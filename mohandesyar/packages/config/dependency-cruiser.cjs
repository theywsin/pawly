/**
 * Module boundary rules (docs/02-architecture.md §2). Enforced in `pnpm lint` and CI.
 */
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'core-must-not-import-modules',
      comment: 'The core must never depend on any module.',
      severity: 'error',
      from: { path: '^apps/' },
      to: { path: '^modules/' },
    },
    {
      name: 'module-must-not-import-other-module',
      comment: 'Modules talk to each other only via registered public services, events and providers.',
      severity: 'error',
      from: { path: '^modules/([^/]+)/' },
      to: { path: '^modules/([^/]+)/', pathNot: '^modules/$1/' },
    },
    {
      name: 'module-must-not-import-apps',
      comment: 'Modules may only use the SDK and shared packages, never core internals.',
      severity: 'error',
      from: { path: '^modules/' },
      to: { path: '^apps/' },
    },
    {
      name: 'packages-must-not-import-apps-or-modules',
      severity: 'error',
      from: { path: '^packages/' },
      to: { path: '^(apps|modules)/' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: { path: '^(apps|packages|tools)/' },
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(/dist/|/node_modules/|\\.local/|shared-vendor)' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    combinedDependencies: true,
  },
};
