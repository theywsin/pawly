/**
 * Default chart of accounts (کدینگ پیش‌فرض) after the common Iranian layout of the national accounting
 * standards: group (1 digit) → ledger (2 digits) → subsidiary (4 digits). The organisation may add, rename
 * or deactivate accounts; `key` marks the accounts automatic vouchers use and cannot be removed.
 */
export type AccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense' | 'memo';
export interface ChartAccount {
  code: string;
  name: string;
  key?: string;
  detail?: boolean;
  nature?: 'debit' | 'credit';
  children?: ChartAccount[];
}
export interface ChartGroup extends ChartAccount {
  type: AccountType;
}

export const DEFAULT_CHART: ChartGroup[] = [
  { code: '1', name: 'دارایی‌های جاری', type: 'asset', children: [
    { code: '11', name: 'موجودی نقد و بانک', children: [
      { code: '1101', name: 'صندوق', key: 'cash', detail: true },
      { code: '1102', name: 'بانک‌ها', key: 'bank', detail: true },
      { code: '1103', name: 'تنخواه‌گردان', key: 'petty_cash', detail: true },
    ] },
    { code: '12', name: 'حساب‌ها و اسناد دریافتنی تجاری', children: [
      { code: '1201', name: 'حساب‌های دریافتنی تجاری', key: 'receivable', detail: true },
      { code: '1202', name: 'اسناد دریافتنی (چک‌های دریافتی)', key: 'cheques_receivable', detail: true },
      { code: '1203', name: 'اسناد در جریان وصول', key: 'cheques_in_collection', detail: true },
    ] },
    { code: '13', name: 'سایر حساب‌ها و اسناد دریافتنی', children: [
      { code: '1301', name: 'سایر حساب‌های دریافتنی', key: 'other_receivable', detail: true },
      { code: '1302', name: 'مالیات بر ارزش افزوده خرید', key: 'vat_in' },
      { code: '1303', name: 'علی‌الحساب و مساعده کارکنان', detail: true },
      { code: '1304', name: 'سپرده‌های حسن انجام کار نزد کارفرمایان', detail: true },
    ] },
    { code: '14', name: 'موجودی مواد و کالا', children: [
      { code: '1401', name: 'موجودی کالا', key: 'inventory' },
    ] },
    { code: '15', name: 'پیش‌پرداخت‌ها', children: [
      { code: '1501', name: 'پیش‌پرداخت خرید و پیمانکاران', key: 'prepayment', detail: true },
      { code: '1502', name: 'پیش‌پرداخت مالیات', key: 'prepaid_tax' },
      { code: '1503', name: 'پیش‌پرداخت بیمه و اجاره' },
    ] },
  ] },
  { code: '2', name: 'دارایی‌های غیرجاری', type: 'asset', children: [
    { code: '21', name: 'دارایی‌های ثابت مشهود', children: [
      { code: '2101', name: 'زمین' },
      { code: '2102', name: 'ساختمان' },
      { code: '2103', name: 'ماشین‌آلات و تجهیزات', key: 'fixed_assets' },
      { code: '2104', name: 'وسایل نقلیه' },
      { code: '2105', name: 'اثاثه و منصوبات' },
      { code: '2106', name: 'رایانه و تجهیزات اداری' },
    ] },
    { code: '22', name: 'استهلاک انباشته', nature: 'credit', children: [
      { code: '2201', name: 'استهلاک انباشته ساختمان', nature: 'credit' },
      { code: '2202', name: 'استهلاک انباشته ماشین‌آلات و تجهیزات', key: 'accumulated_depreciation', nature: 'credit' },
      { code: '2203', name: 'استهلاک انباشته وسایل نقلیه', nature: 'credit' },
      { code: '2204', name: 'استهلاک انباشته اثاثه و منصوبات', nature: 'credit' },
      { code: '2205', name: 'استهلاک انباشته رایانه و تجهیزات اداری', nature: 'credit' },
    ] },
    { code: '23', name: 'سرمایه‌گذاری‌های بلندمدت', children: [{ code: '2301', name: 'سرمایه‌گذاری در سهام و سپرده بلندمدت' }] },
    { code: '24', name: 'دارایی‌های نامشهود', children: [{ code: '2401', name: 'نرم‌افزار، سرقفلی و حق امتیاز' }] },
  ] },
  { code: '3', name: 'بدهی‌های جاری', type: 'liability', children: [
    { code: '31', name: 'حساب‌ها و اسناد پرداختنی تجاری', children: [
      { code: '3101', name: 'حساب‌های پرداختنی تجاری', key: 'payable', detail: true },
      { code: '3102', name: 'اسناد پرداختنی (چک‌های صادره)', key: 'cheques_payable', detail: true },
    ] },
    { code: '32', name: 'سایر حساب‌ها و اسناد پرداختنی', children: [
      { code: '3201', name: 'مالیات بر ارزش افزوده فروش', key: 'vat_out' },
      { code: '3202', name: 'حق بیمه پرداختنی', key: 'insurance_payable' },
      { code: '3203', name: 'مالیات حقوق پرداختنی', key: 'payroll_tax_payable' },
      { code: '3204', name: 'حقوق و دستمزد پرداختنی', key: 'salaries_payable', detail: true },
      { code: '3205', name: 'سایر حساب‌های پرداختنی', key: 'other_payable', detail: true },
      { code: '3206', name: 'سپرده‌های حسن انجام کار پیمانکاران', detail: true },
    ] },
    { code: '33', name: 'پیش‌دریافت‌ها', children: [{ code: '3301', name: 'پیش‌دریافت از مشتریان و کارفرمایان', key: 'customer_advance', detail: true }] },
    { code: '34', name: 'تسهیلات مالی کوتاه‌مدت', children: [{ code: '3401', name: 'وام‌ها و تسهیلات کوتاه‌مدت', detail: true }] },
    { code: '35', name: 'ذخیره مالیات', children: [{ code: '3501', name: 'ذخیره مالیات بر درآمد', key: 'income_tax_provision' }] },
  ] },
  { code: '4', name: 'بدهی‌های غیرجاری', type: 'liability', children: [
    { code: '41', name: 'تسهیلات مالی بلندمدت', children: [{ code: '4101', name: 'وام‌ها و تسهیلات بلندمدت', detail: true }] },
    { code: '42', name: 'ذخیره مزایای پایان خدمت کارکنان', children: [{ code: '4201', name: 'ذخیره مزایای پایان خدمت', detail: true }] },
  ] },
  { code: '5', name: 'حقوق مالکانه', type: 'equity', children: [
    { code: '51', name: 'سرمایه', children: [{ code: '5101', name: 'سرمایه ثبت‌شده', key: 'capital', detail: true }] },
    { code: '52', name: 'اندوخته قانونی', children: [{ code: '5201', name: 'اندوخته قانونی', key: 'legal_reserve' }] },
    { code: '53', name: 'سود و زیان انباشته', children: [
      { code: '5301', name: 'سود و زیان انباشته', key: 'retained_earnings' },
      { code: '5302', name: 'حساب جاری شرکا', detail: true },
    ] },
  ] },
  { code: '6', name: 'درآمدها', type: 'income', children: [
    { code: '61', name: 'درآمدهای عملیاتی', children: [
      { code: '6101', name: 'فروش کالا', key: 'sales' },
      { code: '6102', name: 'درآمد ارائه خدمات و پیمانکاری', key: 'service_income' },
      { code: '6103', name: 'برگشت از فروش و تخفیفات', key: 'sales_returns', nature: 'debit' },
    ] },
    { code: '62', name: 'سایر درآمدها', children: [
      { code: '6201', name: 'سود سپرده‌های بانکی' },
      { code: '6202', name: 'سود فروش دارایی ثابت', key: 'asset_gain' },
      { code: '6203', name: 'اضافات انبار', key: 'inventory_gain' },
      { code: '6204', name: 'سایر درآمدهای متفرقه' },
    ] },
  ] },
  { code: '7', name: 'بهای تمام‌شده', type: 'expense', children: [
    { code: '71', name: 'بهای تمام‌شده کالای فروش‌رفته', children: [{ code: '7101', name: 'بهای تمام‌شده کالای فروش‌رفته', key: 'cogs' }] },
    { code: '72', name: 'هزینه‌های مستقیم پروژه‌ها', children: [
      { code: '7201', name: 'مصالح و مواد مصرفی پروژه', detail: true },
      { code: '7202', name: 'دستمزد مستقیم پروژه', detail: true },
      { code: '7203', name: 'پیمانکاران جزء', detail: true },
      { code: '7204', name: 'اجاره ماشین‌آلات پروژه', detail: true },
    ] },
  ] },
  { code: '8', name: 'هزینه‌های عملیاتی و مالی', type: 'expense', children: [
    { code: '81', name: 'هزینه‌های اداری، عمومی و فروش', children: [
      { code: '8101', name: 'حقوق و دستمزد و مزایا', key: 'salaries_expense' },
      { code: '8102', name: 'حق بیمه سهم کارفرما' },
      { code: '8103', name: 'اجاره' },
      { code: '8104', name: 'آب، برق، گاز و تلفن' },
      { code: '8105', name: 'ملزومات و لوازم اداری' },
      { code: '8106', name: 'خرید خدمات و هزینه‌های متفرقه', key: 'purchase_expense' },
      { code: '8107', name: 'هزینه استهلاک', key: 'depreciation_expense' },
      { code: '8108', name: 'ایاب و ذهاب و حمل‌ونقل' },
      { code: '8109', name: 'تعمیر و نگهداری' },
    ] },
    { code: '82', name: 'هزینه‌های مالی', children: [
      { code: '8201', name: 'کارمزد خدمات بانکی', key: 'bank_fees' },
      { code: '8202', name: 'سود و کارمزد تسهیلات' },
    ] },
    { code: '83', name: 'سایر هزینه‌ها', children: [
      { code: '8301', name: 'زیان فروش و کنارگذاری دارایی ثابت', key: 'asset_loss' },
      { code: '8302', name: 'کسری انبار', key: 'inventory_loss' },
      { code: '8303', name: 'هزینه مالیات بر درآمد' },
    ] },
  ] },
];

/** Account roles that automatic vouchers need; each must exist (and stay a subsidiary) in every chart. */
export const REQUIRED_KEYS = [
  'cash', 'bank', 'receivable', 'cheques_receivable', 'cheques_in_collection', 'vat_in', 'inventory', 'prepayment',
  'fixed_assets', 'accumulated_depreciation', 'payable', 'cheques_payable', 'vat_out', 'retained_earnings',
  'sales', 'service_income', 'sales_returns', 'asset_gain', 'inventory_gain', 'cogs', 'purchase_expense',
  'depreciation_expense', 'asset_loss', 'inventory_loss',
] as const;
export type SystemKey = (typeof REQUIRED_KEYS)[number];

export const naturalSide = (type: AccountType): 'debit' | 'credit' | 'none' => (type === 'asset' || type === 'expense' ? 'debit' : type === 'memo' ? 'none' : 'credit');
