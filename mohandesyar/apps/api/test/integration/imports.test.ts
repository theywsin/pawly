import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateSigningKey } from '@mohandesyar/module-package';
import { multipart, TestApp } from '../helpers/app.js';
import { buildModule } from '../helpers/packages.js';
import { xlsx } from '../helpers/xlsx.js';

/**
 * Data migration from spreadsheets: templates declared by modules and filtered by permission; xlsx and CSV;
 * a dry run that reports per-row errors (conversion, schema, duplicates in the file and in the database);
 * all-or-nothing import; tenant isolation of the written rows.
 */
let t: TestApp;
let a: { token: string; tenantId: string };
let b: { token: string; tenantId: string };
let pm: { token: string; userId: string };
let hrm: { token: string; userId: string };
const send = (token: string, path: string, file: Buffer, name: string, commit: boolean) =>
  t.req('POST', `/api/core/imports/${path}`, { token, ...multipart(file, name, 'file', { commit: commit ? '1' : '0' }) });

beforeAll(async () => {
  t = await TestApp.start();
  const admin = await t.consoleAdmin();
  const key = generateSigningKey();
  a = await t.signup('imp-a');
  b = await t.signup('imp-b');
  const pkgs = await Promise.all(['projects', 'crm', 'hr', 'finance', 'procurement'].map((m) => buildModule(m, key)));
  await t.installModules(admin, key.publicKeyPem, pkgs, [a.tenantId, b.tenantId]);
  pm = await t.member(a.token, 'procurement_manager', 'pm');
  hrm = await t.member(a.token, 'hr_manager', 'hrm');
}, 240_000);
afterAll(async () => t?.stop());

describe('spreadsheet import', () => {
  it('lists only the templates the user may use', async () => {
    const all = (await t.req('GET', '/api/core/imports/templates', { token: a.token })).body.map((x: { key: string }) => x.key).sort();
    expect(all).toEqual(['crm.accounts', 'finance.counterparties', 'hr.employees', 'procurement.suppliers', 'projects.projects']);
    expect((await t.req('GET', '/api/core/imports/templates', { token: pm.token })).body.map((x: { key: string }) => x.key)).toEqual(['procurement.suppliers']);
    expect((await send(pm.token, 'projects/projects.projects', xlsx([['کد پروژه', 'عنوان']]), 'p.xlsx', false)).status).toBe(403);
  });

  it('validates every row of an xlsx file and imports nothing while anything is wrong', async () => {
    await t.req('POST', '/api/m/projects/v1/projects', { token: a.token, body: { code: 'P-OLD', title: 'پروژه قبلی' } });
    const rows: (string | number | null)[][] = [
      ['کد پروژه *', 'عنوان *', 'وضعیت', 'شروع برنامه‌ای', 'بودجه (ریال)', 'ستون اضافه'],
      ['P-10', 'برج اداری', 'در حال اجرا', '۱۴۰۵/۰۱/۱۵', '۲٬۵۰۰٬۰۰۰٬۰۰۰', 'x'],
      ['P-11', 'پل', 'نامعلوم', 46310, null, null],
      ['P-10', 'تکراری در فایل', null, null, null, null],
      ['P-OLD', 'تکراری در پایگاه داده', null, null, null, null],
      ['P-12', 'ب', null, '1405/13/40', 'abc', null],
    ];
    const r = await send(a.token, 'projects/projects.projects', xlsx(rows), 'projects.xlsx', true);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.imported).toBe(false);
    expect(r.body.ignoredColumns).toEqual(['ستون اضافه']);
    const byRow = (n: number) => r.body.errors.filter((e: { row: number }) => e.row === n).map((e: { column: string }) => e.column).sort();
    expect(byRow(3)).toEqual(['status']);
    expect(byRow(6)).toEqual(['budgetAmount', 'plannedStart']);
    // Schema and duplicate checks run only once the cells convert cleanly.
    const fixed = rows.slice(0, 2).concat([['P-11', 'پل', 'برنامه‌ریزی', 46310, null, null], ['P-10', 'تکراری در فایل'], ['P-OLD', 'تکراری در پایگاه داده'], ['P-12', 'ب']]);
    const r2 = (await send(a.token, 'projects/projects.projects', xlsx(fixed), 'projects.xlsx', true)).body;
    expect(r2.errors.map((e: { row: number; column: string }) => `${e.row}:${e.column}`).sort()).toEqual(['4:code', '5:code', '6:title']);
    const n = (await t.req('GET', '/api/m/projects/v1/projects', { token: a.token })).body;
    expect(n.map((p: { code: string }) => p.code)).toEqual(['P-OLD']);
  });

  it('imports a clean file after a dry run, all rows in one go', async () => {
    const rows = [['کد پروژه', 'عنوان', 'وضعیت', 'شروع برنامه‌ای', 'بودجه (ریال)'], ['P-10', 'برج اداری', 'در حال اجرا', '۱۴۰۵/۰۱/۱۵', '۲٬۵۰۰٬۰۰۰٬۰۰۰'], ['P-11', 'پل', 'برنامه‌ریزی', 46310, null]];
    const dry = (await send(a.token, 'projects/projects.projects', xlsx(rows), 'p.xlsx', false)).body;
    expect(dry).toMatchObject({ total: 2, created: 2, imported: false, errors: [] });
    expect((await t.req('GET', '/api/m/projects/v1/projects', { token: a.token })).body).toHaveLength(1);
    const done = (await send(a.token, 'projects/projects.projects', xlsx(rows), 'p.xlsx', true)).body;
    expect(done).toMatchObject({ total: 2, created: 2, imported: true });
    const list = (await t.req('GET', '/api/m/projects/v1/projects', { token: a.token })).body as { code: string; status: string; planned_start: string; budget_amount: string }[];
    expect(list.find((p) => p.code === 'P-10')).toMatchObject({ status: 'active', planned_start: '2026-04-04', budget_amount: '2500000000' });
    expect(list.find((p) => p.code === 'P-11')).toMatchObject({ status: 'planning', planned_start: '2026-10-15' });
    // The same file again: every row is now a duplicate.
    expect((await send(a.token, 'projects/projects.projects', xlsx(rows), 'p.xlsx', true)).body.errors).toHaveLength(2);
    const audit = await t.services.db.tx({ tenantId: a.tenantId }, (x) => x.execute(sql`SELECT after FROM core_audit_log WHERE action = 'core.import.completed'`));
    expect(audit.rows).toHaveLength(1);
  });

  it('reads CSV and enforces each module\'s own rules (supplier IBAN, employee national ID)', async () => {
    const csv = Buffer.from('﻿نام,شماره شبا,تلفن\r\nفولاد البرز,062960000000100324200001,021-1234\r\nسیمان تهران,,\r\n', 'utf8');
    const s = (await send(pm.token, 'procurement/procurement.suppliers', csv, 'suppliers.csv', true)).body;
    expect(s).toMatchObject({ imported: true, created: 2 });
    const sup = (await t.req('GET', '/api/m/procurement/v1/suppliers', { token: pm.token })).body;
    expect(sup.find((x: { name: string }) => x.name === 'فولاد البرز').iban).toBe('IR062960000000100324200001');
    const bad = Buffer.from('نام,شماره شبا\nآهن,123\n', 'utf8');
    expect((await send(pm.token, 'procurement/procurement.suppliers', bad, 's.csv', true)).body.errors).toEqual([{ row: 2, column: 'iban', message: 'شماره شبا معتبر نیست' }]);
    const emp = xlsx([['شماره پرسنلی', 'نام و نام خانوادگی', 'کد ملی', 'تاریخ استخدام'], ['101', 'سارا احمدی', '0010350829', '1402/03/01'], ['102', 'علی رضایی', '1234567890', '1403/01/10']]);
    const e1 = (await send(hrm.token, 'hr/hr.employees', emp, 'e.xlsx', true)).body;
    expect(e1.errors).toEqual([{ row: 3, column: 'nationalId', message: 'کد ملی معتبر نیست' }]);
    const e2 = (await send(hrm.token, 'hr/hr.employees', xlsx([['شماره پرسنلی', 'نام و نام خانوادگی', 'کد ملی', 'تاریخ استخدام'], ['101', 'سارا احمدی', '0010350829', '1402/03/01']]), 'e.xlsx', true)).body;
    expect(e2).toMatchObject({ imported: true, created: 1 });
    const acc = Buffer.from('نوع;نام;شناسه ملی / کد ملی\nشرکت;کارفرمای نمونه;10101010101\nشخص;مهندس مشاور;\nسازمان;نوع نادرست;\n', 'utf8');
    expect((await send(a.token, 'crm/crm.accounts', acc, 'a.csv', true)).body.errors).toEqual([{ row: 4, column: 'kind', message: '«نوع» باید یکی از این‌ها باشد: شرکت، شخص' }]);
    const ok = (await send(a.token, 'crm/crm.accounts', Buffer.from('نوع;نام\nشرکت;کارفرمای نمونه\nشخص;مهندس مشاور\n'), 'a.csv', true)).body;
    expect(ok).toMatchObject({ imported: true, created: 2 });
    expect((await t.req('GET', '/api/m/crm/v1/accounts', { token: a.token })).body.map((x: { kind: string }) => x.kind).sort()).toEqual(['company', 'person']);
  });

  it('rejects broken files and keeps tenants apart', async () => {
    expect((await send(a.token, 'projects/projects.projects', Buffer.from('PK\u0003\u0004garbage'), 'x.xlsx', false)).body.errors[0].message).toBe('فایل Excel معتبر نیست');
    expect((await send(a.token, 'projects/projects.projects', Buffer.from(''), 'x.csv', false)).body.errors[0].message).toBe('فایل خالی است');
    expect((await t.req('GET', '/api/m/projects/v1/projects', { token: b.token })).body).toEqual([]);
  });
});
