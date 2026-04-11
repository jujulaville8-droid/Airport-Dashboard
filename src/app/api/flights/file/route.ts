import { NextRequest } from 'next/server';
import { getFlightSchedulePDFMeta, getFlightSchedulePDFSignedUrl } from '@/lib/db';

const SCHEDULE_MONTH_RE = /^\d{4}-\d{2}$/;

/**
 * GET /api/flights/file?month=YYYY-MM
 *
 * Returns metadata + a short-lived signed URL for the stored flight schedule
 * PDF for the given month. The URL expires in 5 minutes — long enough to
 * open in an <embed> preview on the flights page but not long enough to be
 * useful if shared. The response does NOT stream the PDF itself; the client
 * fetches it directly from Supabase Storage via the signed URL.
 *
 * Returns 404 if no file is on record for the month (e.g., the month was
 * imported before PDF persistence was added).
 */
export async function GET(request: NextRequest) {
  try {
    const month = request.nextUrl.searchParams.get('month');
    if (!month || !SCHEDULE_MONTH_RE.test(month)) {
      return Response.json(
        { error: 'month query param required (YYYY-MM format)' },
        { status: 400 }
      );
    }

    const meta = await getFlightSchedulePDFMeta(month);
    if (!meta) {
      return Response.json(
        { error: 'No PDF on record for this month — re-upload to view' },
        { status: 404 }
      );
    }

    const signedUrl = await getFlightSchedulePDFSignedUrl(month);
    if (!signedUrl) {
      return Response.json({ error: 'Failed to generate signed URL' }, { status: 500 });
    }

    return Response.json({
      month,
      fileName: meta.fileName,
      fileSize: meta.fileSize,
      uploadedAt: meta.uploadedAt,
      signedUrl,
    });
  } catch (err) {
    console.error('[api/flights/file] error:', err);
    return Response.json({ error: 'Failed to fetch flight schedule PDF' }, { status: 500 });
  }
}
