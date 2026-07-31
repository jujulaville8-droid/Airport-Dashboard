import { describe, expect, it, vi } from 'vitest';
import { fetchAllSalesPages } from './sales-rows';

describe('fetchAllSalesPages', () => {
  it('paginates beyond a single Supabase page without truncating totals', async () => {
    const loader = vi.fn(async (from: number, to: number) => ({
      data: Array.from({ length: from === 0 ? 1_000 : 250 }, (_, index) => from + index)
        .filter((value) => value <= to),
      error: null,
    }));

    const rows = await fetchAllSalesPages(loader);

    expect(rows).toHaveLength(1_250);
    expect(loader).toHaveBeenCalledWith(0, 999);
    expect(loader).toHaveBeenCalledWith(1_000, 1_999);
  });

  it('propagates a database failure instead of returning partial sales data', async () => {
    await expect(fetchAllSalesPages(async () => ({ data: null, error: new Error('database unavailable') }))).rejects.toThrow('database unavailable');
  });
});
