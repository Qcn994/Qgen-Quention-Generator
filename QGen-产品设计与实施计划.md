# QGen（中文名：知题）— AI 材料出题学习产品 · 设计与实施计划

## Context

用户要做一个 toC 学习产品：上传任意学习材料（教材、讲义、PPT、笔记），系统解析要点、辨析易错点并自动出题，帮助学生备考。

已确认的关键决策：

- **首批用户**：老师（用自己的材料批量出卷）+ 大学生/成人考证考生（考研、四六级、教资、CPA、法考、公考）。
- **当前目标（2026-10-24 修订）**：只跑通核心链路 `上传 → 出题 → 练习 → 订正 → 复习`；**暂不做定价、支付、额度、会员**。
- **首版形态**：本地单用户纵向切片（localhost，无登录/无 OSS/无队列）；验证通过后再做多用户 Web；小程序更晚。
- **语言**：中文材料出中文题，英文材料出英文题；UI 中文；不做中英对照/互译。
- **复习 v0**：固定间隔 1/3/7/15 天 + 知识点正确率；数据结构按 FSRS/Elo 预留，后续平滑升级。
- **合规（OPC 前）**：仅私有内测；材料默认私有；**关闭跨用户缓存**；保留上传权利声明与最小隐私告知；备案/ICP/支付等 OPC 后办理。
- **资源**：一人全栈，偏 JS/TS → TypeScript 模块化单体（**M0 双进程：Next + 独立 `tsx` worker，由 `pnpm dev` 用 concurrently 同时拉起**；M1 把 worker 换成 pg-boss 消费者，不改领域代码）。
- **产品命名**：QGen（中文名：知题）。
- **项目目录**：`C:\Users\lenovo\Desktop\QGen`（文档与代码同处）。
- **修订**：2026-10-24 完成 K3 第一轮审查（第十五节），并按"核心链路优先"重排实施路线（第二节）。
- **协作模式**：本会话的 AI 编码代理为开发者（运行于 Claude Code 兼容层，底层模型标识为 `deepseek-flash`）；Kimi K3 为独立代码审查者，与开发者共用同一工作区，可直接读取源码与 diff；用户负责转达要审的变更并裁决争议。
- **开发环境**：Node v24 已装；M0 用 SQLite，**不需要 Docker**；M1 再安装 Docker Desktop 运行 Postgres + pgvector。
- **模型密钥**：M0 用现有 `DASHSCOPE_API_KEY`（Qwen）；用户补充 DeepSeek 与豆包/智谱密钥后，M1 启用跨厂商质检。

目标产出：先用 **5–7 天**在本地跑通 M0 核心闭环；再用 **3–4 周**完成 M1 多用户内测；商业化（M2）在 OPC 注册与核心数据验证之后启动。

---

## 一、产品定义：不是"AI 出题器"，是"学习闭环引擎"

市面上的产品本质是一个 prompt：上传 PDF，吐 10 道选择题。可复制、无留存、遇到扫描版中文教材立刻崩。

**知题要做的是**：针对某个知识点，告诉学习者——*你踩中的是哪个具体误区、你材料里的哪句话能推翻它、以及一道专门冲着你这个误区设计的新题，安排在你即将遗忘的那天出现*。

### 三个复利资产（真正的壁垒）

1. **题目质检语料**：每道题记录全部校验结果、模型判定、老师修改、学生申诉。积累 5 万题后，拥有中文考试场景下"什么样的题是有效题"的标注数据集 → 驱动 prompt 迭代、模型路由、最终训练廉价校验器。**生成质量不是壁垒，对生成质量的度量才是。**
2. **易错点图谱**：每个干扰项都为某个 `misconception_id` 而设计。答错不再是二元事件，而是"你把行政处罚和行政强制搞混了"的取证。个人 × 误区的命中次数、纠正状态构成"为什么错"的画像——这是用户付费的真正理由，纯 wrapper 抄不走。
3. **跨用户内容缓存**：考生用同样的教材。缓存 `chunk_hash → 知识点/易错点/已验证题目`。第一个用户分摊 ¥2.4，第 500 个用户边际成本 ≈ ¥0.03。这是免费额度可行的前提，也是纯 wrapper 结构上做不到的。**（OPC 前关闭；M2 经法务确认并取得上传者授权后启用。）**

### 核心闭环

```
上传 → 结构化解析（带字符区间的 chunk）→ 考点提取 + 易错点辨析
→ 出题蓝图（题型×难度×知识点覆盖）→ 生成（每个干扰项绑定误区）
→ 自动质检（异构模型盲解、干扰项质询、引用校验、去重）
→ 作答 → 逐项判分 → 错因归因 → Elo 掌握度 → FSRS 排期
→ 薄弱点定向变式重练 → 新证据回到闭环
```

闭环真正合上是在 **诊断→重练**，不是出题。多数竞品停在"生成完"。

> M0 先用简化版闭环：错误率分档代替 Elo、固定间隔代替 FSRS；数据字段按目标态预留，M1 再升级算法，不改表结构。

**定位语**：把教材变成会盯着你错处出题的家教。

---

## 二、实施路线（2026-10-24 重排：核心链路优先）

### M0 本地纵向切片（当前任务，目标 5–7 个工作日）

**`pnpm dev` 一条命令跑通** `上传 → 出题 → 练习 → 订正 → 复习`（内部用 `concurrently` 同时启动 Next 与独立 worker 进程），浏览器打开 localhost 即全流程可用。单用户、无登录、无对象存储、无队列、无支付。`pnpm eval` 只服务 spike 与回归，不是产品形态。

| 模块 | M0 范围 | 相对目标态的裁剪 |
|---|---|---|
| 运行形态 | Next.js localhost + 独立 worker 进程（`pnpm dev` 一条命令用 concurrently 拉起） | 不做部署、不做多用户 |
| 输入 | 本地 PDF / DOCX / PPTX / TXT；≤200 页 | 不做扫描件、图片、URL |
| 语言 | 自动检测材料语言；中文材料出中文题，英文材料出英文题 | 不做翻译、不做中英对照 |
| 流水线 | **独立 worker 进程（`tsx watch`）**执行；通过 SQLite `processing_jobs` 表通信；前端每 2 秒轮询 `/api/v1/materials/:id/progress` | 无 pg-boss、无 SSE；worker 全局串行 FIFO；**阶段级恢复**（跳过已完成阶段，不整份重跑）；该 worker 即 M1 pg-boss 消费者的雏形 |
| 生成 | 单选/多选/判断；默认 20–40 题，随页数公式最多 60（见第五节） | 不做填空、简答、组卷 |
| 质检 | schema、引用精确匹配、答案唯一、盲解 **2/2**（同厂商两次：temperature 0.7 的不同采样 + 两种措辞 prompt——一次直接作答、一次先推理再作答）、simhash 去重 | 跨厂商质检等密钥到位再加；同族相关性使该检查信息量有限，M0 人工复核改为**每份材料全检** |
| 练习 | 10/20 题一场，即时判分 | 不做考试模式、计时 |
| 订正 | 逐选项解析、**引用原文 + 页码 + 所在 chunk 上下文**、每道干扰项一个 `trap_reason` | 不做 PDF 原页坐标高亮（M1）、不做跨题误区图谱 |
| 复习 | 固定 1/3/7/15 天 + 知识点正确率 | 不上 FSRS/Elo（数据结构预留） |
| 数据 | SQLite + Drizzle；文件存本地 `data/` | 不上 Postgres/pgvector/OSS；**不做 embedding**（去重只用 simhash，M1 随 pgvector 一起上） |
| LLM 缓存 | SQLite `llm_cache` 表，key = `sha256(model|prompt_version|temp|messages)` | 无断点续跑的唯一补偿：中途失败重跑近乎免费 |
| 成本 | 每材料记录 token 与费用，硬上限 ¥15 | 无计费、无额度 |
| 质量门 | 每份材料**全检**（不抽检），硬错误 ≤5% | 与 spike 门槛一致；达不到先补第二家厂商密钥，或改为老师审核发布 |

**M0 完成定义**：拿 5 份真实材料（3 中文、2 英文，含 1 份两栏 PDF）跑完整链路，产出可作答、可订正、可复习的题目；**每份材料的已发布题全检（不做抽检）**，硬错误 ≤5%；全程不需要手工改数据库。

**SQLite 的取舍**：M0 用 SQLite 是为了摆脱 Docker/Postgres 安装依赖，代价是 M1 要重写 infrastructure 适配器（domain/application 因端口隔离不受影响）。若 Docker 在半小时内装好，可跳过 SQLite 直接用 Postgres，省一次迁移。

### M1 多用户 Web 内测（M0 达标后，目标 3–4 周）

- Postgres + pgvector、手机号 OTP、OSS、pg-boss、SSE、多用户隔离、阿里云部署。
- 跨厂商质检（DeepSeek/豆包或智谱）、完整发布门禁、eval harness、管理后台（隔离队列/成本台账）。
- **跨用户缓存保持关闭**（OPC 前不启用）。
- 邀请 10–20 人内测；质量门收紧到硬错误 ≤5%。
- 仍不做支付、额度、会员。

### M2 老师端与商业化（OPC 注册且核心数据验证之后）

- 老师组织账号、批量上传、题库检索、组卷、DOCX/PDF 导出。
- 微信小程序（Taro 复用 API）。
- 额度、会员、微信支付（依赖主体与商户号）、生成式 AI 备案与经营性合规。
- 填空/简答题型、FSRS/Elo 正式版、跨用户缓存（法务确认后）。

### 明确不做（M0/M1 阶段）

- 不做定价、支付、额度、会员；不做小程序/App。
- 不做公开题库市场或社区（版权+审核+信任灾难）；不做手写笔记 OCR、图表理解、音视频；不做作文/口语；不做中英对照/互译，不做中英之外的语言；不做实时协作/LMS 集成；不做私有化部署与微调（没到 5 万标注题之前）。
- **扫描版/图片输入放 M1 后期或 M2**：OCR 错误会污染引用，引用污染会污染质检，最终摧毁信任。考研/CPA/法考的考生本来就持有电子版，先把可信路径跑通。

---

## 三、领域模型

### 实体关系

```
User 1─* Material 1─* Chunk *─* KnowledgePoint *─* Misconception
  │                    │            │                  │
  │                    └─* Question *┘                  │
  │                          │ 1─* QuestionSourceRef ──┘ (chunk + 字符区间 + 原文)
  │                          │ 1─* QuestionCheck
  │                          │ 1─* Attempt ──* Mistake
  │                          └─1 ReviewCard (FSRS)
  ├─* Mastery（按知识点）
  ├─* MisconceptionHit（按误区）
  └─* PracticeSession
Organization 1─* Membership *─1 User        (M2)
Paper 1─* PaperItem *─1 Question 1─* Export (M2)
UsageLedger / LlmCache / PromptVersion / ModerationLog / AuditLog
```

### 核心表（Postgres）

- `materials`：`owner_id, source_type, content_hash, page_count, char_count, exam_profile_id, status(uploaded|processing|ready|partial|failed|archived), parse_quality jsonb`
- `documents`：`material_id, normalized_text, normalization_version, pages jsonb` — **引用坐标系**
- `chunks`：`material_id, ordinal, heading_path text[], text, char_start, char_end, page_start/end, content_hash, embedding vector(1024)`；`text+char_start` 是溯源基础，`content_hash` 是跨用户缓存键
- `knowledge_points`：`material_id, parent_id, name, canonical_name, summary, importance 1-5, exam_frequency, difficulty, chunk_ids uuid[], evidence_quotes jsonb`
- `misconceptions`：`kp_id, statement, why_tempting, correct_contrast, severity, evidence jsonb`
- `questions`：`type, stem, options jsonb（每项带 misconception_id）, answer jsonb, explanation, difficulty_est, difficulty_empirical, kp_ids, primary_kp_id, status, quality_score, checks_summary, stem_hash, simhash, embedding, duplicate_of, generation_meta（model/prompt_version/seed）, idempotency_key, parent_question_id, version`
- `question_source_refs`：`question_id, chunk_id, quote, char_start, char_end, page_no, role(answer_basis|distractor_basis|context)`
- `question_checks`：`check_type, severity(hard|soft), passed, score, model, details jsonb`
- `attempts`、`mastery`、`misconception_hits`、`review_cards`、`processing_jobs`、`usage_ledger`、`llm_cache`

### 溯源表示（成败关键）

引用坐标系 = `documents.normalized_text` + `normalization_version`。每个引用同时存**原文片段**与 `[char_start, char_end)`。校验时：

```ts
const slice = doc.normalized_text.slice(ref.charStart, ref.charEnd);
const ok = normalizeForCompare(slice) === normalizeForCompare(ref.quote);
// 文字层要求完全一致；OCR 容错相似度 ≥ 0.92
```

`normalizeForCompare`：中文 = NFKC → 折叠空白 → 统一标点 → 去零宽字符；英文 = **不做大小写折叠**（保证引用精确性）→ 折叠空白 → 修复行尾断字（`exam-` + 换行 + `ple` → `example`）→ 统一引号/破折号。归一化版本变化时旧区间失效或只读保留。

### 状态机

```
题目：candidate → verifying → auto_passed → published → retired
                     ├→ needs_review →(老师通过)→ published
                     ├→ quarantined →(修复)→ verifying
                     └→ rejected
published →(2 次独立申诉/老师下架/发现重复)→ quarantined
```
只有 `published` 对学习者可见。

```
材料：uploaded → processing →(ready | partial | failed) → archived
```
`partial` = 阶段产出可用但覆盖不足（如 38/60 题通过），UI 显示"已完成 82%，部分章节未识别"，支持只重试失败阶段。

---

## 四、代码分层架构

### 仓库结构（pnpm workspace，根目录 `C:\Users\lenovo\Desktop\QGen`）

```
apps/
  web/                          # Next.js App Router，仅做交付层
    src/app/(marketing)/
    src/app/(app)/materials/...
    src/app/api/v1/materials/route.ts
    src/app/api/v1/materials/[id]/events/route.ts   # SSE
    src/server/container.ts     # 组合根（web 角色）
  worker/                       # 常驻 Node 进程
    src/main.ts                 # 启动 pg-boss，注册消费者
    src/consumers/material-pipeline.ts
    src/consumers/question-item.ts
    src/consumers/export-paper.ts
packages/
  domain/                       # 零依赖纯 TS，禁止 zod/Drizzle/SDK/Date.now()
    src/material/material.ts
    src/question/question.ts
    src/question/question-state.ts
    src/question/answer-key.ts
    src/kp/knowledge-point.ts
    src/misconception/misconception.ts
    src/attempt/attempt.ts
    src/mastery/elo.ts
    src/review/fsrs-policy.ts
    src/paper/blueprint.ts
  application/                  # 用例 + 端口，只依赖 domain
    src/ports/{repositories,llm,queue,storage,extractor,ocr,moderation,payments,clock,unit-of-work}.ts
    src/use-cases/{ingest-material,run-stage,generate-questions,verify-question,
                   publish-question,grade-attempt,update-mastery,schedule-review,
                   regenerate-variants,assemble-paper,enforce-quota}.ts
  infrastructure/               # 适配器，唯一允许出现 SQL/HTTP/SDK 的地方
    src/db/schema.ts            # Drizzle
    src/db/repositories/*.repo.ts
    src/llm/gateway.ts          # 分层路由、重试、缓存、成本计量
    src/llm/providers/{deepseek,qwen,doubao}.ts
    src/llm/prompts/<name>.v<N>.ts   # 发布后不可变
    src/queue/pg-boss-queue.ts
    src/storage/oss-storage.ts
    src/parsing/{pdf-extractor,docx-extractor,pptx-extractor,text-extractor,normalize,chunker}.ts
    src/moderation/aliyun-moderation.ts
    src/payments/wechat-pay.ts
  contracts/                    # zod DTO + 错误码，web/worker 共享
  config/                       # 环境变量、模型路由表、开关
  evals/                        # 金标准集 + prompt 回归
db/migrations/
```

### 依赖规则（CI 强制，不靠自觉）

```
apps/web ──▶ application ──▶ domain
apps/worker ─▶ application ──▶ domain
                  ▲
          infrastructure（实现端口）
```

- `domain` 只 import TypeScript；时间走 `Clock` 端口。
- `application` 只 import domain + 自己的端口，**绝不 import infrastructure**。
- `infrastructure` 实现端口，唯一允许写 SQL/HTTP/SDK。
- `contracts` 是叶子；domain 不依赖它。
- 用 `dependency-cruiser` 禁止：`domain→infrastructure`、`domain→zod`、`application→drizzle`、`application→infrastructure`、`packages→apps`。违规必须让构建失败。

### 端口/适配器

| 端口 | 适配器 |
|---|---|
| `MaterialRepository` 等仓储 | Drizzle/Postgres |
| `UnitOfWork.runInTransaction` | Drizzle 事务 + pg-boss 事务发送 |
| `JobQueue.enqueue/register` | pg-boss |
| `ObjectStorage` | 阿里云 OSS（私有桶、签名 URL 15 分钟） |
| `TextExtractor`（按 MIME 注册） | pdfjs-dist / mammoth / PPTX XML / 纯文本 |
| `LlmClient.complete({tier, schema, messages})` | 多厂商网关（DeepSeek/Qwen/豆包/GLM） |
| `EmbeddingClient.embed` | Qwen text-embedding-v3（1024 维） |
| `ContentModerator.check` | 阿里云内容安全 + 本地敏感词 |
| `PaymentProvider` | 微信支付 v3 |
| `Clock / IdGenerator / Logger / ProgressNotifier` | 系统实现 |

### 异步流水线与进度

> 本节描述 **M1 目标态**。M0 用等价的简化实现：独立 `tsx watch` worker + SQLite `processing_jobs` + 2 秒轮询，替换 1–5 步中的 pg-boss 与 SSE（见第二节 M0 表）。

1. `POST /api/v1/materials`（multipart + `Idempotency-Key`）→ `IngestMaterial` 在一个事务内：存 OSS、插 `materials`、插首个 `processing_jobs`、**同事务内** `queue.enqueue`。
2. worker 消费 `material.parse` → `RunStage`；每阶段完成后插入下一阶段任务，出题阶段扇出为每项一个任务。`singletonKey = materialId:stage` 让重复入队自动折叠。
3. 阶段边界与每 N 题更新 `processing_jobs.progress`，并 `pg_notify`。
4. 客户端订阅 `GET /api/v1/materials/:id/events`（SSE）：路由处理器用独立 pg 连接 `LISTEN`，转发 `event: progress`，15 秒心跳，`event: done` 关闭；`Last-Event-ID` 支持断点续传。
5. 兜底：`GET /api/v1/materials/:id/progress` 轮询（Taro/小程序用这个）。

**M0 worker 执行语义（替代上面 1–5 步）**：

```
- 全局串行：worker 按 processing_jobs.created_at FIFO 一次处理一份材料；
  材料内部题目级任务可并行（并发 10）。
- 失败不阻塞：单任务重试 2 次后标 failed 并让位下一任务；材料可标 partial，
  队列不因一份坏材料饿死。
- 阶段级恢复：worker 重启后跳过 processing_jobs 中已完成的阶段，只重跑中断阶段；
  已完成阶段内的 LLM 调用由 llm_cache 命中。不是"整份重跑"——10 分钟流水线
  不能因为 tsx watch 重载就从解析开始。
- 冷启动清理：worker 启动时把 status = running 的僵尸任务重置为 pending。
```

选 SSE + LISTEN/NOTIFY 而非 WebSocket：单向、易代理、无额外连接状态。不默认轮询：6 分钟流水线 2 秒轮询 = 每份材料 180 次请求。

约束：`pg_notify` payload 上限 8KB，只发进度摘要（阶段、百分比、计数），**不发题目正文**；多实例部署时每个 web 实例各持一个 `LISTEN` 连接，M0/M1 单实例不构成问题，水平扩展前需改为广播方案。

### 关键 API

```
POST/GET /api/v1/materials            上传/列表
GET  /api/v1/materials/:id/events     SSE 进度
POST /api/v1/materials/:id/retry      只重试失败阶段
GET  /api/v1/materials/:id/questions
GET  /api/v1/questions/:id            含 source refs
POST /api/v1/practice-sessions        {mode, materialId?, kpIds?, count}
GET  /api/v1/review/due
POST /api/v1/attempts                 客观题同步判分，简答 3 秒内
GET  /api/v1/mastery?materialId
GET  /api/v1/analytics/weak-points
POST /api/v1/billing/orders
```

---

## 五、生成流水线

| # | 阶段 | 模型档 | 并发 | 产出 | 失败处理 |
|---|---|---|---|---|---|
| 1 | 解析 | 无（OCR 走云 API） | 1/材料 | pages[] | 2 次重试；失败给可操作提示 |
| 2 | 归一化 | 无 | — | normalized_text + 版本 | 确定性，不变量测试 |
| 3 | 切块 | 无 | — | chunks + embedding | 0 块则失败 |
| 4 | 考点提取 | cheap | 6 | 每块知识点 | 单块重试 3 次；≥60% 块成功则继续并标 partial |
| 5 | 知识点合并 | cheap | 1 | 规范知识点 | 降级为字符串归一 |
| 6 | 易错点辨析 | strong | 4 | 每 KP 1–3 条 | 允许缺失，不致命 |
| 7 | 出题蓝图 | strong | 1 | 题位 slots[] | 降级为考试画像默认配比 |
| 8 | 单题生成 | strong | 10 | 1 题 | 单题 2 次 + 1 次修复；失败记日志不致命 |
| 9 | 质检 | **异构厂商** | 10 | 校验包 | **fail-closed**：校验器不可达→需要人工，绝不自动发布 |
| 10 | 去重 | embedding + simhash | — | duplicate_of | 失败则跳过并标 needs_review |
| 11 | 落库发布 | 无 | 1 | questions + checks | 逐题事务 |

**跨厂商质检不可妥协**：生成用 Qwen，校验用豆包/GLM（反之亦然）。同族模型共享盲区，相关性错误正是摧毁信任的失败模式。

### 题量与考点粒度（蓝图硬规则）

```
KP 数 ≈ clamp(页数 / 3, 15, 60)          // 每 3 页一个考点，下限 15，上限 60
总题量 ≈ clamp(页数 / 2, 20, 60)         // M0 目标 20–40 题，上限 60
每 KP 题数 = ceil(总题量 / KP 数)，importance 4–5 的 KP 优先分满
```

100 页 → 约 33 个 KP、40–50 题，与成本模型的 60 题假设一致。这是蓝图阶段的硬规则，**不让模型自由发挥**；题量触及每材料预算时，优先砍低 importance 的 KP。

### 结构化输出

- 全部 JSON mode + 内嵌 JSON Schema + 一个示例；zod 校验。
- 失败发一次**修复调用**（附原始输出 + zod 错误路径），最多 2 次；仍失败则丢弃并计数。
- **一次只生成 1 题**，不批量 10 题：失败隔离、质量更高、幂等简单、天然并行。仅知识点抽取可 5 块一批。
- prompt 放 `packages/infrastructure/src/llm/prompts/<name>.v<N>.ts`，发布后不可变，`prompt_version` 写入 `generation_meta`。

### 三层幂等/缓存

1. 请求级 `Idempotency-Key`；`processing_jobs.idempotency_key = materialId:stage` 唯一索引；题目 key = `sha256(materialId|kpId|slot|promptVersion|model)`。**seed 不进 key**：seed 由 `sha256(materialId|slot|promptVersion)` 确定性派生（取前 8 位十六进制转 int），保证重跑同 key、同随机序列、不重复计费。
2. 精确 LLM 缓存：`sha256(model|prompt_version|temp|messages)` → 响应。重跑免费。
3. **跨用户产物缓存**：`chunks.content_hash` → 复用已提取的知识点/易错点/已验证题目。服务规则：只把缓存产物挂到 chunk 哈希完全相同的材料上（用户确实上传了同样内容）；绝不复制他人的作答、笔记、编辑。**这是最大的成本杠杆。**

### 重试与熔断

- 429/5xx/超时：指数退避 + 抖动（1s/4s/12s），最多 3 次；schema/校验类 4xx 不重试。
- 厂商熔断：60 秒内连续 5 次失败 → 打开 120 秒，切备用厂商，记 `provider_failover`。
- **成本熔断**：每材料预算 ¥15（按套餐可配），超限停止扇出、发布已有内容、标 `partial: budget_exceeded`。硬停。

### 模型路由

| 档位 | 用途 | 主 | 备 |
|---|---|---|---|
| cheap | 考点抽取、打标 | DeepSeek-chat | Qwen-Plus |
| strong | 易错点、蓝图、出题、简答判分 | Qwen-Max | DeepSeek-V3 |
| verify | 盲解、干扰项质询、忠实度 | 豆包-pro | GLM-4-Plus |
| vision（M2） | 扫描页/公式转写 | Qwen-VL-Max | GLM-4V |

应用层只暴露 `tier`，不出现模型名；映射在 `packages/config/src/models.ts`。

### 语言与题型映射（M0）

- 语言检测：按材料文本的中文字符占比判定（阈值在实现中固定并写入配置），中文材料出中文题，英文材料出英文题。
- 题干措辞模板按语言选择：中文用"下列说法正确的是……"，英文用 "Which of the following..."。
- 蓝图默认配比：中文 单选 50% / 多选 30% / 判断 20%；英文 单选 60% / 多选 30% / 判断 10%（判断题在英文材料中少见，降权）。
- M0 **不做完形填空、匹配题、阅读理解**——语篇级出题是另一套切块与生成流水线，记入 M2。
- **题位可重分配**：若某题型在当前材料里找不到合适考点（英文判断题尤其常见），该题位转给单选，**不强行凑题**；配比是默认值，不是硬约束。题量总数按第五节公式保持不变。

---

## 六、题目质检（生死线）

### 自动检查

| 检查 | 方法 | 级别 | 通过阈值 |
|---|---|---|---|
| Schema | zod | hard | 完全通过 |
| 引用存在 | 归一化原文 === 归一化切片 | hard | 文字层精确；OCR ≥0.92 |
| 引用相关 | 校验模型："该句是否支持正确答案" | hard | 是 |
| 答案唯一 | 单选恰 1 项；多选 ≥2；判断恰 1 | hard | 是 |
| **盲解**（异构模型，难度 ≤3） | 只给题干+选项+原文块，**不给答案**，跑 2 次 | hard | **2/2 正确** |
| **给答案反证**（难度 4–5） | 给出答案，要求从原文推演，并主动寻找"第二个可辩护答案" | hard | 无第二答案 + 推导可溯源 |
| 干扰项质询 | 逐个："根据材料它是否可能正确" | hard | 全部为否 |
| 答案泄漏 | 最长选项、语法不匹配、绝对化词、"以上都" | soft | ≥0.7 |
| 忠实度 | 解析中的论断必须被引用块蕴含 | soft | 无无据论断 |
| 去重 | stem_hash 精确；simhash 汉明 ≤3；embedding 余弦 ≥0.93 | hard | 无命中 |
| 难度合理性 | 估计值 vs 实测 p 值（n≥20） | soft | ±1 档 |
| 内容安全 | 题干/选项/解析 | hard | 干净 |

### 发布门禁

```ts
canPublish(q, checks) =
  allHardChecksPass(checks) &&
  softScore(checks) >= 0.75 &&           // 泄漏 .15 / 忠实 .35 / 难度 .15 / 解析质量 .35
  q.sourceRefs.some(r => r.role === 'answer_basis')
```

**按难度分层，避免系统性过滤难题**：难度 ≤3 要求盲解 2/2；难度 4–5 **不要求盲解全对**——校验模型自己解不出难题，会把高难题全部挡在门外，导致自动发布的题库系统性偏简单、难度覆盖被悄悄截断，进而使"难度合理性"检查与"盲解一致率"互相打架。高难题改用"给答案反证 + 推导溯源"。盲解结果仅作难度校准数据：1/2 可发布但记录，0/2 转 `needs_review`。所有难度带都必须满足"无第二可辩护答案"这一硬条件。

### 失败后的动作

```
schema/引用/重复 → 带具体错误反馈重生成 1 次
盲解不一致     → "独立解答者选了 X，理由如下；要么修正答案/选项，要么重写"
                 → 重新校验一次 → 仍失败则隔离
干扰项被质询   → 只替换该干扰项，再校验（比整题重生成便宜）
校验器不可达   → needs_review，绝不发布
```

### 人工抽检协议

- **上线前**：4 个考试画像 × 共 300 题（考研政治、CPA 会计、法考客观题、教资科目二），2 名独立评分者。缺陷分类：`wrong_key / ambiguous / multiple_defensible / unsupported_explanation / bad_distractor / trivial / formatting`。门槛：硬错误 ≤3%，歧义 ≤7%，Cohen's κ ≥0.6。**这是发布 gate。**
- **内测期每周**：随机 30 道已发布题 1 人复核；滚动 7 天硬错误 >5% 时暂停该画像的自动发布。
- **老师每次修改/驳回都是金标签**：存 diff，作为 few-shot 与回归 eval。
- **学生申诉**：2 次独立申诉只触发优先复核，**不自动下架**；自动隔离需同时满足"近 20 次作答中 ≥5 次申诉且申诉率 >20%"，或由老师/管理员确认；同用户/IP 去重，防止两个账号恶意下架任何题目。

### Eval 工程（第 3 周就建，不要拖）

`packages/evals`：20 个原文块 × 期望知识点；40 道题 × 人工结论；30 个简答判分用例。`pnpm eval` 输出：schema 通过率、引用匹配率、盲解一致率、人工可用率代理、单题成本、p95 延迟。**任何 prompt 变更都必须有 eval 差值才允许上线。**

---

## 七、学习闭环与老师端

### 判分规则

| 题型 | 规则 |
|---|---|
| 单选/判断 | 精确匹配 1/0 |
| 多选 | 默认全对才得分；`exam_profile.partialCredit` 可开启 `max(0, 对-错)/应选`，四舍五入到 0.5（法考/CPA 通常全对全错，教资可能部分给分 → 做成画像配置，不硬编码）。**M0 无画像体系，固定全对才得分。** |
| 填空（**M2**） | 每空等权。归一化：NFKC、全半角、大小写、标点、中文数字↔阿拉伯数字、单位等价、数值相对误差 1e-6、LaTeX 规范化。仍有歧义 → LLM 判定，置信度 <0.7 则两种答案都接受并记日志 |
| 简答（**M2**） | 3–6 个评分点带权重；LLM 返回命中点索引 + 证据片段 + 置信度；置信度 <0.7 显示"AI 评分仅供参考"并提供一键自评；`graded_by` 记录 rule/llm/self/teacher。单次判分约 ¥0.007，必须单独计量 |

**永远不要只显示"错了"**：每次判分返回正确答案、逐选项理由、原文引用与"查看原文"跳转；若选中的干扰项绑定了误区，明确写出"你混淆了 X 和 Y"。

**M0 边界**："查看原文"只展示引用文本、页码与所在 chunk 的上下文段落，**不做 PDF 原页坐标高亮**（两栏坐标映射成本高，M1 再做）。在引用旁标注"已与原文逐字校验"，把校验能力转成用户可感知的信任。

### 掌握度：Elo（不上 IRT）

```
p = 1/(1+10^((d_item-θ_user)/400))
θ' = θ + K*(score-p)          K=32(<5 次) / 16(<20) / 8
d_item' = d_item - K_item*(score-p)   K_item=16（双向 Elo：题目难度同步更新）
d_item 初始 = 1000 + (difficulty_est-3)*120
闲置 >7 天：θ ← 1000 + (θ-1000)*0.995^idle_days
mastery = 1/(1+10^((1200-θ)/400))   // 参考题上的答对概率
```

档位：未学 <0.35 / 薄弱 0.35–0.55 / 掌握 0.55–0.75 / 熟练 >0.75。**5 次作答前只显示"数据不足（3/5）"**。多知识点题：主 KP 全权重，次 KP 0.5。

**冷启动口径（修订）**：题目难度用双向 Elo 随每次作答即时更新，**不再依赖 `n≥20` 才能校准**——单人 toC 场景下一道题很难积累 20 次作答，原设计会让难度永远停在初始估计值。实测 p 值只作监控：跨用户累计 ≥20 次且 ≥5 个不同用户时才展示，用于难度合理性抽查，不作为发布或调度的前置条件。

### 复习：FSRS + 考试日期覆盖

- `ts-fsrs`，每 `(user, question)` 一张卡。
- 目标留存 0.90；**考试 45 天内提到 0.93**，且 `maximum_interval = max(3, days_to_exam/2)`，绝不排到考后。
- 评分映射：对且快（<0.6×中位数）→Easy；对→Good；对但慢→Hard；错→Again。
- 每日上限：新卡 20、复习 200。新卡按考点考试权重排序。

### M0 简化实现（当前阶段，目标态公式留到 M1）

- **掌握度**：不用 Elo，改为按知识点统计正确率分档（<60% 薄弱 / 60–80% 掌握 / >80% 熟练）；作答 <5 次显示"数据不足"。
- **复习**：错题按 1/3/7/15 天固定间隔重现；**答错立即重置回第 1 天档**；同一题连续答对 2 次后移出队列。
- **数据表**仍保留 `mastery.theta`、`review_cards.stability/difficulty/lapses` 字段，M1 切 FSRS/Elo 时不改表结构。
- **每日队列**简化为：错题复习 60% + 薄弱知识点抽题 40%，不做新卡/难度配比。

### 每日练习队列

```
50% 到期复习（FSRS）
25% 薄弱知识点：mastery<0.55，按 importance×(1-mastery) 排序
15% 新知识点（按前置依赖排序）
10% 错题重做（未纠正且 >3 天未看）
```

### 薄弱点定向变式

触发条件：KP 到期或薄弱且题库无未用已验证题，或存在未纠正误区。生成时输入原文块、KP、具体 `misconception_id`、3 道旧题干作为负例，指令"同一陷阱，不同表面"。要求：新题干 embedding 余弦 <0.85；同一误区标签；通过完整质检。每日上限 30 次，计入额度。`parent_question_id` 记录血统。

**误区纠正**：同一误区目标题连续答对 2 次且间隔 ≥3 天 → 标记已纠正，并显示"已纠正：混淆行政处罚与行政强制"。这是全产品最有情绪价值的界面，也是续费理由。

### 老师端（M2）

- **题库**：按材料/知识点/题型/难度/状态/误区标签/全文检索筛选；批量加入试卷、编辑、下架。编辑生成 `version+1` 并重新质检，旧版保持发布直到新版通过（试卷引用冻结快照）。
- **组卷**：`PaperBlueprint { sections[], difficulty 配比, kpCoverage, constraints }` → 贪心填充 → 拖拽排序、单题替换、锁定不参与重摇 → 实时统计（总分/题型/难度/覆盖热力图/重复告警）→ 存草稿 → 导出。
- `paper_items` 存 `snapshot jsonb`：多年后即使题目被编辑/下架，试卷渲染仍完全一致。
- **导出 Word 优先**（老师会改），PDF 次之：
  - A4、上下 2.54cm、左侧 3.18cm（留密封线）、右侧 2.54cm；页眉学校/考试名/时间/满分/注意事项；
  - 章节标题严格中文习惯：`一、单项选择题（本大题共20小题，每小题2分，共40分）`；
  - 正文宋体小四 1.5 倍行距，标题黑体；左侧密封线含姓名/学号/班级，竖排旋转；页脚 `第 X 页 共 Y 页`；
  - 短选项 4 列、长选项 2 列；另出「答案与解析」文档与可选「答题卡」；
  - PDF 用 Playwright 渲染 HTML，内嵌 Noto Serif/Sans CJK SC，不依赖系统字体。

---

## 八、技术选型

| 关注点 | 选择 | 理由 |
|---|---|---|
| 框架 | Next.js App Router + React + TS strict | 一个可部署单元，RSC 省成本，Route Handler 做 API |
| UI | Tailwind + shadcn/ui + TanStack Query + RHF + zod | 一人开发提速 |
| DB | Postgres + pgvector | 关系 + 向量同库，省运维 |
| ORM | Drizzle + drizzle-kit | SQL 优先、类型安全、pgvector 无逃生舱 |
| 队列 | **pg-boss** | 见下 |
| 对象存储 | 阿里云 OSS 私有桶 + 签名 URL + SSE | 境内、便宜、无出网费惊喜 |
| PDF 解析 | `pdfjs-dist`（文本+位置+字号用于标题识别） | 确定性，中文文字层支持好 |
| DOCX | `mammoth` + 自定义归一化 | 可靠提取段落与样式 |
| PPTX | `jszip` + `fast-xml-parser` 解析 slide XML | 避免重依赖 Office |
| 扫描件（M1 后期/M2） | 阿里云 OCR 按页 | 保持全 TS 栈；PaddleOCR 自建仅在实测 5 份样本不合格时再上 |
| LLM | DeepSeek / Qwen(DashScope) / 豆包 / GLM | 均境内已备案，延迟低，无跨境数据传输 |
| Embedding | Qwen text-embedding-v3（1024） | 中文好、便宜 |
| 审核 | 阿里云内容安全 + 本地敏感词 | 合规必需 |
| 认证 | `better-auth` 手机号 OTP（阿里云短信） | TS 原生，插件齐全 |
| 支付 | 微信支付 Native v3 | Web 先行；小程序后续用 JSAPI 复用订单服务 |
| 部署 | 阿里云 ECS + Docker Compose：web(2C) / worker(4C) / 托管 RDS / OSS / CDN / SLS | 一个开发者的最优运维面；worker 独立以免 LLM 扇出抢占请求延迟 |
| 测试 | Vitest（domain/application）、Playwright（关键流程）、eval harness | domain 测试纯而快；eval 才是真质量测试 |
| CI | GitHub Actions/云效：typecheck、lint、dependency-cruiser、vitest、迁移检查、eval 冒烟 | 边界规则必须让构建失败 |

**为什么 pg-boss 而不是 BullMQ**：
1. **事务性入队**——材料行与首个任务原子提交，BullMQ+Redis 需要 outbox 表和 relay，多一套代码和失败模式。
2. 少一个服务——不必运维/备份/付费 Redis；一人团队最稀缺的是运维面。
3. 任务状态就是 SQL——进度、重试、死信、成本与领域数据同库，SSE 与后台查询都是普通查询。
4. 每个队列固定并发 = 天然的厂商级限流器（`llm.cheap/strong/verify/parse/export`）。
5. 吞吐足够——1 万任务/天（均值 0.12/s，批量上传瞬时 ~20/s），`SKIP LOCKED` 轻松应对。

仅当持续 >20 任务/秒或需跨区域限流时才迁 BullMQ。

---

## 九、成本模型

假设：100 页中文文字层 PDF ≈ 8 万字 ≈ 5.5 万 token；生成 60 题。

| 阶段 | 档位 | 输入/输出 token | 成本 |
|---|---|---|---|
| 考点抽取 | cheap | 90k / 28k | ¥0.40 |
| 易错点 + 蓝图 | strong | 12k / 5k | ¥0.08 |
| 出题（60） | strong | 110k / 36k | ¥0.64 |
| 修复（20%） | strong | 22k / 7k | ¥0.13 |
| 质检（2 次×60） | verify | 95k / 32k | ¥0.57 |
| Embedding | — | 60k | ¥0.03 |
| 小计 | | | **¥1.85** |
| 重试/失败项 (+30%) | | | ¥0.55 |
| **合计** | | | **≈ ¥2.40/份** |

- 扫描件：+OCR ¥2.00，且 OCR 噪声使修复率 +20% → **¥5.0–6.5**。
- 50% 缓存命中 → **¥1.20**；80%（热门教材）→ **¥0.50**。

**定价模型（M2 启用；M0/M1 不收费、不做额度，本节仅保留供 OPC 后使用）**：

| 套餐 | 价格 | 包含 | 估计 COGS | 毛利 |
|---|---|---|---|---|
| 免费 | ¥0 | 每月 1 份新材料（≤120 页），20 次/月变式 + 不限复用练习 | ~¥3.2 | 获客 |
| 学生会员 | ¥39/月 或 ¥269/年 | 5 份/月（≤200 页），8 次/日变式 + 不限复用练习，完整学情 | ¥19–22 | ~44–51% |
| 教师会员 | ¥99/月 或 ¥699/年 | 30 份/月，10 次/日变式，批量上传，组卷导出，3 个席位 | ¥47–57 | ~42–52% |
| 超额 | ¥6/份 | 按量 | ¥2.4 | 60% |

定价逻辑：≥3× 综合 COGS，保证缓存未命中、重试、OCR 不吞掉毛利。免费档给"1 份材料"而非"无限题"——生成才是成本，练习几乎免费。护栏：每材料硬预算 ¥15；按套餐限页数；每题最多 3 次修复；按套餐排优先级；月度成本上限 + 优雅降级（"本月生成额度已用完，练习不受影响"）。

### 活跃用户月度持续成本（修订：原模型漏算变式重练）

必须把两种"重练"分开：

- **复用题库练习/复习**：几乎零边际成本（只有数据库读），可以不限。
- **定向变式生成**：走 strong 生成 + 异构两次质检，单题约 **¥0.04**（输入 ~2.3k / 输出 ~0.5k，校验 2×）。原设计的"200 次/日重练"若全部是新生成，月成本约 ¥240，远超订阅价，不可持续。

| 套餐 | 变式上限 | 最坏月度变式成本 | 首次材料成本（缓存后） | 月度 COGS | 定价 | 毛利 |
|---|---|---|---|---|---|---|
| 免费 | 20 次/月 | ¥0.8 | ¥2.4（1 份） | ~¥3.2 | ¥0 | 获客 |
| 学生会员 | 8 次/日 | ¥9.6 | ¥9–12 | ¥19–22 | ¥39/月 | ~44–51% |
| 教师会员 | 10 次/日 | ¥12 | ¥35–45 | ¥47–57 | ¥99/月 | ~42–52% |

规则：变式生成前先查该知识点是否有未使用的已验证题，有则复用不生成；每日上限按套餐硬限；M2 的简答 AI 判分约 ¥0.007/次，必须单独计量并计入月度上限（或默认自评）。

---

## 十、合规（OPC 前只做最小集）

**OPC 注册前只做私有内测**，执行最小集：上传权利声明、材料默认私有、**关闭跨用户缓存**、最小隐私告知与删除通道、生成内容不做公开传播。下表的备案/资质/支付项在 OPC 后启动，**不阻塞 M0/M1**。

| 风险 | 最小可行措施 | 时间 |
|---|---|---|
| ICP 备案 + 公安备案 | OPC 注册后提交（主体+域名+服务器），2–4 周 | M2 |
| **经营主体 + 微信支付商户号** | **个人主体无法开通 Native 支付与经营性 ICP**。OPC 注册后立即申请商户号（1–2 周）。这是付费上线的硬前置，不是可选项 | M2 |
| 生成式 AI 服务备案/算法备案 | 只用境内已备案模型；指定安全负责人；准备语料/模型安全/内容标识材料；**付费公开发布前完成备案**；备案期间做邀请制内测 | W2 启动，W8 提交 |
| AI 生成内容标识 | 每题卡片与导出件标注"AI 生成，已经过自动校验"；DOCX/PDF 属性写入 provider/model/generatedAt | M1 |
| 内容安全 | 阿里云内容安全覆盖用户上传文本与生成的题干/选项/解析；本地敏感词预过滤；每题举报入口；24h 下架 SLA | M1 |
| 教材版权 | 用户上传承诺条款；材料默认私有；无公开分享/市场；仅引用片段不展示全文；通知-删除机制。**修订**：跨用户缓存本质上是"匿名化衍生题库"，与"不建跨用户教材语料库"的表述自相矛盾——统一改称"衍生题库"，并在用户协议中取得授权；**OPC 前保持关闭** | M0 起 |
| 删除权与缓存语义 | 删除材料：该用户的全部副本、作答、学情删除；缓存产物按引用计数管理——无其他持有者时一并清除，有多个持有者时与该用户解绑并保留（不含任何个人数据）；写入隐私政策 | M1 |
| 过往真题复现 | 指令模型改写而非转录；导出卷老师复核；加内部真题相似度检查 | M2 |
| PIPL 个人信息 | 只收手机号；上传含他人信息时单独告知同意；境内存储；15 天内支持删除与导出；隐私政策+同意页；无广告追踪 SDK | M1 |
| 未成年人 | 注册年龄声明；未成年人保护条款；无开放社交 | M1 |
| 经营性 ICP 证 | 收费可能需增值电信业务经营许可证（需公司主体）；咨询律师；顺序：免费邀请内测 → 主体+ICP 证 → 付费上线 | M2 |
| 自动续费 | 不得默认勾选；需提前提醒+一键取消 | M2 |
| 等保 2.0 | 先做访问控制、审计日志、静态加密、备份；有规模后做二级备案 | M2 |

---

## 十一、里程碑与验证

### M0-1 技术 Spike（2–3 个工作日，无 UI，决定生死）

在 `packages/evals` 写 CLI，吃 4 份真实材料（考研政治文字版 PDF、CPA 会计 PDF、教资 PPTX、1 份英文教材 PDF；其中至少 1 份两栏排版），跑：解析→切块→考点→易错点→蓝图→每题型 20 题→质检→去重，输出 JSON + 人工复核表。无数据库、无认证、无队列。

| 指标 | 门槛 |
|---|---|
| 文字层字符提取准确率 | ≥98% |
| 切块边界合理（不切句/表） | ≥95% |
| 知识点召回（对比人工清单） | ≥75% |
| 首次 schema 合法率 | ≥90% |
| 引用精确匹配 | ≥95% |
| 盲解一致率（2 次独立，**按难度带分别统计**） | 难度 ≤3：≥90%；难度 4–5：≥60%，且"给答案反证"无第二答案 ≥95% |
| 干扰项误判（"错项"其实正确） | ≤5% |
| 人工"可直接使用" | ≥70% |
| 人工硬错误率 | ≤5% |
| 100 页 p95 延迟 | <10 分钟 |
| 单份成本 | ≤¥6 |

同时花半天用阿里云 OCR 跑 5 页扫描件，只为校准 M2 决策，不构建。

**难度覆盖必须单独验收**：若自动发布的题目中难度 4–5 占比 <15%，即判定为"难题被门禁系统性过滤"，须先修正分层策略再继续。另需用一份两栏排版的真实 PDF 测试阅读顺序——`pdfjs-dist` 在两栏中文材料上常出现串行错位，这是解析阶段的头号风险（K3 未提，但同样致命）。

**门槛不过就不要写完整产品**：要么收窄到质量能过的单一考试垂类，要么把 M0/M1 改成"老师审核后发布"（AI 起草、老师把关）。两者都是可行产品，但用烂题跑完整闭环不是。

并行做低成本需求验证：落地页 + 30 次访谈（15 老师、15 考生）；用 CLI 手工服务 20 个用户；测上传→首次练习完成率、次周回访、3 位老师是否愿预付 ¥199 参加组卷试点。

### 交付计划（2026-10-24 重排）

| 阶段 | 时长 | 内容 | 完成标准 |
|---|---|---|---|
| M0-1 技术 spike | 2–3 天 | CLI 跑 3 份中文 + 1 份英文材料（含 1 份两栏 PDF）：解析→切块→考点→出题→质检，输出复核表 | 第十一节门槛；高难题占比 ≥15% |
| M0-2 本地闭环 | 3–4 天 | 本地 Web（只求能用，不做视觉打磨）：上传、列表、答题、判分、原文高亮、错题本、固定间隔复习 | 5 份材料全链路无手工干预；每份材料全检，硬错误 ≤5% |
| M1 多用户内测 | 3–4 周 | Postgres/pgvector、登录、OSS、pg-boss、SSE、多用户隔离、跨厂商质检、eval、部署 | 10–20 名真实用户；硬错误 ≤5%；有次周留存数据 |
| M2 老师端与商业化 | OPC 后 | 组卷导出、小程序、支付、备案、填空/简答、FSRS/Elo | 5 位老师独立组卷并导出；付费链路合规可用 |

### 三大死亡风险与廉价验证

1. **质量天花板**：自动发布题硬错误 >5% 或歧义 >10%，学习者一次就流失，老师直接拉黑。**验证**：Week 0 spike 的 240 题人工复核 + 每周 50 题盲审。过不了就转"老师审核后发布"。
2. **留存与真实需求**（原"付费与留存"，当前阶段只验证前一半）：考生考完即走，老师在组卷网/学科网习惯低价。M0/M1 不收费，先用"上传后是否真的完成第一次练习、7 天后是否回来"验证需求。**验证**：M1 内测 10–20 人，记录上传→首次练习完成率与次周回访；完成率 <40% 就先改产品，不加功能。
3. **本地切片做成玩具**：SQLite + 无登录的 M0 与 M1 架构差异过大，可能白写一遍。**缓解**：domain/application 用端口隔离，M0 只写 SQLite 适配器；M0 结束即评估是否直接进 M1，不并行维护两套适配器。

---

## 十二、关键文件（待创建）

M0 只需先落地其中 4 个：`packages/domain/src/question/question.ts`、`packages/application/src/use-cases/generate-questions.ts`、`packages/infrastructure/src/db/schema.ts`（SQLite 版）、`packages/evals/run-eval.ts`。

- `C:\Users\lenovo\Desktop\QGen\packages\domain\src\question\question.ts` — 题目实体、选项与误区的绑定、发布不变量与状态机
- `C:\Users\lenovo\Desktop\QGen\packages\application\src\ports\llm.ts` — 分档 LLM 端口（路由、重试、缓存、成本计量可替换）
- `C:\Users\lenovo\Desktop\QGen\packages\application\src\use-cases\generate-questions.ts` — 蓝图扇出、幂等键、单题失败隔离
- `C:\Users\lenovo\Desktop\QGen\packages\infrastructure\src\llm\pipeline\verify-question.ts` — 盲解、干扰项质询、引用校验、发布门禁
- `C:\Users\lenovo\Desktop\QGen\packages\infrastructure\src\db\schema.ts` — Drizzle schema：溯源区间、质量状态、chunk 哈希缓存
- `C:\Users\lenovo\Desktop\QGen\packages\evals\run-eval.ts` — Week 0 spike 与后续 prompt 回归

---

## 十三、验证方式（端到端）

1. **Spike**：`pnpm eval --material <path> --items 20 --types all`，产出 JSON + 复核表；按第十一节门槛逐项打分，不达标即暂停开发。
2. **流水线**：上传一份 100 页讲义 → SSE 观察到 11 个阶段推进 → `processing_jobs` 每阶段有独立状态与成本 → 失败阶段可单独重试且不重复计费。
3. **质检**：抽查 50 道已发布题，逐题点"查看原文"确认高亮片段与原始 PDF 一致；人工盲解答案，硬错误 ≤5%。
4. **学习闭环**：模拟学习者 30 天（脚本注入作答），检查 FSRS 到期队列、Elo 掌握度方向、误区纠正状态、变式题干不重复。
5. **老师端（M2）**：5 位真实老师在不指导下组卷并导出，Word/WPS 打开检查字体、密封线、页码、答案解析分离。
6. **计费与合规**：沙箱支付全链路；额度边界；每道生成题与每份导出件带 AI 标识；删除账号 15 天内完成数据清除。

---

## 十四、开发、环境与审查协作流程

### 角色

- **开发者（Claude）**：架构落地、前后端、数据库、流水线、测试、部署；对每次交付的自测结果负责。
- **审查者（Kimi K3）**：独立检查代码与产出，提出问题与建议；不参与运行时，不直接改代码。
- **用户**：唯一的转述通道，决定有争议的审查意见。

### 环境准备（M0 前置，部分需用户操作）

| 项 | 动作 | 负责方 |
|---|---|---|
| Node 24 | 已具备（v24.15.0） | — |
| pnpm | `corepack enable && corepack prepare pnpm@latest --activate` | 开发者 |
| Docker Desktop | **M1 前置，M0 不需要**；Windows 需 WSL2；若安装受阻，M1 改用云数据库 | 用户（M1 前） |
| Postgres + pgvector | **M1 起**：`docker compose up -d db`，镜像 `pgvector/pgvector:pg17`；M0 用 SQLite | 开发者（M1） |
| 密钥 | 写入 `.env.local`（已 gitignore）：`DASHSCOPE_API_KEY` 已有；用户补 `DEEPSEEK_API_KEY`、`ARK_API_KEY` 或 `ZHIPU_API_KEY` | 用户 |
| 验证 | M0：`pnpm -v` 正常、SQLite 可读写、进度轮询可用；M1：`docker exec -it qgen-db psql -U qgen -c "select '[1,2,3]'::vector;"` 成功 | 开发者 |

### 首批交付物（严格按顺序）

1. **D1 工程地基**：pnpm workspace、TS strict、ESLint/Prettier、Vitest、dependency-cruiser 边界规则、`.env.example`、CI 配置、SQLite schema + 迁移、**独立 worker 进程（`tsx watch`）+ `pnpm dev` 一条命令（concurrently）**、进度轮询接口。**不含 docker-compose；M1 再把 worker 换成 pg-boss 消费者。**
2. **D2 领域与数据**：`packages/domain` 实体与状态机 + 单测；`packages/infrastructure/src/db/schema.ts`（Drizzle）+ 迁移；仓库端口定义。
3. **D3 Week 0 Spike CLI**：`packages/evals` 跑通 解析→切块→考点→出题→质检，输出 JSON + 人工复核表；先用 Qwen 单厂商跑通，跨厂商校验在密钥到位后补。
4. **D4 评测报告**：按第十一节门槛打分，产出 `reviews/` 下的 spike 报告与结论（继续 / 收窄垂类 / 转老师审核模式）。

**在 D4 结论出来前，不写业务 Web 页面。** 这是计划里最重要的止损点。

### 必测清单（D2 完成前全绿）

| 测试文件 | 验证的不变量 |
|---|---|
| `question-state.test.ts` | 状态机非法迁移全部拒绝（如 `published → verifying`） |
| `answer-key.test.ts` | 单选恰 1 答案、多选 ≥2、判断恰 1；非法答案键构造失败 |
| `citation-check.test.ts` | 字符区间切片 === 归一化引用；偏移 1 字符即失败 |
| `grading.test.ts` | 多选"全对才得分"边界（漏选、错选、全选） |
| `normalize.test.ts` | NFKC/空白折叠/零宽字符的确定性 + 幂等性（normalize∘normalize === normalize） |
| `review-schedule.test.ts` | 1/3/7/15 间隔推进、答错重置 |
| `idempotency.test.ts` | 幂等键对同输入确定；seed 由 slot 派生且不进 key |
| `chunk-bounds.test.ts` | `char_start/char_end` 不越界、单调递增、`slice(start,end) === chunk.text` |
| `language-detect.test.ts` | 纯中/纯英/混合样本判定正确；阈值边界稳定 |
| `blueprint.test.ts` | 中英配比 50/30/20 与 60/30/10；题量公式 clamp 边界；importance 4–5 优先分满 |
| `publish-gate.test.ts` | 任一 hard check 失败即拒发；softScore <0.75 拒发；无 `answer_basis` 引用拒发 |

D1 先搭测试骨架并覆盖状态机与引用校验；**D2 的 DoD 必须包含上表全绿**。CI 中任何一项失败即阻断合并。

### Kimi K3 审查协议

**触发时机**：每个交付物完成、每个里程碑结束、或任何涉及发布门禁/计费/合规的改动。小改动可合并为一次审查，频率约每 1–2 天一次。

**审查请求文件**：开发者每次在 `reviews/` 下新建 `YYYY-MM-DD-<topic>.md`。Kimi 与开发者共用同一工作区，**可直接读取源码与 git diff**；请求文件只作为自测记录与索引，关键代码不必整段粘贴，给路径与符号即可。包含：

```markdown
# 审查请求：<主题>
## 背景与目标（3–5 行）
## 变更文件清单（路径 + 一句话说明）
## 变更范围（文件路径 + 关键符号/行号；Kimi 直接读取源码）
## 自测结果（命令 + 实际输出，禁止只写"通过"）
## 已知风险与不确定点
## 请重点审查的问题（最多 5 条，编号）
```

**反馈闭环**：用户把 Kimi 的原文贴回后，开发者在同一文件追加 `## Kimi K3 审查意见（原文）` 与 `## 处理记录`，逐条标注：

- `Blocker`：必须修复才能继续；
- `Major`：本里程碑内修复；
- `Minor`：记录进待办；
- `Nit`：可选。

每条写「接受 / 部分接受 / 不接受 + 理由 + 对应改动（commit 或文件:行）」。**争议项升级给用户裁决，不自行忽略。**

**诚实性约束**：

- 未收到实际审查文本前，不得在任何汇报中写"已通过审查"或"Kimi 认可"。
- 自测失败必须贴原始输出；不得用"应该可以"替代运行结果。
- 审查意见与既定计划冲突时，先暂停并对齐用户，不擅自改需求。

**审查索引**：`reviews/INDEX.md` 维护「日期 / 主题 / 状态（待审 / 有 Blocker / 已关闭）/ 链接」。

### 每个交付物的完成定义（DoD）

1. 代码通过 `typecheck`、`lint`、`test`、`dependency-cruiser`；
2. 有可复现的运行命令与真实输出；
3. 已在 `reviews/` 生成审查请求；
4. 所有 Blocker 已关闭或经用户裁决延期；
5. 更新 `reviews/INDEX.md`。

---

## 十五、K3 第一轮审查处理记录

审查对象：`QGen-产品设计与实施计划.md`（2026-10-24）。处置原则：逐条判定，不静默忽略。

| # | K3 意见 | 判定 | 落点 |
|---|---|---|---|
| 1 | 盲解 2/2 会系统性过滤难题，导致题库偏简单 | **接受** | 第六节改为按难度分层（≤3 盲解 2/2；4–5 给答案反证 + 推导溯源）；第十一节门槛按难度带统计，并新增"高难题占比 ≥15%"验收 |
| 2 | 跨用户缓存与"不建语料库"互相矛盾；删除权未定义 | **接受** | 第十节统一改称"匿名化衍生题库"，增加上传者授权开关（默认关闭）与引用计数删除语义 |
| 3 | 成本模型漏算持续变式重练，COGS 被低估 | **接受** | 第九节新增"活跃用户月度持续成本"；变式单题 ¥0.04；重定价学生 ¥39、教师变式限 10/日；变式前先复用库存题 |
| 4 | 微信支付商户号需企业/个体主体，时间线未反映 | **接受** | 第十节新增主体与商户号行；W1 并行注册；付费上线从 W11 推至 W14–16 并设门禁 |
| 5 | P0 过大，建议填空/简答移 P1 | **接受** | P0 仅单选/多选/判断；填空/简答移至 P1；第七节判分表标注 |
| 6 | 幂等键含随机 seed 会失效 | **接受** | 第五节：seed 由 materialId/slot/promptVersion 确定性派生，不进 key |
| 7 | Elo 的 d_item 校准冷启动无法触发 | **接受** | 第七节改为双向 Elo 即时更新；实测 p 值仅作监控（跨用户 ≥20 次且 ≥5 人） |
| 8 | 2 次申诉即可下架，易被滥用 | **接受** | 第六节：2 次只触发优先复核；自动隔离需近 20 次作答中 ≥5 次且申诉率 >20%，或人工确认 |
| 9 | 仓库路径在文档内不一致 | **接受** | 全文统一为 `C:\Users\lenovo\Desktop\QGen` |
| 10 | `pg_notify` 8KB 限制与多实例 LISTEN | **接受** | 第四节补充约束：只发摘要，多实例扩展前改广播 |
| A | （K3 未提）两栏中文 PDF 解析错位会污染整条引用链 | **新增** | Week 0 spike 增加两栏 PDF 必测项，作为解析阶段头号风险 |
| B | （K3 未提）免费档 20 次/日变式的持续成本 | **新增** | 纳入持续成本模型，免费档改为 20 次/月变式 + 不限复用练习 |

**未采纳**：无。

**遗留待确认**：

1. 学生会员定价从 ¥29 上调至 ¥39 是否可接受——这是成本模型修正后的直接结论，需要市场验证。
2. 跨用户缓存默认关闭会削弱成本飞轮；是否改为"新用户首次上传时明示授权"（opt-in）而非完全关闭，需产品与法务权衡。
3. 付费上线时间由备案与商户号审批决定，W14–16 是基于"W1 立即启动"的乐观估计。

### 第二轮产品决策（2026-10-24，用户确认）

**说明**：本节决策取代上方第一轮记录中的 P0/P1/P2 编号，第一轮记录保留为审查痕迹。

| 决策 | 内容 | 对计划的影响 |
|---|---|---|
| 暂不定价 | 先跑通核心链路，定价后续再说 | 支付/额度/会员移出 M0/M1，列入 M2；保留成本台账与 ¥15/材料硬上限 |
| 语言范围 | 中文材料出中文题、英文材料出英文题、UI 中文 | 取消"不做多语言"中的中英限制；新增英文解析、出题与引用归一化要求 |
| 首版用户 | 先自己本地跑通 | 新增 M0 本地单用户切片；登录/OSS/队列推迟到 M1 |
| 复习算法 | 固定间隔 1/3/7/15 + 知识点正确率 | M0 不上 FSRS/Elo，仅预留字段；M1 切换 |

**由此产生的计划风险**：M0 的 SQLite 适配器在 M1 会被 Postgres 替换，需控制返工面；英文材料的解析与引用归一化未经验证，M0 spike 必须包含英文样本。

### K3 第二轮审查处理记录（2026-10-24）

| # | 意见 | 判定 | 落点 |
|---|---|---|---|
| 1 | M0"同步执行 + 页面看进度"技术上不成立 | **接受** | M0 改为进程内后台任务 + `processing_jobs` + 每 2 秒轮询 progress 接口 |
| 2 | 同厂商盲解 2 次可能因 temp=0 完全一致，检查失效 | **接受** | 两次改为 temp 0.7 的不同采样 + 两种措辞 prompt（直接作答 / 先推理再作答）；M0 人工复核改全检 |
| 3 | Docker 在 Context 与第十四节自相矛盾 | **接受** | M0 坚定用 SQLite；Docker/Postgres 列为 M1 前置；D1 交付物移除 docker-compose 与独立 worker |
| 4 | 开发者身份与文档不一致 | **接受** | 文档改为"本会话 AI 编码代理（模型标识 `deepseek-flash`）"；Kimi 可直接读源码 |
| 5 | 质量门槛倒挂（spike ≤5%，M0-2 ≤10%） | **接受** | 统一为 ≤5%；达不到则补第二家厂商密钥或改老师审核发布 |
| 6 | M0 缺少精确 LLM 缓存 | **接受** | M0 增加 SQLite `llm_cache`，作为无断点续跑的唯一补偿 |
| 7 | 英文引用归一化规则缺失 | **接受** | 英文不折叠大小写，仅折叠空白 + 修复行尾断字 + 统一引号 |
| 8 | 固定间隔复习未定义答错行为 | **接受** | 答错立即重置回第 1 天档 |
| 9 | M0 多选判分依赖尚不存在的 exam_profile | **接受** | M0 固定"全对才得分" |
| 10 | 审查协议假设 Kimi 看不到仓库 | **接受** | Kimi 可直接读源码与 diff；reviews/ 请求文件降为自测记录与索引 |
| 11 | M0 的 embedding 无消费者 | **接受** | M0 去掉 embedding，去重只用 simhash；M1 随 pgvector 一起上 |
| 12 | M0-2 三天做完整 Web UI 偏紧 | **接受** | 界面只做"能用"：上传、列表、答题、解析高亮、错题列表；视觉打磨留 M1 |

**未采纳**：无。

**M0 可行性结论**：修掉 Blocker 1–4 后，5–7 天可跑通；其中 2–3 天是 spike，3–4 天是可用界面 + 全链路。若 spike 阶段质量不达标，不进入 M0-2，先解决模型与 prompt。

### K3 第三轮审查处理记录（2026-10-24，针对开发者提出的 6 个落地缺口）

| # | 意见 | 判定 | 落点 |
|---|---|---|---|
| 1 | M0 后台任务用独立 `tsx watch` 进程，不用 Next 进程内 Promise/instrumentation | **接受** | 第四节 M0 流水线改为独立 worker + SQLite 状态 + 轮询；`pnpm dev` 用 concurrently 合并。**本条取代第二轮记录第 3 条中"D1 移除独立 worker"的表述** |
| 2 | 英文不做完形/匹配/阅读；按语言选题干模板，判断题降权 | **接受** | 第五节新增"语言与题型映射"；英文配比 60/30/10 |
| 3 | 考点粒度与题量公式必须现在定 | **接受** | 第五节新增"题量与考点粒度（蓝图硬规则）" |
| 4 | "查看原文" M0 只做引用文本 + 页码 + chunk 上下文 | **接受** | M0 订正行与第七节边界说明；原页坐标高亮列 M1 |
| 5 | "一条命令"定义为 `pnpm dev` | **接受** | M0 开头改为 `pnpm dev` + concurrently；`pnpm eval` 仅服务 spike |
| 6 | D1/D2 必测清单 | **接受** | 第十四节新增 7 项测试表；D2 DoD 要求全绿 |
| 7 | 身份一致性 | **已修正** | 计划与工作空间 md 第 19 行均为"本会话 AI 编码代理（`deepseek-flash`）" |

**未采纳**：无。

### 当前状态（2026-10-24）

- 本计划文件已包含：核心链路优先的 M0/M1/M2 路线、分层架构、11 阶段流水线、质检与发布门禁、M0 简化学习闭环、合规最小集、交付物 D1–D4、必测清单（11 项）、三轮 K3 审查处理记录。
- 工作空间 `QGen-产品设计与实施计划.md` 已同步，与本文件逐字节一致（`diff -q` 校验）。
- **D1 已于 2026-10-25 落地**：pnpm workspace、TS strict、dependency-cruiser（**8 条规则**）、SQLite schema + Drizzle 迁移、独立 `tsx watch` worker、`pnpm dev` 一条命令、`/api/v1/materials/:id/progress` 轮询接口。`pnpm check` 全绿（33 个用例）。审查请求见 `reviews/2026-10-25-d1-foundation.md`。
- **D1 第四轮审查（K3，2026-10-25）**：1 Blocker / 3 Major / 2 Minor / 3 Nit，全部接受并已修复/归位；**复审通过，D1 审查关闭**。两处记录级备注不要求处理：①上传的 rename 未包进补偿范围（同目录近原子，风险可忽略）；②worker 组合根规则只拦 infrastructure，消费者仍可 import config/contracts，D2 引入消费者文件时视情况收紧。
- **D1 的实现偏差（K3 裁决：全部接受）**：① TypeScript 由 7.0.2 降到 6.0.3——typescript-eslint 8.72 尚不支持 TS 7，待其支持后回迁；② 本机 3000 端口被其他进程占用，dev 端口改为 **3100**；③ worker 的 parse/normalize/chunk 是空实现，只推进度，真实解析在 D3（D3 接长任务时须复审 Blocker 1 的修复）。
- **D2 待办（K3 指定）**：重试语义按第十五节「D2 重试设计」实现；状态枚举三处复制（domain / drizzle / contracts）统一从 domain 派生；contracts 的 DTO 覆盖 GET /materials 列表。
- **下一步**：D2 领域与数据（题目/知识点/作答表、仓库端口、剩余 5 项必测、重试语义）。D1 已关闭，**D2 开工解禁**。D2 DoD：必测清单 11 项全绿（剩余 5 项随对应模块落地，不许先代码后补票）+ 重试语义 + 上述两条待办。

### K3 第三轮正式审查意见处理记录（2026-10-24）

审查对象：工作空间 md（808 行，含第三轮修订）。K3 结论：7 项处置**全部实质落地，无伪接受**；无 Blocker；4 Major、2 Minor、3 Nit。

| 级别 | 意见 | 处置 | 落点 |
|---|---|---|---|
| Major 1 | `processing_jobs` 并发语义未定义；"失败整份重跑"应为**阶段级恢复** | 接受 | 第四节新增「M0 worker 执行语义」四条（串行 FIFO、失败让位、阶段级恢复、僵尸清理）；M0 表流水线行同步改写 |
| Major 2 | 题量口径冲突：第 69 行"20–40"vs 公式上限 60，**以公式为准** | 接受 | 生成行改为"默认 20–40 题，随页数公式最多 60" |
| Major 3 | 必测清单漏 chunk 越界、语言检测、蓝图配比、发布门禁 | 接受 | 补 4 项，清单 7 → 11 项 |
| Major 4 | Context 第 15 行"M0 单进程"与双进程形态矛盾 | 接受 | 改为"M0 双进程（Next + 独立 tsx worker）"；顺手修正 M0 表"运行形态"行 |
| Minor 1 | 第四节只描述 M1 目标态，缺 M0 指引 | 接受 | 小节开头加 M0 简化实现对照说明 |
| Minor 2 | 英文判断题 10% 缺降级规则 | 接受 | 第五节语言映射补「题位可重分配」：找不到合适考点转单选，不强行凑题 |
| Nit 1 | 「当前状态」中"仍停留 755 行"已过期 | 接受 | 改为"已同步，逐字节一致" |
| Nit 2 | 第二轮记录"移除独立 worker"与第三轮冲突 | 接受 | 第三轮记录第 1 条注明取代关系 |
| Nit 3 | 记录 #7 括注"K3 复核的是旧副本"不准确 | 接受 | 删除该括注 |

**Blocker**：无。**未采纳**：无。**结论**：第三轮审查关闭，D1 可开工；D1 交付时一并复核本表 9 条落点。

### K3 第四轮审查处理记录（2026-10-25，D1 工程地基）

审查对象：D1 代码与 `reviews/2026-10-25-d1-foundation.md`。K3 独立复跑 `pnpm check`（EXIT=0）并逐文件核对；结论：1 Blocker / 3 Major / 2 Minor / 3 Nit，D1 不予通过。

| 级别 | 意见 | 处置 | 落点 |
|---|---|---|---|
| Blocker 1 | 优雅退出时 `runStage` 中途 throw → job 标 failed（不在僵尸清理范围）+ 唯一索引堵死重入队 → 材料永久卡死 | 接受 | `apps/worker/src/main.ts` 删除中途 throw，阶段跑完后自然退出；修复前后 SIGINT 实测见审查文件 |
| Major 1 | depcruise 未强制 container/main 为唯一组合根 | 接受 | `.dependency-cruiser.cjs` 新增 `web-infrastructure-only-in-container`、`worker-infrastructure-only-in-main`（规则数 6 → 8）；探针实测 exit code 2 |
| Major 2 | 上传路由先入队后写盘，写盘失败留孤儿 | 接受 | `materials/route.ts` 改为临时名落盘 → ingest → rename，失败补偿删除 |
| Minor 1 | claimNext 抢失败白睡 1s | 记录不改 | K3 裁定条件 update 已是原子认领，多进程也不会双领；`jobs.repo.ts` 加注释 |
| Minor 2 | contracts 是死代码 | 接受 | 新增 `apps/web/src/server/dto.ts`（schema 校验）+ 路由与 `page.tsx` 改用契约类型 |
| Nit 1 | 状态枚举三处复制 | 记录进 D2 | 见「当前状态 · D2 待办」 |
| Nit 2 | 端口 3100 未入文档 | 接受 | `.env.example` 补说明 |
| Nit 3 | 僵尸清理不清 progress | 记录不处理 | 重跑时进度会被覆盖 |

**五问裁决**：依赖方向正确（漏网见 Major 1）；`claimNext` 已并发安全，M0 不改（M1 换 pg-boss）；重试走 UPDATE 原行；M0 不做阶段内检查点（D3 spike 实测后再议）；5 项缺失测试属 D2 DoD，不要求提前补，但各模块落地必须带对应测试。

### D2 重试设计（K3 第四轮裁决，D2 开工前生效）

- **自动重试**：worker 捕获阶段失败时，`attempt < 2` 则把原 job 置回 `pending`（`progress = 0`，`error` 保留最近一次），否则置 `failed`。`attempt` 由 `claimNext` 自增，不手动清零。
- **手工重试**：`POST /api/v1/materials/:id/retry` 只 UPDATE 失败阶段的原 job（`status→pending, progress→0, error→null`），材料状态回到 `processing`。
- **严禁**放宽 `(materialId, stage)` 唯一索引或改为插入新 job——该索引编码"每材料每阶段一条记录"的不变量，阶段级恢复、僵尸清理、`findLatestByMaterial` 都依赖它。`onConflictDoNothing` 保留，职责是阶段链防重复入队。

### K3 第四轮复审（2026-10-25）：D1 通过

K3 独立核验：`pnpm check` EXIT=0（33 测试、47 模块 0 违规）；Blocker 1 修复后的退出行为与实测吻合，attempt 不复位证实阶段级恢复有效；Major 1 两条组合根规则经探针确认会真实失败；Major 2 孤儿路径已封闭；Minor 2 / Nit 2 已接线；第十五节记录与裁决逐字吻合。

**结论**：9 条意见全部落地或按裁决归位，无争议项，**D1 审查关闭**。

记录级备注（不要求处理）：

1. 上传路由的 `rename` 未包进补偿范围——rename 失败会留"材料行 + 临时文件"；同目录 rename 近原子，风险可忽略。
2. worker 组合根规则只拦 infrastructure，消费者仍可 import config/contracts；D2 引入消费者文件时若在意可收紧。

**D2 开工解禁**。DoD 重申：必测清单 11 项全绿（剩余 5 项随对应模块落地，不许先代码后补票）、重试语义按上一节实现、D2 待办两条（枚举从 domain 派生、列表 DTO 接线）。

### 当前状态（2026-10-25，D2 落地待审）

- **D2 已于 2026-10-25 落地**：domain 新增语言检测、切块、知识点、误区、质检类型与发布门禁、幂等键/seed、蓝图分配、作答实体；`Question` 增加 `materialId`；application 新增内容仓库端口与 `RetryMaterial`；infrastructure 重写 Drizzle schema 并生成迁移 `0001_hesitant_sentinels.sql`；contracts 枚举改为从 domain 派生并补齐列表/进度/重试 DTO；web 接入 DTO 与重试按钮；worker 落地自动重试。
- **自测**：`pnpm check` EXIT=0——13 个测试文件 / 75 个用例全绿，depcruise 65 模块 / 112 依赖 0 违规。必测清单 11 项全绿，其中 `idempotency` / `chunk-bounds` / `language-detect` / `blueprint` / `publish-gate` 随对应模块落地（未先代码后补票）。
- **迁移已应用**（`data/qgen.db`）：新增 `chunks`、`knowledge_points`、`misconceptions`、`questions`、`question_source_refs`、`question_checks`、`attempts`、`review_cards` 8 张表。
- **重试语义按「D2 重试设计」实现并端到端实测**：自动重试 attempt 1 回队、attempt 2 标 failed 并置材料 failed；手工重试只 UPDATE 原 job 行，`attempt` 保留（实测 attempt 3 续跑 parse→normalize→chunk→ready），重复重试 409 `no_failed_stage`，未知材料 404 `not_found`。
- **D2 待办两条已关闭**：① 状态枚举统一从 domain 派生（drizzle schema + contracts 均 z.enum 自 domain 常量）；② `GET /api/v1/materials` 经 `toMaterialList` 输出契约 DTO。
- **UI**：失败材料卡片显示「重试失败阶段」按钮，成功后 `pollToken` 重启轮询；仅通过 typecheck，**未做浏览器点击实测**（如实标注）。
- **已知偏差/风险（待 K3 裁定）**：① 缺失的 hard check 不阻断发布——`blind_solve`/`answer_contrast` 的可适用集合依赖难度分层，D2 未建模，现实现只拦截"存在且失败"的 hard check（soft 侧已 fail-closed）；② 手工重试不重置 `attempt`，attempt=2 的 job 每次手点只多一次机会；③ 幂等 seed 取 sha256 前 8 位（32 位）派生。
- 审查请求：`reviews/2026-10-25-d2-domain-and-data.md`；`reviews/INDEX.md` 状态「待审」。
- **下一步**：等待用户转达 K3 的 D2 审查意见；Blocker 清零后开 D3 Week 0 Spike CLI。**未收到实际审查文本前不声明通过。**

### K3 第五轮审查处理记录（2026-10-25，D2 领域与数据）

审查对象：D2 代码与 `reviews/2026-10-25-d2-domain-and-data.md`。K3 独立复跑 `pnpm check`（EXIT=0，13 文件 / 75 用例，65 模块 / 112 依赖）并逐条核对必测清单映射与重试语义；结论：**无 Blocker，2 Major / 1 Minor / 1 Nit**，Major 修复后关闭，D3 等关闭再开工。

| 级别 | 意见 | 处置 | 落点 |
|---|---|---|---|
| Major 1 | `documents` 表缺失——引用坐标系没有持久化 home，D3 normalize 无处落盘 | 接受 | `packages/domain/src/material/document.ts`（`Document`/`DocumentPage`）；`schema.ts` 新增 `documents` 表（`normalized_text`、`normalization_version`、`pages` json、`uq_documents_material_version`）；迁移 `0002_great_puck.sql` 已应用；仓储实现留给 D3 |
| Major 2 | 发布门禁 hard 侧 fail-open：校验器静默漏跑 = 通过 | 接受 | `evaluatePublish(question, checks, applicableHardChecks = HARD_CHECK_TYPES)`，新增阻断原因 `hard_check_missing`；测试 7 → 9 条（缺项拒发、显式适用集合外不要求） |
| Minor | `questions` 缺 `quality_score` / `checks_summary` | 接受（延后） | M1 待办；M0 由 `question_checks` 派生，不建冗余列 |
| Nit | worker 日志 `[worker] [worker]` 双前缀 | 不处理 | 噪声 |

**五问裁决**：

- **Q1（fail-open）**：现在修，不留给 D3——同 Major 2。
- **Q2（soft 分母）**：保持固定分母（全部 soft 权重之和），不按适用集合归一化——归一化会让"漏跑"隐身。**D3 校验器合同：4 种 soft check 必须全部出具，不适用时以得分表达，禁止缺省。**
- **Q3（语言检测 0.3）**：接受，无证据不调参。**D3 spike 的 5 份材料必须含 1 份中英混排/术语密集样本。**
- **Q4（seed 32 位）**：接受，不扩到 12 位——seed 碰撞只造成变式采样序列相关，不是正确性/安全问题。
- **Q5（手工重试）**：批准。attempt 累计是设计：每次手点授予恰好一次新尝试，自动重试预算保持有界；`retry/route.ts` 注释补语义说明，防误读为 bug。

**修复后自测**：`pnpm check` EXIT=0——13 文件 / **77 用例**全绿，depcruise **66 模块 / 113 依赖** 0 违规；`documents` 表已随迁移 `0002` 落库（6 列 / 1 索引 / 1 外键）。`reviews/INDEX.md` 维持「待审」，待 K3 复审通过后改「已关闭」。

**D3 开工条件（K3 指定）**：D2 关闭；D3 spike 含中英混排样本；校验器合同落实"soft check 不缺省"；D3 接长任务时复审 D1 Blocker 1 修复在分钟级阶段下的表现。

### K3 第五轮复审（2026-10-25）：D2 通过

K3 独立复跑 `pnpm check` EXIT=0（**77 用例**、66 模块 / 113 依赖 0 违规），逐项核验两项 Major 的修复：`documents` 表字段、`(materialId, version)` 唯一索引、级联删除与迁移 `0002` 均已落库（并认可"同材料多归一化版本并存"的设计）；`evaluatePublish` 已 fail-closed（`applicableHardChecks` 缺省全 9 种、缺项即 `hard_check_missing`、难度规则留给 D3 校验器），测试 7 → 9；`retry/route.ts` 注释已补"每次手工重试 = +1 次尝试"。

**结论**：第五轮 2 Major / 1 Minor / 1 Nit 全部按裁决落地，无争议项，**D2 审查关闭**。

**D3 spike 开工解禁**，三条硬约束（第十五节第五轮记录同款）：

1. spike 材料集必须含 1 份中英混排/术语密集样本（验证语言检测 0.3 阈值）。
2. 校验器合同：4 种 soft check 必须全部出具，不适用以得分表达，禁止缺省。
3. 接入分钟级长任务后，复审 D1 Blocker 1 修复（关停不打断阶段）在真实耗时下的表现。

D3 产出按第十四节审查协议提交 `reviews/`，重点带：5 份真实材料的端到端输出、硬错误率、人工复核表。

**当前进度**：D1 ✅、D2 ✅、D3 已落地待审。

### D3 落地（2026-10-25，待审）

**已实现**（`reviews/2026-10-25-d3-spike-llm.md` 为审查请求）：

- `packages/infrastructure/src/llm/qwen-client.ts`：DashScope 兼容接口调用、JSON mode、429/5xx 退避重试（1s/4s/12s + 抖动）、预算护栏、token/成本记账、`llm_cache` 精确缓存（key = `sha256(model|prompt_version|temp|messages)`）。
- 6 个版本化 prompt：`kp-extract` / `misconception` / `generate-question` / `blind-solve`（两种措辞）/ `answer-contrast` / `verify-question`。
- `packages/evals/src/pipeline/`：`schemas.ts`（zod，**4 个 soft check 全部必填**）、`locate-quote.ts`（逐字 → 忽略空白两级定位并映射回 `[charStart, charEnd)`）、`simhash.ts`（64 位汉明 ≤3 + `stemKey` 精确键）、`spike.ts`（编排）、`report.ts`（门槛记分卡 + 人工复核表 + 逐题明细）。
- `pnpm eval` 跑完整链路，输出 10 个文件（`document.json` / `normalized.txt` / `chunks.json` / `review.md` / `kps.json` / `misconceptions.json` / `questions.json` / `failures.json` / `stats.json` / `spike-report.md` / `question-details.md`）。

**自测**：`pnpm check` EXIT=0——17 个测试文件 / 105 个用例全绿，depcruise 87 模块 / 167 依赖 0 违规。

**Spike 运行（全部为合成样本，非真实材料）**：

| 材料 | 参数 | 结果 | 成本 |
|---|---|---|---|
| `sample-zh.txt` | `--items 3` | 3 生成 / 2 自动发布 / 1 阻断（盲解 0/2） | ¥0.021 |
| `sample-en.pdf` | `--items 3` | 2 生成 / 1 自动发布 / 1 阻断（盲解 0/2 + soft 0.67） / 1 生成失败 | ¥0.021 |
| `sample-zh.pptx` | `--items 5` | 4 生成 / 4 自动发布 / 1 生成失败（跨行引用无法定位） | ¥0.051 |
| `sample-mixed-zh.txt` | `--items 3` | 10 考点 / 3 生成 / 3 自动发布 | ¥0.027–0.041 |

**K3 三条 D3 硬约束的落实**：

1. **中英混排样本**：新增 `data/fixtures/sample-mixed-zh.txt`（汉字占比 81.3% → zh）与 `sample-mixed-en.txt`（1.0% → en），语言检测按 0.3 阈值判定正确。
2. **校验器 soft check 不缺省**：`verifyResponseSchema` 强制 4 项 soft check 全部出具，缺项、越界即 zod 失败并计入修复/失败，不会静默当作通过。
3. **D1 Blocker 1（关停不打断阶段）在长任务下的表现**：**未验证**。D3 spike 是 CLI 进程，不经过 worker 的 `runStage` 生命周期，分钟级运行下的 SIGINT 行为要等 M0-2 把流水线接进 worker 时才有真实场景可测。如实标注，不声称已覆盖。

**未完成（阻塞项，需要用户提供材料）**：第十一节的 5 份真实材料门槛（考研政治 PDF、CPA 会计 PDF、教资 PPTX、英文 PDF、≥1 份两栏 PDF）一份都没有；因此「文字层准确率 ≥98%、知识点召回 ≥75%、引用精确匹配 ≥95%、硬错误率 ≤5%、单份成本 ≤¥6」等指标**全部无法计算**，D3 不能宣称达标。合成样本只有 77–1651 字，知识点目标 15 个都达不到，题量与难度分布不具代表性。

**已知偏差 / 风险（待 K3 裁定）**：

1. **同厂商质检**：生成用 `qwen-max`、盲解用 `qwen-plus`，同族相关性盲区仍在；计划第六节要求的跨厂商校验要等 DeepSeek/豆包/智谱密钥。
2. **simhash 短文本噪声**：实测改一个词的题干汉明距离在 2–9 之间，≤3 只能抓非常接近的变体；已加 `stemKey` 精确键兜底，是否算偏离计划待裁定。
3. **引用严格度**：`answer_quote` 只接受单个切块内的连续片段，跨句/跨段一律重生成或丢弃；真实材料的软换行、页眉页脚可能放大失败率。
4. **高难题占比 0%**：所有自动发布题 `difficulty_est` 为 2–3，计划要求的自动发布题难度 4–5 占比 ≥15% 未达成，需真实材料验证是模型自评保守还是蓝图没把难度推上去。
5. **`documents` 表未写入**：spike 文件式运行，归一化文档只落 `normalized.txt`；持久化留给 M0-2 的 worker 阶段（与 D2 的 `documents` 表不冲突，但接入时必须补写入）。
6. **prompt 版本纪律**：`generate-question.v1` 开发中原地改过一次（选项指代改 A/B/C/D），未升 v2；已复跑确认生效（`选项A–D` 共 14 处、`选项<数字>` 0 处）。

**下一步**：等待 K3 对 D3 的审查意见（`reviews/INDEX.md` 状态「待审」）；同时需要用户提供至少 1 份真实材料（优先两栏 PDF 与一份英文 PDF）才能跑出第十一节门槛与硬错误率。未收到实际审查文本前不声明通过。

### D3 真实材料验证（2026-10-27，待审）

**审查请求**：`reviews/2026-10-27-d3-dev-report.md`（整体报告；`2026-10-25-d3-spike-llm.md` 的真实材料一节已由它取代）。本节的"真实材料已就位"，取代上一小节"未完成（阻塞项，需要用户提供材料）"的表述。

**材料集（8 份）**：中文期刊论文 1（8 页 / 19,769 字 / zh）、英文期刊 1（18 页 / 56,166 字）、中文授课 PPT 1（48 页 / 16,669 字，汉字 2.9% 误判为 en）、**两栏英文论文 2**（7 页 / 31,696 字；4 页 / 25,108 字）、英文新闻 1（2 页 / 3,943 字）；扫描件 2 份（18.7MB / 17MB）按计划拒收。两栏阅读顺序抽样正常（首页右半页起点占比 53% / 38%），未做系统度量。

**自测**：`pnpm check` EXIT=0——17 个测试文件 / **109 用例**，depcruise 87 模块 / 167 依赖 0 违规。

**端到端（最终代码，6 份可用材料）**：

| 材料 | KP | 题位 | 生成 | 自动发布 | 待复核 | 失败 | schema 首过 | soft 均分 | 难度4–5 | 反证 | 成本 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 明末清初 zh | 22 | 20 | 17 | 10 | 7 | 3 | 96% | .873 | 10% | 1/7 | ¥0.553 |
| 1013 en | 26 | 20 | 17 | 12 | 5 | 3 | 81% | .849 | 50% | 6/10 | ¥0.017 |
| 语言学 PPT en* | 37 | 20 | 18 | 15 | 3 | 2 | 81% | .852 | 47% | 7/7 | ¥0.429 |
| ChatGPT en 两栏 | 30 | 20 | 16 | 15 | 1 | 4 | 87% | .876 | 7% | 1/2 | ¥0.029 |
| Graph RAG en 两栏 | 26 | 20 | 16 | 14 | 2 | 4 | 81% | .887 | 7% | 1/3 | ¥0.046 |
| 新闻 en | 14 | 10 | 8 | 5 | 3 | 2 | 96% | .860 | 0% | 0/3 | ¥0.024 |
| 合计 | 155 | 110 | 92 | 71 | 21 | 18 | 86.1% | .849–.887 | 22.5% | 16/32 | ≤¥0.553 |

盲解 120/120，干扰项质询 91/92，引用定位 92/92（exact 1 / collapsed 91 / folded 0）。

**第十一节门槛**：达标 4 项（引用匹配、盲解、干扰项、成本）；**未达标 2 项**——首次 schema 合法率 86.1%（门槛 90%）、难度 4–5 反证无第二答案 16/32 = 50%（门槛 95%，当前最严重）；部分达标 1 项——难度 4–5 占比总体 22.5% 达标，但逐材料 0–50%，4/6 低于 15%；**待人工** 3 项——文字层准确率、切块边界、知识点召回；**待人工** 2 项——可直接使用率 ≥70%、硬错误率 ≤5%（需人审 71 道已发布题）；100 页 p95 未验证（材料 2–18 页，冷跑 32–66s）。

**已修复缺陷（真实材料证据）**：① 中文 PDF 缺 CMap 致汉字全丢（0.0% → 67.3%）；② 全半角/空白差异误杀引用（新增 folded 档 + 排版差异豁免）；③ 考点引用用省略号拼接（按块带失败样本重抽，丢弃 7 → 3）；④ 英文行尾断字（折叠时跳过断字连字符）；⑤ 定位失败反馈收窄为"复制一段连续句子（8–120 字）"。

**负面结果**：定位前按 `answer_quote > 160 字` 直接拒会**变差**（1013 从 17 生成掉到 10 生成 / 10 失败），已完全回退；长度约束只能进反馈，不能做硬门。

**待裁定（`reviews/2026-10-27-d3-dev-report.md` 第九节）**：① 反证 50% 是 prompt 过严、题目歧义还是同厂商偏置；② 考点抽取整块失败（1013 有 10/26 块）如何处置；③ schema 首过 86.1% 是否接受"修复后合法"口径；④ 难度/题型配额是否进蓝图；⑤ PPT 语言检测是否改双条件。

**仍未覆盖**：人工硬错误率（待用户人审）；同厂商质检（待第二家密钥）；D1 Blocker 1 在长任务下的表现（待 M0-2）；中文两栏样本；页眉页脚、PPT 语言、短材料题量公式、`documents` 落库（见报告 R6–R10）。

**下一步**：等待 K3 对 D3 整体报告的审查意见；Blocker 清零前不进入 M0-2 业务页面。未收到实际审查文本前不声明通过。

### K3 审查：D3 整体报告（2026-10-27，原文）


审查者：# K3 审查意见：D3 整体报告（2026-10-27）

## 验证方式（不采信转述）
- 独立读取`data/evals/` 六份材料的`stats.json` ：生成/发布/盲解/反证数字与报告表格 全部吻合 （1013：17 生成/12 发布/反证 6/10；zh 论文：17/10/1/7；PPT：18/15/7/7 等）。
- `failures.json` 确认 1013`kp_extract` 10 次块级失败，属实。
- 全缓存重跑痕迹属实：六份`stats.json` 均`llmCalls: 0 / cacheHits 49–128` ，文件时间戳集中在今日 11:48，与"后台进程污染后重跑"的说明一致。
- 代码核对： spike.ts:626-636 难度分层 applicableHardChecks 已接线（≤3 盲解、≥4 反证），D2 Major 2 的设计已在 D3 校验器落地； schemas.ts:63-80 4 种 soft check zod 必填、有专项测试， "soft 不缺省"合同落实 ； extract.ts:151-159 CMap 修复真实存在；反证调用失败按 fail-closed 处理（ spike.ts:1050-1054 ），正确。
我设的三条 D3 准入 ：① 中英混排/术语密集样本 ✅（高鹏 PPT + d3-mixed 合成样本）；② soft check 不缺省 ✅；③ 分钟级长任务下复审 D1 关停修复 ❌ 未验证 （开发者如实标注，spike 是 CLI）。第 ③ 条转为 M0-2 准入条件 ：流水线接进 worker 时必须实测 SIGINT 不打断分钟级阶段，不测不进。

## 总体裁定：D3 不关闭，0 Blocker / 4 Major / 3 Minor / 1 Nit
解析层与端到端链路的工程质量我认可（缺陷谱系的修复证据链完整、负面结果回退诚实）。但两项门槛未达标 + 我抽样发现的质检可靠性问题，使"自动发布"的信任基础尚不成立。

## 🔴 必须修改（Major）
Major 1 — 难度 4–5 全面转人工，反证结论不可信已有实证。 我抽查`questions.json` 发现：`ChatGPT q1` 的反证推理文本明确写着"Therefore second_answer_defensible = false "，但结构化字段输出`true` → 题被阻断。该矛盾在 6 份材料中 3 份各出现至少 1 例（ChatGPT、新闻、明末清初）。另`answer_leakage` 声称"选项无绝对词"，而同题 B 选项含 "always more fair"、D 含 "no potential"——soft check 在同厂商下漏检。这直接回答 Q1： 不是题歧义，是单厂商自证的字段-推理不一致 。裁决：① 跨厂商密钥到位前， 难度 4–5 一律`needs_review` ，禁止自动发布 （把`applicableHardChecksFor` 的 ≥4 分支改为直接转人工，反证仅作参考意见展示）；② 反证 prompt 增加自洽要求（先推理、后字段，字段必须与推理一致），但这只是缓解，根因等第二家厂商。③ 报告口径修正：16/32 是 attempt 级 （含生成重试的重复质检， spike.ts:693 ），最终题级失败更低（如 1013 仅 1/17）——门槛统计必须按最终题口径重算并注明。

Major 2 —`kp_extract` 块级失败必须走修复调用，禁止直接放弃。 1013 丢 10/26 块 ≈ 近 40% 章节无考点，触及"知识点召回 ≥75%"门槛。zod 失败≠内容失败，generation 侧已有 repair 回路，复用即可。裁决：块级抽取加 一次带 zod 错误路径的修复调用 （同 generation 模式），修复仍失败才允许放弃并告警；`stats.json` 增加`kpBlockRepairCount` 。1013 一篇独占 10 次且其 schema 首过 81%，需顺带排查该材料的 prompt 适配问题（是否与页眉污染 R6 相关）。

Major 3 — 蓝图加入难度/题型配额与一次补位重试。 证据充分：难度 4–5 逐材料 0–50%（4/6 低于 15%）、英文多选 12.7% vs 目标 30%、多选答案数非法即丢题位 5 次。裁决：蓝图按 KP 重要性显式分配难度档与题型配额；生成失败/答案数非法时允许 同 KP 换题型补位一次 ，仍失败再降级单选并记录原因。这是对 Q4 的回答，M0-2 前落地。

Major 4 — 语言检测改双条件（Q5 裁决）。 PPT（16,669 字、汉字 483 个、占比 2.9%）被判`en` ，直接违反"中文材料出中文题"。裁决：阈值改为——`hanRatio ≥ 0.3` 判 zh； 或`汉字绝对数 ≥ 300 且 hanRatio ≥ 0.02` 判 zh（术语密集中文材料分支，英文术语保留原文、题干解析用中文）。英文论文夹零星中文注释（汉字数远低于 300）不受影响。必带两条新测试：PPT 形态样本、英文论文夹中文注释样本。

## 🟡 建议（Minor）
- Minor 1 — 成本台账不可追溯。 全缓存重跑覆盖了`stats.json` ，报告中 ¥0.553 等成本来自已被覆盖的旧运行，当前产物无法复核。今后每次非全缓存运行将 stats 追加写入`cost-ledger.jsonl` ，不覆盖。另外整个工作区不是 git 仓库，报告无法锚定代码版本——建议初始化 git 并让报告记录 commit hash。
- Minor 2 — R6 页眉页脚未剥离 （1013 出现 53 字页眉独立切块）：M0-2 前做简单的跨页重复行检测剥离，成本低、直接减少 token 浪费与考点污染。
- Minor 3 — R10/R11 登记 ：接 worker 时`documents` 表必须写入（引用坐标系持久化，D2 已建表）；`generate-question.v1` 原地改过一次，今后 prompt 任何改动必须升版本号。
## Nit
- `ChatGPT q1` 的题干是陈述句而非问句（多选可以，但题干模板建议统一为问句或"以下哪些…"句式），人审时留意。

## 对 5 个问题的其余裁决
- Q3（schema 首过 86.1%） ：接受"一次修复后合法"的运行时行为，M0 不强制提首过率；但门槛统计 维持首过口径 ，且`stats.json` 须新增`schemaAfterRepairRate` ，修复调用不得计为首过。
- Q1/Q2/Q4/Q5 见 Major 1/2/3/4。

## M0 完成定义还剩什么
1. 4 个 Major 修复并复审；
2. 人工复核 71 道已发布题 （门槛 10/11，我无法代算，`question-details.md` 已备妥）；
3. M0-2 接 worker 时实测分钟级任务 SIGINT 行为（准入条件 ③）+`documents` 表写入；
4. 第二家厂商密钥到位后补跨厂商反证，再决定难度 4–5 能否恢复自动发布；
5. 100 页材料 p95 实测（当前最大 18 页，不外推）。
文档处置：请将 INDEX.md 中本报告状态改为「有 Major（4 项），修复后待复审」，并把本意见原文落入计划第十五节。Major 清零前不进 M0-2 业务页面——止损规则继续有效。

### K3 审查处理记录：D3 整体报告（2026-10-29）

审查对象：`reviews/2026-10-27-d3-dev-report.md`。K3 裁定 0 Blocker / 4 Major / 3 Minor / 1 Nit，D3 不关闭。本轮 9 条意见全部处理，逐条落点见审查文件「处理记录」；`pnpm check` EXIT=0（18 文件 / **120 用例**，depcruise 90 模块 / 171 依赖 0 违规）。

| # | 意见 | 判定 | 落点 |
|---|---|---|---|
| Major 1 | 难度 4–5 一律转人工；反证只作参考；门槛按最终题口径 | 接受 | `spike.ts:704-717`（≥4 不进 `answer_contrast` 适用集合）、`spike.ts:1140-1150`（`high_difficulty_manual_review` 强制 `needs_review`）、`answer-contrast.v2.ts`（自洽要求）、`spike.ts:1342-1352` + `report.ts:143-149`（分母改为最终题口径并注明） |
| Major 2 | `kp_extract` 块级失败必须修复一次 | 接受 | `spike.ts:340-376`（带 zod 错误路径 + 降载提示的修复调用）、`stats.kpBlockRepairCount` |
| Major 3 | 蓝图加难度配额 + 换题型补位 | 接受 | `spike.ts:563-582`（15% 题位推难度 ≥4，按 KP importance 优先）、`spike.ts:1261-1290`（换题型一次 → 降级单选，逐次计数） |
| Major 4 | 语言检测双条件 | 接受（发现新误判样本，待 K3 裁决） | `language.ts:13-51`；`language-detect.test.ts:42-58`（两条必带用例）。**PPT 判 zh ✅；英文期刊 1013 也被判 zh，见争议项** |
| Minor 1 | 成本台账 + 代码版本锚点 | 接受（git 初始化待用户确认） | `run-eval.ts:299-320`（`cost-ledger.jsonl` 追加写）、`run-eval.ts:342-383`（`computeCodeDigest`）、`report.ts:279` |
| Minor 2 | 跨页页眉页脚剥离 | 接受 | `normalize-document.ts:81-155`（`stripRepeatedEdgeLines`）、`NORMALIZATION_VERSION` 升 `m0-v2`、9 条新测试 |
| Minor 3 | `documents` 落库 + prompt 版本纪律 | 接受（登记） | M0-2 准入条件；`generate-question.v2` / `answer-contrast.v2` 新建，v1 原样保留 |
| Nit | 题干模板统一问句 | 接受（缓解） | `generate-question.v2.ts` 规则 6 |
| Q3 | 首过口径不变，新增 after-repair | 接受 | `spike.ts:1369-1379`、`report.ts:110-123`（修复调用不计首过） |

**复跑（v2 prompt + m0-v2，6/6 完成）**：自动发布且难度 ≥4 的题 = 0（44 道难度 ≥4 全部 `needs_review`）；生成题中难度 4–5 占比 26.3%–66.7%（门槛 15%，D3 同期 7%–47%）；1013 的 `kp_extract` 块级失败 10 → 0；schema 修复后合法率 98.5%–100%；6 份合计生成 102 题、自动发布 51、补位 37 次成功 18 次，成本 ¥2.936（台账 6 行，与产物逐份对得上）。自动发布数下降（51/102 vs D3 71/92）是难度转人工的结果，不是质量回退。**台账说明**：Graph RAG 的成本记在第一次运行（¥0.588 / 112 次调用，被中止的批次其实跑完了这一份），复跑为 124 次全缓存命中、¥0；台账只在运行完整结束时追加，中途被强杀会漏记（本轮未出现）。

**争议项（未擅自改规则）**：1013 是英文期刊（*Children's Literature in Education*），汉字 979 个 / 占比 2.31%，按 K3 公式判 `zh`，于是出了 18 道中文题。实测 PPT（359 汉字 / 2.85%）与 1013 无法用汉字数、占比、连续段长度、含汉字行占比区分（前者 127 vs 后者 4 的差别只在"文首 2000 字"）。候选第三条件未实施，等 K3 裁决；也可能这类材料应允许用户手动指定语言而非靠统计猜。

**未完成（不声称已关闭）**：K3 复审；人工复核 51 道自动发布题（D3 原 71 道的集合已被本轮重跑取代）；M0-2 准入（分钟级 SIGINT + `documents` 落库）；跨厂商反证。**git 已初始化**（用户批准）：首个提交 `4285982`，`data/`、`.env.local`、`*.db` 均被 `.gitignore` 排除，未配置远端、未推送。**INDEX 维持「有 Major（4 项），修复后待复审」。**

### D3 复审请求与仓库托管（2026-10-29）

**引用定位口径缺陷（本轮自查发现并修正，`ec26ae9`）**：旧口径 `citationLocated / plannedSlots` 把没生成出来的题位算进分母、同一题位重试成功也只记一次，6 份材料实测算出 `103/102 > 100%`。改为按**模型产出 `answer_quote` 的次数**计：首次定位 `103/136 = 75.7%`，重试后最终 102 道题位全部有可定位引用。全部 6 份材料从缓存重跑以重新生成 `stats.json`，因此这些产物里 `costCny` / `p95` 为 0——真实成本仍在 `data/evals/cost-ledger.jsonl`（6 行，合计 ¥2.936）与首次运行日志中（逐题 p95 32.2–42.8s）。**记分卡上引用匹配改为 ❌ 未达标**，这是比以前"92/92 = 100%"更可信的口径。

**开发报告重写**：`reviews/2026-10-29-d3-dev-report.md` 作为复审请求（背景/变更清单/自测/6 份材料复跑表/门槛记分卡/口径修正说明/已知偏差/负面结果/5 个待裁问题/复现与产物）。`reviews/2026-10-27-d3-dev-report.md` 原样保留为受审对象与审计痕迹（含 K3 意见原文与逐条处理记录）。`reviews/INDEX.md`：新报告登记「待审」，旧报告状态注明"复审请求见 2026-10-29 报告"。

**仓库托管（用户批准，约束"不要动别的仓库"）**：远端 `https://github.com/Qcn994/Qgen-Quention-Generator.git`，本地 `main` 已合并 GitHub 初始提交并推送（`1cda4a7`）；后续 `ec26ae9` 与本轮文档提交在同一分支顺序推送。`data/`、`.env.local`、`*.db` 均在 `.gitignore` 内，材料与产物未入库。Windows 下需 `git config http.sslBackend schannel`（OpenSSL 证书链失败）。

**状态**：D3 仍未关闭，INDEX 维持「有 Major（4 项），修复后待复审」的语义（新报告为待审）。未收到 K3 实际复审文本前不声明通过；M0-2 止损规则继续有效。
