import { Navigate, type RouteObject } from 'react-router';
import { PublicLayout } from './PublicLayout.js';
import { Home, HOME_META, NotFound } from './Home.js';
import { ContactPage, ContentPage, DownloadPage, ModuleDetailPage, ModulesPage, PAGE_META, PricingPage } from './Pages.js';
import { MODULES } from './catalog.js';
import { BLOG_META, BlogListPage, BlogPostPage } from './Blog.js';
import type { PageMeta } from './meta.js';

/** Public (landing) routes, shared by the SPA router and the build-time prerender. */
export const publicRoutes: RouteObject[] = [
  {
    element: <PublicLayout />,
    children: [
      { path: '/', element: <Home /> },
      { path: '/pricing', element: <PricingPage /> },
      { path: '/modules', element: <ModulesPage /> },
      { path: '/modules/:id', element: <ModuleDetailPage /> },
      { path: '/about', element: <ContentPage key="about" pageKey="about" /> },
      { path: '/terms', element: <ContentPage key="terms" pageKey="terms" /> },
      { path: '/privacy', element: <ContentPage key="privacy" pageKey="privacy" /> },
      { path: '/contact', element: <ContactPage /> },
      { path: '/download', element: <DownloadPage /> },
      { path: '/blog', element: <BlogListPage /> },
      { path: '/blog/:slug', element: <BlogPostPage /> },
      // The demo request was replaced by online purchase; old links land on the plans.
      { path: '/demo', element: <Navigate to="/pricing" replace /> },
      { path: '*', element: <NotFound /> },
    ],
  },
];

/** Every page written as static HTML at build time, with its metadata. */
export const PRERENDER: { path: string; meta: PageMeta; priority: number }[] = [
  { path: '/', meta: HOME_META, priority: 1 },
  { path: '/pricing', meta: PAGE_META.pricing, priority: 0.9 },
  { path: '/modules', meta: PAGE_META.modules, priority: 0.9 },
  ...MODULES.map((m) => ({ path: `/modules/${m.id}`, meta: { title: m.name, description: m.tagline }, priority: 0.7 })),
  { path: '/download', meta: PAGE_META.download, priority: 0.7 },
  { path: '/blog', meta: BLOG_META, priority: 0.8 },
  { path: '/contact', meta: PAGE_META.contact, priority: 0.6 },
  { path: '/about', meta: PAGE_META.about, priority: 0.5 },
  { path: '/terms', meta: PAGE_META.terms, priority: 0.3 },
  { path: '/privacy', meta: PAGE_META.privacy, priority: 0.3 },
];
