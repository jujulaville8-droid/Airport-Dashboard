// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { importSourceForAttachment } from './gmail-inbox';

describe('importSourceForAttachment', () => {
  it('maps every routed Gmail result to its normalized health source', () => {
    expect(importSourceForAttachment('sales_monthly')).toBe('sales');
    expect(importSourceForAttachment('sales_daily')).toBe('sales');
    expect(importSourceForAttachment('item_sales')).toBe('item_sales');
    expect(importSourceForAttachment('inventory_snapshot')).toBe('inventory');
    expect(importSourceForAttachment('flight_schedule')).toBe('flight_schedule');
    expect(importSourceForAttachment('carrier_capacity')).toBe('passenger_summary');
    expect(importSourceForAttachment('unknown')).toBeNull();
  });
});
