import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InventoryPage } from './InventoryPage';
import { ReorderRuleForm } from './ReorderRuleForm';
import type { InventoryRisk } from './types';

afterEach(cleanup);

const fixture: InventoryRisk = { asOf: '2026-07-30', snapshotDate: '2026-07-30', salesWindow: 14, updatedAt: '2026-07-30', critical: [{ itemNo: 'SKU-100', descr: 'Travel adapter', category: 'Electronics', qtyOnHand: 2, unitCost: 15, totalValue: 30, velocityPerDay: 3, daysOfCover: 0.7, lastSaleDate: '2026-07-30', risk: 'CRITICAL', reorder: { min: 5, reorderPoint: 10, max: 40, leadTimeDays: 14 } }], atRisk: [], healthy: [], deadStock: [], overstocked: [], summary: { criticalCount: 1, atRiskCount: 0, deadStockCount: 0, deadStockValue: 0, overstockedCount: 0, totalSkusTracked: 1, totalInventoryValue: 30, snapshotDate: '2026-07-30' } };

describe('Inventory action center', () => {
  it('opens a critical item in a labelled detail drawer', async () => {
    render(<InventoryPage initialRisk={fixture} />);
    await userEvent.click(screen.getByRole('button', { name: /open SKU-100/i }));
    expect(screen.getByRole('dialog', { name: 'SKU-100 inventory details' })).toBeVisible();
  });
  it('rejects a reorder point below minimum stock', async () => {
    render(<ReorderRuleForm value={{ minStock: 10, reorderPoint: 12, maxStock: 30, leadTimeDays: 14 }} onSave={vi.fn()} />);
    await userEvent.clear(screen.getByLabelText('Reorder point'));
    await userEvent.type(screen.getByLabelText('Reorder point'), '5');
    await userEvent.click(screen.getByRole('button', { name: 'Save rule' }));
    expect(screen.getByText('Reorder point must be at least the minimum stock')).toBeVisible();
  });
});
