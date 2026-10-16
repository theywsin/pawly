import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { multipart, PNG, TestApp } from '../helpers/app.js';
import { postHead } from '../../src/app/app.factory.js';

let t: TestApp;
let admin: { token: string };
let image: { id: string; url: string };

beforeAll(async () => {
  t = await TestApp.start();
  admin = await t.consoleAdmin(['sales_admin']);
  const m = multipart(PNG, 'cover.png');
  image = (await t.req('POST', '/api/console/site/media', { token: admin.token, payload: m.payload, headers: m.headers })).body;
});
afterAll(async () => t?.stop());

const savePost = (id: string, body: object) => t.req('PUT', `/api/console/site/blog/posts/${id}`, { token: admin.token, body });
const minute = 60_000;

describe('blog', () => {
  it('shows nothing until a post is published; drafts and scheduled posts stay private', async () => {
    expect((await t.req('GET', '/api/public/blog')).body).toMatchObject({ posts: [], total: 0, pages: 1 });
    const cat = await t.req('PUT', '/api/console/site/blog/categories/new', { token: admin.token, body: { name: 'مدیریت پروژه', slug: 'مدیریت-پروژه' } });
    expect(cat.status, JSON.stringify(cat.body)).toBe(200);
    const draft = await savePost('new', { slug: 'پیش-نویس', title: 'یک پیش‌نویس', body: [{ type: 'p', text: 'متن' }] });
    expect(draft.status, JSON.stringify(draft.body)).toBe(200);
    const scheduled = await savePost('new', { slug: 'آینده', title: 'مطلب آینده', status: 'published', publishedAt: new Date(Date.now() + 60 * minute).toISOString() });
    expect(scheduled.status).toBe(200);
    const live = await savePost('new', {
      slug: 'کنترل-پروژه',
      title: 'کنترل پروژه در شرکت‌های پیمانکاری',
      excerpt: 'چگونه پیشرفت واقعی را اندازه بگیریم',
      coverId: image.id,
      categoryId: cat.body.id,
      tags: ['پروژه', 'EVM'],
      status: 'published',
      authorName: 'تیم مهندیکس',
      body: [
        { type: 'h2', text: 'مقدمه' },
        { type: 'p', text: 'متن **مهم** با [پیوند](https://example.ir)' },
        { type: 'ul', items: ['یک', 'دو'] },
        { type: 'img', mediaId: image.id, caption: 'نمودار' },
      ],
    });
    expect(live.status, JSON.stringify(live.body)).toBe(200);

    const list = (await t.req('GET', '/api/public/blog')).body;
    expect(list.posts.map((p: { slug: string }) => p.slug)).toEqual(['کنترل-پروژه']);
    expect(list.categories).toEqual([{ slug: 'مدیریت-پروژه', name: 'مدیریت پروژه', posts: 1 }]);
    expect(list.posts[0]).toMatchObject({ cover: image.url, category: { slug: 'مدیریت-پروژه' }, tags: ['پروژه', 'EVM'] });
    expect(list.posts[0].body).toBeUndefined();

    const post = (await t.req('GET', `/api/public/blog/${encodeURIComponent('کنترل-پروژه')}`)).body;
    expect(post.body[3]).toMatchObject({ type: 'img', src: image.url, caption: 'نمودار' });
    expect((await t.req('GET', `/api/public/blog/${encodeURIComponent('پیش-نویس')}`)).status).toBe(404);
    expect((await t.req('GET', `/api/public/blog/${encodeURIComponent('آینده')}`)).status).toBe(404);

    // Filters and the console list (which shows everything, with the scheduled flag).
    expect((await t.req('GET', `/api/public/blog?tag=EVM`)).body.total).toBe(1);
    expect((await t.req('GET', `/api/public/blog?category=other`)).body.total).toBe(0);
    const admin_ = (await t.req('GET', '/api/console/site/blog/posts', { token: admin.token })).body as { slug: string; scheduled: boolean }[];
    expect(admin_).toHaveLength(3);
    expect(admin_.find((p) => p.slug === 'آینده')!.scheduled).toBe(true);
  });

  it('becomes public once the scheduled time passes', async () => {
    const list = (await t.req('GET', '/api/console/site/blog/posts', { token: admin.token })).body as { id: string; slug: string }[];
    const id = list.find((p) => p.slug === 'آینده')!.id;
    await t.services.db.app.execute((await import('drizzle-orm')).sql`UPDATE platform_blog_posts SET published_at = now() - interval '1 minute' WHERE id = ${id}`);
    expect((await t.req('GET', `/api/public/blog/${encodeURIComponent('آینده')}`)).status).toBe(200);
    expect((await t.services.blog.sitemap()).map((p) => p.slug)).toEqual(expect.arrayContaining(['آینده', 'کنترل-پروژه']));
  });

  it('validates slugs, blocks and references', async () => {
    expect((await savePost('new', { slug: 'دارای فاصله', title: 'عنوان معتبر' })).status).toBe(400);
    expect((await savePost('new', { slug: 'کنترل-پروژه', title: 'تکراری' })).status).toBe(409);
    const html = await savePost('new', { slug: 'html', title: 'تزریق', body: [{ type: 'html', text: '<script>alert(1)</script>' }] });
    expect(html.status).toBe(400);
    expect((await savePost('new', { slug: 'bad-image', title: 'تصویر نادرست', body: [{ type: 'img', mediaId: '018f0000-0000-7000-8000-000000000000' }] })).status).toBe(400);
    // Stored text is returned as text; rendering it is React's job (no HTML is ever interpreted).
    const xss = await savePost('new', { slug: 'xss', title: 'متن خطرناک', status: 'published', body: [{ type: 'p', text: '<img src=x onerror=alert(1)>' }] });
    expect(xss.status).toBe(200);
    expect((await t.req('GET', '/api/public/blog/xss')).body.body[0].text).toBe('<img src=x onerror=alert(1)>');
  });

  it('is managed by platform admins only', async () => {
    const user = await t.signup('blog');
    expect((await t.req('PUT', '/api/console/site/blog/posts/new', { token: user.token, body: { slug: 'x-y', title: 'عنوان' } })).status).toBe(401);
  });

  it('writes escaped meta tags and structured data for a post page', () => {
    const head = postHead(
      { title: 'عنوان "خاص" </script><script>alert(1)</script>', description: 'توضیح <b>', image: '/api/public/media/x', publishedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z', author: 'نویسنده', text: '</script><script>alert(2)</script>' },
      'https://example.ir/blog/a',
      'https://example.ir',
    );
    expect(head).toContain('<meta property="og:image" content="https://example.ir/api/public/media/x" />');
    expect(head).toContain('&quot;خاص&quot;');
    expect(head).not.toContain('<script>alert');
    expect(head.match(/<\/script>/g)).toHaveLength(1);
    const ld = JSON.parse(head.split('application/ld+json">')[1]!.split('</script>')[0]!);
    expect(ld).toMatchObject({ '@type': 'BlogPosting', author: { name: 'نویسنده' }, articleBody: '</script><script>alert(2)</script>' });
  });
});
