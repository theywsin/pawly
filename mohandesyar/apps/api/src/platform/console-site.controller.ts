import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Req } from '@nestjs/common';
import { z } from 'zod';
import { Services } from '../app/services.js';
import { Console, CurrentAdmin, type AdminIdentity } from '../core/http/context.js';
import { badRequest, parse } from '../core/http/errors.js';
import { MAX_IMAGE_BYTES } from './media.service.js';
import { clientSchema } from './site.service.js';

export interface ImageUploadReq {
  file(opts?: { limits?: { fileSize?: number } }): Promise<{ filename: string; toBuffer(): Promise<Buffer>; file: { truncated?: boolean }; fields: Record<string, { value?: string } | undefined> } | undefined>;
}

/** Re-throws schema errors as field-level validation failures (shared by the platform controllers). */
export async function zodToApi<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof z.ZodError) throw badRequest('VALIDATION_FAILED', 'اطلاعات معتبر نیست', err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    throw err;
  }
}

/** Console: site images, customers' logos and app download links. */
@Controller('console/site')
export class ConsoleSiteController {
  constructor(@Inject(Services) private readonly s: Services) {}

  @Console('super_admin', 'sales_admin')
  @Post('media')
  @HttpCode(201)
  async upload(@Req() req: ImageUploadReq, @CurrentAdmin() a: AdminIdentity) {
    const part = await req.file({ limits: { fileSize: MAX_IMAGE_BYTES + 1 } });
    if (!part) throw badRequest('NO_FILE', 'تصویری ارسال نشده است');
    const data = await part.toBuffer().catch(() => null);
    if (!data || part.file.truncated) throw badRequest('FILE_TOO_LARGE', 'حجم تصویر بیش از ۵ مگابایت است');
    return this.s.media.upload({ name: part.filename, data }, part.fields.alt?.value ?? '', a.adminId);
  }

  @Console('super_admin', 'sales_admin')
  @Get('media')
  media() {
    return this.s.media.list();
  }

  @Console('super_admin', 'sales_admin')
  @Get('clients')
  clients() {
    return this.s.site.listClients();
  }

  @Console('super_admin', 'sales_admin')
  @Put('clients/:id')
  async saveClient(@Param('id') id: string, @Body() body: unknown, @CurrentAdmin() a: AdminIdentity) {
    return { id: await this.s.site.saveClient(id === 'new' ? null : parse(z.uuid(), id), parse(clientSchema, body), a.adminId) };
  }

  @Console('super_admin', 'sales_admin')
  @Post('clients/:id/delete')
  @HttpCode(200)
  async deleteClient(@Param('id') id: string, @CurrentAdmin() a: AdminIdentity) {
    await this.s.site.deleteClient(parse(z.uuid(), id), a.adminId);
    return { ok: true };
  }

  @Console('super_admin', 'sales_admin')
  @Get('apps')
  apps() {
    return this.s.site.apps();
  }

  @Console('super_admin', 'sales_admin')
  @Put('apps')
  async setApps(@Body() body: unknown, @CurrentAdmin() a: AdminIdentity) {
    return zodToApi(() => this.s.site.setApps(body, a.adminId));
  }
}
