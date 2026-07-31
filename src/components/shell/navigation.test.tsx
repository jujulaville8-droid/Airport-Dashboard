import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { DesktopSidebar } from './DesktopSidebar';
import { MobileNavigation } from './MobileNavigation';
import { DESKTOP_NAV, MOBILE_NAV } from './navigation';

afterEach(cleanup);

describe('dashboard navigation', () => {
  it('groups desktop destinations by the manager mental model', () => {
    render(
      <DesktopSidebar pathname="/dashboard/inventory" username="admin" />,
    );

    expect(screen.getByText('Commerce')).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Inventory' }),
    ).toHaveAttribute('aria-current', 'page');
    expect(
      screen.getByRole('link', { name: /imports healthy/i }),
    ).toHaveAttribute('href', '/dashboard/connections');
  });

  it('exports the exact approved desktop groups and destinations', () => {
    expect(DESKTOP_NAV).toEqual([
      {
        label: 'Today',
        items: [{ href: '/dashboard', label: 'Overview' }],
      },
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
        items: [
          { href: '/dashboard/concession', label: 'Concession' },
        ],
      },
    ]);
  });

  it('keeps exactly five primary mobile destinations', () => {
    render(<MobileNavigation pathname="/dashboard" />);

    expect(MOBILE_NAV.map(({ label }) => label)).toEqual([
      'Today',
      'Sales',
      'Stock',
      'Flights',
      'More',
    ]);
    expect(screen.getAllByRole('link')).toHaveLength(5);
    expect(screen.getByRole('link', { name: 'Today' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'More' })).toBeVisible();
  });

  it('marks nested routes active and treats secondary mobile routes as More', () => {
    const { rerender } = render(
      <MobileNavigation pathname="/dashboard/inventory/item-1" />,
    );

    expect(screen.getByRole('link', { name: 'Stock' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    rerender(<MobileNavigation pathname="/dashboard/schedules" />);

    expect(screen.getByRole('link', { name: 'More' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('opens an accessible More sheet with manager actions', async () => {
    const user = userEvent.setup();
    render(<MobileNavigation pathname="/dashboard" />);

    await user.click(screen.getByRole('link', { name: 'More' }));

    const sheet = screen.getByRole('dialog', {
      name: 'More dashboard destinations',
    });
    expect(sheet).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Schedules' }),
    ).toHaveAttribute('href', '/dashboard/schedules');
    expect(
      screen.getByRole('link', { name: 'Concession' }),
    ).toHaveAttribute('href', '/dashboard/concession');
    expect(
      screen.getByRole('link', { name: 'Data Connections' }),
    ).toHaveAttribute('href', '/dashboard/connections');

    const signOut = screen.getByRole('button', { name: 'Sign out' });
    expect(signOut.closest('form')).toHaveAttribute('action', '/auth/signout');
    expect(signOut.closest('form')).toHaveAttribute('method', 'post');

    await waitFor(() => {
      expect(
        screen.getByRole('link', { name: 'Schedules' }),
      ).toHaveFocus();
    });
  });

  it('traps sheet focus, closes on Escape, and restores the trigger', async () => {
    const user = userEvent.setup();
    render(<MobileNavigation pathname="/dashboard" />);

    const more = screen.getByRole('link', { name: 'More' });
    await user.click(more);

    const close = screen.getByRole('button', { name: 'Close more menu' });
    const signOut = screen.getByRole('button', { name: 'Sign out' });

    signOut.focus();
    await user.tab();
    expect(close).toHaveFocus();

    await user.tab({ shift: true });
    expect(signOut).toHaveFocus();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(more).toHaveFocus();
  });
});
