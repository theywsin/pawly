import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
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
import { AppSession, ConsoleSession } from './lib/session.js';
import { Home, NotFound } from './areas/public/Home.js';
import { Login } from './areas/auth/Login.js';
import { Signup } from './areas/auth/Signup.js';
import { AppShell } from './areas/app/AppShell.js';
import { Dashboard } from './areas/app/Dashboard.js';
import { Tasks } from './areas/app/Tasks.js';
import { Approvals } from './areas/app/Approvals.js';
import { Notifications } from './areas/app/Notifications.js';
import { Search } from './areas/app/Search.js';
import { Profile } from './areas/app/Profile.js';
import { Members } from './areas/app/settings/Members.js';
import { Modules } from './areas/app/settings/Modules.js';
import { Audit } from './areas/app/settings/Audit.js';
import { ModuleOutlet } from './module-host/ModuleOutlet.js';
import { ConsoleLogin } from './areas/console/ConsoleLogin.js';
import { ConsoleShell } from './areas/console/ConsoleShell.js';
import { Overview } from './areas/console/Overview.js';
import { ConsoleModules } from './areas/console/Modules.js';
import { ModuleInstall } from './areas/console/ModuleInstall.js';
import { ModuleDetail } from './areas/console/ModuleDetail.js';
import { ConsoleAudit, Keys, Tenants } from './areas/console/Other.js';

applyTheme(useUi.getState().theme);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (n, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && n < 2,
      refetchOnWindowFocus: false,
    },
  },
});

const router = createBrowserRouter([
  { path: '/', element: <Home /> },
  { path: '/auth/login', element: <Login /> },
  { path: '/auth/signup', element: <Signup /> },
  {
    path: '/app',
    element: (
      <AppSession>
        <AppShell />
      </AppSession>
    ),
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'tasks', element: <Tasks /> },
      { path: 'approvals', element: <Approvals /> },
      { path: 'notifications', element: <Notifications /> },
      { path: 'search', element: <Search /> },
      { path: 'profile', element: <Profile /> },
      { path: 'settings/members', element: <Members /> },
      { path: 'settings/modules', element: <Modules /> },
      { path: 'settings/audit', element: <Audit /> },
      { path: '*', element: <ModuleOutlet /> },
    ],
  },
  { path: '/console/login', element: <ConsoleLogin /> },
  {
    path: '/console',
    element: (
      <ConsoleSession>
        <ConsoleShell />
      </ConsoleSession>
    ),
    children: [
      { index: true, element: <Overview /> },
      { path: 'modules', element: <ConsoleModules /> },
      { path: 'modules/install', element: <ModuleInstall /> },
      { path: 'modules/:id', element: <ModuleDetail /> },
      { path: 'keys', element: <Keys /> },
      { path: 'tenants', element: <Tenants /> },
      { path: 'audit', element: <ConsoleAudit /> },
    ],
  },
  { path: '*', element: <NotFound /> },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);

