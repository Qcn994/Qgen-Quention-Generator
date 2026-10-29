# 审查请求：D2 领域与数据（含重试语义）

## 背景与目标

D1 已关闭，按 K3 的 D2 DoD 交付：① 必测清单 11 项全绿（剩余 5 项随对应模块落地）；② 重试语义按计划第十五节「D2 重试设计」实现；③ D2 待办两条——状态枚举从 domain 派生、`GET /materials` 列表 DTO 接线。

本次变更只覆盖领域实体/规则、Drizzle 表结构 + 迁移、应用层仓库端口与重试用例、契约 DTO 与 web/worker 接线；**不含**解析、LLM 调用与真实出题（D3 才接）。

## 变更文件清单

### domain（新增）

| 文件 | 说明 |
|---|---|
| `packages/domain/src/text/language.ts` | 中/英判定：中文字符占比 ≥0.3 → `zh`；无字母 → `en` |
| `packages/domain/src/chunk/chunk.ts` | 切块实体、`checkChunkBounds`（越界/反向/空区间/ordinal）、`assertChunkSequence`（ordinal 连续、不重叠） |
| `packages/domain/src/kp/knowledge-point.ts` | 知识点构造与校验（importance 1–5、difficulty、examFrequency、chunkIds 非空） |
| `packages/domain/src/misconception/misconception.ts` | 误区构造与校验（statement/whyTempting/correctContrast/severity） |
| `packages/domain/src/question/checks.ts` | 9 种 hard / 4 种 soft 检查类型；soft 权重 .15/.35/.15/.35 |
| `packages/domain/src/question/publish-gate.ts` | `softScoreOf`（分母固定为全部 soft 权重 → 缺项按 0）、`evaluatePublish` |
| `packages/domain/src/question/idempotency.ts` | 幂等键 = `materialId\|kpId\|slot\|promptVersion\|model`；seed 由 `materialId\|slot\|promptVersion` 派生（不进 key） |
| `packages/domain/src/paper/blueprint.ts` | 题量/KP 数 clamp 公式、中英配比最大余数法、按 importance 顺序分配 |
| `packages/domain/src/attempt/attempt.ts` | 作答实体，判分调用 `gradeObjective` |

### domain（修改）

- `packages/domain/src/question/question.ts`（:12 附近）：`Question` 增加 `materialId`
- `packages/domain/src/question/answer-key.ts`：`CreateQuestionInput` 增加必填 `materialId` 并回填
- 测试夹具补 `materialId`：`answer-key.test.ts`、`question-state.test.ts`、`publish-gate.test.ts`
- `packages/domain/src/index.ts`：导出上述新模块

### application

- `packages/application/src/ports/content-repositories.ts`（新）：`ChunkRepository` / `KnowledgePointRepository` / `QuestionRepository` / `AttemptRepository`
- `packages/application/src/ports/repositories.ts`：`JobRepository.requeue(id, now): Promise<boolean>`，注释写明「UPDATE 原行、不放宽唯一索引」
- `packages/application/src/use-cases/retry-material.ts` + `retry-material.test.ts`（新）：`not_found` / `no_failed_stage` / 成功三分支
- `packages/application/src/index.ts`：导出新端口与用例

### infrastructure

- `packages/infrastructure/src/db/schema.ts`（重写）：枚举从 domain 派生（`MATERIAL_STATUSES` / `QUESTION_TYPES` / `QUESTION_STATUSES`）；新增 `chunks`、`knowledge_points`、`misconceptions`、`questions`、`question_source_refs`、`question_checks`、`attempts`、`review_cards`
- `packages/infrastructure/drizzle/0001_hesitant_sentinels.sql` + `meta/`（新）：139 行，建 8 表 + 索引（含 `uq_questions_idempotency_key`、`uq_chunks_material_ordinal`）
- `packages/infrastructure/src/db/repositories/jobs.repo.ts`：`requeue()`；`claimNext` 补原子认领注释（Minor 1 的归位）

### contracts / web / worker

- `packages/contracts/src/index.ts`：`materialStatusSchema`/`jobStatusSchema`/`questionTypeSchema` 全部 z.enum 自 domain 常量；新增 `materialListSchema`、`jobProgressSchema`、`retryResponseSchema` 及对应类型；`package.json` 增加 `@qgen/domain`、`@qgen/application` 依赖
- `apps/web/src/server/dto.ts`（新）：`toMaterialDto` / `toMaterialList` / `toProgressResponse`，出口统一 `schema.parse`
- `apps/web/src/server/container.ts`：装配 `retryMaterial`
- `apps/web/src/app/api/v1/materials/route.ts`：写临时文件 → ingest → rename（Major 2 已修）；GET 改用 `toMaterialList`
- `apps/web/src/app/api/v1/materials/[id]/retry/route.ts`（新）：404 / 409 / 200
- `apps/web/src/app/page.tsx`：改用 contracts 类型；失败态新增「重试失败阶段」按钮 + `pollToken` 重启轮询
- `apps/worker/src/main.ts`：`MAX_ATTEMPTS = 2`，`attempt < 2` 回队、否则 `failed`；保留「关停不打断阶段」

## 关键符号

- `detectLanguage`（`text/language.ts:18`）、`HAN_RATIO_THRESHOLD`（:13）
- `createChunk`（`chunk/chunk.ts:59`）、`checkChunkBounds`（:79）、`assertChunkSequence`（:110）
- `createKnowledgePoint`（`kp/knowledge-point.ts:61`）、`createMisconception`（`misconception/misconception.ts:52`）
- `HARD_CHECK_TYPES` / `SOFT_CHECK_TYPES` / `SOFT_CHECK_WEIGHTS`（`question/checks.ts:6,20,30`）
- `softScoreOf`（`question/publish-gate.ts:21`）、`evaluatePublish`（:39）
- `idempotencyKeyMaterial`（`question/idempotency.ts:28`）、`seedMaterial`（:32）、`seedFromDigestHex`（:40）
- `targetKpCount` / `targetQuestionCount` / `typeDistribution` / `allocateQuestionsPerKp`（`paper/blueprint.ts:34,38,45,86`）
- `SqliteJobRepository.requeue`（`jobs.repo.ts:93`）、`RetryMaterial`（`use-cases/retry-material.ts:14`）

## 自测结果

### 1. `pnpm check`（typecheck → lint → test → depcruise）

```
$ pnpm -r --if-present typecheck
packages/domain typecheck: Done
packages/config typecheck: Done
packages/application typecheck: Done
packages/contracts typecheck: Done
packages/evals typecheck: Done
packages/infrastructure typecheck: Done
apps/worker typecheck: Done
apps/web typecheck: Done
$ eslint .
$ vitest run
 Test Files  13 passed (13)
      Tests  75 passed (75)
$ depcruise apps packages --config .dependency-cruiser.cjs
✔ no dependency violations found (65 modules, 112 dependencies cruised)
EXIT=0
```

### 2. 必测清单 11 项 → 测试文件映射（全部已存在且绿）

`question-state` / `answer-key` / `citation-check` / `grading` / `normalize` / `review-schedule`（D1 已有）+ `idempotency` / `chunk-bounds` / `language-detect` / `blueprint` / `publish-gate`（本次随模块落地，未先代码后补票）。

### 3. 迁移

```
$ pnpm db:migrate
$ tsx src/db/migrate.ts
[db] migrated C:\Users\lenovo\Desktop\QGen\data\qgen.db
```

```
sqlite_master 表：attempts, chunks, knowledge_points, llm_cache, materials,
misconceptions, processing_jobs, question_checks, question_source_refs,
questions, review_cards（+ __drizzle_migrations, sqlite_sequence）
```

### 4. 重试语义端到端（`pnpm dev` 实跑，输出去自真实请求）

**自动重试**（插入 material `m-auto2` + job `stage='boom'`）：

```
[worker] m-auto2 boom 第 1 次失败，重新入队: 未知阶段: boom
[worker] m-auto2 boom 失败（已用满 2 次尝试）: 未知阶段: boom
GET /api/v1/materials/m-auto2/progress →
{"material":{"id":"m-auto2",...,"status":"failed"},
 "job":{"stage":"boom","status":"failed","progress":0,"error":"未知阶段: boom"}}
```

**手工重试**（m-retry2：job `parse` 预置 `status=failed, attempt=2`）：

```
POST /api/v1/materials/m-retry2/retry
{"id":"m-retry2","status":"processing","stage":"parse"}   HTTP=200
# 5 秒后
GET /progress → {"material":{...,"status":"ready"},"job":{"stage":"chunk","status":"done","progress":100,"error":null}}
# 原 job 行：{stage:'parse', status:'done', attempt:3, progress:100, error:null}
# 再重试 → 409 {"error":{"code":"no_failed_stage",...}}
# 未知材料 → 404 {"error":{"code":"not_found",...}}
```

已上传的真实材料 `d2-e2e.txt` 走完 parse→normalize→chunk→ready；对 ready 材料 POST retry 返回 409。测试行与上传文件已清理。

### 5. 前端重试按钮

`apps/web/src/app/page.tsx` 在 `material.status === 'failed'` 时渲染按钮，POST 成功后 `pollToken + 1` 重启轮询。**仅通过 typecheck，未做浏览器点击实测**（本次未起浏览器），如实标注。

## 已知风险与不确定点

1. **缺失的 hard check 不阻断发布**：`evaluatePublish` 只在「存在的 hard check 失败」时 block；`blind_solve`（难度 ≤3 才适用）与 `answer_contrast`（4–5 才适用）的可适用集合依赖难度分层，D2 尚未建模，因此没有强制"9 种 hard 必须齐"。soft 侧已 fail-closed（缺项按 0）。
2. `allocateQuestionsPerKp` 顺序填满：题量不足时低 importance 的 KP 会分到 0 题（计划第五节的规则本身），不是均匀分配。
3. `assertChunkSequence` 只禁止重叠，允许块间空隙（被丢弃的页眉页脚/空白），不要求首尾相接。
4. 内容仓库端口只有接口，没有 SQLite 实现——D3 接流水线时落地，届时需验证 `questions` 的 json 列与 `Question` 实体的互转。
5. 手工重试一个 `attempt` 已到 2 的 job，会再获得恰好 1 次尝试（`claimNext` 自增到 3 后即失败标 failed）；这是「attempt 不清零」裁决的直接结果。
6. worker 日志有 `[worker] [worker]` 双前缀（concurrently 前缀 + 自身前缀），D1 起就存在，属噪声。

## 请重点审查的问题

1. **发布门禁的 hard 侧 fail-open**：如风险 1，是否应在 D2 就引入"可适用 hard check 集合"参数（由难度分层决定），还是按计划留给 D3 校验器阶段？现在的实现会不会让"质检没跑"的题在 D3 误发布？
2. **`softScoreOf` 的分母**固定为全部 soft 权重之和（1.0），而非"已运行检查的权重和"。这符合 fail-closed，但若后续某检查对某题型无条件不适用（例如判断题不测 answer_leakage），是否应改为按适用集合归一化？哪种更安全？
3. **`detectLanguage`** 用「汉字数 / 字母数」≥0.3 判中文、无字母判英文；对中英混排的考试材料（英文术语夹在中文段落）是否稳健？阈值 0.3 请确认。
4. **幂等 seed 派生**取 `sha256` 前 8 位十六进制转 int（32 位）。同一 `(materialId, slot, promptVersion)` 重跑必然相同；但跨材料碰撞概率 ~2^-32。对 M0（单用户、每材料数十题）是否可接受，还是应扩到 12 位？
5. **重试语义**：手工重试不重置 `attempt`，因此 attempt=2 的 job 只多一次机会；若用户点了重试仍失败，按钮会再次出现并可再次重试——这样"每次手点给一次机会"是否符合第十五节裁决的本意？

## Kimi K3 审查意见（原文）

# K3 审查结论：D2 领域与数据（第五轮）

## 复测声明

未采信自测输出，独立复核：沙箱外复跑 `pnpm check` **EXIT=0**——typecheck 8 包全过、eslint 干净、**13 测试文件 / 75 用例**、depcruise **65 模块 / 112 依赖 0 违规**，数字与声称逐项一致。必测清单 11 项映射核对无误（13 文件 ⊇ 11 必测），剩余 5 项确随模块落地，无"先代码后补票"。重试语义与计划第十五节逐条比对一致：`jobs.repo.ts` L93-101 UPDATE 原行、attempt 不清零、`main.ts` L88-98 `attempt < 2` 回队否则 failed、唯一索引未动。D2 待办两条已关闭（contracts L1-12 枚举派生自 domain、列表 DTO 已接线）。

**结论：无 Blocker；2 Major / 1 Minor / 1 Nit。Major 修复后关闭，D3 等关闭再开工。**

---

## 🟡 Major 1：`documents` 表缺失——引用坐标系没有持久化 home

计划 L129 定义 `documents`（`material_id, normalized_text, normalization_version, pages`）为**引用坐标系**，计划称溯源为"成败关键"。D2 建了 `chunks`（含 `char_start/char_end`），但 chunk 的字符区间指向的那份 normalized_text **没有表可存**。D3 的 normalize 阶段产出无处落盘，citation-check 要切片的 docText 也没有来源。

这条必须在 D3 前补，且**现在补最便宜**：等 D3 fork 出数据再加，面临的是 normalized_text 回填与 `normalization_version` 变更导致旧区间失效（计划 L148 已警告）的迁移包袱。要求：补 `documents` 表 + 一次新迁移，字段含 `normalization_version`；不需要仓储实现（D3 落地）。

## 🟡 Major 2：发布门禁 hard 侧 fail-open（指定问题 1，裁决：现在就修）

`evaluatePublish` L42 只拦"存在且失败"的 hard check。这意味着 D3 里**任何一次校验器静默漏跑**（难度判定 bug、超时跳过、厂商故障）都会变成"没跑 = 通过"——发布门禁是信任命门，这里必须 fail-closed。

**裁决**：给 `evaluatePublish` 加第三个参数 `applicableHardChecks: readonly HardCheckType[]`，**默认值为全部 9 种**（缺省即最严）；门禁要求"可适用的 hard check 全部存在且通过"，缺项即拒发。难度分层（盲解 ≤3 / 答案推导 4–5）的适用集合**由 D3 校验器计算后传入**，domain 不建模难度规则——这样难度策略变化不改 domain。补一个"可适用但缺失即拒发"的测试用例。改动约 10 行，随本轮一起修。

## Minor

`questions` 表缺计划 L133 的 `quality_score` / `checks_summary` 冗余列。可从 `question_checks` 派生，M0 不需要；**记录进 M1 待办**，不堵 D2。

## Nit

worker 日志 `[worker] [worker]` 双前缀（concurrently 前缀叠加）。噪声，不处理。

---

## 五个指定问题的回答

**Q1**：见 Major 2——现在修，不留给 D3。
**Q2（softScoreOf 分母）**：**保持固定分母，不改**。fail-closed 方向正确；按适用集合归一化会让"漏跑"变成隐身。D3 校验器合同加一条硬规则：4 种 soft check 必须全部出具，不适用时以**得分**表达，禁止缺省。漏跑会被分数拖下水，这正是我们要的信号。
**Q3（detectLanguage 0.3）**：**接受 0.3，无证据不调参**。已知风险面是按字母数而非词数——代码/公式密集的中文材料字母膨胀可能翻转判定。D3 spike 的 5 份真实材料必须含 1 份中英混排/术语密集样本，用实测说话。
**Q4（seed 32 位）**：**接受，不扩 12 位**。seed 碰撞的后果只是两份材料的变式采样序列相关，不是正确性或安全问题；M0 规模下 2^-32 是噪声。不为假设需求加位宽。
**Q5（手工重试不重置 attempt）**：**符合裁决本意，批准**。attempt 累计是设计而非副作用：每次手点授予恰好一次新尝试，自动重试预算保持有界，手工重试每次都是用户的知情动作。M0 单用户下"失败→按钮再现"可接受。要求在 `retry/route.ts` 注释里补一句语义说明（"每次手工重试 = +1 次尝试"），防止后人误读为 bug。

---

## 处置要求

1. 修 Major 1（documents 表 + 迁移）、Major 2（applicableHardChecks + 测试）后回报，附 `pnpm check` 与迁移输出；两项均小改，预期同批完成。
2. 处理记录落计划第十五节；Minor 记入 M1 待办。
3. `INDEX.md` 维持"待审"，两项 Major 关闭后改"已关闭"。
4. **D3 开工条件**：D2 关闭。D3 spike 附加准入：5 份材料含中英混排样本（Q3）；校验器合同落实"soft check 不缺省"（Q2）；D3 接长任务时复审 D1 Blocker 1 修复在分钟级阶段下的表现。

---

**给用户的说明**：D2 主体质量扎实——75 用例真实全绿，重试语义与裁决逐字吻合，开发者主动披露的两个存疑点（fail-open、attempt 语义）都是该问的问题。两个 Major 都是"现在修 10 行、以后修伤筋动骨"的类型：documents 表是引用坐标系的家，发布门禁 fail-open 是信任命门。修完即可关闭，D3 spike 随后开工。

## 处理记录（2026-10-25，待 K3 复审）

| 级别 | 意见 | 判定 | 改动 |
|---|---|---|---|
| Major 1 | `documents` 表缺失 | **接受，已修** | 新增 `packages/domain/src/material/document.ts`（`Document` / `DocumentPage`，含 `normalizationVersion`）；`schema.ts` 新增 `documents` 表（`normalized_text`、`normalization_version`、`pages` json，`uq_documents_material_version` 唯一索引 + 级联删除）；drizzle-kit 生成 `drizzle/0002_great_puck.sql` 并已应用。仓储实现按裁决留给 D3 |
| Major 2 | 门禁 hard 侧 fail-open | **接受，已修** | `evaluatePublish(question, checks, applicableHardChecks = HARD_CHECK_TYPES)`；新增阻断原因 `hard_check_missing`；测试从 7 增至 9 条（全部适用 hard 全通过才发布、缺项拒发、显式适用集合外不要求） |
| Minor | `quality_score` / `checks_summary` | **接受（延后）** | 记入 M1 待办：M0 由 `question_checks` 派生，不建冗余列 |
| Nit | worker 日志双前缀 | 不处理 | 噪声 |
| Q2 | soft 分母固定 | 接受裁决 | 保持实现；D3 校验器合同要求 4 种 soft check 全部出具、不适用以得分表达 |
| Q3 | 语言检测阈值 0.3 | 接受裁决 | 不调参；D3 spike 材料清单增列"1 份中英混排/术语密集样本" |
| Q4 | seed 32 位 | 接受裁决 | 不扩位宽 |
| Q5 | 手工重试 +1 次尝试 | 接受裁决 | `apps/web/src/app/api/v1/materials/[id]/retry/route.ts` 注释补语义说明 |

### 自测输出（修复后）

```
$ pnpm check
 Test Files  13 passed (13)
      Tests  77 passed (77)
✔ no dependency violations found (66 modules, 113 dependencies cruised)
EXIT=0

$ pnpm db:generate
documents 6 columns 1 indexes 1 fks
[✓] Your SQL migration file ➜ drizzle\0002_great_puck.sql

$ pnpm db:migrate
[db] migrated C:\Users\lenovo\Desktop\QGen\data\qgen.db

sqlite_master 表：..., chunks, documents, ...（documents 已建，uq_documents_material_version 存在）
```

状态：**待复审**。INDEX 保持「待审」，收到复审通过后改「已关闭」。
