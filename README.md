# QGen（知题）

Upload your study material, and it turns into questions you can practice, correct and review.
上传学习材料 → 后台解析出题 → 练习 → 订正 → 复习。

当前进度：**M0 / D3 Week 0 Spike 已完成**——6 份真实材料（含 2 份两栏英文 PDF、1 份中文授课 PPT）跑通「解析 → 切块 → 考点 → 易错点 → 出题 → 质检 → 发布门禁」，报告与处理记录见 `reviews/`。
尚未接入产品形态：worker 的三个阶段仍是空实现，真实解析要在 M0-2 接入（D3 审查 Major 清零前不进 M0-2）。

## 运行

```bash
pnpm install
pnpm dev          # 迁移 + 同时启动 web(3100) 与 worker
```

打开 http://localhost:3100 ，上传 PDF / DOCX / PPTX / TXT 即可看到进度推进到「可练习」。

> 端口 3100 是因为本机 3000 被其他进程占用；改动见 `apps/web/package.json`。

## Spike / 评测

```bash
pnpm eval -- --material <path> [--items 20] [--parse-only]
```

产出写到 `data/evals/<材料名>-<hash8>/`：归一化全文、切块、考点、题目与校验、门槛记分卡、逐题明细；每次发生 LLM 调用的运行追加一行到 `data/evals/cost-ledger.jsonl`（含成本、调用数与代码指纹）。

## 检查

```bash
pnpm check        # typecheck + lint + test + 分层边界
```

## 结构

```
apps/web            Next.js App Router（交付层 + 组合根 src/server/container.ts）
apps/worker         独立 tsx watch 进程（SQLite 队列、阶段链、僵尸恢复）
packages/domain     纯 TS：题目状态机、答案键、判分、复习排期、归一化、引用校验
packages/application 用例 + 端口（只依赖 domain）
packages/infrastructure Drizzle/SQLite 适配器（唯一写 SQL 的地方）
packages/contracts  zod DTO
packages/config     env + 模型路由表
packages/evals      spike / 回归（D3）
reviews/            审查请求与处理记录
```

数据落在 `data/`（已 gitignore）：`qgen.db`、`uploads/`、`evals/`。
