# 审查请求：D1 工程地基

## 背景与目标

按计划第十四节 D1 交付物搭建 pnpm workspace：TS strict、ESLint/Prettier、Vitest、dependency-cruiser 边界规则、SQLite schema + 迁移、独立 `tsx watch` worker、`pnpm dev` 一条命令、进度轮询接口。

本轮**不写业务流水线**：worker 的三个阶段（parse/normalize/chunk）是空实现，只推进进度。真正的解析与出题在 D3 接入。目标是先让分层、任务队列、崩溃恢复、前后端联调这条"地基"真实跑通。

## 变更文件清单

**根目录**
- `package.json` — workspace 脚本（dev/check/db:*）
- `pnpm-workspace.yaml`、`tsconfig.base.json`、`.gitignore`、`.env.example`
- `.dependency-cruiser.cjs` — 6 条边界规则
- `eslint.config.mjs`、`vitest.config.ts`
- `.github/workflows/ci.yml` — typecheck / lint / test / depcruise 四道关

**packages/domain**（零依赖，只 import TS）
- `src/question/question.ts`、`question-state.ts`、`answer-key.ts`
- `src/attempt/grading.ts`、`src/review/review-schedule.ts`
- `src/text/normalize.ts`、`src/citation/citation-check.ts`
- `src/material/material.ts`、`src/index.ts`
- 6 个测试文件（33 个用例）

**packages/application**（只依赖 domain + 自己的端口）
- `src/ports/{clock,id-generator,repositories}.ts`
- `src/use-cases/{ingest-material,get-material-progress}.ts`

**packages/infrastructure**
- `src/db/schema.ts`（materials / processing_jobs / llm_cache）
- `src/db/client.ts`（better-sqlite3 + WAL + 外键）
- `src/db/migrate.ts`、`drizzle.config.ts`、`drizzle/0000_complete_the_watchers.sql`
- `src/db/repositories/{materials,jobs}.repo.ts`

**packages/contracts / config / evals**
- `contracts/src/index.ts`（zod DTO）、`config/src/index.ts`（env + 模型路由表）、`evals/src/run-eval.ts`（占位）

**apps**
- `apps/worker/src/main.ts` — FIFO 串行、僵尸重置、阶段链、优雅退出
- `apps/web/src/server/container.ts` — 组合根（唯一 import infrastructure 的位置）
- `apps/web/src/app/api/v1/materials/route.ts`、`.../[id]/progress/route.ts`
- `apps/web/src/app/{layout,page}.tsx`

## 自测结果（实际命令与输出）

### 1. 全量检查

```
$ pnpm check
...
apps/web typecheck: Done
$ eslint .
$ vitest run
 Test Files  7 passed (7)
      Tests  33 passed (33)
$ depcruise apps packages --config .dependency-cruiser.cjs
✔ no dependency violations found (45 modules, 67 dependencies cruised)
```

### 2. 边界规则真的会失败（K3 要求的破坏性验证）

临时创建 `packages/domain/src/boundary-probe.ts`，内容为 `import '../../application/src/index.ts'`：

```
$ pnpm depcruise
  error domain-no-outward: packages/domain/src/boundary-probe.ts → packages/application/src/index.ts

x 1 dependency violations (1 errors, 0 warnings). 46 modules, 68 dependencies cruised.

[ELIFECYCLE] Command failed with exit code 1.
```

删除探针后复跑：`✔ no dependency violations found (45 modules, 67 dependencies cruised)`。

### 3. 僵尸任务清理（启动前手工插一条 running）

```
$ node -e "...insert materials('m-zombie') + processing_jobs('j-zombie','parse','running')..."
inserted zombie job

$ timeout 6 pnpm --filter @qgen/worker start
[worker] 重置 1 条僵尸任务（上次进程遗留的 running）
[worker] m-zombie parse 开始
[worker] m-zombie parse 完成
[worker] m-zombie normalize 开始
[worker] m-zombie normalize 完成
[worker] m-zombie chunk 开始
[worker] m-zombie chunk 完成

// 之后查库：
{ id: 'j-zombie', stage: 'parse', status: 'done', progress: 100, attempt: 2 }
{ id: 'm-zombie', status: 'ready' }
```

### 4. 端到端（上传 → 轮询 → ready）

```
$ pnpm dev            # db:migrate + concurrently(web:3100, worker)
ready after 1s

$ curl -X POST -F "file=@data/samples/demo.txt;type=text/plain" localhost:3100/api/v1/materials
{"id":"00129f7e-...","status":"uploaded"}

$ curl localhost:3100/api/v1/materials/00129f7e-.../progress
{"material":{...,"status":"ready"},"job":{"stage":"chunk","status":"done","progress":100,"attempt":1}}
```

耗时约 3 秒（三个 stub 阶段各 0.9 秒）。`GET /` 返回 200，`data/uploads/` 下有落盘文件。

## 已知风险与不确定点

1. **TypeScript 从 7.0.2 降到 6.0.3**。typescript-eslint 8.72 启动即报 `typescript-eslint does not support TS 7.0`。降到 6.0.3 后 lint 正常；TS 7 是原生编译器，等 typescript-eslint 支持后再升。
2. **3000 端口被外部进程占用**（PID 3768，非本项目），dev 改到 **3100**。需要确认这不是用户的另一个项目在跑。
3. **`DATA_DIR` 的解析依赖 cwd 向上查找 `pnpm-workspace.yaml`**。M0 可用；M1 部署时必须传绝对路径，否则会写错位置。
4. **重试语义未实现**：`enqueue` 用 `onConflictDoNothing` 且 `(materialId, stage)` 唯一，失败任务重跑需要先重置状态，D2 的 retry 接口才补齐。当前 worker 失败后只标 failed。
5. **阶段级恢复会让中断阶段从头开始**（progress 归 0），`llm_cache` 只能省掉已完成的调用费用，不能省掉阶段内的重复计算。
6. **未接 Tailwind / shadcn**：页面用内联样式，只为证明轮询链路可用。D2 前补。
7. **上传文件整块读进内存**（`file.arrayBuffer()`），200MB 上限下峰值内存约 200MB/请求，单用户 M0 可接受。
8. **better-sqlite3 是同步 API**，在 Next 请求线程里直接用；单用户 M0 没问题，M1 换 Postgres 后自然消失。

## 请重点审查的问题

1. **依赖方向**：infrastructure 依赖 application 的端口接口，apps 通过 `apps/web/src/server/container.ts` 组合。这个方向是否符合计划第四节的同心圆？depcruise 规则是否还有漏网路径（例如 contracts → domain、config → application）？
2. **`claimNext` 的并发安全**：现在是"先 select 再条件 update"，单 worker 下安全。M1 多 worker 时是否必须改成单语句 `UPDATE ... RETURNING`？M0 就改的成本是否值得？
3. **重试设计**：`(materialId, stage)` 唯一索引 + `onConflictDoNothing` 会让失败阶段无法重新入队（除非手工重置）。D2 的 retry 应该 update 原 job 的 status/attempt，还是插入新 job 并放宽唯一索引？
4. **阶段级恢复粒度**：中断阶段 progress 归零是否可接受？如果 D3 的解析阶段要跑 2 分钟，是否需要在阶段内部写检查点（例如每 10 页更新一次进度并记录已完成页数）？
5. **测试覆盖缺口**：计划必测清单 11 项，当前实现了 6 项（状态机、答案键、判分、归一化、引用、复习；幂等与 chunk/blueprint/language/publish-gate 未做）。是否要求 D2 开始前先补齐剩余 5 项，再接 schema？

## Kimi K3 审查意见（原文，2026-10-25）

复测声明：未采信请求文件中的自测输出，全部独立复核。

- **沙箱外复跑 `pnpm check`，EXIT=0**：typecheck / eslint / vitest(33 通过) / depcruise(45 模块，0 违规) 全绿，与声称一致。
- 逐文件核对了 depcruise 规则、schema、迁移 SQL、worker 主循环、两个 repo、container、两条 API 路由、前端轮询、CI、.env.example、tsconfig strict、domain 纯度（无 `Date.now`/`Math.random`，时间全部走注入参数）。

**结论：1 Blocker / 3 Major / 2 Minor / 3 Nit。D1 不予通过，Blocker 修复后复审。**

### 🔴 Blocker 1：优雅退出把中断任务永久标 failed，且无法恢复

`main.ts` 的进度循环里 `if (!running) throw new Error('worker 正在退出')`，这个异常被主循环的 catch 捕获后走 `jobs.fail()` + 材料标 `failed`。

后果链：job 是 `failed` 不是 `running` → **下次启动的僵尸清理不会捡它**（只重置 `running`）→ 唯一索引 `(materialId, stage)` + `onConflictDoNothing` 又堵死重新入队 → **该材料永久卡死，只能手工改库**。

这直接违反两条计划条文：①计划 L266 阶段级恢复；②M0 完成定义"全程不需要手工改数据库"。同时实现与自身意图矛盾：L32 的日志写着 "finishing current stage then exiting"，代码却是中断当前阶段。

注意 Windows 细节：`concurrently -k` 走 taskkill 强杀（handler 不执行，僵尸清理可恢复），但**独立终端 Ctrl+C 和 Linux 的 SIGTERM 都会执行 handler**，必踩此坑。D3 阶段跑 2 分钟后，每次 Ctrl+C 稳定砖一份材料。

**修复要求**（二选一，都很小）：①按日志承诺实现：删掉中途 throw，让当前阶段跑完再退出；或②catch 里区分关停错误：关停时把 job 置回 `pending`（或保持 `running` 留给僵尸清理），不得标 failed，材料也不得标 failed。

### 🟡 Major 1：depcruise 没有强制"container 是唯一组合根"

6 条规则挡不住 `apps/web/src/app/**` 的路由处理器直接 `import '@qgen/infrastructure'` 绕过 `container.ts`。当前代码没有违规，但 D1 的全部意义就是机器强制边界。

**修复**：加规则，`from: apps/web/src/**` 且 `pathNot: container.ts` → `to: packages/infrastructure` 禁止；worker 侧同理只放行 `main.ts`。

### 🟡 Major 2：上传路由先入队、后写盘，写盘失败留孤儿

`route.ts`：`ingestMaterial.execute()`（落材料行 + 入队 parse）**在 `writeFile` 之前**。写盘失败时材料行和 pending job 已存在但文件不存在——D1 stub 感知不到，D3 接入真实解析后就是"材料 failed 且无法重试"的另一个源头。

**修复**：先写盘成功再调 `ingestMaterial`；或 try/catch 里补偿删除。不要求 D1 抽象 storage 端口（那是 D2 的事），只要求顺序修正。

### 🟡 Major 3：重试语义整体缺席，需锁定 D2 设计方向

计划 L264"单任务重试 2 次后标 failed"、L281 `POST /api/v1/materials/:id/retry`，当前均未实现（开发者已在风险 4 披露）。接受延期到 D2，但 **D2 开工前必须把 Q3 的设计结论写进计划**，否则 D2 会在错误的唯一索引假设上盖楼。

### Minor

1. **claimNext 抢失败时白睡 1 秒**：条件 update 失配返回 null，主循环 sleep 1s 而不是立即重取下一条 pending。单 worker 无感，仅记录。
2. **contracts 目前是死代码**：路由未用 zod schema 校验响应。要么接线，要么在 D2 明确它只服务前端类型导入。

### Nit

1. **状态枚举三处复制**：`domain/material.ts`、`infrastructure/db/schema.ts`、`contracts/index.ts`。M0 可忍，D2 统一从 domain 派生。
2. 端口 3100 未写进 `.env.example` 或任何文档。
3. 僵尸清理只重置 status 不清 progress，无碍（重跑时 15/45/80 会覆盖），仅备注。

### 三处实现偏差的裁决

1. **TS 7.0.2 → 6.0.3：接受**。typescript-eslint 8.72 不支持 TS 7 是硬性工具链约束。记录升级触发条件：typescript-eslint 官宣支持 TS 7 后回迁。
2. **端口 3000 → 3100：接受**。环境约束非架构决策。3000 上的 PID 3768 不用动。
3. **worker 三阶段空实现：接受，且明确支持这个裁剪**。计划 L681 给 D1 的定义就是分层 + 队列 + 恢复 + 联调，L683 把解析划给 D3 spike。**附带条件**：D3 接入真实长任务时，必须复审 Blocker 1 的修复在分钟级阶段下的表现。

### 五个指定问题的回答

**Q1 依赖方向**：方向正确，符合同心圆。漏网路径见 Major 1（apps 内部绕行）。contracts/config 目前干净，暂不加规则，保持观察。

**Q2 claimNext 并发安全**：**开发者的担忧比实际严重**。条件 update（`where id AND status='pending'`）本身就是原子认领——两个进程 select 到同一行后，后到的 update 匹配 0 行返回 null，**不会双领**。真正缺陷只是 Minor 1 的白睡 1 秒。M0 不改；M1 反正整体换 pg-boss。

**Q3 重试设计**：**UPDATE 原行，严禁放宽唯一索引**。`(materialId, stage)` 唯一编码了"每材料每阶段一条记录"的不变量，阶段级恢复、僵尸清理、`findLatestByMaterial` 全部建立在它上面。D2 设计锁定为：自动重试放 worker——失败时 `attempt < 2` 则置回 `pending`（attempt 累计不清零），否则标 `failed`；手工重试走 `POST /retry`，同样 UPDATE 原行（status→pending, progress→0, error→null）。`onConflictDoNothing` 保留，它在阶段链里的职责是防重复入队的幂等保护。

**Q4 阶段内检查点**：M0 接受 progress 归零。llm_cache 保证的是费用不重复，损失的是时间不是钱，单用户本地可忍。现在**不加** schema 字段、不做页级持久化；D3 spike 实测 parse 耗时后，若单阶段 >2 分钟再议。

**Q5 测试缺口**：**不要求 D2 前补齐**。计划 L704 本来就只要求 D1 覆盖状态机 + 引用校验，实际交付 6/11 已超标。剩余 5 项对应的被测模块还不存在，现在写是测空气。它们是 D2 DoD 的一部分，且是模块级准入条件：chunker 落地必须带 chunk-bounds 测试，blueprint 落地必须带配比测试，不许"先代码后补票"。

### 处置要求

1. Blocker 1 修复后重新提交审查（附修复前后的退出行为实测输出）；Major 1、2 改动很小，建议同批修。
2. 将本结论按 Blocker/Major/Minor/Nit 落入计划第十五节并追加处理记录；Q3 的重试设计结论写入 D2 范围。
3. `INDEX.md` 状态从"待审"改为"有 Blocker"。
4. 计划 L830 的"D1 审查结论回来前不开工 D2"仍然有效。

## 处理记录（2026-10-25）

| # | 意见 | 判定 | 改动 |
|---|---|---|---|
| Blocker 1 | 优雅退出把中断任务标 failed，永久卡死 | **接受** | `apps/worker/src/main.ts`：删除 `runStage` 里的中途 `throw`，关停只置 `running=false`，当前阶段跑完后 `while (running)` 自然退出；加注释说明原因。修复前后实测见下节 |
| Major 1 | depcruise 未强制"container 唯一组合根" | **接受** | `.dependency-cruiser.cjs` 新增 `web-infrastructure-only-in-container` 与 `worker-infrastructure-only-in-main`；用两个探针文件实测两条规则均报 error（`exit code 2`），删除探针后复跑干净 |
| Major 2 | 上传路由先入队后写盘 | **接受** | `apps/web/src/app/api/v1/materials/route.ts`：改为「临时名落盘 → `ingestMaterial` → rename 到 `${materialId}-${safeName}`」；ingest 失败时 `rm` 临时文件。同目录 rename 原子；rename 本身失败仍会留下孤儿行（概率极低，记录待 D2 storage 端口一并处理） |
| Major 3 | 重试语义缺席 | **接受（延期 D2）** | 计划第十五节新增「D2 重试设计（K3 裁决）」：UPDATE 原行、`attempt < 2` 自动重试、保留唯一索引与 `onConflictDoNothing` |
| Minor 1 | claimNext 抢失败白睡 1s | **记录，不改** | `jobs.repo.ts` 的 `claimNext` 增注释，写明条件 update 已是原子认领、抢输返回 null 是预期路径；M1 换 pg-boss 后消失 |
| Minor 2 | contracts 是死代码 | **接受** | 新增 `apps/web/src/server/dto.ts`（`toProgressResponse`，按 `progressResponseSchema.parse` 校验）；progress 路由改用它；`page.tsx` 删除本地 DTO，改用 `@qgen/contracts` 的 `ProgressResponse` / `MaterialDto` / `UploadResponse` / `ErrorResponse` |
| Nit 1 | 状态枚举三处复制 | **记录进 D2** | 计划「当前状态」记为 D2 待办：枚举统一从 domain 派生 |
| Nit 2 | 端口 3100 未入文档 | **接受** | `.env.example` 补端口说明与 `DATA_DIR` 相对根目录解析的说明 |
| Nit 3 | 僵尸清理不清 progress | **记录，不处理** | 重跑时 15/45/80 会覆盖，无行为影响 |

三处实现偏差：K3 全部裁决为**接受**（TS 6.0.3 锁定 + typescript-eslint 支持 TS 7 后回迁；端口 3100 保持；worker 空实现保持，D3 接入长任务时复审 Blocker 1 修复）。

### 修复前后实测：SIGINT 打断进行中的阶段

Windows 无法向其他进程投递真实控制台 Ctrl+C（Node 的 `process.kill` 走 `TerminateProcess`，handler 不执行），因此用 `process.emit('SIGINT')` 在 worker 启动 500ms 时触发**同一个处理函数**，复现同一条代码路径。夹具放在仓库外的临时目录。

**修复前**（任务 `j-shut2`，stage=parse 进行中收到关停）：

```
[worker] m-shut2 parse 开始
[repro] 触发 SIGINT（等价于终端 Ctrl+C 进入 handler）
[worker] SIGINT received, finishing current stage then exiting
[worker] m-shut2 parse 失败: worker 正在退出
[worker] 已退出

查库：j-shut2 { stage: 'parse', status: 'failed', progress: 0, attempt: 1, error: 'worker 正在退出' }
      m-shut2 { status: 'failed' }
```

**修复后**（任务 `j-shut3`，同样时机关停）：

```
[worker] m-shut3 parse 开始
[repro] 触发 SIGINT（等价于终端 Ctrl+C 进入 handler）
[worker] SIGINT received, finishing current stage then exiting
[worker] m-shut3 parse 完成
[worker] 已退出

查库：parse       { status: 'done', progress: 100, attempt: 1 }
      normalize   { status: 'pending', progress: 0 }   ← 下一阶段已入队，等下次启动
      m-shut3     { status: 'processing' }
```

再次启动 worker（阶段级恢复验证）：

```
[worker] m-shut3 normalize 开始 / 完成
[worker] m-shut3 chunk 开始 / 完成

查库：parse/normalize/chunk 全部 done，attempt 均为 1（parse 未被重跑）
      m-shut3 { status: 'ready' }
```

### Major 1 规则的破坏性验证

临时创建 `apps/web/src/app/boundary-probe.ts` 与 `apps/worker/src/consumer-probe.ts`，各自 `import { createSqliteDb } from '@qgen/infrastructure'`：

```
$ pnpm depcruise
  error worker-infrastructure-only-in-main: apps/worker/src/consumer-probe.ts → packages/infrastructure/src/index.ts
  error web-infrastructure-only-in-container: apps/web/src/app/boundary-probe.ts → packages/infrastructure/src/index.ts

x 2 dependency violations (2 errors, 0 warnings). 49 modules, 75 dependencies cruised.
[ELIFECYCLE] Command failed with exit code 2.
```

删除探针后 `pnpm check` 全绿：`Test Files 7 passed`、`Tests 33 passed`、`✔ no dependency violations found (47 modules, 73 dependencies cruised)`，EXIT=0。

### Major 2 回归验证（真实上传）

```
POST /api/v1/materials (demo.txt) → {"id":"5e1fcf93-...","status":"uploaded"}
落到 data/uploads/5e1fcf93-...-demo.txt，无遗留 .tmp- 文件
GET  /api/v1/materials/5e1fcf93-.../progress → 契约校验通过：
  {"material":{...,"status":"uploaded","createdAt":"2026-10-25T04:19:08.531Z",...},
   "job":{"stage":"parse","status":"pending","progress":0,"error":null}}
worker 跑完后 → status "ready"，job chunk done 100
```

### 附带发现（操作层面，不影响代码）

复现过程中发现上一轮验证用的 `pnpm dev` 进程树（concurrently → next dev:3100 + `tsx watch` worker）**在会话的后台任务结束后仍然存活**，并且持续消费队列任务。本次已手动清理。教训：后台启动的 `pnpm dev` 必须显式 `taskkill //T` 整个树，不能只依赖任务结束。"

## K3 第四轮复审结论（2026-10-25）：✅ 通过，审查关闭

复审声明：未采信处理记录的文字描述，逐项独立核验。

- 沙箱外复跑 `pnpm check`，EXIT=0：33 测试通过，depcruise 47 模块 / 73 依赖 / 0 违规，模块数与声称一致。
- **Blocker 1**：中途 throw 已删除，注释正确引用成因链；阶段跑完后由 `while (running)` 自然退出，与日志承诺一致。修复前后实测（j-shut2 failed → m-shut3 续跑 normalize/chunk 至 ready 且 parse 的 attempt 保持 1）与代码行为吻合，attempt 不复位顺带证实阶段级恢复有效。
- **Major 1**：两条组合根规则 `pathNot` 精确锁定 container.ts / main.ts，探针破坏性验证（exit code 2）确认规则会真的失败。
- **Major 2**：临时名落盘 → ingest（失败补偿删临时文件）→ rename，孤儿路径已封闭。
- **Minor 2 / Nit 2**：`dto.ts` 用 `progressResponseSchema.parse` 在接口处校验，`page.tsx` 已切契约类型；`.env.example` 已注明端口与 DATA_DIR 解析规则。
- **文档**：第十五节处理记录与「D2 重试设计」与裁决逐字吻合。
- **进程残留**：`netstat` 确认 3100 无监听；该问题属观测污染典型，披露得当。

**结论**：9 条意见全部落地或按裁决归位，无争议项，D1 关闭。

两处备注（不要求处理）：

1. `route.ts` 的 `rename` 未包进补偿范围——rename 失败会留"材料行 + 临时文件"。同目录 rename 近原子，风险可忽略，仅记录。
2. worker 组合根规则的注释写"消费者只允许依赖 application 的端口"，但规则实际只拦 infrastructure（消费者仍可 import config/contracts）。当前无违规；D2 引入消费者文件时若在意可收紧。

**处置**：INDEX 改为已关闭；D2 开工解禁，DoD 重申——必测清单 11 项全绿（剩余 5 项随对应模块落地，不许先代码后补票）、重试语义按第十五节实现、D2 待办两条。
