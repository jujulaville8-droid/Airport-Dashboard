import {
  AirplaneTilt,
  CalendarBlank,
  CurrencyDollar,
  Database,
  Package,
  Receipt,
  SignOut,
  SquaresFour,
  type Icon,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { DESKTOP_NAV, isNavigationItemActive } from './navigation';

const NAV_ICONS: Record<string, Icon> = {
  Overview: SquaresFour,
  Sales: Receipt,
  Inventory: Package,
  Flights: AirplaneTilt,
  Schedules: CalendarBlank,
  Concession: CurrencyDollar,
};

export interface DesktopSidebarProps {
  pathname: string;
  username: string | null;
}

function getInitials(username: string | null) {
  if (!username) {
    return 'SM';
  }

  const initials = username
    .split('@')[0]
    .split(/[._\-\s]+/)
    .map((part) => part[0]?.toUpperCase())
    .filter(Boolean)
    .slice(0, 2)
    .join('');

  return initials || username[0]?.toUpperCase() || 'SM';
}

export function DesktopSidebar({
  pathname,
  username,
}: DesktopSidebarProps) {
  const displayName = username ?? 'Store Manager';

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 flex-col border-r border-surface/10 bg-nav text-surface md:flex">
      <div className="shrink-0 border-b border-surface/10 px-7 py-7">
        <p className="font-mono text-[0.6875rem] font-semibold uppercase tracking-[0.18em] text-accent">
          ANU · Retail operations
        </p>
        <p className="mt-3 font-display text-2xl font-semibold leading-6 tracking-[0.01em]">
          The Tailor&apos;s Daughter
        </p>
        <p className="mt-2 text-xs leading-5 text-surface/65">
          V.C. Bird International Airport
        </p>
      </div>

      <nav
        aria-label="Dashboard"
        className="min-h-0 flex-1 overflow-y-auto px-4 py-5"
      >
        <div className="space-y-5">
          {DESKTOP_NAV.map((group) => (
            <section aria-labelledby={`nav-${group.label}`} key={group.label}>
              <h2
                className="px-3 font-mono text-[0.625rem] font-semibold uppercase tracking-[0.18em] text-surface/50"
                id={`nav-${group.label}`}
              >
                {group.label}
              </h2>
              <ul className="mt-1.5 space-y-1">
                {group.items.map((item) => {
                  const active = isNavigationItemActive(pathname, item.href);
                  const ItemIcon = NAV_ICONS[item.label];

                  return (
                    <li key={item.href}>
                      <Link
                        aria-current={active ? 'page' : undefined}
                        className={[
                          'group relative flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-semibold transition-colors duration-150',
                          active
                            ? 'bg-surface text-nav'
                            : 'text-surface/75 hover:bg-surface/10 hover:text-surface',
                        ].join(' ')}
                        href={item.href}
                      >
                        <span
                          aria-hidden="true"
                          className={[
                            'absolute inset-y-2 left-0 w-0.5 rounded-full',
                            active ? 'bg-accent' : 'bg-transparent',
                          ].join(' ')}
                        />
                        <ItemIcon
                          aria-hidden="true"
                          className={active ? 'text-nav' : 'text-surface/60'}
                          size={19}
                          weight={active ? 'fill' : 'regular'}
                        />
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </nav>

      <div className="shrink-0 border-t border-surface/10 p-4">
        <Link
          aria-current={
            isNavigationItemActive(pathname, '/dashboard/connections')
              ? 'page'
              : undefined
          }
          aria-label="Imports healthy"
          className="flex min-h-14 items-center gap-3 rounded-md border border-positive/40 bg-positive/10 px-3 text-left transition-colors hover:border-positive hover:bg-positive/20"
          href="/dashboard/connections"
        >
          <span className="relative flex size-9 shrink-0 items-center justify-center rounded-md bg-positive text-surface">
            <Database aria-hidden="true" size={19} weight="bold" />
            <span className="absolute -right-1 -top-1 size-2.5 rounded-full border-2 border-nav bg-accent" />
          </span>
          <span className="min-w-0">
            <span className="block text-xs font-semibold text-surface">
              Automatic imports
            </span>
            <span className="mt-0.5 block font-mono text-[0.625rem] font-semibold uppercase tracking-[0.12em] text-surface/65">
              Healthy
            </span>
          </span>
        </Link>

        <div className="mt-3 flex items-center gap-3 rounded-md px-1 py-1">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent font-display text-base font-bold text-nav">
            {getInitials(username)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-semibold text-surface">
              {displayName}
            </span>
            <span className="mt-0.5 block font-mono text-[0.625rem] uppercase tracking-[0.12em] text-surface/50">
              Store manager
            </span>
          </span>
          <form action="/auth/signout" method="post">
            <button
              aria-label="Sign out"
              className="flex size-11 items-center justify-center rounded-md text-surface/65 transition-colors hover:bg-surface/10 hover:text-surface"
              title="Sign out"
              type="submit"
            >
              <SignOut aria-hidden="true" size={19} />
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}
