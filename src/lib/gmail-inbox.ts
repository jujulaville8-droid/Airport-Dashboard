import { google, gmail_v1 } from 'googleapis';
import { importSalesReport, importDailySalesReport } from './counterpoint';
import { importItemSales } from './counterpoint-items';
import { importInventorySnapshot } from './counterpoint-inventory';
import { importFlightSchedule } from './flight-schedule';
import { importCarrierCapacityEmail } from './carrier-capacity-importer';
import { logImport } from './db';

/**
 * Gmail inbox watcher — auto-ingests Counterpoint + airport reports.
 *
 * Runs on a schedule (see src/app/api/cron/inbox/route.ts). Scans the
 * configured Gmail mailbox for unprocessed messages with attachments,
 * classifies each attachment by filename, and routes it to the right
 * importer (sales / item sales / inventory / flight schedule).
 *
 * Idempotency: every processed message gets labelled with either
 * `TailorsDaughter/Imported` or `TailorsDaughter/Failed`. The inbox query
 * excludes both labels, so each message is seen exactly once — cron can
 * run hourly without double-importing. To retry a failed message the user
 * removes the `Failed` label in Gmail.
 *
 * Security:
 * - If GMAIL_INBOX_ALLOWED_SENDERS is set (comma-separated), messages from
 *   other senders are skipped and labelled Failed so they're never reprocessed.
 * - Attachments are size-capped at 10 MB before download.
 * - Files with unknown extensions are rejected.
 */

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const LABEL_IMPORTED = 'TailorsDaughter/Imported';
const LABEL_FAILED = 'TailorsDaughter/Failed';
const ALLOWED_EXTS = new Set(['xls', 'xlsx', 'csv', 'pdf']);

type AttachmentType =
  | 'sales_monthly'
  | 'sales_daily'
  | 'item_sales'
  | 'inventory_snapshot'
  | 'flight_schedule'
  | 'carrier_capacity'   // body-only import, no attachment
  | 'unknown';

export interface InboxScanResult {
  scanned: number;
  imported: number;
  failed: number;
  skipped: number;
  details: Array<{
    messageId: string;
    from: string;
    subject: string;
    attachment: string;
    type: AttachmentType;
    status: 'imported' | 'failed' | 'skipped';
    reason?: string;
  }>;
}

function getGmailClient(): gmail_v1.Gmail {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'Gmail inbox scanner missing env vars: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN'
    );
  }
  const oauth = new google.auth.OAuth2(clientId, clientSecret);
  oauth.setCredentials({ refresh_token: refreshToken });
  return google.gmail({ version: 'v1', auth: oauth });
}

// ---------- Classification ----------

/**
 * Decide which importer to run for an attachment based on filename and the
 * email subject (which often carries clearer context than the filename
 * Counterpoint exports). Filename takes precedence — subject is a fallback.
 */
function classifyAttachment(fileName: string, subject: string): AttachmentType {
  const name = fileName.toLowerCase();
  const ext = name.split('.').pop() ?? '';
  const hay = `${name} ${subject.toLowerCase()}`;

  if (ext === 'pdf') {
    // Any PDF we see is assumed to be a flight schedule. The airport's weekly
    // PDF is the only PDF source we ingest via email.
    return 'flight_schedule';
  }

  if (!['xls', 'xlsx', 'csv'].includes(ext)) return 'unknown';

  // Inventory valuation / stock-on-hand — check first since "sales" can
  // appear in inventory report titles.
  if (/valuation|stock.?on.?hand|\binventory\b/.test(hay)) {
    return 'inventory_snapshot';
  }

  // SKU-level item sales — "item" is the discriminator vs daily totals.
  if (/\bitem/.test(hay)) {
    return 'item_sales';
  }

  // Daily vs monthly sales totals. Counterpoint's daily export typically
  // has "daily" or a single date in the name; monthly reports span a month.
  if (/\bdaily\b|day.?sales/.test(hay)) {
    return 'sales_daily';
  }

  if (/sales|counterpoint/.test(hay)) {
    return 'sales_monthly';
  }

  return 'unknown';
}

/**
 * Extract a YYYY-MM schedule month hint from the filename or subject for
 * flight-schedule uploads. Falls back to the next calendar month if nothing
 * parseable is found (flight schedules are delivered in advance).
 */
function extractScheduleMonth(fileName: string, subject: string): string {
  const hay = `${fileName} ${subject}`;

  // 1) Explicit YYYY-MM
  const iso = hay.match(/(20\d{2})[-_/](\d{1,2})/);
  if (iso) {
    const y = iso[1];
    const m = iso[2].padStart(2, '0');
    return `${y}-${m}`;
  }

  // 2) Month name + year ("April 2026", "Apr 2026")
  const monthNames = [
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december',
  ];
  const monthNameRe = new RegExp(
    `\\b(${monthNames.join('|')}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\\b[^\\d]*?(20\\d{2})`,
    'i'
  );
  const nameMatch = hay.match(monthNameRe);
  if (nameMatch) {
    const prefix = nameMatch[1].slice(0, 3).toLowerCase();
    const idx = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(prefix);
    if (idx >= 0) {
      return `${nameMatch[2]}-${String(idx + 1).padStart(2, '0')}`;
    }
  }

  // 3) Fallback — next month
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
}

// ---------- Gmail label management ----------

/**
 * Ensures both the Imported and Failed labels exist. Returns their IDs.
 * Labels are created once and then cached in module scope — Gmail rejects
 * duplicates, so subsequent creates short-circuit to the cached ID.
 */
let _labelIds: { imported: string; failed: string } | null = null;

async function ensureLabels(gmail: gmail_v1.Gmail): Promise<{ imported: string; failed: string }> {
  if (_labelIds) return _labelIds;

  const existing = await gmail.users.labels.list({ userId: 'me' });
  const byName = new Map<string, string>();
  for (const l of existing.data.labels ?? []) {
    if (l.name && l.id) byName.set(l.name, l.id);
  }

  async function getOrCreate(name: string): Promise<string> {
    const cached = byName.get(name);
    if (cached) return cached;
    const created = await gmail.users.labels.create({
      userId: 'me',
      requestBody: {
        name,
        labelListVisibility: 'labelShow',
        messageListVisibility: 'show',
      },
    });
    if (!created.data.id) throw new Error(`Failed to create Gmail label "${name}"`);
    return created.data.id;
  }

  _labelIds = {
    imported: await getOrCreate(LABEL_IMPORTED),
    failed: await getOrCreate(LABEL_FAILED),
  };
  return _labelIds;
}

async function applyLabel(
  gmail: gmail_v1.Gmail,
  messageId: string,
  labelId: string,
  markRead: boolean
): Promise<void> {
  const removeLabelIds = markRead ? ['UNREAD'] : [];
  await gmail.users.messages.modify({
    userId: 'me',
    id: messageId,
    requestBody: {
      addLabelIds: [labelId],
      removeLabelIds,
    },
  });
}

// ---------- Attachment traversal ----------

interface GmailAttachment {
  filename: string;
  mimeType: string;
  attachmentId: string;
  size: number;
}

/**
 * Walk the MIME tree and return the best plain-text representation of the
 * email body for subject-based body parsers (Carrier Passenger Summary).
 *
 * Strategy:
 *   - Prefer `text/plain` parts when available
 *   - Fall back to stripping HTML tags from `text/html` if no plain part
 *   - Collapse all whitespace to single spaces so the regex parsers can
 *     treat the body as one long line (the airport emails are heavy on
 *     soft line breaks that would otherwise split flight lines)
 */
function extractPlainTextBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return '';
  const plainParts: string[] = [];
  const htmlParts: string[] = [];

  const walk = (part: gmail_v1.Schema$MessagePart) => {
    const mime = (part.mimeType ?? '').toLowerCase();
    const data = part.body?.data;
    if (data) {
      if (mime === 'text/plain') {
        plainParts.push(Buffer.from(data, 'base64url').toString('utf8'));
      } else if (mime === 'text/html') {
        htmlParts.push(Buffer.from(data, 'base64url').toString('utf8'));
      }
    }
    for (const child of part.parts ?? []) walk(child);
  };
  walk(payload);

  let body = plainParts.join('\n').trim();
  if (!body && htmlParts.length > 0) {
    // Cheap HTML → text: drop tags, decode a few common entities
    body = htmlParts
      .join('\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'");
  }
  // Collapse all whitespace to single spaces so the regex parsers can
  // treat soft-wrapped flight lines as one continuous stream
  return body.replace(/\s+/g, ' ').trim();
}

function collectAttachments(payload: gmail_v1.Schema$MessagePart | undefined): GmailAttachment[] {
  if (!payload) return [];
  const out: GmailAttachment[] = [];
  const walk = (part: gmail_v1.Schema$MessagePart) => {
    if (part.filename && part.filename.length > 0 && part.body?.attachmentId) {
      out.push({
        filename: part.filename,
        mimeType: part.mimeType ?? 'application/octet-stream',
        attachmentId: part.body.attachmentId,
        size: part.body.size ?? 0,
      });
    }
    for (const child of part.parts ?? []) walk(child);
  };
  walk(payload);
  return out;
}

async function downloadAttachment(
  gmail: gmail_v1.Gmail,
  messageId: string,
  attachmentId: string
): Promise<Buffer> {
  const res = await gmail.users.messages.attachments.get({
    userId: 'me',
    messageId,
    id: attachmentId,
  });
  const data = res.data.data;
  if (!data) throw new Error('Empty attachment body');
  // Gmail returns url-safe base64
  return Buffer.from(data, 'base64url');
}

function getHeader(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string {
  if (!headers) return '';
  const h = headers.find((x) => x.name?.toLowerCase() === name.toLowerCase());
  return h?.value ?? '';
}

function parseSenderEmail(fromHeader: string): string {
  // "Name <addr@x.com>" or "addr@x.com"
  const m = fromHeader.match(/<([^>]+)>/);
  return (m ? m[1] : fromHeader).trim().toLowerCase();
}

function getAllowedSenders(): Set<string> | null {
  const raw = process.env.GMAIL_INBOX_ALLOWED_SENDERS;
  if (!raw || !raw.trim()) return null;
  return new Set(
    raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  );
}

// ---------- Router ----------

async function routeAttachment(
  type: AttachmentType,
  buffer: Buffer,
  fileName: string,
  subject: string
): Promise<{ ok: boolean; detail: string }> {
  switch (type) {
    case 'sales_monthly': {
      const r = await importSalesReport(buffer, fileName);
      return {
        ok: r.success,
        detail: r.success
          ? `monthly sales: ${r.totalDays} days, $${r.totalSales.toFixed(2)}`
          : `monthly sales failed: ${r.errors.join('; ')}`,
      };
    }
    case 'sales_daily': {
      const r = await importDailySalesReport(buffer, fileName);
      return {
        ok: r.success,
        detail: r.success
          ? `daily sales ${r.date}: $${r.sales.toFixed(2)}, ${r.tickets} tickets`
          : `daily sales failed: ${r.errors.join('; ')}`,
      };
    }
    case 'item_sales': {
      const r = await importItemSales(buffer, fileName);
      return {
        ok: r.success,
        detail: r.success
          ? `item sales: ${r.lineItemsWritten} rows, ${r.uniqueSkus} SKUs`
          : `item sales failed: ${r.errors.join('; ')}`,
      };
    }
    case 'inventory_snapshot': {
      const r = await importInventorySnapshot(buffer, fileName);
      return {
        ok: r.success,
        detail: r.success
          ? `inventory snapshot ${r.snapshotDate}: ${r.uniqueSkus} SKUs, $${r.totalValue.toFixed(2)} on hand`
          : `inventory snapshot failed: ${r.errors.join('; ')}`,
      };
    }
    case 'flight_schedule': {
      const scheduleMonth = extractScheduleMonth(fileName, subject);
      const r = await importFlightSchedule(buffer, scheduleMonth, fileName);
      return {
        ok: r.success,
        detail: r.success
          ? `flights ${scheduleMonth}: ${r.totalFlights} flights (${r.arrivals}a / ${r.departures}d)`
          : `flights failed: ${(r.errors ?? []).join('; ')}`,
      };
    }
    case 'carrier_capacity':
      // Carrier capacity emails never reach this router — they're handled
      // inline in scanInbox because they're body-only (no attachment). This
      // branch exists only to keep TypeScript's exhaustiveness check happy.
      return { ok: false, detail: 'carrier_capacity should be handled inline, not routed through attachment pipeline' };
    case 'unknown':
      return { ok: false, detail: 'unrecognized file type' };
  }
}

// ---------- Main scan ----------

export async function scanInbox(): Promise<InboxScanResult> {
  const gmail = getGmailClient();
  const labels = await ensureLabels(gmail);
  const allowedSenders = getAllowedSenders();

  const result: InboxScanResult = {
    scanned: 0, imported: 0, failed: 0, skipped: 0, details: [],
  };

  // Pull two groups in one query:
  //   1. Anything with an attachment (Counterpoint / inventory / flight PDF)
  //   2. Carrier Passenger Summary emails — these are plain-text body-only
  //      and only have Outlook signature images, so has:attachment misses
  //      them. Subject match catches both fresh and forwarded variants.
  //
  // Either group is excluded if already stamped with one of our labels.
  // Cap at 25 per run to keep each cron invocation bounded.
  const q =
    `(has:attachment OR subject:"Carrier Passenger Summary") ` +
    `-label:${LABEL_IMPORTED} -label:${LABEL_FAILED}`;
  const list = await gmail.users.messages.list({
    userId: 'me',
    q,
    maxResults: 25,
  });

  const messageIds = (list.data.messages ?? []).map((m) => m.id).filter((x): x is string => !!x);
  result.scanned = messageIds.length;

  for (const messageId of messageIds) {
    const full = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    });

    const headers = full.data.payload?.headers;
    const from = parseSenderEmail(getHeader(headers, 'From'));
    const subject = getHeader(headers, 'Subject');

    // Sender allow-list (if configured)
    if (allowedSenders && !allowedSenders.has(from)) {
      await applyLabel(gmail, messageId, labels.failed, true);
      result.skipped += 1;
      result.details.push({
        messageId, from, subject,
        attachment: '', type: 'unknown',
        status: 'skipped', reason: 'sender not in allow-list',
      });
      continue;
    }

    // Carrier Passenger Summary emails are body-only — no data attachment,
    // just Outlook signature PNGs. Handle them before we go hunting for
    // attachments to parse.
    if (/carrier\s+passenger\s+summary/i.test(subject)) {
      const body = extractPlainTextBody(full.data.payload ?? undefined);
      const receivedDate = full.data.internalDate
        ? new Date(Number(full.data.internalDate)).toISOString()
        : undefined;
      try {
        const r = await importCarrierCapacityEmail(subject, body, receivedDate, 'email');
        const detail = r.success
          ? `capacity ${r.flight_date}: ${r.flightsMatched}/${r.flightsParsed} flights matched` +
            (r.flightsUnmatched > 0 ? ` (${r.flightsUnmatched} unmatched: ${r.unmatchedFlights.slice(0, 3).join(', ')})` : '')
          : `capacity failed: ${r.errors.join('; ') || r.warnings.join('; ') || 'no matches'}`;
        await applyLabel(gmail, messageId, r.success ? labels.imported : labels.failed, true);
        if (r.success) {
          result.imported += 1;
        } else {
          result.failed += 1;
        }
        result.details.push({
          messageId, from, subject,
          attachment: '(body only)', type: 'carrier_capacity',
          status: r.success ? 'imported' : 'failed', reason: detail,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await applyLabel(gmail, messageId, labels.failed, true);
        result.failed += 1;
        result.details.push({
          messageId, from, subject,
          attachment: '(body only)', type: 'carrier_capacity',
          status: 'failed', reason: msg,
        });
      }
      continue;
    }

    const attachments = collectAttachments(full.data.payload ?? undefined);
    if (attachments.length === 0) {
      // Has attachment flag but we couldn't find one — label failed and move on
      await applyLabel(gmail, messageId, labels.failed, true);
      result.skipped += 1;
      result.details.push({
        messageId, from, subject,
        attachment: '', type: 'unknown',
        status: 'skipped', reason: 'no attachment body found',
      });
      continue;
    }

    // Process every attachment on the message. One message's outcome is
    // success iff *every* attachment it carries imports cleanly — partial
    // successes still get labelled Failed so nothing is silently lost.
    let anyFailed = false;
    for (const att of attachments) {
      const ext = att.filename.split('.').pop()?.toLowerCase() ?? '';
      if (!ALLOWED_EXTS.has(ext)) {
        anyFailed = true;
        result.failed += 1;
        result.details.push({
          messageId, from, subject,
          attachment: att.filename, type: 'unknown',
          status: 'failed', reason: `unsupported extension .${ext}`,
        });
        continue;
      }

      if (att.size > MAX_ATTACHMENT_BYTES) {
        anyFailed = true;
        result.failed += 1;
        result.details.push({
          messageId, from, subject,
          attachment: att.filename, type: 'unknown',
          status: 'failed', reason: `attachment exceeds ${MAX_ATTACHMENT_BYTES / (1024 * 1024)}MB limit`,
        });
        continue;
      }

      const type = classifyAttachment(att.filename, subject);
      if (type === 'unknown') {
        anyFailed = true;
        result.failed += 1;
        result.details.push({
          messageId, from, subject,
          attachment: att.filename, type,
          status: 'failed', reason: 'could not classify attachment',
        });
        continue;
      }

      try {
        const buffer = await downloadAttachment(gmail, messageId, att.attachmentId);
        const routed = await routeAttachment(type, buffer, att.filename, subject);
        if (routed.ok) {
          result.imported += 1;
          result.details.push({
            messageId, from, subject,
            attachment: att.filename, type,
            status: 'imported', reason: routed.detail,
          });
        } else {
          anyFailed = true;
          result.failed += 1;
          result.details.push({
            messageId, from, subject,
            attachment: att.filename, type,
            status: 'failed', reason: routed.detail,
          });
        }
      } catch (err) {
        anyFailed = true;
        result.failed += 1;
        const msg = err instanceof Error ? err.message : String(err);
        result.details.push({
          messageId, from, subject,
          attachment: att.filename, type,
          status: 'failed', reason: msg,
        });
        console.error('[gmail-inbox] attachment error:', messageId, att.filename, msg);
      }
    }

    // Stamp the message with a terminal label so the next scan skips it.
    await applyLabel(
      gmail,
      messageId,
      anyFailed ? labels.failed : labels.imported,
      true
    );
  }

  // Log the scan itself so there's a record even when zero messages matched.
  try {
    await logImport({
      source_type: 'manual',
      file_name: 'gmail-inbox-scan',
      total_records: result.scanned,
      successful_records: result.imported,
      failed_records: result.failed,
      error_messages: { details: result.details },
      reconciliation_status: result.failed === 0 ? 'ok' : 'partial',
    });
  } catch (err) {
    console.error('[gmail-inbox] failed to write scan log:', err);
  }

  return result;
}
