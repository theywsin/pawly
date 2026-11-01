import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { Ctx, RequirePermission, type ModuleRequestContext } from '@mohandesyar/module-sdk/server';
import { todayIso } from '@mohandesyar/persian';
import { z } from 'zod';
import { parse } from './errors.js';
import {
  awardInput, categoryInput, invoiceDecisionInput, invoiceInput, orderInput, orderQuery, quoteInput, ratingInput, receiptInput, reportQuery, requestInput, requestQuery, rfqInput, supplierInput,
} from './inputs.js';
import { Invoices, Orders, projectOptions, reports, Requests, Rfqs, supplierStatement, Suppliers } from './logic.js';

const uuid = (v: string) => parse(z.uuid({ message: 'شناسه نامعتبر است' }), v);
const ok = { ok: true };

/** Mounted at /api/m/procurement/v1. */
@Controller()
export class ProcurementController {
  // ---------------------------------------------------------------- suppliers
  @Get('suppliers')
  @RequirePermission('procurement.supplier.view', 'company')
  suppliers(@Ctx() ctx: ModuleRequestContext, @Query('q') q?: string) {
    return Suppliers.list(ctx, q ? String(q).slice(0, 100) : undefined);
  }

  @Post('suppliers')
  @RequirePermission('procurement.supplier.manage', 'company')
  createSupplier(@Ctx() ctx: ModuleRequestContext, @Body() b: unknown) {
    return Suppliers.save(ctx, null, parse(supplierInput, b));
  }

  @Put('suppliers/:id')
  @RequirePermission('procurement.supplier.manage', 'company')
  updateSupplier(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() b: unknown) {
    return Suppliers.save(ctx, uuid(id), parse(supplierInput, b));
  }

  @Get('suppliers/:id/statement')
  @RequirePermission('procurement.supplier.view', 'company')
  statement(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string) {
    return supplierStatement(ctx, uuid(id));
  }

  /** Lookups for the request form: everyone who may raise a request needs them. */
  @Get('categories')
  @RequirePermission('procurement.request.create', 'project')
  categories(@Ctx() ctx: ModuleRequestContext) {
    return Suppliers.categories(ctx);
  }

  @Get('projects')
  @RequirePermission('procurement.request.create', 'project')
  projects(@Ctx() ctx: ModuleRequestContext) {
    return projectOptions(ctx);
  }

  @Post('categories')
  @RequirePermission('procurement.supplier.manage', 'company')
  addCategory(@Ctx() ctx: ModuleRequestContext, @Body() b: unknown) {
    return Suppliers.addCategory(ctx, parse(categoryInput, b));
  }

  // ---------------------------------------------------------------- requests
  @Get('requests')
  @RequirePermission('procurement.request.view', 'own')
  requests(@Ctx() ctx: ModuleRequestContext, @Query() q: unknown) {
    return Requests.list(ctx, parse(requestQuery, q));
  }

  @Get('requests/:id')
  @RequirePermission('procurement.request.view', 'own')
  request(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string) {
    return Requests.get(ctx, uuid(id));
  }

  @Post('requests')
  @RequirePermission('procurement.request.create', 'project')
  createRequest(@Ctx() ctx: ModuleRequestContext, @Body() b: unknown) {
    return Requests.create(ctx, parse(requestInput, b));
  }

  @Post('requests/:id/cancel')
  @HttpCode(200)
  @RequirePermission('procurement.request.view', 'own')
  async cancelRequest(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string) {
    await Requests.cancel(ctx, uuid(id));
    return ok;
  }

  // ---------------------------------------------------------------- RFQs
  @Get('rfqs')
  @RequirePermission('procurement.order.manage', 'company')
  rfqs(@Ctx() ctx: ModuleRequestContext) {
    return Rfqs.list(ctx);
  }

  @Post('rfqs')
  @RequirePermission('procurement.order.manage', 'company')
  createRfq(@Ctx() ctx: ModuleRequestContext, @Body() b: unknown) {
    return Rfqs.create(ctx, parse(rfqInput, b));
  }

  @Get('rfqs/:id')
  @RequirePermission('procurement.order.manage', 'company')
  rfq(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string) {
    return Rfqs.get(ctx, uuid(id));
  }

  @Post('rfqs/:id/quotes')
  @RequirePermission('procurement.order.manage', 'company')
  addQuote(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() b: unknown) {
    return Rfqs.addQuote(ctx, uuid(id), parse(quoteInput, b));
  }

  @Post('rfqs/:id/award')
  @RequirePermission('procurement.order.manage', 'company')
  award(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() b: unknown) {
    return Rfqs.award(ctx, uuid(id), parse(awardInput, b), todayIso());
  }

  // ---------------------------------------------------------------- orders
  @Get('orders')
  @RequirePermission('procurement.receipt.record', 'project')
  orders(@Ctx() ctx: ModuleRequestContext, @Query() q: unknown) {
    return Orders.list(ctx, parse(orderQuery, q), todayIso(), true);
  }

  @Get('orders/:id')
  @RequirePermission('procurement.receipt.record', 'project')
  order(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string) {
    return Orders.get(ctx, uuid(id), todayIso());
  }

  @Post('orders')
  @RequirePermission('procurement.order.manage', 'company')
  createOrder(@Ctx() ctx: ModuleRequestContext, @Body() b: unknown) {
    return Orders.create(ctx, parse(orderInput, b));
  }

  @Post('orders/:id/cancel')
  @HttpCode(200)
  @RequirePermission('procurement.order.manage', 'company')
  async cancelOrder(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string) {
    await Orders.cancel(ctx, uuid(id));
    return ok;
  }

  @Post('orders/:id/close')
  @HttpCode(200)
  @RequirePermission('procurement.order.manage', 'company')
  async closeOrder(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string) {
    await Orders.close(ctx, uuid(id));
    return ok;
  }

  @Post('orders/:id/receipts')
  @RequirePermission('procurement.receipt.record', 'project')
  receive(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() b: unknown) {
    return Orders.receive(ctx, uuid(id), parse(receiptInput, b));
  }

  @Post('orders/:id/rating')
  @HttpCode(200)
  @RequirePermission('procurement.supplier.manage', 'company')
  async rate(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() b: unknown) {
    await Suppliers.rate(ctx, uuid(id), parse(ratingInput, b));
    return ok;
  }

  // ---------------------------------------------------------------- invoices
  @Get('invoices')
  @RequirePermission('procurement.supplier.view', 'company')
  invoices(@Ctx() ctx: ModuleRequestContext) {
    return Invoices.list(ctx);
  }

  @Post('invoices')
  @RequirePermission('procurement.invoice.manage', 'company')
  createInvoice(@Ctx() ctx: ModuleRequestContext, @Body() b: unknown) {
    return Invoices.create(ctx, parse(invoiceInput, b));
  }

  @Post('invoices/:id/decision')
  @HttpCode(200)
  @RequirePermission('procurement.invoice.approve', 'company')
  decide(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() b: unknown) {
    return Invoices.decide(ctx, uuid(id), parse(invoiceDecisionInput, b));
  }

  // ---------------------------------------------------------------- reports
  @Get('reports')
  @RequirePermission('procurement.report.view', 'company')
  reports(@Ctx() ctx: ModuleRequestContext, @Query() q: unknown) {
    return reports(ctx, parse(reportQuery, q), todayIso());
  }
}
