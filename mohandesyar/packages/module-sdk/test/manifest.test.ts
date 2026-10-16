import { describe, expect, it } from 'vitest';
import { isCoreCompatible, parseManifest } from '../src/manifest.js';

const base = {
  manifestVersion: 1,
  id: 'hello-module',
  name: { fa: 'سلام' },
  version: '1.0.0',
  description: { fa: 'ماژول نمونه' },
  publisher: { id: 'mohandesyar', name: 'Mohandesyar' },
  coreVersionRange: '^1.0.0',
  permissions: [{ key: 'hello-module.note.view', fa: 'مشاهده' }],
  menu: [{ key: 'hello', label: { fa: 'سلام' }, path: '/app/hello', permission: 'hello-module.note.view' }],
  backend: { entry: 'backend/index.mjs' },
  tablePrefix: 'hello_module_',
  entitlement: { key: 'mod.hello' },
};

describe('manifest', () => {
  it('accepts a valid manifest and applies defaults', () => {
    const r = parseManifest(base);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.manifest.disablePolicy.keepData).toBe(true);
      expect(r.manifest.permissions[0]?.scopes).toEqual(['company']);
    }
  });

  it('rejects keys not prefixed with the module id', () => {
    const r = parseManifest({ ...base, permissions: [{ key: 'crm.lead.view', fa: 'x' }], menu: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toContain('hello-module.');
  });

  it('rejects a wrong table prefix', () => {
    const r = parseManifest({ ...base, tablePrefix: 'other_' });
    expect(r.ok).toBe(false);
  });

  it('rejects paths escaping the package', () => {
    expect(parseManifest({ ...base, backend: { entry: '../evil.mjs' } }).ok).toBe(false);
    expect(parseManifest({ ...base, backend: { entry: '/etc/passwd' } }).ok).toBe(false);
  });

  it('rejects a menu permission that is not declared', () => {
    const r = parseManifest({ ...base, permissions: [] });
    expect(r.ok).toBe(false);
  });

  it('rejects self dependency and invalid versions', () => {
    expect(parseManifest({ ...base, dependencies: { 'hello-module': '^1.0.0' } }).ok).toBe(false);
    expect(parseManifest({ ...base, version: '1.0' }).ok).toBe(false);
  });

  it('checks core compatibility', () => {
    expect(isCoreCompatible({ coreVersionRange: '^1.0.0' }, '1.4.2')).toBe(true);
    expect(isCoreCompatible({ coreVersionRange: '^1.0.0' }, '2.0.0')).toBe(false);
  });
});
