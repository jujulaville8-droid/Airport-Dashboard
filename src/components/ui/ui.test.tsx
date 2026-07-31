import { readFileSync } from 'node:fs';
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

const globalStyles = readFileSync('src/app/globals.css', 'utf8');

afterEach(cleanup);

function colorToken(token: string): string {
  const match = globalStyles.match(
    new RegExp(`--color-${token}:\\s*(#[0-9A-Fa-f]{6});`),
  );
  if (!match?.[1]) throw new Error(`Missing color token: ${token}`);
  return match[1];
}

function relativeLuminance(hex: string): number {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)
    ?.map((channel) => Number.parseInt(channel, 16) / 255);
  if (!channels || channels.length !== 3) return 0;

  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(first: string, second: string): number {
  const [lighter, darker] = [
    relativeLuminance(first),
    relativeLuminance(second),
  ].sort((left, right) => right - left);
  return (lighter + 0.05) / (darker + 0.05);
}

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
  it.each([
    ['brand-cream', 'app-bg'],
    ['brand-linen', 'surface'],
    ['brand-black', 'ink'],
    ['brand-wood', 'muted'],
    ['brand-gold', 'accent'],
    ['brand-teal', 'positive'],
  ])(
    'keeps the temporary %s utility mapped to semantic %s',
    (legacyToken, semanticToken) => {
      expect(globalStyles).toContain(
        `--color-${legacyToken}: var(--color-${semanticToken});`,
      );
    },
  );

  it('uses a three-to-one Terminal Navy focus boundary plus amber cue', () => {
    expect(globalStyles).toMatch(
      /:focus-visible\s*{[\s\S]*?outline:\s*0\.125rem solid var\(--color-nav\)\s*!important;[\s\S]*?box-shadow:\s*0 0 0 0\.25rem var\(--color-accent\)\s*!important;/,
    );
    expect(
      contrastRatio(colorToken('nav'), colorToken('surface')),
    ).toBeGreaterThanOrEqual(3);
    expect(
      contrastRatio(colorToken('nav'), colorToken('app-bg')),
    ).toBeGreaterThanOrEqual(3);

    render(
      <>
        <Button>Refresh data</Button>
        <DetailDrawer
          open
          title="Silk airport scarf"
          onClose={() => {}}
        >
          Eight units on hand
        </DetailDrawer>
      </>,
    );

    expect(screen.getByRole('button', { name: 'Refresh data' })).toHaveClass(
      'terminal-focus',
    );
    expect(screen.getByRole('button', { name: 'Close details' })).toHaveClass(
      'terminal-focus',
    );
  });

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

  it('wraps confirmation Tab order around hidden and programmatic-only descendants', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">Before confirmation</button>
        <ConfirmDialog
          open
          title="Clear schedule?"
          description="This removes seven days."
          confirmLabel="Clear schedule"
          onConfirm={() => {}}
          onClose={() => {}}
        />
        <button type="button">After confirmation</button>
      </>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Clear schedule?' });
    const hiddenStart = document.createElement('button');
    hiddenStart.hidden = true;
    hiddenStart.textContent = 'Hidden start';
    const programmaticStart = document.createElement('button');
    programmaticStart.tabIndex = -1;
    programmaticStart.textContent = 'Programmatic start';
    const hiddenEnd = hiddenStart.cloneNode(true);
    const programmaticEnd = programmaticStart.cloneNode(true);
    dialog.prepend(hiddenStart, programmaticStart);
    dialog.append(hiddenEnd, programmaticEnd);

    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const confirm = screen.getByRole('button', { name: 'Clear schedule' });
    confirm.focus();
    await user.tab();
    expect(cancel).toHaveFocus();

    cancel.focus();
    await user.tab({ shift: true });
    expect(confirm).toHaveFocus();
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

  it('wraps drawer Tab order around hidden and programmatic-only descendants', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">Before details</button>
        <DetailDrawer
          open
          title="Silk airport scarf"
          onClose={() => {}}
        >
          <button type="button">Edit reorder rules</button>
          <button hidden type="button">
            Hidden action
          </button>
          <span style={{ display: 'none' }}>
            <button type="button">CSS-hidden action</button>
          </span>
          <button tabIndex={-1} type="button">
            Programmatic action
          </button>
        </DetailDrawer>
        <button type="button">After details</button>
      </>,
    );

    const close = screen.getByRole('button', { name: 'Close details' });
    const edit = screen.getByRole('button', { name: 'Edit reorder rules' });
    edit.focus();
    await user.tab();
    expect(close).toHaveFocus();

    close.focus();
    await user.tab({ shift: true });
    expect(edit).toHaveFocus();
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
