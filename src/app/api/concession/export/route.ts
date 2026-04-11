import { supabase } from '@/lib/db';
import { NextRequest } from 'next/server';
import * as XLSX from 'xlsx';
import * as path from 'path';
import * as fs from 'fs';

/**
 * GET /api/concession/export?month=YYYY-MM&ccSales=...&cashSales=...
 *
 * Generates the Antigua and Barbuda Airport Authority Concession Calculator
 * spreadsheet, populated with the shop's actual numbers for a given month.
 *
 * Approach:
 *  1. Load the master template from src/lib/templates/concession-template.xlsx
 *  2. Query sales_transactions for the month to get gross sales USD
 *  3. Overwrite the 4 user-input cells (B5 period, B8 gross, B10 CC, B13 cash)
 *  4. Update cached values of the formula cells so the file opens with correct
 *     numbers even on viewers that don't recalc. Formulas themselves are left
 *     intact so the airport can audit the math.
 *  5. Set workbook fullCalcOnLoad = true so Excel recomputes on open anyway.
 *
 * The template lives in src/lib/templates and is treated as a read-only asset.
 * Never mutate the file on disk — always work on an in-memory copy.
 */

const EC_RATE = 2.7;           // USD → ECD
const CC_COMMISSION = 0.04;    // 4% credit card commission
const RENT_PERCENT = 0.10;     // 10% of net sales

// MAG (Minimum Annual Guarantee) — the base rent the airport charges
// regardless of sales. The template ships with an "exclusive of ABST" figure;
// we gross it up by the 13% ABST (Antigua & Barbuda Sales Tax) so the C19
// "Concession Payable" line already reflects what actually has to be remitted.
const MAG_EXCL_ABST = 4198;
const ABST_RATE = 0.13;
const MAG_INCL_ABST = MAG_EXCL_ABST * (1 + ABST_RATE); // 4743.74

/**
 * Convert a YYYY-MM-DD string to an Excel date serial number.
 * Excel counts days from 1899-12-30 (accounting for its 1900 leap year bug
 * which makes 1900-03-01 and later line up with standard date math).
 */
function toExcelDateSerial(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  const target = Date.UTC(y, m - 1, d);
  const epoch = Date.UTC(1899, 11, 30);
  return Math.round((target - epoch) / (24 * 60 * 60 * 1000));
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const month = searchParams.get('month');

    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return Response.json({ error: 'month param required (YYYY-MM)' }, { status: 400 });
    }

    // Parse optional CC/cash with same semantics as /api/concession:
    // null = use defaults (all cash), explicit 0 is respected.
    const parseOptional = (v: string | null): number | null | 'invalid' => {
      if (v === null) return null;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) return 'invalid';
      return n;
    };
    const ccSalesUSDRaw = parseOptional(searchParams.get('ccSales'));
    const cashSalesUSDRaw = parseOptional(searchParams.get('cashSales'));
    if (ccSalesUSDRaw === 'invalid' || cashSalesUSDRaw === 'invalid') {
      return Response.json(
        { error: 'ccSales and cashSales must be non-negative numbers' },
        { status: 400 }
      );
    }

    // Query sales for the month
    const [yearStr, monthStr] = month.split('-');
    const year = parseInt(yearStr, 10);
    const monthNum = parseInt(monthStr, 10);
    const lastDay = new Date(year, monthNum, 0).getDate();
    const monthStart = `${month}-01T00:00:00`;
    const monthEnd = `${month}-${String(lastDay).padStart(2, '0')}T23:59:59`;

    const { data: sales, error } = await supabase
      .from('sales_transactions')
      .select('tot_amt')
      .gte('tkt_dt', monthStart)
      .lte('tkt_dt', monthEnd);

    if (error) throw error;
    if (!sales) {
      throw new Error('Sales query returned null data');
    }

    const grossSalesUSD = sales.reduce((sum, s) => sum + Number(s.tot_amt), 0);

    if (grossSalesUSD === 0) {
      return Response.json(
        { error: `No sales data found for ${month}. Upload a sales report first.` },
        { status: 404 }
      );
    }

    const actualCCSalesUSD = ccSalesUSDRaw ?? 0;
    const actualCashSalesUSD = cashSalesUSDRaw ?? (grossSalesUSD - actualCCSalesUSD);

    // Load the template. Template lives next to this code in src/lib/templates/.
    // In Next.js standalone builds, process.cwd() points at the deployed root,
    // so we resolve relative to it. If this ever moves to a bundled context,
    // we'd switch to fs.readFileSync on an embedded asset — fine for now.
    const templatePath = path.join(
      process.cwd(),
      'src',
      'lib',
      'templates',
      'concession-template.xlsx'
    );

    if (!fs.existsSync(templatePath)) {
      throw new Error(`Concession template not found at ${templatePath}`);
    }

    const templateBuffer = fs.readFileSync(templatePath);
    const wb = XLSX.read(templateBuffer, {
      cellFormula: true,
      cellStyles: true,
      cellNF: true,
    });
    const sheet = wb.Sheets[wb.SheetNames[0]];

    // --- Populate user-input cells ---
    sheet['B5']  = { t: 'n', v: toExcelDateSerial(`${month}-01`) };
    sheet['B8']  = { t: 'n', v: round2(grossSalesUSD) };
    sheet['B10'] = { t: 'n', v: round2(actualCCSalesUSD) };
    sheet['B13'] = { t: 'n', v: round2(actualCashSalesUSD) };

    // --- Precompute cached values for formula cells ---
    // Formulas themselves (sheet['C8'].f etc.) are preserved from the template
    // via the { ...existing, v } spread — except C18 and C19 where we override
    // the template's hardcoded MAG and payable logic (see below).
    const c8 = grossSalesUSD * EC_RATE;
    const c10 = actualCCSalesUSD * EC_RATE;
    const c11 = -(c10 * CC_COMMISSION);
    const c12 = c10 + c11;
    const c13 = actualCashSalesUSD * EC_RATE;
    const c15 = c12 + c13;
    const c17 = c15 * RENT_PERCENT;

    // C18 = MAG inclusive of 13% ABST, shown as a negative credit against
    // percentage rent (matching the template's sign convention). We rewrite
    // this at runtime because the shipped template stores MAG-exclusive of
    // ABST and the airport authority wants the tax-inclusive figure.
    const c18 = -MAG_INCL_ABST;

    // C19 "Concession Payable" = MAX(0, C17 + C18).
    // Percentage rent floors the payable — in low-sales months where rent
    // doesn't exceed MAG, the payable is $0 (MAG is already prepaid), never
    // a negative "refund". We also overwrite the template's C17+C18 formula
    // with a MAX() formula so a user recalculating in Excel gets the same
    // answer our cached value shows.
    const c19 = Math.max(0, c17 + c18);
    const g12 = c8 - c10 - c13;

    sheet['C8'] = { ...sheet['C8'], v: round2(c8) };
    sheet['C10'] = { ...sheet['C10'], v: round2(c10) };
    sheet['C11'] = { ...sheet['C11'], v: round2(c11) };
    sheet['C12'] = { ...sheet['C12'], v: round2(c12) };
    sheet['C13'] = { ...sheet['C13'], v: round2(c13) };
    sheet['C15'] = { ...sheet['C15'], v: round2(c15) };
    sheet['C17'] = { ...sheet['C17'], v: round2(c17) };

    // C18: relabel column A and write the tax-inclusive MAG as a literal
    // negative so Excel/LibreOffice display it correctly without a formula.
    sheet['A18'] = { ...sheet['A18'], t: 's', v: 'Less: MAG (Inclusive of 13% ABST)' };
    sheet['C18'] = { t: 'n', v: round2(c18) };

    // C19: replace the template's `C17+C18` formula with MAX(0, C17+C18)
    // so the file audits correctly if opened and recalculated.
    sheet['C19'] = { t: 'n', f: 'MAX(0, C17+C18)', v: round2(c19) };

    sheet['G12'] = { ...sheet['G12'], v: round2(g12) };

    // Tell Excel / LibreOffice to force a full recalc when the file opens.
    // Belt-and-suspenders with the precomputed cached values above.
    // (The xlsx library's WBProps type doesn't expose CalcPr, but the writer
    // respects it at runtime.)
    const wbExt = wb as unknown as {
      Workbook?: { CalcPr?: { fullCalcOnLoad?: boolean } };
    };
    if (!wbExt.Workbook) wbExt.Workbook = {};
    if (!wbExt.Workbook.CalcPr) wbExt.Workbook.CalcPr = {};
    wbExt.Workbook.CalcPr.fullCalcOnLoad = true;

    const outBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    const filename = `Tailors-Daughter-Concession-${month}.xlsx`;

    // Copy into a fresh ArrayBuffer to satisfy TS's strict BlobPart typing
    // (Node's Buffer sits on top of a union-typed ArrayBufferLike which TS
    // refuses to pass directly to Blob in strict mode).
    const copy = new ArrayBuffer(outBuffer.byteLength);
    new Uint8Array(copy).set(outBuffer);
    const blob = new Blob([copy], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    return new Response(blob, {
      status: 200,
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('[api/concession/export] error:', error);
    return Response.json({ error: 'Failed to generate concession export' }, { status: 500 });
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
