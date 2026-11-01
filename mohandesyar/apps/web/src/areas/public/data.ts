import { useQuery } from '@tanstack/react-query';

export interface PublicPlan {
  key: string;
  name: string;
  description: string;
  price_monthly: string | null;
  price_yearly: string | null;
  user_limit: number | null;
  storage_gb: number | null;
  features: Record<string, unknown>;
  modules: { moduleId: string; included: boolean; addonPrice: string | null; name: { fa: string } | null; installed: boolean | null }[];
}

export interface PublicSite {
  faq: { id: string; question: string; answer: string }[];
  contact: { phone?: string; email?: string; address?: string; hours?: string } | null;
  pages: { about: boolean; terms: boolean; privacy: boolean };
  signupMode: 'open' | 'approval' | 'closed';
  availableModules: { id: string; name: { fa: string }; active_version: string }[];
  clients: { id: string; name: string; url: string | null; logo: string }[];
  apps: Record<AppPlatform, { url: string; version: string; note: string }>;
}

export type AppPlatform = 'android' | 'ios' | 'windows' | 'mac';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { accept: 'application/json' } });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error((body as { message?: string } | null)?.message ?? 'بارگذاری ممکن نشد'), { status: res.status });
  return body as T;
}

export const usePlans = () => useQuery({ queryKey: ['public', 'plans'], queryFn: () => get<PublicPlan[]>('/api/public/plans'), staleTime: 60_000 });
export const useSite = () => useQuery({ queryKey: ['public', 'site'], queryFn: () => get<PublicSite>('/api/public/site'), staleTime: 60_000 });
export const usePage = (key: string) => useQuery({ queryKey: ['public', 'page', key], queryFn: () => get<{ title: string; body: string; updatedAt: string }>(`/api/public/pages/${key}`), retry: false });

/** Modules installed and enabled on this deployment are "available"; the rest are shown as in development. */
export function useAvailability(): (id: string) => 'available' | 'coming' | 'unknown' {
  const site = useSite();
  return (id) => (!site.data ? 'unknown' : site.data.availableModules.some((m) => m.id === id) ? 'available' : 'coming');
}

export type BlogBlock =
  | { type: 'p' | 'h2' | 'h3' | 'quote'; text: string }
  | { type: 'ul' | 'ol'; items: string[] }
  | { type: 'img'; mediaId: string; src: string; caption: string; alt: string };

export interface BlogPostSummary {
  slug: string;
  title: string;
  excerpt: string;
  cover: string | null;
  category: { slug: string; name: string } | null;
  tags: string[];
  publishedAt: string;
  updatedAt: string;
  authorName: string;
}
export interface BlogPost extends BlogPostSummary {
  seoTitle: string;
  seoDescription: string;
  body: BlogBlock[];
  related: BlogPostSummary[];
}
export interface BlogList {
  posts: BlogPostSummary[];
  page: number;
  pages: number;
  total: number;
  categories: { slug: string; name: string; posts: number }[];
}

export const useBlogList = (p: { page: number; category?: string; tag?: string }) => {
  const qs = new URLSearchParams({ page: String(p.page), ...(p.category ? { category: p.category } : {}), ...(p.tag ? { tag: p.tag } : {}) });
  return useQuery({ queryKey: ['public', 'blog', p], queryFn: () => get<BlogList>(`/api/public/blog?${qs}`), staleTime: 60_000 });
};
export const useBlogPost = (slug: string) => useQuery({ queryKey: ['public', 'blog-post', slug], queryFn: () => get<BlogPost>(`/api/public/blog/${encodeURIComponent(slug)}`), retry: false });
