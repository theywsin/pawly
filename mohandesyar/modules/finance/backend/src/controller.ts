import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { Ctx, RequirePermission, type ModuleRequestContext } from '@mohandesyar/module-sdk/server';
import { todayIso } from '@mohandesyar/persian';
import { z } from 'zod';
import { Budgets } from './budgets.js';
import { cashflow, Forecasts, incomeExpense, Reconcile } from './cash.js';
import { parse } from './errors.js';
import {
  accountInput, budgetInput, cashflowQuery, categoryInput, chequeActionInput, chequeInput, commitmentInput, costCenterInput, counterpartyInput, eacMethodInput, etcInput, executeInput,
  forecastInput, matchInput, noteInput, obligationInput, obligationQuery, paymentRequestInput, prQuery, receiptInput, reportQuery, statementInput, transferInput, txQuery, voidInput,
} from './inputs.js';
import { Cheques, Obligations, Payments, Transactions } from './money.js';
import { Setup } from './setup.js';

const uuid = (v: string) => parse(z.uuid({ message: 'شناسه نامعتبر است' }), v);
const ok = { ok: true };

/** Mounted at /api/m/finance/v1. */
@Controller()
export class FinanceController {
  // ---------------------------------------------------------------- setup
  @Get('accounts')
  @RequirePermission('finance.transaction.view', 'company')
  accounts(@Ctx() ctx: ModuleRequestContext) {
    return Setup.accounts(ctx);
  }

  @Post('accounts')
  @RequirePermission('finance.account.manage', 'company')
  createAccount(@Ctx() ctx: ModuleRequestContext, @Body() b: unknown) {
    return Setup.saveAccount(ctx, null, parse(accountInput, b));
  }

  @Put('accounts/:id')
  @RequirePermission('finance.account.manage', 'company')
  updateAccount(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() b: unknown) {
    return Setup.saveAccount(ctx, uuid(id), parse(accountInput, b));
  }

  /** Lookups used by request forms: everyone who may request a payment needs them. */
  @Get('categories')
  @RequirePermission('finance.payment.request', 'project')
  categories(@Ctx() ctx: ModuleRequestContext) {
    return Setup.categories(ctx);
  }

  @Post('categories')
  @RequirePermission('finance.account.manage', 'company')
  createCategory(@Ctx() ctx: ModuleRequestContext, @Body() b: unknown) {
    return Setup.saveCategory(ctx, null, parse(categoryInput, b));
  }

  @Put('categories/:id')
  @RequirePermission('finance.account.manage', 'company')
  updateCategory(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() b: unknown) {
    return Setup.saveCategory(ctx, uuid(id), parse(categoryInput, b));
  }

  @Get('cost-centers')
  @RequirePermission('finance.payment.request', 'project')
  costCenters(@Ctx() ctx: ModuleRequestContext) {
    return Setup.costCenters(ctx);
  }

  @Post('cost-centers')
  @RequirePermission('finance.account.manage', 'company')
  createCostCenter(@Ctx() ctx: ModuleRequestContext, @Body() b: unknown) {
    return Setup.saveCostCenter(ctx, null, parse(costCenterInput, b));
  }

  @Put('cost-centers/:id')
  @RequirePermission('finance.account.manage', 'company')
  updateCostCenter(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() b: unknown) {
    return Setup.saveCostCenter(ctx, uuid(id), parse(costCenterInput, b));
  }

  @Get('counterparties')
  @RequirePermission('finance.payment.request', 'project')
  counterparties(@Ctx() ctx: ModuleRequestContext, @Query('q') q?: string) {
    return Setup.counterparties(ctx, q ? String(q).slice(0, 100) : undefined);
  }

  @Post('counterparties')
  @RequirePermission('finance.payment.request', 'project')
  createCounterparty(@Ctx() ctx: ModuleRequestContext, @Body() b: unknown) {
    return Setup.saveCounterparty(ctx, null, parse(counterpartyInput, b));
  }

  @Put('counterparties/:id')
  @RequirePermission('finance.account.manage', 'company')
  updateCounterparty(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() b: unknown) {
    return Setup.saveCounterparty(ctx, uuid(id), parse(counterpartyInput, b));
  }

  /** Projects for linking, through the projects module (empty when it is not active). */
  @Get('lookups/projects')
  @RequirePermission('finance.payment.request', 'project')
  async projects(@Ctx() ctx: ModuleRequestContext, @Query('q') q = '') {
    const svc = ctx.services.get<{ search(q: string, limit: number): Promise<{ id: string; code: string; title: string }[]>; memberOf(u: string): Promise<string[]> }>('projects.projects', '^1');
    if (!svc) return [];
    const list = await svc.search(String(q).slice(0, 100), 50);
    if (ctx.can('finance.payment.request', 'company') || ctx.can('finance.budget.view', 'company')) return list;
    const mine = await svc.memberOf(ctx.userId);
    return list.filter((p) => mine.includes(p.id));
  }

  // ---------------------------------------------------------------- transactions
  @Get('transactions')
  @RequirePermission('finance.transaction.view', 'company')
  transactions(@Ctx() ctx: ModuleRequestContext, @Query() q: unknown) {
    return Transactions.list(ctx, parse(txQuery, q));
  }

  @Post('receipts')
  @RequirePermission('finance.transaction.record', 'company')
  receipt(@Ctx() ctx: ModuleRequestContext, @Body() b: unknown) {
    return Transactions.receipt(ctx, parse(receiptInput, b));
  }

  @Post('transfers')
  @RequirePermission('finance.transaction.record', 'company')
  transfer(@Ctx() ctx: ModuleRequestContext, @Body() b: unknown) {
    return Transactions.transfer(ctx, parse(transferInput, b));
  }

  @Post('transactions/:id/void')
  @HttpCode(200)
  @RequirePermission('finance.transaction.void', 'company')
  void(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() b: unknown) {
    return Transactions.void(ctx, uuid(id), parse(voidInput, b));
  }

  // ---------------------------------------------------------------- payment requests
  @Get('payment-requests')
  @RequirePermission('finance.payment.request', 'project')
  payments(@Ctx() ctx: ModuleRequestContext, @Query() q: unknown) {
    return Payments.list(ctx, parse(prQuery, q));
  }

  /** The treasurer's queue (execution permission without request permission). */
  @Get('payment-requests/approved')
  @RequirePermission('finance.payment.execute', 'company')
  approvedQueue(@Ctx() ctx: ModuleRequestContext) {
    return Payments.list(ctx, { status: 'approved' });
  }

  @Post('payment-requests')
  @RequirePermission('finance.payment.request', 'project')
  request(@Ctx() ctx: ModuleRequestContext, @Body() b: unknown) {
    return Payments.create(ctx, parse(paymentRequestInput, b));
  }

  @Post('payment-requests/:id/cancel')
  @HttpCode(200)
  @RequirePermission('finance.payment.request', 'project')
  async cancel(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string) {
    await Payments.cancel(ctx, uuid(id));
    return ok;
  }

  @Post('payment-requests/:id/execute')
  @HttpCode(200)
  @RequirePermission('finance.payment.execute', 'company')
  execute(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() b: unknown) {
    return Payments.execute(ctx, uuid(id), parse(executeInput, b));
  }

  // ---------------------------------------------------------------- receivables, payables, cheques
  @Get('obligations')
  @RequirePermission('finance.obligation.manage', 'company')
  obligations(@Ctx() ctx: ModuleRequestContext, @Query() q: unknown) {
    return Obligations.list(ctx, parse(obligationQuery, q), todayIso());
  }

  @Post('obligations')
  @RequirePermission('finance.obligation.manage', 'company')
  createObligation(@Ctx() ctx: ModuleRequestContext, @Body() b: unknown) {
    return Obligations.create(ctx, parse(obligationInput, b));
  }

  @Post('obligations/:id/cancel')
  @HttpCode(200)
  @RequirePermission('finance.obligation.manage', 'company')
  async cancelObligation(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string) {
    await Obligations.cancel(ctx, uuid(id));
    return ok;
  }

  /** Open payables of a payee, for linking a payment request. */
  @Get('lookups/payables')
  @RequirePermission('finance.payment.request', 'project')
  async payables(@Ctx() ctx: ModuleRequestContext, @Query('counterpartyId') cp = '') {
    const all = await Obligations.list(ctx, { kind: 'payable', state: 'open' }, todayIso());
    return all.filter((o) => o.counterparty_id === cp).map((o) => ({ id: o.id, description: o.description, remaining: o.remaining, due_on: o.due_on }));
  }

  @Get('cheques')
  @RequirePermission('finance.obligation.manage', 'company')
  cheques(@Ctx() ctx: ModuleRequestContext) {
    return Cheques.list(ctx);
  }

  @Post('cheques')
  @RequirePermission('finance.obligation.manage', 'company')
  receiveCheque(@Ctx() ctx: ModuleRequestContext, @Body() b: unknown) {
    return Cheques.receive(ctx, parse(chequeInput, b));
  }

  @Post('cheques/:id/action')
  @HttpCode(200)
  @RequirePermission('finance.obligation.manage', 'company')
  chequeAction(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() b: unknown) {
    return Cheques.act(ctx, uuid(id), parse(chequeActionInput, b));
  }

  // ---------------------------------------------------------------- budgets & EAC
  @Get('budgets')
  @RequirePermission('finance.budget.view', 'project')
  budgets(@Ctx() ctx: ModuleRequestContext) {
    return Budgets.overview(ctx);
  }

  @Get('budgets/:projectId')
  @RequirePermission('finance.budget.view', 'project')
  budget(@Ctx() ctx: ModuleRequestContext, @Param('projectId') id: string) {
    return Budgets.project(ctx, uuid(id), todayIso());
  }

  @Put('budgets/:projectId/draft')
  @RequirePermission('finance.budget.manage', 'company')
  draft(@Ctx() ctx: ModuleRequestContext, @Param('projectId') id: string, @Body() b: unknown) {
    return Budgets.saveDraft(ctx, uuid(id), parse(budgetInput, b));
  }

  @Post('budget-versions/:id/approve')
  @HttpCode(200)
  @RequirePermission('finance.budget.approve', 'company')
  async approveBudget(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string) {
    await Budgets.approve(ctx, uuid(id));
    return ok;
  }

  @Post('commitments')
  @RequirePermission('finance.budget.manage', 'company')
  commitment(@Ctx() ctx: ModuleRequestContext, @Body() b: unknown) {
    return Budgets.addCommitment(ctx, parse(commitmentInput, b));
  }

  @Post('commitments/:id/close')
  @HttpCode(200)
  @RequirePermission('finance.budget.manage', 'company')
  async closeCommitment(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string) {
    await Budgets.closeCommitment(ctx, uuid(id));
    return ok;
  }

  @Get('eac-methods')
  @RequirePermission('finance.budget.view', 'project')
  methods(@Ctx() ctx: ModuleRequestContext) {
    return Budgets.methods(ctx);
  }

  @Post('eac-methods')
  @RequirePermission('finance.budget.manage', 'company')
  setMethod(@Ctx() ctx: ModuleRequestContext, @Body() b: unknown) {
    return Budgets.setMethod(ctx, parse(eacMethodInput, b));
  }

  @Post('budgets/:projectId/etc')
  @RequirePermission('finance.budget.manage', 'company')
  async etc(@Ctx() ctx: ModuleRequestContext, @Param('projectId') id: string, @Body() b: unknown) {
    await Budgets.addEtc(ctx, uuid(id), parse(etcInput, b));
    return ok;
  }

  @Post('budgets/:projectId/notes')
  @RequirePermission('finance.budget.view', 'project')
  async note(@Ctx() ctx: ModuleRequestContext, @Param('projectId') id: string, @Body() b: unknown) {
    await Budgets.addNote(ctx, uuid(id), parse(noteInput, b).note);
    return ok;
  }

  // ---------------------------------------------------------------- cash flow, reconciliation, reports
  @Get('cashflow')
  @RequirePermission('finance.report.view', 'company')
  cashflow(@Ctx() ctx: ModuleRequestContext, @Query() q: unknown) {
    return cashflow(ctx, parse(cashflowQuery, q));
  }

  @Get('forecasts')
  @RequirePermission('finance.report.view', 'company')
  forecasts(@Ctx() ctx: ModuleRequestContext) {
    return Forecasts.list(ctx);
  }

  @Post('forecasts')
  @RequirePermission('finance.budget.manage', 'company')
  addForecast(@Ctx() ctx: ModuleRequestContext, @Body() b: unknown) {
    return Forecasts.add(ctx, parse(forecastInput, b));
  }

  @Delete('forecasts/:id')
  @RequirePermission('finance.budget.manage', 'company')
  async removeForecast(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string) {
    await Forecasts.remove(ctx, uuid(id));
    return ok;
  }

  @Post('reconciliation/statements')
  @RequirePermission('finance.reconcile', 'company')
  importStatement(@Ctx() ctx: ModuleRequestContext, @Body() b: unknown) {
    return Reconcile.import(ctx, parse(statementInput, b));
  }

  @Get('reconciliation/:accountId')
  @RequirePermission('finance.reconcile', 'company')
  reconciliation(@Ctx() ctx: ModuleRequestContext, @Param('accountId') id: string) {
    return Reconcile.view(ctx, uuid(id));
  }

  @Post('reconciliation/:accountId/auto')
  @HttpCode(200)
  @RequirePermission('finance.reconcile', 'company')
  auto(@Ctx() ctx: ModuleRequestContext, @Param('accountId') id: string) {
    return Reconcile.auto(ctx, uuid(id));
  }

  @Put('reconciliation/lines/:id')
  @RequirePermission('finance.reconcile', 'company')
  async match(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() b: unknown) {
    await Reconcile.match(ctx, uuid(id), parse(matchInput, b).transactionId);
    return ok;
  }

  @Get('reports/income-expense')
  @RequirePermission('finance.report.view', 'company')
  report(@Ctx() ctx: ModuleRequestContext, @Query() q: unknown) {
    return incomeExpense(ctx, parse(reportQuery, q));
  }
}
