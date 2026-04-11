import { importSalesReport, importDailySalesReport } from '@/lib/counterpoint';
import { NextRequest } from 'next/server';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

export async function POST(request: NextRequest) {
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

    const buffer = Buffer.from(await file.arrayBuffer());

    if (type === 'daily') {
      const result = await importDailySalesReport(buffer, file.name);
      return Response.json(result, { status: result.success ? 200 : 422 });
    }

    const result = await importSalesReport(buffer, file.name);
    return Response.json(result, { status: result.success ? 200 : 422 });
  } catch (error) {
    console.error('[api/sales/import] error:', error);
    return Response.json(
      { error: 'Import failed' },
      { status: 500 }
    );
  }
}
