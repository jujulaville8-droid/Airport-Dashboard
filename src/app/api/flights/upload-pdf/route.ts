import { importFlightSchedule } from '@/lib/flight-schedule';
import { deleteFlightMonth, deleteFlightSchedulePDF, getUploadedMonths } from '@/lib/db';
import { recordImportHealthResult } from '@/lib/import-health-log';
import { NextRequest } from 'next/server';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
const SCHEDULE_MONTH_RE = /^\d{4}-\d{2}$/;

export async function POST(request: NextRequest) {
  let attemptedFileName: string | null = null;
  try {
    const formData = await request.formData();
    const fileEntry = formData.get('file');
    const scheduleMonth = formData.get('scheduleMonth') as string; // e.g. "2026-04"

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

    if (!file.name.endsWith('.pdf')) {
      return Response.json({ error: 'File must be a PDF' }, { status: 400 });
    }

    if (!scheduleMonth || !SCHEDULE_MONTH_RE.test(scheduleMonth)) {
      return Response.json(
        { error: 'scheduleMonth is required (YYYY-MM format, e.g. 2026-04)' },
        { status: 400 }
      );
    }

    attemptedFileName = file.name;
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await importFlightSchedule(buffer, scheduleMonth, file.name);
    try {
      await recordImportHealthResult({
        source: 'flight_schedule',
        fileName: file.name,
        success: result.success,
        records: result.totalFlights,
        message: result.errors.join('; ') || null,
      });
    } catch (healthError) {
      console.error(
        '[api/flights/upload-pdf POST] health log failed:',
        healthError,
      );
      return Response.json(
        { error: 'Import result could not be recorded' },
        { status: 500 },
      );
    }

    return Response.json(result, { status: result.success ? 200 : 422 });
  } catch (error) {
    console.error('[api/flights/upload-pdf POST] error:', error);
    if (attemptedFileName) {
      try {
        await recordImportHealthResult({
          source: 'flight_schedule',
          fileName: attemptedFileName,
          success: false,
          records: 0,
          message: error instanceof Error ? error.message : String(error),
        });
      } catch (healthError) {
        console.error(
          '[api/flights/upload-pdf POST] failed to record importer error:',
          healthError,
        );
      }
    }
    return Response.json(
      { success: false, totalFlights: 0, arrivals: 0, departures: 0, error: 'Flight upload failed' },
      { status: 500 }
    );
  }
}

// DELETE a month's flight data
export async function DELETE(request: NextRequest) {
  try {
    const { scheduleMonth } = await request.json();

    if (typeof scheduleMonth !== 'string' || !SCHEDULE_MONTH_RE.test(scheduleMonth)) {
      return Response.json(
        { error: 'scheduleMonth must be YYYY-MM format' },
        { status: 400 }
      );
    }

    await deleteFlightMonth(scheduleMonth);
    // Best-effort cleanup of the stored source PDF. Failure here is logged
    // but doesn't fail the request — the flight rows are already gone.
    try {
      await deleteFlightSchedulePDF(scheduleMonth);
    } catch (pdfErr) {
      console.error('[api/flights/upload-pdf DELETE] PDF cleanup failed:', pdfErr);
    }
    return Response.json({ success: true, deleted: scheduleMonth });
  } catch (error) {
    console.error('[api/flights/upload-pdf DELETE] error:', error);
    return Response.json({ error: 'Failed to delete flight month' }, { status: 500 });
  }
}

// GET list of uploaded months
export async function GET() {
  try {
    const months = await getUploadedMonths();
    return Response.json({ months });
  } catch (error) {
    console.error('[api/flights/upload-pdf GET] error:', error);
    return Response.json({ error: 'Failed to list uploaded months' }, { status: 500 });
  }
}
