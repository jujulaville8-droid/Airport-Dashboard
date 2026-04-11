import { importInventorySnapshot } from '@/lib/counterpoint-inventory';
import { NextRequest } from 'next/server';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * POST /api/inventory/snapshot
 *
 * Accepts a Counterpoint Inventory Valuation / Stock On Hand XLS/XLSX and
 * writes a point-in-time snapshot into inventory_snapshots. Upserts
 * item_master with latest unit_cost.
 *
 * Form fields:
 *   - file: xls/xlsx (required)
 *   - snapshotDate: YYYY-MM-DD (optional, defaults to today) — use when
 *     backfilling a snapshot from a prior date.
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const fileEntry = formData.get('file');
    const snapshotDateRaw = formData.get('snapshotDate');

    if (!(fileEntry instanceof File)) {
      return Response.json({ error: 'No file provided' }, { status: 400 });
    }
    const file = fileEntry;

    if (file.size === 0) {
      return Response.json({ error: 'File is empty' }, { status: 400 });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return Response.json(
        { error: `File exceeds ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB limit` },
        { status: 413 }
      );
    }

    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!['xls', 'xlsx', 'csv'].includes(ext || '')) {
      return Response.json({ error: 'File must be .xls, .xlsx, or .csv' }, { status: 400 });
    }

    let snapshotDate: string | undefined;
    if (typeof snapshotDateRaw === 'string' && snapshotDateRaw.trim()) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDateRaw)) {
        return Response.json({ error: 'snapshotDate must be YYYY-MM-DD' }, { status: 400 });
      }
      snapshotDate = snapshotDateRaw;
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await importInventorySnapshot(buffer, file.name, snapshotDate);

    return Response.json(result, { status: result.success ? 200 : 422 });
  } catch (error) {
    console.error('[api/inventory/snapshot] error:', error);
    return Response.json({ error: 'Inventory snapshot import failed' }, { status: 500 });
  }
}
