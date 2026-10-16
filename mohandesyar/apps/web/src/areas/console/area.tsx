import { Route, Routes } from 'react-router';
import { ConsoleSession } from '../../lib/session.js';
import { ConsoleLogin } from './ConsoleLogin.js';
import { ConsoleShell } from './ConsoleShell.js';
import { Overview } from './Overview.js';
import { ConsoleModules } from './Modules.js';
import { ModuleInstall } from './ModuleInstall.js';
import { ModuleDetail } from './ModuleDetail.js';
import { ConsoleAudit, Keys, Tenants } from './Other.js';
import { Leads } from './Leads.js';
import { Plans } from './Plans.js';
import { Content } from './Content.js';
import { BlogCategories, BlogEditor, BlogPosts } from './Blog.js';

/** Platform console area (lazy chunk). */
export const element = (
  <Routes>
    <Route path="login" element={<ConsoleLogin />} />
    <Route
      element={
        <ConsoleSession>
          <ConsoleShell />
        </ConsoleSession>
      }
    >
      <Route index element={<Overview />} />
      <Route path="modules" element={<ConsoleModules />} />
      <Route path="modules/install" element={<ModuleInstall />} />
      <Route path="modules/:id" element={<ModuleDetail />} />
      <Route path="keys" element={<Keys />} />
      <Route path="tenants" element={<Tenants />} />
      <Route path="leads" element={<Leads />} />
      <Route path="plans" element={<Plans />} />
      <Route path="content" element={<Content />} />
      <Route path="blog" element={<BlogPosts />} />
      <Route path="blog/categories" element={<BlogCategories />} />
      <Route path="blog/:id" element={<BlogEditor />} />
      <Route path="audit" element={<ConsoleAudit />} />
    </Route>
  </Routes>
);
