import { useState } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Badge } from './Badge';
import { Button } from './Button';
import { ConfirmDialog } from './ConfirmDialog';
import {
  EmptyState,
  ErrorState,
  FreshnessIndicator,
  LoadingState,
} from './DataState';
import { DetailDrawer } from './DetailDrawer';
import { Metric } from './Metric';
import { PageHeader } from './PageHeader';
import { Panel } from './Panel';

afterEach(cleanup);

function ConfirmDialogHarness() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open confirmation
      </button>
      <ConfirmDialog
        open={open}
        title="Clear schedule?"
        description="This removes seven days."
        confirmLabel="Clear schedule"
        onConfirm={() => {}}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

function DetailDrawerHarness() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open item details
      </button>
      <DetailDrawer
        open={open}
        title="Silk airport scarf"
        description="Inventory detail"
        onClose={() => setOpen(false)}
      >
        <p>Eight units on hand</p>
      </DetailDrawer>
    </>
  );
}

describe('shared operational UI', () => {
  it('pairs stale color with visible text', () => {
    render(
      <FreshnessIndicator
        freshness={{
          kind: 'stale',
          updatedAt: '2026-07-30T10:00:00Z',
          minutesOld: 180,
        }}
      />,
    );
    expect(screen.getByText(/stale/i)).toBeVisible();
  });

  it('labels current and missing freshness without relying on color', () => {
    const { rerender } = render(
      <FreshnessIndicator
        freshness={{
          kind: 'current',
          updatedAt: '2026-07-30T12:00:00Z',
          minutesOld: 12,
        }}
      />,
    );
    expect(screen.getByText(/current/i)).toBeVisible();

    rerender(<FreshnessIndicator freshness={{ kind: 'missing' }} />);
    expect(screen.getByText(/not received/i)).toBeVisible();
  });

  it('exposes the recovery action for an error', async () => {
    const retry = vi.fn();
    render(
      <ErrorState
        title="Sales import failed"
        message="Workbook could not be parsed."
        actionLabel="Open recovery"
        onAction={retry}
      />,
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Open recovery' }),
    );
    expect(retry).toHaveBeenCalledOnce();
  });

  it('announces loading and exposes a guided empty-state action', async () => {
    const connect = vi.fn();
    const { rerender } = render(<LoadingState label="Loading sales" />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading sales');

    rerender(
      <EmptyState
        title="No sales report"
        message="Connect Gmail to receive daily reports."
        actionLabel="Open connections"
        onAction={connect}
      />,
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Open connections' }),
    );
    expect(connect).toHaveBeenCalledOnce();
  });

  it('requires an explicit destructive confirmation', async () => {
    const confirm = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Clear schedule?"
        description="This removes seven days."
        confirmLabel="Clear schedule"
        onConfirm={confirm}
        onClose={() => {}}
      />,
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Clear schedule' }),
    );
    expect(confirm).toHaveBeenCalledOnce();
  });

  it('cancels without confirming', async () => {
    const confirm = vi.fn();
    const close = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Clear schedule?"
        description="This removes seven days."
        confirmLabel="Clear schedule"
        onConfirm={confirm}
        onClose={close}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(close).toHaveBeenCalledOnce();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('closes a confirmation on Escape and restores trigger focus', async () => {
    const user = userEvent.setup();
    render(<ConfirmDialogHarness />);

    const trigger = screen.getByRole('button', {
      name: 'Open confirmation',
    });
    await user.click(trigger);

    expect(
      screen.getByRole('dialog', { name: 'Clear schedule?' }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('keeps confirmation focus stable across a parent rerender', () => {
    const baseProps = {
      open: true,
      title: 'Clear schedule?',
      description: 'This removes seven days.',
      confirmLabel: 'Clear schedule',
      onConfirm: () => {},
    };
    const { rerender } = render(
      <ConfirmDialog {...baseProps} onClose={() => {}} />,
    );
    screen.getByRole('button', { name: 'Clear schedule' }).focus();

    rerender(<ConfirmDialog {...baseProps} onClose={() => {}} />);

    expect(
      screen.getByRole('button', { name: 'Clear schedule' }),
    ).toHaveFocus();
  });

  it('exposes the drawer as a labelled dialog and restores trigger focus', async () => {
    const user = userEvent.setup();
    render(<DetailDrawerHarness />);

    const trigger = screen.getByRole('button', {
      name: 'Open item details',
    });
    await user.click(trigger);

    expect(
      screen.getByRole('dialog', { name: 'Silk airport scarf' }),
    ).toHaveTextContent('Eight units on hand');

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('keeps drawer focus stable across a parent rerender', () => {
    const baseProps = {
      open: true,
      title: 'Silk airport scarf',
      description: 'Inventory detail',
      children: <button type="button">Edit reorder rules</button>,
    };
    const { rerender } = render(
      <DetailDrawer {...baseProps} onClose={() => {}} />,
    );
    screen.getByRole('button', { name: 'Edit reorder rules' }).focus();

    rerender(<DetailDrawer {...baseProps} onClose={() => {}} />);

    expect(
      screen.getByRole('button', { name: 'Edit reorder rules' }),
    ).toHaveFocus();
  });

  it('renders the static primitives with operational semantics', () => {
    render(
      <>
        <Button>Refresh data</Button>
        <Badge tone="positive">Current</Badge>
        <PageHeader
          eyebrow="Today · ANU"
          title="Operations brief"
          description="The next passenger window starts at 14:20."
          actions={<button type="button">Choose date</button>}
        />
        <Metric label="Revenue" value="$8,420" detail="12% above pace" />
        <Panel title="Upcoming traffic" description="Next three movements">
          Flight LI 362
        </Panel>
      </>,
    );

    expect(screen.getByRole('button', { name: 'Refresh data' })).toHaveAttribute(
      'type',
      'button',
    );
    expect(screen.getByText('Current')).toBeVisible();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Operations brief' }),
    ).toBeVisible();
    expect(screen.getByText('$8,420')).toBeVisible();
    expect(
      screen.getByRole('region', { name: 'Upcoming traffic' }),
    ).toHaveTextContent('Flight LI 362');
  });
});
