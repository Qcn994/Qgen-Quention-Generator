import type { NextConfig } from 'next';

/**
 * 工作区包直接导出 TS 源码，交给 Next 编译；
 * better-sqlite3 是原生模块，必须留在 Node 运行时侧，不能被打包。
 */
const nextConfig: NextConfig = {
  transpilePackages: [
    '@qgen/domain',
    '@qgen/application',
    '@qgen/infrastructure',
    '@qgen/contracts',
    '@qgen/config',
  ],
  serverExternalPackages: ['better-sqlite3'],
};

export default nextConfig;
