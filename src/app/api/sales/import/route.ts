import { importSalesReport, importDailySalesReport } from '@/lib/counterpoint';
import { recordImportHealthResult } from '@/lib/import-health-log';
import { NextRequest } from 'next/server';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

export async function POST(request: NextRequest) {
  let attemptedFileName: string | null = null;
  try {
    const formData = await request.formData();
    const fileEntry = formData.get('file');
    const type = (formData.get('type') as string) || 'monthly'; // 'daily' or 'monthly'

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

    attemptedFileName = file.name;
    const buffer = Buffer.from(await file.arrayBuffer());

    if (type === 'daily') {
      const result = await importDailySalesReport(buffer, file.name);
      try {
        await recordImportHealthResult({
          source: 'sales',
          fileName: file.name,
          success: result.success,
          records: result.date ? 1 : 0,
          message: result.errors.join('; ') || null,
        });
      } catch (healthError) {
        console.error('[api/sales/import] health log failed:', healthError);
        return Response.json(
          { error: 'Import result could not be recorded' },
          { status: 500 },
        );
      }
      return Response.json(result, { status: result.success ? 200 : 422 });
    }

    const result = await importSalesReport(buffer, file.name);
    try {
      await recordImportHealthResult({
        source: 'sales',
        fileName: file.name,
        success: result.success,
        records: result.totalDays,
        message: result.errors.join('; ') || null,
      });
    } catch (healthError) {
      console.error('[api/sales/import] health log failed:', healthError);
      return Response.json(
        { error: 'Import result could not be recorded' },
        { status: 500 },
      );
    }
    return Response.json(result, { status: result.success ? 200 : 422 });
  } catch (error) {
    console.error('[api/sales/import] error:', error);
    if (attemptedFileName) {
      try {
        await recordImportHealthResult({
          source: 'sales',
          fileName: attemptedFileName,
          success: false,
          records: 0,
          message: error instanceof Error ? error.message : String(error),
        });
      } catch (healthError) {
        console.error(
          '[api/sales/import] failed to record importer error:',
          healthError,
        );
      }
    }
    return Response.json(
      { error: 'Import failed' },
      { status: 500 }
    );
  }
}
