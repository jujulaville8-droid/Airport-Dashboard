import { importItemSales } from '@/lib/counterpoint-items';
import { recordImportHealthResult } from '@/lib/import-health-log';
import { NextRequest } from 'next/server';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * POST /api/items/import
 *
 * Accepts a Counterpoint Item Sales Analysis XLS/XLSX and writes per-item
 * sales rows into sales_line_items, plus upserts item_master catalog entries.
 *
 * Form fields:
 *   - file: xls/xlsx (required)
 *   - date: YYYY-MM-DD (optional) — used when the report rows don't include
 *     a ticket date column; defaults to today.
 */
export async function POST(request: NextRequest) {
  let attemptedFileName: string | null = null;
  try {
    const formData = await request.formData();
    const fileEntry = formData.get('file');
    const dateRaw = formData.get('date');

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

    let date: string | undefined;
    if (typeof dateRaw === 'string' && dateRaw.trim()) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) {
        return Response.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
      }
      date = dateRaw;
    }

    attemptedFileName = file.name;
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await importItemSales(buffer, file.name, date);
    try {
      await recordImportHealthResult({
        source: 'item_sales',
        fileName: file.name,
        success: result.success,
        records: result.rowsParsed,
        message: result.errors.join('; ') || null,
      });
    } catch (healthError) {
      console.error('[api/items/import] health log failed:', healthError);
      return Response.json(
        { error: 'Import result could not be recorded' },
        { status: 500 },
      );
    }

    return Response.json(result, { status: result.success ? 200 : 422 });
  } catch (error) {
    console.error('[api/items/import] error:', error);
    if (attemptedFileName) {
      try {
        await recordImportHealthResult({
          source: 'item_sales',
          fileName: attemptedFileName,
          success: false,
          records: 0,
          message: error instanceof Error ? error.message : String(error),
        });
      } catch (healthError) {
        console.error(
          '[api/items/import] failed to record importer error:',
          healthError,
        );
      }
    }
    return Response.json({ error: 'Item sales import failed' }, { status: 500 });
  }
}
