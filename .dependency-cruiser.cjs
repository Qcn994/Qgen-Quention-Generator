/**
 * 分层边界的机器强制。规则一旦放宽，架构就会在一周内腐烂。
 * 新增例外必须在 reviews/ 里留下记录。
 */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: '循环依赖会让分层失去意义',
      from: {},
      to: { circular: true },
    },
    {
      name: 'domain-is-pure-typescript',
      severity: 'error',
      comment: 'domain 只能 import TypeScript：不许 zod、不许 Drizzle、不许 node 内置模块',
      from: { path: '^packages/domain/src' },
      to: {
        dependencyTypes: ['npm', 'npm-dev', 'npm-peer', 'npm-optional', 'core'],
      },
    },
    {
      name: 'domain-no-outward',
      severity: 'error',
      comment: 'domain 是同心圆最内层，不许知道任何上层',
      from: { path: '^packages/domain/src' },
      to: { pathNot: '^packages/domain/src' },
    },
    {
      name: 'application-only-domain-and-ports',
      severity: 'error',
      comment: 'application 只依赖 domain 与自己的端口定义；时间走 Clock，哈希走端口',
      from: { path: '^packages/application/src' },
      to: {
        dependencyTypes: ['npm', 'npm-dev', 'npm-peer', 'npm-optional', 'core'],
      },
    },
    {
      name: 'application-no-infrastructure',
      severity: 'error',
      comment: '用例层不许知道 Drizzle / pg-boss / OSS / SDK 的存在',
      from: { path: '^packages/application/src' },
      to: { path: '^packages/(infrastructure|config|contracts)/src' },
    },
    {
      name: 'no-packages-to-apps',
      severity: 'error',
      comment: '包不能反向依赖应用',
      from: { path: '^packages/' },
      to: { path: '^apps/' },
    },
    {
      name: 'web-infrastructure-only-in-container',
      severity: 'error',
      comment: 'web 只在 container.ts 装配依赖；路由/页面直接 import infrastructure 会绕开用例层',
      from: { path: '^apps/web/src', pathNot: '^apps/web/src/server/container\\.ts$' },
      to: { path: '^packages/infrastructure/src' },
    },
    {
      name: 'worker-infrastructure-only-in-main',
      severity: 'error',
      comment: 'worker 只在 main.ts 装配依赖；消费者只允许依赖 application 的端口',
      from: { path: '^apps/worker/src', pathNot: '^apps/worker/src/main\\.ts$' },
      to: { path: '^packages/infrastructure/src' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: 'node_modules|dist|\\.next|coverage' },
    tsConfig: { fileName: 'tsconfig.base.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
    },
  },
};
