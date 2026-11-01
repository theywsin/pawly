/**
 * Build-time renderer for the public (landing) routes (prompt §5 SEO). Produces real HTML for search
 * engines; in the browser the SPA renders the same tree and replaces it. Data that comes from the API
 * (plans, FAQ, contact) renders as its loading state here and is fetched by the client.
 */
import { renderToString } from 'react-dom/server';
import { createStaticHandler, createStaticRouter, StaticRouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { publicRoutes, PRERENDER } from './areas/public/routes.js';
import { fullTitle, SITE_NAME } from './areas/public/meta.js';

export { PRERENDER, fullTitle, SITE_NAME };

export async function render(path: string): Promise<string> {
  const handler = createStaticHandler(publicRoutes);
  const context = await handler.query(new Request(`http://prerender.local${path}`));
  if (context instanceof Response) throw new Error(`unexpected redirect while prerendering ${path}`);
  const router = createStaticRouter(handler.dataRoutes, context);
  return renderToString(
    <QueryClientProvider client={new QueryClient()}>
      <StaticRouterProvider router={router} context={context} hydrate={false} />
    </QueryClientProvider>,
  );
}
