import { google } from 'googleapis';
import type { ShiftAssignment } from './schedule';

const oauth2Client = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET
);

oauth2Client.setCredentials({
  refresh_token: process.env.GMAIL_REFRESH_TOKEN,
});

const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
const SENDER = process.env.GMAIL_SENDER || '';

function buildMimeMessage(to: string, subject: string, htmlBody: string): string {
  // Encode subject if it contains non-ASCII or special chars (RFC 2047)
  const needsEncoding = /[^\x20-\x7E]/.test(subject);
  const encodedSubject = needsEncoding
    ? `=?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`
    : subject;

  const messageParts = [
    `From: "The Tailors Daughter" <${SENDER}>`,
    `To: ${to}`,
    `Subject: ${encodedSubject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
    '',
    htmlBody,
  ];
  const message = messageParts.join('\r\n');
  return Buffer.from(message).toString('base64url');
}

async function sendEmail(to: string, subject: string, htmlBody: string): Promise<boolean> {
  if (!SENDER || !process.env.GMAIL_REFRESH_TOKEN) {
    console.warn('Gmail not configured — skipping email');
    return false;
  }

  try {
    const raw = buildMimeMessage(to, subject, htmlBody);
    await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw },
    });
    return true;
  } catch (error) {
    console.error('Gmail send failed:', (error as Error).message);
    return false;
  }
}

interface DayScheduleExport {
  date: string;
  shifts: ShiftAssignment[];
}

function formatShiftTime(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const suffix = h >= 12 ? 'pm' : 'am';
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m === 0 ? `${hour12}${suffix}` : `${hour12}:${String(m).padStart(2, '0')}${suffix}`;
}

function formatDayName(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.toLocaleDateString('en-US', { weekday: 'long' });
  const num = d.getDate();
  const suffix = num === 1 || num === 21 || num === 31 ? 'st' : num === 2 || num === 22 ? 'nd' : num === 3 || num === 23 ? 'rd' : 'th';
  return `${day} ${num}${suffix}`;
}

function buildWeekTable(days: DayScheduleExport[], weekLabel: string, staffHours: { biliana: number; devonte: number; nichelle: number }): string {
  const cellStyle = 'padding:8px 12px;border:1px solid #ccc;text-align:center;font-size:13px;';
  const headerStyle = 'padding:8px 12px;border:1px solid #999;font-weight:bold;text-align:center;font-size:13px;background:#f0f0f0;';
  const offStyle = 'color:#cc0000;font-weight:bold;';
  const shiftStyle = 'color:#333;';

  let rows = '';
  for (const day of days) {
    const biliana = day.shifts.find(s => s.staffName === 'Biliana');
    const nichelle = day.shifts.find(s => s.staffName === 'Nichelle');

    const bilianaCell = biliana
      ? `<span style="${shiftStyle}">${formatShiftTime(biliana.start)} – ${formatShiftTime(biliana.end)}<br/><small>Biliana</small></span>`
      : `<span style="${offStyle}">OFF</span>`;
    const devonteCell = `<span style="${offStyle}">OFF</span>`;
    const nichelleCell = nichelle
      ? `<span style="${shiftStyle}">${formatShiftTime(nichelle.start)} – ${formatShiftTime(nichelle.end)}</span>`
      : `<span style="${offStyle}">OFF</span>`;

    rows += `<tr>
      <td style="${cellStyle}font-weight:bold;text-align:left;">${formatDayName(day.date)}</td>
      <td style="${cellStyle}">${bilianaCell}</td>
      <td style="${cellStyle}">${devonteCell}</td>
      <td style="${cellStyle}">${nichelleCell}</td>
    </tr>`;
  }

  return `
    <table style="border-collapse:collapse;width:100%;margin-bottom:24px;">
      <tr><td colspan="4" style="padding:8px;font-weight:bold;font-size:15px;border:1px solid #999;background:#e8e8e8;text-align:center;">${weekLabel}</td></tr>
      <tr>
        <td style="${headerStyle}">Dates</td>
        <td style="${headerStyle}">Nakita/Biliana</td>
        <td style="${headerStyle}">Devonte Burton-Charles</td>
        <td style="${headerStyle}">Nichelle Archibald</td>
      </tr>
      ${rows}
      <tr>
        <td style="${cellStyle}font-weight:bold;">Total Hours</td>
        <td style="${cellStyle}font-weight:bold;">${staffHours.biliana}</td>
        <td style="${cellStyle}font-weight:bold;">${staffHours.devonte}</td>
        <td style="${cellStyle}font-weight:bold;">${staffHours.nichelle}</td>
      </tr>
    </table>
  `;
}

export async function sendScheduleEmail(
  to: string,
  startDate: string,
  endDate: string,
  allDays: DayScheduleExport[],
  _totalStaffHours: Record<string, { totalHours: number; daysWorked: number }>
): Promise<boolean> {
  // Split into two weeks
  const week1 = allDays.slice(0, 7);
  const week2 = allDays.slice(7, 14);

  const startD = new Date(startDate + 'T12:00:00');
  const midD = new Date(startDate + 'T12:00:00');
  midD.setDate(midD.getDate() + 7);
  const endD = new Date(endDate + 'T12:00:00');

  const fmtDate = (d: Date) => `${d.getDate()}${d.getDate() === 1 || d.getDate() === 21 || d.getDate() === 31 ? 'st' : d.getDate() === 2 || d.getDate() === 22 ? 'nd' : d.getDate() === 3 || d.getDate() === 23 ? 'rd' : 'th'} ${d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`;

  const week1Label = `${fmtDate(startD)} – ${fmtDate(new Date(startD.getTime() + 6 * 86400000))}`;
  const week2Label = week2.length > 0 ? `${fmtDate(midD)} – ${fmtDate(endD)}` : '';

  // Calculate per-week hours
  const calcWeekHours = (days: DayScheduleExport[]) => {
    let biliana = 0, nichelle = 0;
    for (const d of days) {
      for (const s of d.shifts) {
        if (s.staffName === 'Biliana') biliana += s.hours;
        if (s.staffName === 'Nichelle') nichelle += s.hours;
      }
    }
    return { biliana: Math.round(biliana), devonte: 0, nichelle: Math.round(nichelle) };
  };

  const week1Hours = calcWeekHours(week1);
  const week2Hours = calcWeekHours(week2);

  const week1Table = buildWeekTable(week1, week1Label, week1Hours);
  const week2Table = week2.length > 0 ? buildWeekTable(week2, week2Label, week2Hours) : '';

  // HR section
  const hrTable = `
    <table style="border-collapse:collapse;width:100%;margin-top:16px;">
      <tr>
        <td style="padding:6px 10px;border:1px solid #ccc;font-weight:bold;font-size:12px;">Name</td>
        <td style="padding:6px 10px;border:1px solid #ccc;font-weight:bold;font-size:12px;color:#cc0000;">Holiday Pay</td>
        <td style="padding:6px 10px;border:1px solid #ccc;font-weight:bold;font-size:12px;color:#2266cc;">Overtime Pay</td>
        <td style="padding:6px 10px;border:1px solid #ccc;font-weight:bold;font-size:12px;color:#cc6600;">Sick Hours</td>
        <td style="padding:6px 10px;border:1px solid #ccc;font-weight:bold;font-size:12px;">Absent</td>
        <td style="padding:6px 10px;border:1px solid #ccc;font-weight:bold;font-size:12px;">Vacation</td>
        <td style="padding:6px 10px;border:1px solid #ccc;font-weight:bold;font-size:12px;color:#cc0000;">Sick Leave</td>
        <td style="padding:6px 10px;border:1px solid #ccc;font-weight:bold;font-size:12px;color:#009900;">Leave without PAY</td>
        <td style="padding:6px 10px;border:1px solid #ccc;font-weight:bold;font-size:12px;">Comments</td>
      </tr>
      <tr>
        <td style="padding:6px 10px;border:1px solid #ccc;font-size:12px;">Biliana</td>
        <td style="padding:6px 10px;border:1px solid #ccc;"></td><td style="padding:6px 10px;border:1px solid #ccc;"></td><td style="padding:6px 10px;border:1px solid #ccc;"></td><td style="padding:6px 10px;border:1px solid #ccc;"></td><td style="padding:6px 10px;border:1px solid #ccc;"></td><td style="padding:6px 10px;border:1px solid #ccc;"></td><td style="padding:6px 10px;border:1px solid #ccc;"></td><td style="padding:6px 10px;border:1px solid #ccc;"></td>
      </tr>
      <tr>
        <td style="padding:6px 10px;border:1px solid #ccc;font-size:12px;">Devonte Burton-Charles</td>
        <td style="padding:6px 10px;border:1px solid #ccc;"></td><td style="padding:6px 10px;border:1px solid #ccc;"></td><td style="padding:6px 10px;border:1px solid #ccc;"></td><td style="padding:6px 10px;border:1px solid #ccc;"></td><td style="padding:6px 10px;border:1px solid #ccc;"></td><td style="padding:6px 10px;border:1px solid #ccc;"></td><td style="padding:6px 10px;border:1px solid #ccc;"></td><td style="padding:6px 10px;border:1px solid #ccc;"></td>
      </tr>
      <tr>
        <td style="padding:6px 10px;border:1px solid #ccc;font-size:12px;">Nichelle Archibald</td>
        <td style="padding:6px 10px;border:1px solid #ccc;"></td><td style="padding:6px 10px;border:1px solid #ccc;"></td><td style="padding:6px 10px;border:1px solid #ccc;"></td><td style="padding:6px 10px;border:1px solid #ccc;"></td><td style="padding:6px 10px;border:1px solid #ccc;"></td><td style="padding:6px 10px;border:1px solid #ccc;"></td><td style="padding:6px 10px;border:1px solid #ccc;"></td><td style="padding:6px 10px;border:1px solid #ccc;"></td>
      </tr>
    </table>
  `;

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:900px;margin:0 auto;">
      <h2 style="text-align:center;color:#1a1a1a;margin-bottom:24px;">The Tailor's Daughter Bi-Weekly Schedule</h2>
      <div style="display:flex;gap:24px;flex-wrap:wrap;">
        <div style="flex:1;min-width:400px;">${week1Table}</div>
        ${week2Table ? `<div style="flex:1;min-width:400px;">${week2Table}</div>` : ''}
      </div>
      ${hrTable}
    </div>
  `;

  // Build a clean ASCII-safe subject with simple date format
  const monthOpts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
  const subjectStart = startD.toLocaleDateString('en-US', monthOpts);
  const subjectEnd = endD.toLocaleDateString('en-US', monthOpts);
  const subject = `Tailor's Daughter Schedule: ${subjectStart} - ${subjectEnd}`;
  return sendEmail(to, subject, html);
}

export async function sendDailySummaryEmail(
  to: string,
  date: string,
  summary: {
    totalSales: number;
    totalTransactions: number;
    avgTransaction: number;
  },
  aiInsight?: string
): Promise<boolean> {
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
      <h2 style="color:#1a1a2e;">Daily Sales Summary — ${date}</h2>
      <div style="display:flex;gap:20px;margin-bottom:16px;">
        <div style="background:#f0fdf4;padding:12px 20px;border-radius:8px;">
          <div style="font-size:12px;color:#666;">Revenue</div>
          <div style="font-size:24px;font-weight:bold;color:#16a34a;">$${summary.totalSales.toLocaleString()}</div>
        </div>
        <div style="background:#f0f4ff;padding:12px 20px;border-radius:8px;">
          <div style="font-size:12px;color:#666;">Transactions</div>
          <div style="font-size:24px;font-weight:bold;color:#2563eb;">${summary.totalTransactions}</div>
        </div>
        <div style="background:#fefce8;padding:12px 20px;border-radius:8px;">
          <div style="font-size:12px;color:#666;">Avg Transaction</div>
          <div style="font-size:24px;font-weight:bold;color:#ca8a04;">$${summary.avgTransaction.toFixed(2)}</div>
        </div>
      </div>
      ${aiInsight ? `<div style="background:#f8f9fa;padding:16px;border-radius:8px;margin-top:16px;">
        <strong>AI Insight:</strong><br/>${aiInsight.replace(/\n/g, '<br/>')}
      </div>` : ''}
      <hr style="margin-top:24px;border:none;border-top:1px solid #eee;"/>
      <p style="font-size:11px;color:#999;">The Tailor's Daughter — V.C. Bird International Airport</p>
    </div>
  `;

  return sendEmail(to, `Daily Summary — ${date} | Revenue: $${summary.totalSales.toLocaleString()}`, html);
}

export async function sendAlertEmail(to: string, title: string, message: string): Promise<boolean> {
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
      <h2 style="color:#e74c3c;">${title}</h2>
      <p>${message.replace(/\n/g, '<br/>')}</p>
      <hr style="margin-top:24px;border:none;border-top:1px solid #eee;"/>
      <p style="font-size:11px;color:#999;">The Tailor's Daughter — V.C. Bird International Airport</p>
    </div>
  `;

  return sendEmail(to, title, html);
}
