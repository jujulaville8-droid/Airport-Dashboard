import { computeRiskSummary } from '@/lib/inventory-analytics';

/**
 * GET /api/inventory/risk
 *
 * Returns the full stockout / dead-stock / overstock risk summary grouped
 * by class. Optional query param:
 *   - window: velocity averaging window in days (default 14)
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const windowRaw = url.searchParams.get('window');
    const velocityWindow = windowRaw ? parseInt(windowRaw, 10) : 14;
    if (!Number.isFinite(velocityWindow) || velocityWindow < 1 || velocityWindow > 90) {
      return Response.json({ error: 'window must be 1-90 days' }, { status: 400 });
    }

    const result = await computeRiskSummary(velocityWindow);
    return Response.json({
      ...result,
      snapshotDate: result.summary.snapshotDate,
      salesWindow: velocityWindow,
      updatedAt: result.summary.snapshotDate,
    });
  } catch (error) {
    console.error('[api/inventory/risk] error:', error);
    return Response.json({ error: 'Failed to compute inventory risk' }, { status: 500 });
  }
}
