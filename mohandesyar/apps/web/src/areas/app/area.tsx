import { Route, Routes } from 'react-router';
import { AppSession } from '../../lib/session.js';
import { AppShell } from './AppShell.js';
import { Dashboard } from './Dashboard.js';
import { Tasks } from './Tasks.js';
import { Approvals } from './Approvals.js';
import { Notifications } from './Notifications.js';
import { Search } from './Search.js';
import { Profile } from './Profile.js';
import { Members } from './settings/Members.js';
import { Modules } from './settings/Modules.js';
import { Audit } from './settings/Audit.js';
import { ApprovalSettings } from './settings/Approvals.js';
import { ImportsPage } from './settings/Imports.js';
import { ReportsPage } from './Reports.js';
import { IntegrationsPage } from './settings/Integrations.js';
import { Calendar } from './settings/Calendar.js';
import { Onboarding } from './Onboarding.js';
import { BillingPage, CheckoutPage, InvoicePage } from './Billing.js';
import { NewTicket, SupportList, TicketPage } from './Support.js';
import { ModuleOutlet } from '../../module-host/ModuleOutlet.js';

/** Company app area (lazy chunk). */
export const element = (
  <AppSession>
    <Routes>
      <Route path="onboarding" element={<Onboarding />} />
      <Route element={<AppShell />}>
        <Route index element={<Dashboard />} />
        <Route path="tasks" element={<Tasks />} />
        <Route path="approvals" element={<Approvals />} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="search" element={<Search />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="profile" element={<Profile />} />
        <Route path="settings/members" element={<Members />} />
        <Route path="settings/modules" element={<Modules />} />
        <Route path="settings/audit" element={<Audit />} />
        <Route path="settings/calendar" element={<Calendar />} />
        <Route path="settings/approvals" element={<ApprovalSettings />} />
        <Route path="settings/imports" element={<ImportsPage />} />
        <Route path="settings/integrations" element={<IntegrationsPage />} />
        <Route path="support" element={<SupportList />} />
        <Route path="support/new" element={<NewTicket />} />
        <Route path="support/:id" element={<TicketPage />} />
        <Route path="billing" element={<BillingPage />} />
        <Route path="billing/checkout" element={<CheckoutPage />} />
        <Route path="billing/invoices/:id" element={<InvoicePage />} />
        <Route path="*" element={<ModuleOutlet />} />
      </Route>
    </Routes>
  </AppSession>
);
