import { Fragment, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { CalendarDays, ChevronLeft, ChevronRight, Tag } from "lucide-react";
import { Badge, Skeleton, cn } from "@mohandesyar/ui";
import { formatDate, toPersianDigits } from "@mohandesyar/persian";
import {
  useBlogList,
  useBlogPost,
  type BlogBlock,
  type BlogPostSummary,
} from "./data.js";
import { usePageMeta } from "./meta.js";
import { Section } from "./Sections.js";
import { NotFound } from "./Home.js";

export const BLOG_META = {
  title: "وبلاگ",
  description:
    "مقاله‌ها و راهنماهای مهندیکس درباره مدیریت پروژه، قرارداد، مالی و منابع انسانی در شرکت‌های مهندسی.",
};

/**
 * Inline formatting of block text: **bold** and [label](https://link). Built as React elements, so text
 * from the editor can never become markup.
 */
export function RichText({ text }: { text: string }) {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) out.push(<strong key={m.index}>{m[1]}</strong>);
    else
      out.push(
        <a
          key={m.index}
          href={m[3]}
          className="text-primary underline"
          rel="noopener"
          target={
            typeof window !== "undefined" &&
            m[3]!.startsWith(window.location.origin)
              ? undefined
              : "_blank"
          }
        >
          {m[2]}
        </a>,
      );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

export function BlogBody({ blocks }: { blocks: BlogBlock[] }) {
  return (
    <div className="space-y-5 text-[1.0625rem] leading-9">
      {blocks.map((b, i) => {
        switch (b.type) {
          case "p":
            return (
              <p key={i} className="whitespace-pre-line">
                <RichText text={b.text} />
              </p>
            );
          case "h2":
            return (
              <h2 key={i} className="pt-4 text-2xl font-extrabold">
                {b.text}
              </h2>
            );
          case "h3":
            return (
              <h3 key={i} className="pt-2 text-xl font-bold">
                {b.text}
              </h3>
            );
          case "quote":
            return (
              <blockquote
                key={i}
                className="border-s-4 border-primary bg-surface-2/60 px-5 py-3 text-muted"
              >
                <RichText text={b.text} />
              </blockquote>
            );
          case "ul":
          case "ol": {
            const L = b.type === "ul" ? "ul" : "ol";
            return (
              <L
                key={i}
                className={cn(
                  "space-y-2 ps-6",
                  b.type === "ul" ? "list-disc" : "list-decimal",
                )}
              >
                {b.items.map((it, j) => (
                  <li key={j}>
                    <RichText text={it} />
                  </li>
                ))}
              </L>
            );
          }
          case "img":
            return (
              <figure key={i}>
                <img
                  src={b.src}
                  alt={b.alt || b.caption}
                  loading="lazy"
                  className="w-full rounded-lg border border-border"
                />
                {b.caption && (
                  <figcaption className="mt-2 text-center text-sm text-muted">
                    {b.caption}
                  </figcaption>
                )}
              </figure>
            );
        }
      })}
    </div>
  );
}

function PostCard({ p }: { p: BlogPostSummary }) {
  return (
    <li>
      <Link
        to={`/blog/${encodeURIComponent(p.slug)}`}
        className="group flex h-full flex-col overflow-hidden rounded-lg border border-border bg-surface transition-colors hover:border-primary/50"
      >
        {p.cover ? (
          <img
            src={p.cover}
            alt=""
            loading="lazy"
            className="aspect-[16/9] w-full object-cover"
          />
        ) : (
          <div
            className="aspect-[16/9] w-full bg-gradient-to-br from-primary/15 to-primary/5"
            aria-hidden="true"
          />
        )}
        <div className="flex flex-1 flex-col p-5">
          {p.category && <Badge className="w-fit">{p.category.name}</Badge>}
          <h2 className="mt-3 text-lg font-bold leading-8 group-hover:text-primary">
            {p.title}
          </h2>
          {p.excerpt && (
            <p className="mt-2 line-clamp-3 flex-1 text-sm leading-7 text-muted">
              {p.excerpt}
            </p>
          )}
          <p className="mt-4 flex items-center gap-1 text-xs text-muted">
            <CalendarDays className="size-3.5" aria-hidden="true" />{" "}
            {formatDate(p.publishedAt)}
          </p>
        </div>
      </Link>
    </li>
  );
}

export function BlogListPage() {
  usePageMeta(BLOG_META);
  const [sp, setSp] = useSearchParams();
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const category = sp.get("category") ?? undefined;
  const tag = sp.get("tag") ?? undefined;
  const q = useBlogList({ page, category, tag });
  const go = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setSp(next);
    window.scrollTo({ top: 0 });
  };
  const chip = (active: boolean) =>
    cn(
      "rounded-full border px-3 py-1 text-sm",
      active
        ? "border-primary bg-primary/10 font-semibold text-primary"
        : "border-border hover:bg-surface-2",
    );
  return (
    <Section
      page
      title="وبلاگ"
      lead="مقاله‌ها، راهنماها و تجربه‌های مدیریت شرکت‌های مهندسی."
    >
      {q.data && q.data.categories.length > 0 && (
        <nav aria-label="دسته‌بندی‌ها" className="mb-8 flex flex-wrap gap-2">
          <button
            className={chip(!category)}
            onClick={() => go({ category: undefined, page: undefined })}
          >
            همه
          </button>
          {q.data.categories.map((c) => (
            <button
              key={c.slug}
              className={chip(category === c.slug)}
              onClick={() => go({ category: c.slug, page: undefined })}
            >
              {c.name}{" "}
              <span className="text-muted">({toPersianDigits(c.posts)})</span>
            </button>
          ))}
        </nav>
      )}
      {tag && (
        <p className="mb-6 flex items-center gap-2 text-sm">
          <Tag className="size-4" aria-hidden="true" /> برچسب:{" "}
          <strong>{tag}</strong>
          <button
            className="text-primary underline"
            onClick={() => go({ tag: undefined, page: undefined })}
          >
            حذف
          </button>
        </p>
      )}
      {/* Reserves the list's space before the posts arrive, so the page does not jump (CLS). */}
      <div className="min-h-[70vh]">
        {q.isPending ? (
          <div
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
            role="status"
            aria-busy="true"
            aria-label="در حال بارگذاری مطالب"
          >
            <Skeleton className="h-72" />
            <Skeleton className="hidden h-72 sm:block" />
            <Skeleton className="hidden h-72 lg:block" />
          </div>
        ) : q.isError ? (
          <p className="text-muted">
            بارگذاری مطالب ممکن نشد؛ کمی بعد دوباره تلاش کنید.
          </p>
        ) : q.data.posts.length === 0 ? (
          <p className="rounded-lg border border-border bg-surface p-6 text-center text-muted">
            هنوز مطلبی منتشر نشده است.
          </p>
        ) : (
          <>
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {q.data.posts.map((p) => (
                <PostCard key={p.slug} p={p} />
              ))}
            </ul>
            {q.data.pages > 1 && (
              <nav
                aria-label="صفحه‌بندی"
                className="mt-10 flex items-center justify-center gap-3"
              >
                <button
                  className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-2 text-sm disabled:opacity-40"
                  disabled={page <= 1}
                  onClick={() => go({ page: String(page - 1) })}
                >
                  <ChevronRight className="size-4" aria-hidden="true" /> قبلی
                </button>
                <span className="text-sm text-muted">
                  صفحه {toPersianDigits(page)} از{" "}
                  {toPersianDigits(q.data.pages)}
                </span>
                <button
                  className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-2 text-sm disabled:opacity-40"
                  disabled={page >= q.data.pages}
                  onClick={() => go({ page: String(page + 1) })}
                >
                  بعدی <ChevronLeft className="size-4" aria-hidden="true" />
                </button>
              </nav>
            )}
          </>
        )}
      </div>
    </Section>
  );
}

export function BlogPostPage() {
  const { slug = "" } = useParams();
  const q = useBlogPost(slug);
  usePageMeta(
    q.data
      ? {
          title: q.data.seoTitle || q.data.title,
          description: q.data.seoDescription || q.data.excerpt,
        }
      : BLOG_META,
  );
  if (q.isError) return <NotFound />;
  if (q.isPending) {
    return (
      <div
        className="mx-auto max-w-3xl space-y-4 px-4 py-16"
        role="status"
        aria-busy="true"
        aria-label="در حال بارگذاری مطلب"
      >
        <Skeleton className="h-10 w-3/4" />
        <Skeleton className="aspect-[16/9] w-full" />
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-5/6" />
      </div>
    );
  }
  const p = q.data;
  return (
    <article className="mx-auto max-w-3xl px-4 py-12 sm:py-16">
      <nav
        aria-label="مسیر"
        className="mb-6 flex flex-wrap items-center gap-1 text-sm text-muted"
      >
        <Link to="/blog" className="hover:text-primary">
          وبلاگ
        </Link>
        {p.category && (
          <>
            <ChevronLeft className="size-4" aria-hidden="true" />
            <Link
              to={`/blog?category=${encodeURIComponent(p.category.slug)}`}
              className="hover:text-primary"
            >
              {p.category.name}
            </Link>
          </>
        )}
      </nav>
      <h1 className="text-3xl font-extrabold leading-[1.6] sm:text-4xl">
        {p.title}
      </h1>
      <p className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
        <span className="flex items-center gap-1">
          <CalendarDays className="size-4" aria-hidden="true" />{" "}
          <time dateTime={p.publishedAt}>{formatDate(p.publishedAt)}</time>
        </span>
        {p.authorName && <span>نویسنده: {p.authorName}</span>}
      </p>
      {p.cover && (
        <img
          src={p.cover}
          alt=""
          className="mt-8 w-full rounded-lg border border-border"
        />
      )}
      {p.excerpt && (
        <p className="mt-8 text-lg leading-9 text-muted">{p.excerpt}</p>
      )}
      <div className="mt-8">
        <BlogBody blocks={p.body} />
      </div>
      {p.tags.length > 0 && (
        <ul className="mt-10 flex flex-wrap gap-2" aria-label="برچسب‌ها">
          {p.tags.map((t) => (
            <li key={t}>
              <Link
                to={`/blog?tag=${encodeURIComponent(t)}`}
                className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-sm hover:bg-surface-2"
              >
                <Tag className="size-3.5" aria-hidden="true" /> {t}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {p.related.length > 0 && (
        <section
          aria-labelledby="related-title"
          className="mt-14 border-t border-border pt-10"
        >
          <h2 id="related-title" className="text-xl font-bold">
            مطالب مرتبط
          </h2>
          <ul className="mt-6 grid gap-4 sm:grid-cols-3">
            {p.related.map((r) => (
              <Fragment key={r.slug}>
                <li>
                  <Link
                    to={`/blog/${encodeURIComponent(r.slug)}`}
                    className="block rounded-lg border border-border bg-surface p-4 hover:border-primary/50"
                  >
                    <p className="font-semibold leading-7">{r.title}</p>
                    <p className="mt-2 text-xs text-muted">
                      {formatDate(r.publishedAt)}
                    </p>
                  </Link>
                </li>
              </Fragment>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
