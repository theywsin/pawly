import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { Ctx, RequirePermission, type ModuleRequestContext } from '@mohandesyar/module-sdk/server';
import { todayIso } from '@mohandesyar/persian';
import { z } from 'zod';
import { Assets, closeYear } from './assets.js';
import { parse } from './errors.js';
import { balanceSheet, incomeStatement, ledger, partyBalances, Setup, trialBalance, Vouchers } from './gl.js';
import * as I from './inputs.js';
import { adjustStock, Invoices, Items, vatReport } from './trade.js';
import { Treasury } from './treasury.js';

const uuid = (v: string) => parse(z.uuid({ message: 'شناسه نامعتبر است' }), v);
const day = (v: unknown) => parse(z.iso.date({ message: 'تاریخ معتبر نیست' }), v ?? todayIso());
const dated = z.object({ date: z.iso.date({ message: 'تاریخ معتبر نیست' }).default(() => todayIso()), reason: z.string().trim().max(500).default('') });

/** Mounted at /api/m/accounting/v1 — chart, details, fiscal years, vouchers and reports. */
@Controller()
export class LedgerController {
  @Get('accounts')
  @RequirePermission('accounting.view', 'company')
  accounts(@Ctx() ctx: ModuleRequestContext) {
    return Setup.accounts(ctx);
  }

  @Post('accounts')
  @RequirePermission('accounting.setup', 'company')
  createAccount(@Ctx() ctx: ModuleRequestContext, @Body() body: unknown) {
    return Setup.createAccount(ctx, parse(I.accountInput, body));
  }

  @Put('accounts/:id')
  @RequirePermission('accounting.setup', 'company')
  updateAccount(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    return Setup.updateAccount(ctx, uuid(id), parse(I.accountUpdate, body));
  }

  @Get('details')
  @RequirePermission('accounting.view', 'company')
  details(@Ctx() ctx: ModuleRequestContext, @Query('q') q = '') {
    return Setup.details(ctx, String(q).slice(0, 100));
  }

  @Post('details')
  @RequirePermission('accounting.party', 'company')
  createDetail(@Ctx() ctx: ModuleRequestContext, @Body() body: unknown) {
    return Setup.saveDetail(ctx, null, parse(I.detailInput, body));
  }

  @Put('details/:id')
  @RequirePermission('accounting.party', 'company')
  updateDetail(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    return Setup.saveDetail(ctx, uuid(id), parse(I.detailInput, body));
  }

  @Get('years')
  @RequirePermission('accounting.view', 'company')
  years(@Ctx() ctx: ModuleRequestContext) {
    return Setup.years(ctx);
  }

  @Post('years')
  @RequirePermission('accounting.setup', 'company')
  createYear(@Ctx() ctx: ModuleRequestContext, @Body() body: unknown) {
    return Setup.createYear(ctx, parse(I.fiscalYearInput, body));
  }

  @Post('years/:id/close')
  @HttpCode(200)
  @RequirePermission('accounting.post', 'company')
  closeYear(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string) {
    return closeYear(ctx, uuid(id));
  }

  @Get('vouchers')
  @RequirePermission('accounting.view', 'company')
  vouchers(@Ctx() ctx: ModuleRequestContext, @Query() q: unknown) {
    return Vouchers.list(ctx, parse(I.voucherQuery, q));
  }

  @Get('vouchers/:id')
  @RequirePermission('accounting.view', 'company')
  voucher(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string) {
    return Vouchers.get(ctx, uuid(id));
  }

  @Post('vouchers')
  @RequirePermission('accounting.voucher', 'company')
  createVoucher(@Ctx() ctx: ModuleRequestContext, @Body() body: unknown) {
    return Vouchers.save(ctx, null, parse(I.voucherInput, body));
  }

  @Put('vouchers/:id')
  @RequirePermission('accounting.voucher', 'company')
  updateVoucher(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    return Vouchers.save(ctx, uuid(id), parse(I.voucherInput, body));
  }

  @Post('vouchers/:id/delete')
  @HttpCode(200)
  @RequirePermission('accounting.voucher', 'company')
  deleteVoucher(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string) {
    return Vouchers.remove(ctx, uuid(id));
  }

  @Post('vouchers/:id/post')
  @HttpCode(200)
  @RequirePermission('accounting.post', 'company')
  post(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string) {
    return Vouchers.post(ctx, uuid(id));
  }

  @Post('vouchers/:id/reverse')
  @HttpCode(200)
  @RequirePermission('accounting.post', 'company')
  reverse(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    const d = parse(dated, body ?? {});
    return Vouchers.reverse(ctx, uuid(id), d.date, d.reason);
  }

  @Get('reports/trial-balance')
  @RequirePermission('accounting.view', 'company')
  trial(@Ctx() ctx: ModuleRequestContext, @Query() q: unknown) {
    return trialBalance(ctx, parse(I.trialQuery, q));
  }

  @Get('reports/ledger')
  @RequirePermission('accounting.view', 'company')
  ledger(@Ctx() ctx: ModuleRequestContext, @Query() q: unknown) {
    return ledger(ctx, parse(I.ledgerQuery, q));
  }

  @Get('reports/balance-sheet')
  @RequirePermission('accounting.view', 'company')
  balanceSheet(@Ctx() ctx: ModuleRequestContext, @Query('to') to?: string) {
    return balanceSheet(ctx, day(to));
  }

  @Get('reports/income-statement')
  @RequirePermission('accounting.view', 'company')
  incomeStatement(@Ctx() ctx: ModuleRequestContext, @Query() q: unknown) {
    const r = parse(I.rangeQuery, q);
    return incomeStatement(ctx, r.from, r.to);
  }

  @Get('reports/parties')
  @RequirePermission('accounting.view', 'company')
  parties(@Ctx() ctx: ModuleRequestContext, @Query('to') to?: string) {
    return partyBalances(ctx, day(to));
  }

  @Get('reports/vat')
  @RequirePermission('accounting.view', 'company')
  vat(@Ctx() ctx: ModuleRequestContext, @Query() q: unknown) {
    return vatReport(ctx, parse(I.vatQuery, q));
  }
}

/** Treasury, cheques, items, inventory, invoices and fixed assets. */
@Controller()
export class OperationsController {
  @Get('treasury/accounts')
  @RequirePermission('accounting.view', 'company')
  treasuries(@Ctx() ctx: ModuleRequestContext) {
    return Treasury.accounts(ctx);
  }

  @Post('treasury/accounts')
  @RequirePermission('accounting.setup', 'company')
  createTreasury(@Ctx() ctx: ModuleRequestContext, @Body() body: unknown) {
    return Treasury.createAccount(ctx, parse(I.treasuryAccountInput, body));
  }

  @Get('treasury/docs')
  @RequirePermission('accounting.view', 'company')
  docs(@Ctx() ctx: ModuleRequestContext, @Query() q: unknown) {
    const r = parse(I.rangeQuery, q);
    return Treasury.docs(ctx, r.from, r.to);
  }

  @Post('treasury/docs')
  @RequirePermission('accounting.treasury', 'company')
  register(@Ctx() ctx: ModuleRequestContext, @Body() body: unknown) {
    return Treasury.register(ctx, parse(I.treasuryDocInput, body));
  }

  @Post('treasury/transfers')
  @RequirePermission('accounting.treasury', 'company')
  transfer(@Ctx() ctx: ModuleRequestContext, @Body() body: unknown) {
    return Treasury.transfer(ctx, parse(I.transferInput, body));
  }

  @Post('treasury/docs/:id/cancel')
  @HttpCode(200)
  @RequirePermission('accounting.treasury', 'company')
  cancelDoc(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    return Treasury.cancel(ctx, uuid(id), parse(dated, body ?? {}).date);
  }

  @Get('cheques')
  @RequirePermission('accounting.view', 'company')
  cheques(@Ctx() ctx: ModuleRequestContext, @Query('direction') direction?: string, @Query('open') open?: string) {
    return Treasury.cheques(ctx, parse(z.enum(['received', 'issued']).optional(), direction || undefined), open === '1');
  }

  @Get('cheques/:id/history')
  @RequirePermission('accounting.view', 'company')
  chequeHistory(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string) {
    return Treasury.chequeHistory(ctx, uuid(id));
  }

  @Post('cheques/:id/action')
  @HttpCode(200)
  @RequirePermission('accounting.treasury', 'company')
  chequeAction(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    return Treasury.chequeAction(ctx, uuid(id), parse(I.chequeAction, body));
  }

  @Get('items')
  @RequirePermission('accounting.view', 'company')
  items(@Ctx() ctx: ModuleRequestContext) {
    return Items.list(ctx);
  }

  @Post('items')
  @RequirePermission('accounting.party', 'company')
  createItem(@Ctx() ctx: ModuleRequestContext, @Body() body: unknown) {
    return Items.save(ctx, null, parse(I.itemInput, body));
  }

  @Put('items/:id')
  @RequirePermission('accounting.party', 'company')
  updateItem(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    return Items.save(ctx, uuid(id), parse(I.itemInput, body));
  }

  @Get('items/:id/card')
  @RequirePermission('accounting.view', 'company')
  card(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string) {
    return Items.card(ctx, uuid(id));
  }

  @Get('warehouses')
  @RequirePermission('accounting.view', 'company')
  warehouses(@Ctx() ctx: ModuleRequestContext) {
    return Items.warehouses(ctx);
  }

  @Post('warehouses')
  @RequirePermission('accounting.inventory', 'company')
  createWarehouse(@Ctx() ctx: ModuleRequestContext, @Body() body: unknown) {
    return Items.createWarehouse(ctx, parse(I.warehouseInput, body));
  }

  @Post('stock/adjustments')
  @RequirePermission('accounting.inventory', 'company')
  adjust(@Ctx() ctx: ModuleRequestContext, @Body() body: unknown) {
    return adjustStock(ctx, parse(I.adjustmentInput, body));
  }

  @Get('invoices')
  @RequirePermission('accounting.view', 'company')
  invoices(@Ctx() ctx: ModuleRequestContext, @Query() q: unknown) {
    return Invoices.list(ctx, parse(I.invoiceQuery, q));
  }

  @Get('invoices/:id')
  @RequirePermission('accounting.view', 'company')
  invoice(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string) {
    return Invoices.get(ctx, uuid(id));
  }

  @Post('invoices')
  @RequirePermission('accounting.invoice', 'company')
  createInvoice(@Ctx() ctx: ModuleRequestContext, @Body() body: unknown) {
    return Invoices.save(ctx, null, parse(I.invoiceInput, body));
  }

  @Put('invoices/:id')
  @RequirePermission('accounting.invoice', 'company')
  updateInvoice(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    return Invoices.save(ctx, uuid(id), parse(I.invoiceInput, body));
  }

  @Post('invoices/:id/approve')
  @HttpCode(200)
  @RequirePermission('accounting.invoice.approve', 'company')
  approve(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string) {
    return Invoices.approve(ctx, uuid(id));
  }

  @Post('invoices/:id/cancel')
  @HttpCode(200)
  @RequirePermission('accounting.invoice', 'company')
  cancelInvoice(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    return Invoices.cancel(ctx, uuid(id), parse(dated, body ?? {}).date);
  }

  @Get('assets')
  @RequirePermission('accounting.view', 'company')
  assets(@Ctx() ctx: ModuleRequestContext) {
    return Assets.list(ctx);
  }

  @Post('assets')
  @RequirePermission('accounting.assets', 'company')
  createAsset(@Ctx() ctx: ModuleRequestContext, @Body() body: unknown) {
    return Assets.create(ctx, parse(I.assetInput, body));
  }

  @Post('assets/depreciation')
  @HttpCode(200)
  @RequirePermission('accounting.assets', 'company')
  depreciate(@Ctx() ctx: ModuleRequestContext, @Body() body: unknown) {
    return Assets.depreciate(ctx, parse(I.depreciationInput, body));
  }

  @Post('assets/:id/dispose')
  @HttpCode(200)
  @RequirePermission('accounting.assets', 'company')
  dispose(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    return Assets.dispose(ctx, uuid(id), parse(I.disposalInput, body));
  }
}
