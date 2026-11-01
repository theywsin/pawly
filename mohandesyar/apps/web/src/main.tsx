import './zod-config';
import { StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@fontsource/vazirmatn/arabic-400.css';
import '@fontsource/vazirmatn/arabic-500.css';
import '@fontsource/vazirmatn/arabic-700.css';
import '@fontsource/vazirmatn/latin-400.css';
import '@fontsource/vazirmatn/latin-700.css';
import './styles.css';
import { ApiError } from '@mohandesyar/module-sdk/web';
import { applyTheme, useUi } from './lib/ui-store.js';
import { publicRoutes } from './areas/public/routes.js';
import { RouteError } from './areas/public/RouteError.js';

applyTheme(useUi.getState().theme);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (n, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && n < 2,
      refetchOnWindowFocus: false,
    },
  },
});

// The landing is loaded eagerly; the company app and the platform console are separate chunks.
const lazyArea = (load: () => Promise<{ element: React.ReactNode }>) => async () => {
  const { element } = await load();
  return { element };
};

const router = createBrowserRouter([
  {
    errorElement: <RouteError />,
    children: [
      ...publicRoutes,
      { path: '/auth/login', lazy: async () => ({ Component: (await import('./areas/auth/Login.js')).Login }) },
      { path: '/auth/signup', lazy: async () => ({ Component: (await import('./areas/auth/Signup.js')).Signup }) },
      { path: '/app/*', lazy: lazyArea(() => import('./areas/app/area.js')) },
      { path: '/console/*', lazy: lazyArea(() => import('./areas/console/area.js')) },
    ],
  },
]);

const app = (
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>
);

// Prerendered public pages are hydrated (no repaint of the static HTML); the SPA shell renders from scratch.
const container = document.getElementById('root')!;
// Prerendered pages are already painted: hydrate after the first frame so it never delays first paint.
if (container.firstElementChild) requestAnimationFrame(() => setTimeout(() => hydrateRoot(container, app), 0));
else createRoot(container).render(app);
