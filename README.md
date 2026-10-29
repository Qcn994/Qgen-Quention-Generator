# QGen（知题）

上传学习材料 → 后台解析出题 → 练习 → 订正 → 复习。

当前进度：**M0 / D1 工程地基已完成**。worker 的三个阶段是空实现，只推进度；真正的解析与出题在 D3 接入。

## 运行

```bash
pnpm install
pnpm dev          # 迁移 + 同时启动 web(3100) 与 worker
```

打开 http://localhost:3100 ，上传 PDF / DOCX / PPTX / TXT 即可看到进度推进到「可练习」。

> 端口 3100 是因为本机 3000 被其他进程占用；改动见 `apps/web/package.json`。

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

数据落在 `data/`（已 gitignore）：`qgen.db` + `uploads/`。
