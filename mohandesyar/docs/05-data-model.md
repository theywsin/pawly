# ۰۵ — مدل داده هسته و ماژول‌ها

> وضعیت: پیش‌نویس فاز ۰ — منتظر تأیید. این سند در سطح موجودیت، رابطه، ایندکس و سیاست حذف است؛ ستون‌های کامل در اسکیمای Drizzle هر فاز نهایی می‌شوند و این سند هم‌زمان به‌روز می‌شود.

## ۰. قراردادهای عمومی

| قرارداد | قاعده |
|---|---|
| کلید اصلی | `id uuid` (UUIDv7، تولید در اپ) |
| ستون‌های استاندارد سازمانی | `tenant_id uuid not null`, `company_id uuid not null` (در صورت سطح شرکت)، `created_at timestamptz`, `created_by uuid`, `updated_at`, `updated_by`, `version int` (قفل خوش‌بینانه) |
| حذف | **حذف نرم** (`deleted_at`, `deleted_by`) برای داده کسب‌وکار؛ حذف فیزیکی فقط با سیاست نگهداری یا پاک‌سازی صریح |
| اسناد تأییدشده | تغییرناپذیر (`status in ('approved','posted')` → trigger مانع UPDATE/DELETE)؛ اصلاح فقط با سند اصلاحی/ابطال |
| مبلغ | `numeric(20,0)` به **ریال** + `currency char(3)` پیش‌فرض `IRR`؛ نمایش ریال/تومان قابل تنظیم؛ هرگز float |
| درصد | `numeric(7,4)` |
| تاریخ | `timestamptz` (UTC)؛ تاریخ بدون زمان (سررسید، تاریخ قرارداد) `date` تفسیرشده در منطقه زمانی Tenant |
| ارجاع بین‌ماژولی | فقط `uuid` بدون Foreign Key (ارجاع نرم) + نام ماژول هدف در نام ستون (`crm_customer_id`)؛ اعتبار از طریق Public API هنگام نوشتن |
| ارجاع درون‌ماژولی | Foreign Key واقعی با `ON DELETE RESTRICT` (پیش‌فرض) |
| ایندکس | همه با `tenant_id` شروع؛ ایندکس جزئی `WHERE deleted_at IS NULL` برای فهرست‌ها |
| جست‌وجو | ستون `search_vector tsvector` (تولیدشده در اپ از متن نرمال‌شده) + GIN؛ `pg_trgm` روی نام/عنوان |
| JSON | `jsonb` فقط برای داده واقعاً بی‌ساختار (فیلدهای سفارشی، تنظیمات)؛ نه برای داده قابل گزارش |
| فیلد سفارشی | `custom_fields jsonb` + تعریف در `core_custom_field_defs` (فاز ۳+) |

## ۱. هسته

### هویت و سازمان
| جدول | فیلدهای کلیدی | ایندکس/محدودیت | حذف |
|---|---|---|---|
| `core_users` (پلتفرم) | email, mobile, password_hash (argon2id), totp_secret_enc, totp_enabled, locale, status, failed_attempts, locked_until | unique(lower(email)), unique(mobile) | غیرفعال‌سازی؛ ناشناس‌سازی با درخواست |
| `core_sessions` | user_id, tenant_id, refresh_hash, family_id, ip, user_agent, created_at, last_used_at, expires_at, revoked_at, revoke_reason | (user_id), (family_id) | حذف فیزیکی ۹۰ روز پس از انقضا |
| `core_tenants` (پلتفرم) | slug, name, status: trial/active/suspended/closed, locale, timezone, number_style, branding jsonb | unique(slug) | هرگز خودکار |
| `core_companies` | tenant_id, name, legal_name, national_id, economic_code, address, logo_file_id, status | (tenant_id) | نرم |
| `core_org_units` | tenant_id, company_id, parent_id, name, path ltree | GIST(path) | نرم، فقط بدون عضو فعال |
| `core_memberships` | tenant_id, user_id, status, title, org_unit_id, invited_by | unique(tenant_id,user_id) | نرم |
| `core_invitations` | tenant_id, email/mobile, token_hash, roles, expires_at, accepted_at | | فیزیکی پس از انقضا |

### دسترسی
| جدول | فیلدها |
|---|---|
| `core_permissions` (پلتفرم) | key (PK)، module_id، label_fa، allowed_scopes text[]، sensitive bool |
| `core_roles` | tenant_id، key، name، is_system، module_id (نقش پیش‌فرض ماژول)، approval_limit numeric |
| `core_role_permissions` | role_id، permission_key، scope (company/unit/project/own)، conditions jsonb (مثلاً سقف مبلغ، سطح محرمانگی) |
| `core_role_assignments` | tenant_id، membership_id، role_id، company_id، org_unit_id null، project_ref uuid null، valid_from/to |
| `core_company_grants` | سند ۰۴ §۵ |

### ماژول‌ها و اشتراک (پلتفرم)
| جدول | فیلدها |
|---|---|
| `core_modules` | id (PK)، name jsonb، state، active_version، previous_version، globally_enabled، installed_at، installed_by |
| `core_module_versions` | module_id، version، manifest jsonb، package_sha256، signer_key_id، store_path، uploaded_at، status |
| `core_module_migrations` | module_id، file، checksum، applied_at، applied_by، duration_ms |
| `core_module_operations` | module_id، op (install/upgrade/rollback/enable/disable/uninstall/purge)، target (global/tenant_id)، status، log text، started/finished، actor |
| `core_module_runtime_status` | instance_id، module_id، version، status (loaded/load_failed)، error، reported_at |
| `core_trusted_keys` | key_id، public_key، label، status |
| `core_tenant_modules` | tenant_id، module_id، enabled، source، expires_at، settings jsonb |
| `core_plans` | key، name، description، price_monthly/yearly، user_limit، storage_gb، features jsonb، is_public، sort، status |
| `core_plan_modules` | plan_key، module_id، included bool، addon_price |
| `core_subscriptions` | tenant_id، plan_key، status (trialing/active/past_due/expired/canceled)، period_start/end، trial_end، user_limit_extra، storage_extra، discount_id |
| `core_subscription_addons` | subscription_id، module_id، price، period |
| `core_discounts` | code، type (percent/amount)، value، valid_from/to، max_uses، used_count |
| `core_invoices` / `core_invoice_lines` / `core_payments` | فاکتور داخلی، شماره ترتیبی، وضعیت، پرداخت دستی (روش، مرجع، ثبت‌کننده، پیوست) |

### زیرساخت‌های عمومی
| جدول | فیلدها | نکته |
|---|---|---|
| `core_audit_log` | id bigserial، tenant_id null، actor_user_id، actor_type (user/platform/system/support)، support_session_id، action، entity_type، entity_id، module_id، before jsonb، after jsonb (فیلدهای حساس ماسک‌شده)، ip، at، prev_hash، hash | فقط INSERT/SELECT برای app؛ زنجیره هش برای کشف دستکاری؛ پارتیشن ماهانه |
| `core_access_log` | مشاهده/دانلود داده حساس (tenant_id، user_id، entity، action: view/download/export) | پارتیشن ماهانه |
| `core_outbox` | id، tenant_id، event_type، version، payload، status (pending/dispatched/failed/skipped)، attempts، created_at | پاک‌سازی پس از ۳۰ روز |
| `core_event_consumptions` | event_id، consumer (module.handler)، status، processed_at | idempotency |
| `core_files` | tenant_id، company_id، bucket_key، name، mime، size، sha256، scan_status (pending/clean/infected/skipped)، confidentiality، owner_module، owner_entity_type، owner_entity_id | سهمیه فضا از جمع size |
| `core_file_versions` | file_id، version، bucket_key، size، uploaded_by | نسخه‌بندی عمومی (ماژول documents روی آن سوار است) |
| `core_notifications` | tenant_id، user_id، type، title، body، link، module_id، read_at | ۹۰ روز |
| `core_notification_prefs` | user_id، type، channels (in_app/email/sms) | |
| `core_tasks` | tenant_id، company_id، title، description، assignee_id، due_at، status، priority، source_module، source_entity_type، source_entity_id | |
| `core_workflow_defs` | tenant_id، key، module_id، version، definition jsonb (حالت‌ها، انتقال‌ها، مراحل تأیید، قواعد تأییدکننده)، active | نسخه‌دار؛ نمونه‌های در جریان با نسخه خود ادامه می‌دهند |
| `core_workflow_instances` | tenant_id، def_id، def_version، entity_type، entity_id، state، amount، started_by | |
| `core_workflow_steps` | instance_id، step_key، approver_rule، assigned_to، decision (approve/reject/return)، comment، decided_by، decided_at | قاعده: تصمیم‌گیرنده ≠ درخواست‌کننده (قابل تنظیم و پیش‌فرض روشن) |
| `core_settings` | scope (platform/tenant/company/user)، scope_id، module_id null، key، value jsonb | |
| `core_saved_filters` | tenant_id، user_id، report_key، name، filter jsonb، shared | |
| `core_report_schedules` | tenant_id، report_key، filter، format، cron، recipients (user_ids)، last_run | گیرنده‌ها فقط کاربران با مجوز؛ خروجی با مجوز هر گیرنده |
| `core_report_runs` | schedule_id، status، file_id، error | |
| `core_dashboards` | tenant_id، user_id null (پیش‌فرض نقش/شرکت)، layout jsonb | |
| `core_search_index` | tenant_id، company_id، module_id، entity_type، entity_id، title، snippet، permission_key، search_vector، updated_at | ماژول‌ها از طریق SearchProvider به‌روز می‌کنند (رویداد → worker) |
| `core_import_jobs` | tenant_id، template_key، file_id، status، preview jsonb، errors jsonb، created_by | |
| `core_support_tickets` / `core_ticket_messages` | tenant_id، subject، status، priority، assignee (پلتفرم)، پیام‌ها و پیوست | |
| `core_support_access_requests` | سند ۰۴ §۶ | |
| `platform_announcements` | عنوان، متن، مخاطب (همه/پلن/tenant)، بازه نمایش | |
| `platform_leads` | نوع (demo/contact)، نام، شرکت، تلفن، ایمیل، پیام، وضعیت پیگیری، یادداشت، ip_hash | ضد اسپم: honeypot + زمان پرکردن + نرخ |
| `platform_faq` / `platform_contact_info` / `platform_pages` | محتوای قابل مدیریت لندینگ | |
| `platform_settings` | key/value (branding، SMTP، adapterها) | اسرار رمزنگاری‌شده با کلید محیطی |

## ۲. ماژول‌ها (سطح موجودیت)

همه جداول زیر `tenant_id` + `company_id` + ستون‌های استاندارد دارند مگر خلاف آن ذکر شود.

### `projects_*`
`projects_projects` (کد یکتا در شرکت، عنوان، crm_customer_id، employer_name (اگر crm نباشد)، manager_id، نوع، محل/استان/شهر، مشخصات فنی jsonb، تاریخ شروع/پایان برنامه‌ای و واقعی، وضعیت، contracts_contract_id) · `projects_members` (نقش در پروژه) · `projects_phases` (مراحل، تحویل موقت/قطعی، تأیید کارفرما) · `projects_activities` (WBS درختی، مدت، شروع/پایان برنامه‌ای و واقعی، وزن، مسئول، ES/EF/LS/LF/float محاسبه‌شده) · `projects_dependencies` (FS/SS/FF/SF + lag) · `projects_progress_entries` (تاریخ، فعالیت، درصد فیزیکی، ثبت‌کننده، تأیید) · `projects_progress_snapshots` (پیشرفت برنامه‌ای/واقعی فیزیکی، زمانی، مالی به تفکیک در هر دوره) · `projects_daily_reports` · `projects_issues` (تأخیر/مانع/مسئله، علت، اثر) · `projects_risks` (احتمال، اثر، امتیاز، پاسخ) · `projects_change_requests` (گردش تأیید) · `projects_drawings` (به core_files با نسخه) · `projects_baselines` (نسخه برنامه پایه).
ایندکس‌ها: (tenant_id, company_id, status)، (tenant_id, project_id) روی همه جداول فرزند. حذف: پروژه با داده مالی/قرارداد → فقط بایگانی.

### `crm_*`
`crm_accounts` (شخص/شرکت) · `crm_contacts` · `crm_interactions` (تماس/جلسه/ایمیل) · `crm_leads` (منبع، نیاز، بودجه تخمینی، امتیاز، next_contact_at، دلیل شکست) · `crm_pipeline_stages` (قابل تنظیم) · `crm_opportunities` (مرحله، ارزش، احتمال، owner) · `crm_proposals` + `crm_proposal_versions` (فنی/مالی، اعتبار تا، وضعیت) · `crm_stage_history` (برای نرخ تبدیل).
یکتایی: (tenant_id, normalized_mobile) روی contacts برای تشخیص تکرار (هشدار نه مانع).

### `contracts_*`
`contracts_contracts` (نوع: کارفرمایی/پیمانکاری/مشاوره/خرید/…، طرفین (crm_account_id یا procurement_supplier_id یا نام آزاد)، مبلغ اولیه، مبلغ اصلاحی محاسبه‌شده، تاریخ امضا/شروع/پایان، projects_project_id) · `contracts_amendments` (الحاقیه، تغییر مبلغ/تاریخ) · `contracts_obligations` · `contracts_payment_terms` (پیش‌پرداخت، مراحل) · `contracts_guarantees` (نوع ضمانت‌نامه، مبلغ، بانک، سررسید، وضعیت آزادسازی) · `contracts_deductions` (حسن انجام کار، بیمه، مالیات — درصد قابل تنظیم) · `contracts_statements` (صورت‌وضعیت: شماره، دوره، مبلغ ناخالص، کسورات، خالص، وضعیت تأیید) · `contracts_renewals` · `contracts_history` (diff تغییرات).
قرارداد امضاشده: فقط با الحاقیه تغییر می‌کند.

### `meetings_*`
`meetings_meetings` (عنوان، زمان، مکان/لینک، projects_project_id، برگزارکننده) · `meetings_attendees` · `meetings_agenda_items` · `meetings_minutes` (متن، تأیید) · `meetings_resolutions` (مصوبه، مسئول، مهلت، وضعیت، core_task_id) .

### `recruitment_*`
`recruitment_candidates` (اطلاعات تماس، موقعیت مورد نظر، حقوق مورد انتظار، آمادگی شروع، معرف، consent_at، retention_until) · `recruitment_educations` · `recruitment_experiences` · `recruitment_candidate_projects` · `recruitment_skills` (+ سطح) · `recruitment_software` · `recruitment_certificates` · `recruitment_languages` · `recruitment_files` (رزومه، نمونه‌کار → core_files با محرمانگی) · `recruitment_duplicates` (جفت مشکوک، قاعده، وضعیت ادغام) · `recruitment_jobs` (موقعیت شغلی) · `recruitment_scoring_profiles` (معیارها، وزن‌ها؛ **فهرست سفید فیلدهای مجاز** برای امتیاز — فیلدهای سن/جنسیت/قومیت/مذهب/سلامت اصلاً در مدل ذخیره نمی‌شوند) · `recruitment_applications` (candidate × job، مرحله، امتیاز، score_breakdown jsonb با دلیل هر جزء) · `recruitment_stages` · `recruitment_interview_forms` · `recruitment_interviews` (ارزیابی).
حساس: مشاهده/دانلود ثبت در `core_access_log`. سیاست نگهداری: حذف/ناشناس‌سازی خودکار پس از `retention_until` (پیش‌فرض ۲ سال، قابل تنظیم).

### `hr_*`
`hr_employees` (شماره پرسنلی، membership_id null، recruitment_candidate_id null، اطلاعات هویتی، واحد، سمت) · `hr_contracts` (نوع، مدت، حقوق — **محرمانه**) · `hr_records` (سوابق) · `hr_skills` · `hr_trainings` · `hr_leave_types` · `hr_leave_balances` · `hr_leave_requests` (→ workflow) · `hr_reviews` (ارزیابی عملکرد، دوره، ارزیاب، امتیاز).
انتقال از recruitment: فرم انتخابی فیلد‌به‌فیلد توسط کاربر مجاز؛ هیچ داده حساسی خودکار منتقل نمی‌شود.

### `kpi_*`
`kpi_definitions` (نام، توضیح، واحد، جهت مطلوب، سطح: org/unit/project/role/person، منبع: provider_key یا manual، فرمول (عبارت محدود روی متغیرها — پارسر امن، بدون eval)، وزن، آستانه‌ها، is_gate (ایمنی/کیفیت/انطباق شرط لازم)، version) · `kpi_targets` (دوره، هدف) · `kpi_values` (دوره، مقدار، منبع، provider_snapshot jsonb برای ردیابی، ثبت‌کننده، وضعیت تأیید) · `kpi_scorecards` (فرد/واحد، دوره، امتیاز، breakdown، وضعیت: draft/reviewed/approved، version) · `kpi_reward_rules` (ضرایب پاداش نسخه‌دار) · `kpi_reward_results` (فقط پیشنهادی؛ پرداخت ندارد).

### `finance_*`
`finance_accounts` (بانکی/تنخواه/صندوق، شماره، شبا، موجودی افتتاحیه) · `finance_counterparties` (ارجاع نرم به crm/procurement یا آزاد) · `finance_categories` (درآمد/هزینه، درختی) · `finance_cost_centers` · `finance_transactions` (نوع: receipt/payment/**transfer**، مبلغ، تاریخ، حساب، طرف، دسته، پروژه، قرارداد، وضعیت: draft/requested/approved/executed/voided، reverses_id) — **transfer دو ردیف پیوسته با `transfer_group_id` و دسته «انتقال» که در همه گزارش‌های درآمد/هزینه به‌صورت ساختاری حذف می‌شود** · `finance_payment_requests` (درخواست → تأیید (workflow با سقف) → اجرا؛ سه کاربر/مجوز جدا: `finance.payment.request`/`approve`/`execute`؛ constraint: requested_by ≠ approved_by ≠ executed_by) · `finance_receivables` / `finance_payables` (سررسید، مانده) · `finance_cheques` (دریافتی/پرداختی، وضعیت) · `finance_budgets` (پروژه، نسخه: initial/approved/revision-n) · `finance_budget_lines` (سرفصل، مبلغ) · `finance_commitments` (تعهدات از سفارش خرید/قرارداد) · `finance_eac_methods` (فرمول EAC نسخه‌دار: `AC + (BAC − EV)`، `AC + (BAC − EV)/CPI`، `AC + ETC_manual`، …) · `finance_forecasts` (جریان نقدی: قطعی/تخمینی جدا) · `finance_bank_statements` + `finance_reconciliations`.
ممنوعیت: DELETE روی تراکنش executed (trigger)؛ اصلاح با `voided` + تراکنش معکوس.

### `procurement_*`
`procurement_suppliers` + `procurement_supplier_categories` · `procurement_requests` (درخواست خرید، اقلام، پروژه، مرکز هزینه، بودجه، قرارداد) · `procurement_rfqs` + `procurement_quotes` (مقایسه) · `procurement_orders` + `procurement_order_lines` (تأیید) · `procurement_receipts` (تحویل، کسری/مرجوعی) · `procurement_supplier_statements` · `procurement_invoices` (کنترل سه‌طرفه: سفارش/تحویل/فاکتور) · `procurement_supplier_ratings`.

### `documents_*`
`documents_folders` (درختی، مجوز ارثی) · `documents_documents` (عنوان، کد، دسته، برچسب‌ها، محرمانگی: public/internal/confidential/secret، انقضا، وضعیت تأیید، retention_policy_id) · `documents_versions` (→ core_file_versions) · `documents_links` (اتصال نرم به موجودیت ماژول دیگر: module_id، entity_type، entity_id) · `documents_acl` (کاربر/نقش/واحد × دسترسی) · `documents_retention_policies`.

### `qhse_*`
`qhse_incidents` (حادثه/شبه‌حادثه، شدت، محل، پروژه، افراد، علت ریشه‌ای) · `qhse_risks` · `qhse_checklists` + `qhse_checklist_items` (قالب) · `qhse_inspections` + `qhse_inspection_results` · `qhse_nonconformities` · `qhse_capas` (اقدام اصلاحی/پیشگیرانه، مسئول، مهلت، اثربخشی) · `qhse_trainings` + `qhse_training_attendance` · `qhse_ppe_items` + `qhse_ppe_issues`.

### `holding_*`
بدون داده عملیاتی اصلی؛ `holding_report_defs` (گزارش‌های مقایسه‌ای ذخیره‌شده) و `holding_snapshots` (عکس‌های دوره‌ای تجمیعی برای روند).

### `hello_*`
`hello_notes` (عنوان، متن).

## ۳. سیاست حذف و نگهداری (خلاصه)

| دسته | سیاست |
|---|---|
| داده کسب‌وکار عادی | حذف نرم؛ بازیابی از «سطل بازیافت» ۳۰ روز؛ سپس فقط با درخواست صریح مدیر شرکت حذف فیزیکی |
| اسناد مالی تأییدشده، صورت‌وضعیت، قرارداد امضاشده | هرگز حذف؛ فقط ابطال/اصلاحیه |
| Audit Log | هرگز حذف توسط اپ؛ آرشیو پارتیشن‌های قدیمی (پیش‌فرض نگهداری ۷ سال، قابل تنظیم پلتفرم) |
| رزومه و داده شخصی | retention قابل تنظیم؛ ناشناس‌سازی خودکار؛ حذف به درخواست فرد (ثبت در Audit) |
| Tenant لغوشده | داده حفظ (پیش‌فرض ۱۸۰ روز) + خروجی کامل قابل دریافت؛ حذف فقط با تأیید صریح ادمین و مشتری |
| ماژول غیرفعال/حذف نصب | داده حفظ (سند ۰۳) |
