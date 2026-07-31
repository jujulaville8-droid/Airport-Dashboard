'use client';

import {
  AirplaneTilt,
  CalendarBlank,
  CurrencyDollar,
  Database,
  DotsThree,
  Package,
  Receipt,
  SignOut,
  SquaresFour,
  X,
  type Icon,
} from '@phosphor-icons/react';
import Link from 'next/link';
import {
  type KeyboardEvent,
  type MouseEvent,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  isMobileMoreActive,
  isNavigationItemActive,
  MOBILE_NAV,
} from './navigation';

const MOBILE_ICONS: Record<string, Icon> = {
  Today: SquaresFour,
  Sales: Receipt,
  Stock: Package,
  Flights: AirplaneTilt,
  More: DotsThree,
};

const MORE_ITEMS = [
  {
    href: '/dashboard/schedules',
    label: 'Schedules',
    description: 'Plan coverage around passenger traffic',
    icon: CalendarBlank,
  },
  {
    href: '/dashboard/concession',
    label: 'Concession',
    description: 'Review airport fees and monthly reporting',
    icon: CurrencyDollar,
  },
  {
    href: '/dashboard/connections',
    label: 'Data Connections',
    description: 'Check import health and recovery tools',
    icon: Database,
  },
] as const;

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const DESKTOP_MEDIA_QUERY = '(min-width: 48rem)';

function isHiddenFromFocus(element: HTMLElement) {
  let current: HTMLElement | null = element;

  while (current) {
    const style = window.getComputedStyle(current);

    if (
      current.hidden ||
      current.hasAttribute('inert') ||
      current.getAttribute('aria-hidden') === 'true' ||
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.visibility === 'collapse'
    ) {
      return true;
    }

    current = current.parentElement;
  }

  return false;
}

function getFocusableElements(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter(
    (element) =>
      element.tabIndex >= 0 && !isHiddenFromFocus(element),
  );
}

export interface MobileNavigationProps {
  pathname: string;
}

export function MobileNavigation({ pathname }: MobileNavigationProps) {
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const moreTriggerRef = useRef<HTMLAnchorElement>(null);
  const sheetRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const desktopMediaQuery = window.matchMedia?.(DESKTOP_MEDIA_QUERY);

    if (!desktopMediaQuery) {
      return;
    }

    function closeAtDesktop(event: MediaQueryListEvent) {
      if (event.matches) {
        setIsMoreOpen(false);
      }
    }

    desktopMediaQuery.addEventListener('change', closeAtDesktop);

    return () => {
      desktopMediaQuery.removeEventListener('change', closeAtDesktop);
    };
  }, []);

  useEffect(() => {
    if (!isMoreOpen || !sheetRef.current) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const sheet = sheetRef.current;
    const trigger = moreTriggerRef.current;
    const desktopMediaQuery = window.matchMedia?.(DESKTOP_MEDIA_QUERY);
    const [, firstDestination] = getFocusableElements(sheet);

    document.body.style.overflow = 'hidden';
    firstDestination?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;

      if (desktopMediaQuery?.matches) {
        document.getElementById('dashboard-content')?.focus();
      } else {
        trigger?.focus();
      }
    };
  }, [isMoreOpen]);

  function openMore(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    setIsMoreOpen(true);
  }

  function closeMore() {
    setIsMoreOpen(false);
  }

  function handleSheetKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMore();
      return;
    }

    if (event.key !== 'Tab' || !sheetRef.current) {
      return;
    }

    const focusableElements = getFocusableElements(sheetRef.current);
    const first = focusableElements[0];
    const last = focusableElements.at(-1);

    if (!first || !last) {
      event.preventDefault();
      return;
    }

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <>
      <nav
        aria-label="Primary dashboard"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-0.5rem_1.5rem] shadow-nav/10 backdrop-blur md:hidden"
      >
        <ul className="grid grid-cols-5 px-1 py-1.5">
          {MOBILE_NAV.map((item) => {
            const active =
              item.label === 'More'
                ? isMobileMoreActive(pathname)
                : isNavigationItemActive(pathname, item.href);
            const ItemIcon = MOBILE_ICONS[item.label];
            const commonProps = {
              'aria-current': active ? ('page' as const) : undefined,
              className: [
                'relative flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-md px-1',
                'text-[0.625rem] font-semibold leading-4 transition-colors duration-150',
                active ? 'text-nav' : 'text-muted hover:bg-app-bg hover:text-ink',
              ].join(' '),
            };

            return (
              <li key={item.label}>
                {item.label === 'More' ? (
                  <a
                    {...commonProps}
                    aria-controls="dashboard-more-menu"
                    aria-expanded={isMoreOpen}
                    aria-haspopup="dialog"
                    href={item.href}
                    onClick={openMore}
                    ref={moreTriggerRef}
                  >
                    <span
                      aria-hidden="true"
                      className={[
                        'absolute inset-x-4 -top-1.5 h-0.5 rounded-full',
                        active ? 'bg-accent' : 'bg-transparent',
                      ].join(' ')}
                    />
                    <ItemIcon
                      aria-hidden="true"
                      size={21}
                      weight={active ? 'fill' : 'regular'}
                    />
                    {item.label}
                  </a>
                ) : (
                  <Link {...commonProps} href={item.href}>
                    <span
                      aria-hidden="true"
                      className={[
                        'absolute inset-x-4 -top-1.5 h-0.5 rounded-full',
                        active ? 'bg-accent' : 'bg-transparent',
                      ].join(' ')}
                    />
                    <ItemIcon
                      aria-hidden="true"
                      size={21}
                      weight={active ? 'fill' : 'regular'}
                    />
                    {item.label}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </nav>

      {isMoreOpen ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            aria-label="Dismiss more menu"
            className="terminal-overlay-in absolute inset-0 size-full bg-nav/55 backdrop-blur-[1px]"
            onClick={closeMore}
            type="button"
          />
          <aside
            aria-labelledby="dashboard-more-title"
            aria-modal="true"
            className="terminal-dialog-in absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] shadow-2xl"
            id="dashboard-more-menu"
            onKeyDown={handleSheetKeyDown}
            ref={sheetRef}
            role="dialog"
          >
            <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-line" />
            <header className="flex items-start justify-between gap-4 border-b border-line px-5 pb-4 pt-3">
              <div>
                <p className="font-mono text-[0.625rem] font-semibold uppercase tracking-[0.16em] text-muted">
                  Manager tools
                </p>
                <h2
                  className="mt-1 font-display text-2xl font-semibold leading-none text-ink"
                  id="dashboard-more-title"
                >
                  More dashboard destinations
                </h2>
              </div>
              <button
                aria-label="Close more menu"
                className="flex size-11 shrink-0 items-center justify-center rounded-md border border-line text-ink transition-colors hover:bg-app-bg"
                onClick={closeMore}
                type="button"
              >
                <X aria-hidden="true" size={20} />
              </button>
            </header>

            <nav aria-label="More dashboard destinations" className="p-3">
              <ul className="space-y-1">
                {MORE_ITEMS.map((item) => {
                  const active = isNavigationItemActive(pathname, item.href);
                  const ItemIcon = item.icon;

                  return (
                    <li key={item.href}>
                      <Link
                        aria-current={active ? 'page' : undefined}
                        aria-label={item.label}
                        className={[
                          'flex min-h-16 items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors',
                          active
                            ? 'border-accent bg-accent/10'
                            : 'border-transparent hover:border-line hover:bg-app-bg',
                        ].join(' ')}
                        href={item.href}
                        onClick={closeMore}
                      >
                        <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-nav text-surface">
                          <ItemIcon aria-hidden="true" size={20} />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-ink">
                            {item.label}
                          </span>
                          <span className="mt-0.5 block text-xs leading-4 text-muted">
                            {item.description}
                          </span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>

            <form
              action="/auth/signout"
              className="border-t border-line px-3 pb-3 pt-2"
              method="post"
            >
              <button
                className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-sm font-semibold text-danger transition-colors hover:bg-danger/10"
                type="submit"
              >
                <SignOut aria-hidden="true" size={20} />
                Sign out
              </button>
            </form>
          </aside>
        </div>
      ) : null}
    </>
  );
}
