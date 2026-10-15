import {
  Bell, Briefcase, Building2, CalendarDays, CheckSquare, ClipboardCheck, FileSignature, FileText, Handshake, FolderKanban, Gauge, HardHat, LayoutDashboard,
  ListChecks, NotebookPen, Package, Puzzle, Receipt, ScrollText, Search, Settings, ShieldCheck, Users, Wallet, type LucideIcon,
} from 'lucide-react';

/**
 * Icons modules may reference by name in their manifest menu. A curated set keeps the shell bundle small;
 * unknown names fall back to a generic icon.
 */
const ICONS: Record<string, LucideIcon> = {
  bell: Bell, briefcase: Briefcase, 'building-2': Building2, 'calendar-days': CalendarDays, 'check-square': CheckSquare,
  'clipboard-check': ClipboardCheck, 'file-signature': FileSignature, 'file-text': FileText, handshake: Handshake, 'folder-kanban': FolderKanban, gauge: Gauge, 'hard-hat': HardHat,
  'layout-dashboard': LayoutDashboard, 'list-checks': ListChecks, 'notebook-pen': NotebookPen, package: Package, puzzle: Puzzle,
  receipt: Receipt, 'scroll-text': ScrollText, search: Search, settings: Settings, 'shield-check': ShieldCheck, users: Users, wallet: Wallet,
};

export function MenuIcon({ name, className }: { name?: string; className?: string }) {
  const I = (name && ICONS[name]) || Puzzle;
  return <I className={className ?? 'size-5'} aria-hidden="true" />;
}
