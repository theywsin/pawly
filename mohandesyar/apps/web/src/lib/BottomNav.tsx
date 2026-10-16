import type { ComponentType } from 'react';
import { NavLink } from 'react-router';
import { cn } from '@mohandesyar/ui';

export interface BottomNavItem {
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** A link target, or an action (e.g. opening the full menu). */
  to?: string;
  end?: boolean;
  onClick?: () => void;
  /** Shows a dot (e.g. unread notifications). */
  dot?: boolean;
}

const item = 'flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 pt-1.5 pb-1 text-[0.6875rem] leading-tight';

/**
 * Phone-width navigation pinned to the bottom of the screen (hidden from md up). Pages using it reserve
 * the same space at the end of their content with `BOTTOM_NAV_SPACE`, including the home-indicator area.
 */
export function BottomNav({ items, label }: { items: BottomNavItem[]; label: string }) {
  return (
    <nav
      aria-label={label}
      className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden print:hidden"
    >
      {items.map(({ label: text, icon: Icon, to, end, onClick, dot }) => {
        const body = (active: boolean) => (
          <>
            <span className="relative">
              <Icon className={cn('size-6', active ? 'text-primary' : 'text-muted')} />
              {dot && <span className="absolute -end-0.5 -top-0.5 size-2 rounded-full bg-danger" aria-hidden="true" />}
            </span>
            <span className={cn('truncate', active ? 'font-semibold text-primary' : 'text-muted')}>{text}</span>
          </>
        );
        return to ? (
          <NavLink key={text} to={to} end={end} className={item}>
            {({ isActive }) => body(isActive)}
          </NavLink>
        ) : (
          <button key={text} type="button" className={item} onClick={onClick}>
            {body(false)}
          </button>
        );
      })}
    </nav>
  );
}

/** Bottom padding that keeps content clear of the bar on phones. */
export const BOTTOM_NAV_SPACE = 'pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0';
