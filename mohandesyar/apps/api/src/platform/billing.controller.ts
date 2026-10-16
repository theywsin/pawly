import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Query, Res } from '@nestjs/common';
import { z } from 'zod';
import { Public, RequirePermission } from '@mohandesyar/module-sdk/server';
import { Services } from '../app/services.js';
import { Console, CurrentAdmin, CurrentIdentity, type AdminIdentity, type Identity } from '../core/http/context.js';
import { notFound, parse } from '../core/http/errors.js';
import { BillingService, modulePriceSchema, purchaseSchema } from './billing.service.js';
import { zodToApi } from './console-site.controller.js';
import type { SepCallback } from './sep.js';

const who = (id: Identity) => ({ tenantId: id.tenantId, userId: id.userId, companyId: id.companyId, companyIds: id.companyIds });
interface RedirectReply {
  code(n: number): RedirectReply;
  header(k: string, v: string): RedirectReply;
  type(t: string): RedirectReply;
}

/** The organisation's subscription, invoices and online payment (members with core.billing.manage). */
@Controller('billing')
export class BillingController {
  constructor(@Inject(Services) private readonly s: Services) {}

  @Get()
  @RequirePermission('core.billing.manage')
  overview(@CurrentIdentity() id: Identity) {
    return this.s.billing.overview(id.tenantId);
  }

  @Post('quote')
  @HttpCode(200)
  @RequirePermission('core.billing.manage')
  async quote(@CurrentIdentity() id: Identity, @Body() body: unknown) {
    return BillingService.quoteJson(await this.s.billing.quote(id.tenantId, parse(purchaseSchema, body)));
  }

  @Post('invoices')
  @HttpCode(201)
  @RequirePermission('core.billing.manage')
  invoice(@CurrentIdentity() id: Identity, @Body() body: unknown) {
    return this.s.billing.createInvoice(who(id), parse(purchaseSchema, body));
  }

  @Get('invoices/:id')
  @RequirePermission('core.billing.manage')
  getInvoice(@CurrentIdentity() id: Identity, @Param('id') invoiceId: string) {
    return this.s.billing.invoice(id.tenantId, parse(z.uuid(), invoiceId));
  }

  @Post('invoices/:id/pay')
  @HttpCode(200)
  @RequirePermission('core.billing.manage')
  pay(@CurrentIdentity() id: Identity, @Param('id') invoiceId: string, @Body() body: unknown) {
    const b = parse(z.object({ returnTo: z.string().max(200).optional() }), body ?? {});
    return this.s.billing.pay(who(id), parse(z.uuid(), invoiceId), b.returnTo);
  }

  @Get('payments/:id')
  @RequirePermission('core.billing.manage')
  payment(@CurrentIdentity() id: Identity, @Param('id') paymentId: string) {
    return this.s.billing.payment(id.tenantId, parse(z.uuid(), paymentId));
  }
}

/** Where the bank returns the payer, and the built-in test bank's page (PAYMENT_SANDBOX only). */
@Controller()
export class PaymentCallbackController {
  constructor(@Inject(Services) private readonly s: Services) {}

  @Public()
  @Post('public/payments/sep/callback')
  async callback(@Body() body: unknown, @Res({ passthrough: true }) reply: RedirectReply) {
    const fields = (body && typeof body === 'object' ? body : {}) as SepCallback;
    const target = await this.s.billing.callback(fields);
    reply.code(303).header('location', target);
    return '';
  }

  @Public()
  @Get('sandbox/sep/OnlinePG/SendToken')
  async sandboxPage(@Query('token') token: string, @Res({ passthrough: true }) reply: RedirectReply) {
    if (!this.s.config.PAYMENT_SANDBOX || !/^[0-9a-f]{32}$/.test(token ?? '')) throw notFound();
    const html = await this.s.billing.sandbox.page(token);
    if (!html) throw notFound('تراکنش آزمایشی یافت نشد یا منقضی شده است');
    reply.type('text/html; charset=utf-8');
    return html;
  }
}

/** Console: gateway, VAT and trial settings, module prices and the payments ledger. */
@Controller('console/billing')
export class ConsoleBillingController {
  constructor(@Inject(Services) private readonly s: Services) {}

  @Console('super_admin', 'sales_admin')
  @Get('settings')
  async settings() {
    return { ...(await this.s.billing.settings()), sandboxAvailable: this.s.config.PAYMENT_SANDBOX, callbackUrl: `${this.s.config.PUBLIC_ORIGIN.replace(/\/$/, '')}/api/public/payments/sep/callback` };
  }

  @Console('super_admin')
  @Put('settings')
  saveSettings(@Body() body: unknown, @CurrentAdmin() a: AdminIdentity) {
    return zodToApi(() => this.s.billing.setSettings(body, a.adminId));
  }

  @Console('super_admin', 'sales_admin')
  @Get('module-prices')
  modulePrices() {
    return this.s.billing.modulePrices();
  }

  @Console('super_admin', 'sales_admin')
  @Put('module-prices/:moduleId')
  async setModulePrice(@Param('moduleId') moduleId: string, @Body() body: unknown, @CurrentAdmin() a: AdminIdentity) {
    await this.s.billing.setModulePrice(parse(z.string().regex(/^[a-z][a-z0-9-]{1,30}$/), moduleId), parse(modulePriceSchema, body), a.adminId);
    return { ok: true };
  }

  @Console('super_admin', 'sales_admin', 'support')
  @Get('payments')
  payments(@Query('status') status?: string, @Query('tenantId') tenantId?: string) {
    return this.s.billing.adminPayments({
      status: status && ['pending', 'verifying', 'paid', 'failed'].includes(status) ? status : undefined,
      tenantId: tenantId && z.uuid().safeParse(tenantId).success ? tenantId : undefined,
    });
  }

  @Console('super_admin', 'sales_admin', 'support')
  @Get('invoices/:id')
  invoice(@Param('id') id: string) {
    return this.s.billing.invoice(null, parse(z.uuid(), id));
  }
}
