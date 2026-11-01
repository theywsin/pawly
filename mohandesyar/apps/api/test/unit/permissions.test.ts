import { describe, expect, it } from 'vitest';
import { forCompany, matchesPermission, PermissionSet } from '../../src/core/rbac/permissions.js';

describe('permission evaluation', () => {
  it('matches exact keys and wildcards', () => {
    expect(matchesPermission('hello-module.note.view', 'hello-module.note.view')).toBe(true);
    expect(matchesPermission('hello-module.*', 'hello-module.note.view')).toBe(true);
    expect(matchesPermission('*', 'finance.payment.approve')).toBe(true);
    expect(matchesPermission('*.view', 'crm.lead.view')).toBe(true);
    expect(matchesPermission('*.view', 'crm.lead.viewer')).toBe(false);
    expect(matchesPermission('hello.*', 'hello-module.note.view')).toBe(false);
    expect(matchesPermission('crm.lead.view', 'crm.lead.view.extra')).toBe(false);
  });

  it('respects scope ranks', () => {
    const s = new PermissionSet([
      { permission: 'projects.project.view', scope: 'project', companyId: null },
      { permission: 'projects.*', scope: 'own', companyId: null },
    ]);
    expect(s.bestScope('projects.project.view')).toBe('project');
    expect(s.can('projects.project.view', 'own')).toBe(true);
    expect(s.can('projects.project.view', 'company')).toBe(false);
    expect(s.can('projects.project.delete')).toBe(true);
    expect(s.can('projects.project.delete', 'project')).toBe(false);
    expect(s.can('crm.lead.view')).toBe(false);
  });

  it('filters grants by company', () => {
    const grants = [
      { permission: 'a.b.view', scope: 'company' as const, companyId: 'c1' },
      { permission: 'a.b.edit', scope: 'company' as const, companyId: null },
    ];
    expect(forCompany(grants, 'c1').can('a.b.view')).toBe(true);
    expect(forCompany(grants, 'c2').can('a.b.view')).toBe(false);
    expect(forCompany(grants, 'c2').can('a.b.edit')).toBe(true);
  });
});
