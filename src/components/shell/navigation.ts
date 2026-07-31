export const DESKTOP_NAV = [
  { label: 'Today', items: [{ href: '/dashboard', label: 'Overview' }] },
  {
    label: 'Commerce',
    items: [
      { href: '/dashboard/sales', label: 'Sales' },
      { href: '/dashboard/inventory', label: 'Inventory' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { href: '/dashboard/flights', label: 'Flights' },
      { href: '/dashboard/schedules', label: 'Schedules' },
    ],
  },
  {
    label: 'Finance',
    items: [{ href: '/dashboard/concession', label: 'Concession' }],
  },
] as const;

export const MOBILE_NAV = [
  { href: '/dashboard', label: 'Today' },
  { href: '/dashboard/sales', label: 'Sales' },
  { href: '/dashboard/inventory', label: 'Stock' },
  { href: '/dashboard/flights', label: 'Flights' },
  { href: '#dashboard-more-menu', label: 'More' },
] as const;

export const MOBILE_MORE_HREFS = [
  '/dashboard/schedules',
  '/dashboard/concession',
  '/dashboard/connections',
] as const;

export function isNavigationItemActive(pathname: string, href: string) {
  if (href === '/dashboard') {
    return pathname === href;
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

export function isMobileMoreActive(pathname: string) {
  return MOBILE_MORE_HREFS.some((href) =>
    isNavigationItemActive(pathname, href),
  );
}
