import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateSigningKey } from '@mohandesyar/module-package';
import { addDays, todayIso } from '@mohandesyar/persian';
import { TestApp, multipart } from '../helpers/app.js';
import { buildModule } from '../helpers/packages.js';

/**
 * recruitment: structured resumes with consent and retention, full-text search and filters, duplicate
 * detection and merge, module-owned confidential files, whitelisted transparent scoring, configurable
 * pipeline, interviews in own scope, hiring event, reports, retention purge and erasure, isolation.
 */
let t: TestApp;
let a: { token: string; tenantId: string };
let b: { token: string; tenantId: string };
let interviewer: { token: string; userId: string };
let otherInterviewer: { token: string; userId: string };
let employee: { token: string; userId: string };
const api = (p: string) => `/api/m/recruitment/v1${p}`;
const today = todayIso();
let saraId = '';
let saraDupId = '';
let aliId = '';
let jobId = '';
let fileRowId = '';
let appId = '';
let interviewId = '';

const sara = {
  fullName: 'سارا  رضايي',
  mobile: '۰۹۱۲۱۱۱۲۲۳۳',
  email: 'sara@example.ir',
  city: 'تهران',
  desiredPosition: 'کارشناس طراحی سازه',
  expectedSalary: 450_000_000,
  availableFrom: addDays(today, 10),
  source: 'referral',
  consentOn: today,
  educations: [{ degree: 'master', field: 'مهندسی عمران - سازه', institution: 'دانشگاه تهران', endYear: 1398 }],
  experiences: [
    { employer: 'مهندسین مشاور الف', title: 'طراح سازه', startedOn: '2018-03-21', endedOn: '2022-03-20', description: 'طراحی ساختمان‌های بتنی و فولادی' },
    { employer: 'شرکت ب', title: 'سرپرست طراحی', startedOn: '2022-04-01', endedOn: null, description: 'تحلیل لرزه‌ای سازه‌های بلند' },
  ],
  projects: [{ title: 'برج اداری ونک', role: 'طراح ارشد', client: 'شرکت ج', year: 1401, description: 'تحلیل غیرخطی با ETABS' }],
  skills: [
    { kind: 'software', name: 'ETABS', level: 5 },
    { kind: 'software', name: 'SAFE', level: 3 },
    { kind: 'language', name: 'انگليسي', level: 3 },
  ],
};

beforeAll(async () => {
  t = await TestApp.start();
  const admin = await t.consoleAdmin();
  const key = generateSigningKey();
  a = await t.signup('rec-a');
  b = await t.signup('rec-b');
  await t.installModules(admin, key.publicKeyPem, [await buildModule('recruitment', key)], [a.tenantId, b.tenantId]);
  interviewer = await t.member(a.token, 'interviewer', 'iv');
  otherInterviewer = await t.member(a.token, 'interviewer', 'iv2');
  employee = await t.member(a.token, 'employee', 'emp');
}, 240_000);
afterAll(async () => t?.stop());

describe('recruitment', () => {
  it('validates and stores a structured resume (no protected attributes)', async () => {
    expect((await t.req('POST', api('/candidates'), { token: a.token, body: { fullName: 'بدون تماس', consentOn: today } })).body.details[0].message).toContain('همراه یا ایمیل');
    expect((await t.req('POST', api('/candidates'), { token: a.token, body: { ...sara, consentOn: addDays(today, 1) } })).body.code).toBe('CONSENT_DATE');
    const withAge = await t.req('POST', api('/candidates'), { token: a.token, body: { ...sara, birthDate: '1990-01-01', gender: 'f' } });
    expect(withAge.status).toBe(201);
    saraId = withAge.body.id;
    expect(withAge.body.duplicates).toBe(0);
    const d = await t.req('GET', api(`/candidates/${saraId}`), { token: a.token });
    expect(d.body.candidate).toMatchObject({ full_name: 'سارا  رضايي', mobile: '09121112233', status: 'active', consent_on: today });
    expect(Object.keys(d.body.candidate).some((k) => /birth|gender|age/.test(k))).toBe(false);
    expect(d.body.candidate.retention_until > addDays(today, 700)).toBe(true); // default 24 months
    expect(d.body.experiences).toHaveLength(2);
    expect(d.body.skills.map((s: { name: string }) => s.name).sort()).toEqual(['ETABS', 'SAFE', 'انگليسي']);
    // Viewing personal data is recorded.
    const audit = await t.req('GET', '/api/core/audit', { token: a.token });
    expect(JSON.stringify(audit.body)).toContain('recruitment.candidate.viewed');
  });

  it('searches the full text (Persian normalisation) and filters', async () => {
    const ali = await t.req('POST', api('/candidates'), {
      token: a.token,
      body: { fullName: 'علی کریمی', email: 'ali@example.ir', city: 'شیراز', desiredPosition: 'نقشه‌بردار', consentOn: today, educations: [{ degree: 'associate', field: 'نقشه‌برداری' }], skills: [{ kind: 'software', name: 'AutoCAD Civil 3D', level: 4 }] },
    });
    aliId = ali.body.id;
    const names = async (qs: string) => ((await t.req('GET', api(`/candidates?${qs}`), { token: a.token })).body as { full_name: string }[]).map((c) => c.full_name);
    expect(await names(`q=${encodeURIComponent('تحلیل لرزه')}`)).toEqual(['سارا  رضايي']); // prefix match inside experience text
    expect(await names(`q=${encodeURIComponent('رضایی')}`)).toEqual(['سارا  رضايي']); // Persian Yeh finds Arabic Yeh
    expect(await names(`q=${encodeURIComponent('etabs')}`)).toEqual(['سارا  رضايي']);
    expect(await names(`q=${encodeURIComponent("x' & |")}`)).toEqual([]); // operators are not interpreted
    expect(await names('degree=bachelor')).toEqual(['سارا  رضايي']);
    expect(await names(`skill=${encodeURIComponent('autocad civil 3d')}`)).toEqual(['علی کریمی']);
    expect(await names('minYears=5')).toEqual(['سارا  رضايي']);
    expect((await names('maxSalary=100000000')).length).toBe(0);
    const list = (await t.req('GET', api('/candidates'), { token: a.token })).body;
    expect(list.find((c: { id: string }) => c.id === saraId).years).toBeGreaterThan(6);
  });

  it('enforces permissions and tenant isolation', async () => {
    expect((await t.req('GET', api('/candidates'), { token: employee.token })).status).toBe(403);
    expect((await t.req('GET', api('/candidates'), { token: interviewer.token })).status).toBe(403);
    expect((await t.req('GET', api(`/candidates/${saraId}`), { token: interviewer.token })).status).toBe(403);
    expect((await t.req('GET', api(`/candidates/${saraId}`), { token: b.token })).status).toBe(404);
    expect((await t.req('GET', api('/candidates'), { token: b.token })).body).toEqual([]);
  });

  it('keeps resume files confidential: module-owned, audited, unreachable through the generic file API', async () => {
    const up = await t.req('POST', '/api/core/files', { token: a.token, ...multipart(Buffer.from('%PDF-1.4 رزومه سارا'), 'resume.pdf', 'file', { module: 'recruitment', confidentiality: 'confidential' }) });
    expect(up.status, JSON.stringify(up.body)).toBe(201);
    expect((await t.req('GET', `/api/core/files/${up.body.id}/url`, { token: a.token })).status).toBe(404);
    // Another tenant cannot attach it.
    expect((await t.req('POST', api(`/candidates/${saraId}/files`), { token: b.token, body: { fileId: up.body.id } })).status).toBe(404);
    const att = await t.req('POST', api(`/candidates/${saraId}/files`), { token: a.token, body: { fileId: up.body.id, kind: 'resume' } });
    expect(att.status, JSON.stringify(att.body)).toBe(201);
    fileRowId = att.body.id;
    expect((await t.req('POST', api(`/candidates/${aliId}/files`), { token: a.token, body: { fileId: up.body.id } })).status).toBe(404); // claimed once
    const url = await t.req('GET', api(`/candidates/${saraId}/files/${fileRowId}/url`), { token: a.token });
    expect(await (await fetch(url.body.url)).text()).toBe('%PDF-1.4 رزومه سارا');
    expect((await t.req('GET', api(`/candidates/${saraId}/files/${fileRowId}/url`), { token: interviewer.token })).status).toBe(403);
  });

  it('detects duplicates by mobile / e-mail / name and merges them', async () => {
    const dup = await t.req('POST', api('/candidates'), {
      token: a.token,
      body: { fullName: 'سارا رضایی', mobile: '+989121112233', consentOn: addDays(today, -30), summary: 'رزومه ارسالی از سایت', skills: [{ kind: 'software', name: 'etabs', level: 4 }, { kind: 'software', name: 'Revit', level: 3 }], experiences: [sara.experiences[0]] },
    });
    expect(dup.body.duplicates, JSON.stringify(dup.body)).toBe(1);
    saraDupId = dup.body.id;
    const pairs = (await t.req('GET', api('/duplicates'), { token: a.token })).body;
    expect(pairs).toHaveLength(1);
    expect(pairs[0].rules.sort()).toEqual(['mobile', 'name']); // name compared after normalisation (spaces, Yeh)
    expect((await t.req('POST', api(`/duplicates/${pairs[0].id}/merge`), { token: a.token, body: { keepId: aliId } })).body.code).toBe('KEEP_ID');
    expect((await t.req('POST', api(`/duplicates/${pairs[0].id}/merge`), { token: a.token, body: { keepId: saraId } })).status).toBe(200);
    const kept = (await t.req('GET', api(`/candidates/${saraId}`), { token: a.token })).body;
    expect(kept.candidate.summary).toBe('رزومه ارسالی از سایت'); // empty field filled from the merged resume
    expect(kept.skills.map((s: { name: string; level: number }) => `${s.name}:${s.level}`).sort()).toEqual(['ETABS:5', 'Revit:3', 'SAFE:3', 'انگليسي:3']);
    expect(kept.experiences).toHaveLength(2); // identical experience kept once
    expect(kept.files).toHaveLength(1);
    const merged = (await t.req('GET', api(`/candidates/${saraDupId}`), { token: a.token })).body.candidate;
    expect(merged).toMatchObject({ status: 'merged', merged_into: saraId, mobile: null });
    expect((await t.req('GET', api('/duplicates'), { token: a.token })).body).toEqual([]);
    expect((await t.req('PUT', api(`/candidates/${saraDupId}`), { token: a.token, body: { ...sara } })).body.code).toBe('MERGED');
  });

  it('scores only with whitelisted, job-related criteria and explains every point', async () => {
    const j = await t.req('POST', api('/jobs'), { token: a.token, body: { title: 'کارشناس ارشد طراحی سازه', department: 'فنی', openings: 2 } });
    expect(j.status).toBe(201);
    jobId = j.body.id;
    for (const bad of [[{ type: 'age', max: 35, weight: 3 }], [{ type: 'gender', value: 'm', weight: 1 }], [{ type: 'item', kind: 'religion', name: 'x', weight: 1 }]]) {
      expect((await t.req('PUT', api(`/jobs/${jobId}/scoring`), { token: a.token, body: { criteria: bad } })).status).toBe(400);
    }
    const criteria = [
      { type: 'item', kind: 'software', name: 'ETABS', minLevel: 4, weight: 4 },
      { type: 'experience_years', min: 5, weight: 3 },
      { type: 'education', minDegree: 'bachelor', field: 'سازه', weight: 2 },
      { type: 'salary_fit', max: 400_000_000, weight: 1 },
    ];
    expect((await t.req('PUT', api(`/jobs/${jobId}/scoring`), { token: a.token, body: { criteria } })).body.version).toBe(2);
    const add = await t.req('POST', api(`/jobs/${jobId}/applications`), { token: a.token, body: { candidateIds: [saraId, aliId, saraId] } });
    expect(add.body.added).toBe(2);
    expect((await t.req('POST', api(`/jobs/${jobId}/applications`), { token: a.token, body: { candidateIds: [saraId] } })).body.added).toBe(0);
    const job = (await t.req('GET', api(`/jobs/${jobId}`), { token: a.token })).body;
    expect(job.stages.map((s: { name: string }) => s.name)).toEqual(['دریافت رزومه', 'غربالگری', 'مصاحبه', 'پیشنهاد همکاری', 'استخدام‌شده', 'ردشده']);
    const [first, second] = job.applications;
    expect(first.full_name).toBe('سارا  رضايي');
    expect(first.score).toBe(90); // all but salary (1 of 10 weight)
    expect(first.score_breakdown.find((x: { label: string }) => x.label.includes('حقوق')).reason).toContain('بیش از سقف');
    expect(second.score).toBe(0);
    expect(second.score_breakdown.find((x: { label: string }) => x.label.includes('تحصیلات')).reason).toBe('بالاترین مدرک ثبت‌شده: کاردانی');
    appId = first.id;
    // A new profile version re-scores everyone.
    await t.req('PUT', api(`/jobs/${jobId}/scoring`), { token: a.token, body: { criteria: [...criteria.slice(0, 3), { type: 'salary_fit', max: 500_000_000, weight: 1 }] } });
    expect((await t.req('GET', api(`/jobs/${jobId}`), { token: a.token })).body.applications[0]).toMatchObject({ score: 100, scoring_version: 3 });
  });

  it('keeps the pipeline usable when stages are edited', async () => {
    const stages = (await t.req('GET', api('/stages'), { token: a.token })).body as { id: string; name: string; kind: string; archived: boolean }[];
    expect((await t.req('PUT', api('/stages'), { token: a.token, body: { stages: stages.slice(1) } })).body.code).toBe('STAGE_MISSING');
    expect((await t.req('PUT', api('/stages'), { token: a.token, body: { stages: stages.map((s) => (s.kind === 'hired' ? { ...s, kind: 'open' } : s)) } })).status).toBe(400);
    expect((await t.req('PUT', api('/stages'), { token: a.token, body: { stages: stages.map((s, i) => (i === 0 ? { ...s, archived: true } : s)) } })).body.code).toBe('STAGE_IN_USE');
    const renamed = [...stages.slice(0, 2), { id: null, name: 'آزمون فنی', kind: 'open', archived: false }, ...stages.slice(2)];
    expect((await t.req('PUT', api('/stages'), { token: a.token, body: { stages: renamed } })).status).toBe(200);
    expect(((await t.req('GET', api('/stages'), { token: a.token })).body as { name: string }[]).map((s) => s.name)[2]).toBe('آزمون فنی');
  });

  it('lets the assigned interviewer — and only them — see the needed resume content and evaluate', async () => {
    const forms = (await t.req('GET', api('/forms'), { token: a.token })).body;
    expect(forms[0].name).toBe('ارزیابی عمومی مصاحبه');
    const s = await t.req('POST', api(`/applications/${appId}/interviews`), { token: a.token, body: { formId: forms[0].id, interviewerId: interviewer.userId, date: addDays(today, 2), time: '10:30' } });
    expect(s.status, JSON.stringify(s.body)).toBe(201);
    interviewId = s.body.id;
    const n = await t.req('GET', '/api/core/notifications', { token: interviewer.token });
    expect(n.body.items.some((x: { type: string }) => x.type === 'recruitment.interview.assigned')).toBe(true);
    const mine = (await t.req('GET', api('/interviews/mine'), { token: interviewer.token })).body;
    expect(mine).toHaveLength(1);
    const d = (await t.req('GET', api(`/interviews/${interviewId}`), { token: interviewer.token })).body;
    expect(d.interview.full_name).toBe('سارا  رضايي');
    expect(JSON.stringify(d)).not.toContain('09121112233'); // no contact details or salary for interviewers
    expect(JSON.stringify(d)).not.toContain('450000000');
    expect(d.files).toHaveLength(1);
    const url = await t.req('GET', api(`/interviews/${interviewId}/files/${d.files[0].id}/url`), { token: interviewer.token });
    expect(url.body.url).toContain('X-Amz-Expires=300');
    expect((await t.req('GET', api(`/interviews/${interviewId}`), { token: otherInterviewer.token })).status).toBe(404);
    expect((await t.req('GET', api(`/interviews/${interviewId}/files/${d.files[0].id}/url`), { token: otherInterviewer.token })).status).toBe(404);
    expect((await t.req('PUT', api(`/interviews/${interviewId}/evaluation`), { token: otherInterviewer.token, body: { ratings: {}, recommendation: 'yes' } })).status).toBe(404);
    expect((await t.req('PUT', api(`/interviews/${interviewId}/evaluation`), { token: interviewer.token, body: { ratings: { technical: 5 }, recommendation: 'yes' } })).body.code).toBe('RATINGS');
    const ratings = { technical: 5, experience: 4, problem_solving: 4, communication: 3, motivation: 5 };
    expect((await t.req('PUT', api(`/interviews/${interviewId}/evaluation`), { token: interviewer.token, body: { ratings, recommendation: 'strong_yes', notes: 'تسلط کامل بر تحلیل لرزه‌ای' } })).status).toBe(200);
    const app = (await t.req('GET', api(`/applications/${appId}`), { token: a.token })).body;
    // (5·3 + 4·3 + 4·2 + 3·2 + 5·1) / 11 / 5 = 46/55 → 83.6
    expect(app.interviews[0]).toMatchObject({ status: 'done', score: 83.6, recommendation: 'strong_yes' });
    expect((await t.req('GET', api(`/jobs/${jobId}`), { token: interviewer.token })).status).toBe(403);
  });

  it('records the hire, publishes the event and reports it', async () => {
    const stages = (await t.req('GET', api('/stages'), { token: a.token })).body as { id: string; kind: string }[];
    const rejected = stages.find((s) => s.kind === 'rejected')!.id;
    const hired = stages.find((s) => s.kind === 'hired')!.id;
    const aliApp = (await t.req('GET', api(`/jobs/${jobId}`), { token: a.token })).body.applications.find((x: { candidate_id: string }) => x.candidate_id === aliId).id;
    expect((await t.req('POST', api(`/applications/${aliApp}/move`), { token: a.token, body: { stageId: rejected } })).body.code).toBe('REASON');
    expect((await t.req('POST', api(`/applications/${aliApp}/move`), { token: a.token, body: { stageId: rejected, rejectionReason: 'نداشتن سابقه طراحی سازه' } })).status).toBe(200);
    expect((await t.req('POST', api(`/applications/${appId}/move`), { token: a.token, body: { stageId: hired, note: 'پذیرش پیشنهاد' } })).body.moved).toBe(true);
    expect((await t.req('GET', api(`/candidates/${saraId}`), { token: a.token })).body.candidate.status).toBe('hired');
    const ev = await t.services.db.tx({ tenantId: a.tenantId }, (tx) => tx.execute(sql`SELECT payload FROM core_outbox WHERE event_type = 'recruitment.candidate.hired'`));
    expect(ev.rows).toHaveLength(1);
    expect(ev.rows[0]!.payload).toMatchObject({ candidateId: saraId, applicationId: appId, jobId, hiredOn: today });
    const r = (await t.req('GET', api(`/reports?from=${addDays(today, -7)}&to=${today}`), { token: a.token })).body;
    expect(r.totals).toMatchObject({ hired: 1, interviews: 1, days_to_hire: 0, open_jobs: 1 });
    expect(r.jobs[0]).toMatchObject({ title: 'کارشناس ارشد طراحی سازه', applications: 2, hired: 1, rejected: 1 });
    expect(r.rejections).toEqual([{ reason: 'نداشتن سابقه طراحی سازه', n: 1 }]);
    expect(r.sources.find((s: { source: string }) => s.source === 'referral')).toMatchObject({ hired: 1 });
    expect((await t.req('GET', api(`/reports?from=${today}&to=${today}`), { token: interviewer.token })).status).toBe(403);
    const w = await t.req('GET', '/api/core/widgets/recruitment/recruitment.pipeline', { token: a.token });
    expect(w.body.data).toMatchObject({ open_jobs: 1, hired_30: 1 });
  });

  it('erases a resume on request and purges expired ones; statistics remain', async () => {
    // Erasure on request.
    expect((await t.req('DELETE', api(`/candidates/${aliId}`), { token: a.token })).status).toBe(200);
    expect((await t.req('GET', api(`/candidates/${aliId}`), { token: a.token })).status).toBe(404);
    // Retention: a consent recorded more than 24 months ago has expired.
    const old = addDays(today, -800);
    expect((await t.req('PUT', api(`/candidates/${saraId}/consent`), { token: a.token, body: { consentOn: old } })).body.retentionUntil < today).toBe(true);
    const link = (await t.req('GET', api(`/candidates/${saraId}/files/${fileRowId}/url`), { token: a.token })).body.url;
    expect(await t.services.scheduler.tick(Date.now())).toBeGreaterThanOrEqual(1);
    expect((await t.req('GET', api(`/candidates/${saraId}`), { token: a.token })).status).toBe(404);
    expect((await fetch(link)).status).toBeGreaterThanOrEqual(400); // stored object erased
    expect((await t.req('GET', api(`/candidates?status=all`), { token: a.token })).body).toEqual([]);
    const job = (await t.req('GET', api(`/jobs/${jobId}`), { token: a.token })).body;
    expect(job.applications.map((x: { full_name: string; score_breakdown: unknown[] }) => [x.full_name, x.score_breakdown.length])).toEqual([['رزومه حذف‌شده', 0], ['رزومه حذف‌شده', 0]]);
    const iv = (await t.req('GET', api(`/applications/${appId}`), { token: a.token })).body.interviews[0];
    expect(iv.notes).toBe('');
    const r = (await t.req('GET', api(`/reports?from=${addDays(today, -7)}&to=${today}`), { token: a.token })).body;
    expect(r.totals.hired).toBe(1);
    const log = JSON.stringify((await t.req('GET', '/api/core/audit', { token: a.token })).body);
    expect(log).toContain('recruitment.candidate.anonymized');
    expect(log).toContain('"reason":"retention"');
    expect(log).toContain('"reason":"request"');
    expect(log).toContain('recruitment.file.downloaded');
  });
});
