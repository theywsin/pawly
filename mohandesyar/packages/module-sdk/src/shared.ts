/**
 * Bare specifiers a module *frontend* bundle leaves external. The host SPA provides exactly one copy of
 * each through its import map (docs/03-module-system.md §6), so host and modules share React, router
 * and query-client instances.
 */
export const SHARED_WEB_DEPENDENCIES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  'react-router',
  '@tanstack/react-query',
  '@mohandesyar/ui',
  '@mohandesyar/module-sdk/web',
] as const;
