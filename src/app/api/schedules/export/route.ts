import { supabase } from '@/lib/db';
import { NextRequest } from 'next/server';
import ExcelJS from 'exceljs';

function formatShiftTime(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const suffix = h >= 12 ? 'pm' : 'am';
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m === 0 ? `${hour12}${suffix}` : `${hour12}:${String(m).padStart(2, '0')}${suffix}`;
}

function formatDayLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.toLocaleDateString('en-US', { weekday: 'long' });
  const num = d.getDate();
  const suffix = num === 1 || num === 21 || num === 31 ? 'st' : num === 2 || num === 22 ? 'nd' : num === 3 || num === 23 ? 'rd' : 'th';
  return `${day} ${num}${suffix}`;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    if (!startDate || !endDate) {
      return Response.json({ error: 'startDate and endDate required' }, { status: 400 });
    }

    // Get schedules
    const { data: scheduleRows, error } = await supabase
      .from('staff_schedules')
      .select('*')
      .gte('schedule_date', startDate)
      .lte('schedule_date', endDate)
      .order('schedule_date', { ascending: true })
      .order('shift_start', { ascending: true });

    if (error) throw error;

    // Group by date
    const byDate: Record<string, { staffName: string; start: string; end: string; hours: number }[]> = {};
    for (const row of (scheduleRows || [])) {
      const d = row.schedule_date as string;
      if (!byDate[d]) byDate[d] = [];
      byDate[d].push({
        staffName: row.staff_name as string,
        start: (row.shift_start as string).substring(0, 5),
        end: (row.shift_end as string).substring(0, 5),
        hours: Number(row.shift_hours),
      });
    }

    // Fill all days in range
    const days: { date: string; shifts: typeof byDate[string] }[] = [];
    const current = new Date(startDate);
    const end = new Date(endDate);
    while (current <= end) {
      const dateStr = current.toISOString().split('T')[0];
      days.push({ date: dateStr, shifts: byDate[dateStr] || [] });
      current.setDate(current.getDate() + 1);
    }

    const week1 = days.slice(0, 7);
    const week2 = days.slice(7, 14);

    // Create workbook
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "The Tailor's Daughter";
    const sheet = workbook.addWorksheet('Bi-Weekly Schedule');

    // Styles
    const headerFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };
    const offFont: Partial<ExcelJS.Font> = { color: { argb: 'FFCC0000' }, bold: true };
    const shiftFont: Partial<ExcelJS.Font> = { color: { argb: 'FF333333' } };
    const titleFont: Partial<ExcelJS.Font> = { size: 14, bold: true };
    const borderStyle: Partial<ExcelJS.Borders> = {
      top: { style: 'thin' }, bottom: { style: 'thin' },
      left: { style: 'thin' }, right: { style: 'thin' },
    };

    // Column widths
    sheet.columns = [
      { width: 20 }, // Dates
      { width: 18 }, // Biliana
      { width: 22 }, // Devonte
      { width: 20 }, // Nichelle
      { width: 3 },  // spacer
      { width: 20 }, // Dates week 2
      { width: 18 }, // Biliana week 2
      { width: 22 }, // Devonte week 2
      { width: 20 }, // Nichelle week 2
    ];

    // Title
    sheet.mergeCells('A1:I1');
    const titleCell = sheet.getCell('A1');
    titleCell.value = "The Tailor's Daughter Bi-Weekly Schedule";
    titleCell.font = titleFont;
    titleCell.alignment = { horizontal: 'center' };

    // Helper to build a week block
    const buildWeek = (weekDays: typeof days, startCol: number, weekLabel: string) => {
      const row3 = 3;

      // Week label
      sheet.mergeCells(row3, startCol, row3, startCol + 3);
      const labelCell = sheet.getCell(row3, startCol);
      labelCell.value = weekLabel;
      labelCell.font = { bold: true, size: 12 };
      labelCell.alignment = { horizontal: 'center' };
      labelCell.fill = headerFill;
      labelCell.border = borderStyle;

      // Headers
      const headers = ['Dates', 'Nakita/Biliana', 'Devonte Burton-Charles', 'Nichelle Archibald'];
      const headerRow = row3 + 1;
      headers.forEach((h, i) => {
        const cell = sheet.getCell(headerRow, startCol + i);
        cell.value = h;
        cell.font = { bold: true, size: 11 };
        cell.fill = headerFill;
        cell.border = borderStyle;
        cell.alignment = { horizontal: 'center' };
      });

      // Days
      let bilianaHours = 0;
      let nichelleHours = 0;

      weekDays.forEach((day, idx) => {
        const rowNum = headerRow + 1 + idx;
        const biliana = day.shifts.find(s => s.staffName === 'Biliana');
        const nichelle = day.shifts.find(s => s.staffName === 'Nichelle');

        // Date
        const dateCell = sheet.getCell(rowNum, startCol);
        dateCell.value = formatDayLabel(day.date);
        dateCell.font = { bold: true };
        dateCell.border = borderStyle;

        // Biliana
        const bCell = sheet.getCell(rowNum, startCol + 1);
        if (biliana) {
          bCell.value = `${formatShiftTime(biliana.start)} – ${formatShiftTime(biliana.end)}\nBiliana`;
          bCell.font = shiftFont;
          bilianaHours += biliana.hours;
        } else {
          bCell.value = 'OFF';
          bCell.font = offFont;
        }
        bCell.border = borderStyle;
        bCell.alignment = { horizontal: 'center', wrapText: true };

        // Devonte (always OFF)
        const dCell = sheet.getCell(rowNum, startCol + 2);
        dCell.value = 'OFF';
        dCell.font = offFont;
        dCell.border = borderStyle;
        dCell.alignment = { horizontal: 'center' };

        // Nichelle
        const nCell = sheet.getCell(rowNum, startCol + 3);
        if (nichelle) {
          nCell.value = `${formatShiftTime(nichelle.start)} – ${formatShiftTime(nichelle.end)}`;
          nCell.font = shiftFont;
          nichelleHours += nichelle.hours;
        } else {
          nCell.value = 'OFF';
          nCell.font = offFont;
        }
        nCell.border = borderStyle;
        nCell.alignment = { horizontal: 'center' };
      });

      // Total hours row
      const totalRow = headerRow + 1 + weekDays.length;
      const tLabel = sheet.getCell(totalRow, startCol);
      tLabel.value = 'Total Hours';
      tLabel.font = { bold: true };
      tLabel.border = borderStyle;

      const tBiliana = sheet.getCell(totalRow, startCol + 1);
      tBiliana.value = `${Math.round(bilianaHours)}`;
      tBiliana.font = { bold: true };
      tBiliana.border = borderStyle;
      tBiliana.alignment = { horizontal: 'center' };

      const tDevonte = sheet.getCell(totalRow, startCol + 2);
      tDevonte.value = '0';
      tDevonte.font = { bold: true };
      tDevonte.border = borderStyle;
      tDevonte.alignment = { horizontal: 'center' };

      const tNichelle = sheet.getCell(totalRow, startCol + 3);
      tNichelle.value = `${Math.round(nichelleHours)}`;
      tNichelle.font = { bold: true };
      tNichelle.border = borderStyle;
      tNichelle.alignment = { horizontal: 'center' };
    };

    // Build both weeks
    const startD = new Date(startDate + 'T12:00:00');
    const midD = new Date(startDate + 'T12:00:00');
    midD.setDate(midD.getDate() + 7);
    const endD = new Date(endDate + 'T12:00:00');

    const fmtLabel = (d1: Date, d2: Date) => {
      const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric' };
      return `${d1.toLocaleDateString('en-US', opts)} – ${d2.toLocaleDateString('en-US', opts)}`;
    };

    buildWeek(week1, 1, fmtLabel(startD, new Date(startD.getTime() + 6 * 86400000)));
    if (week2.length > 0) {
      buildWeek(week2, 6, fmtLabel(midD, endD));
    }

    // HR Section
    const hrStartRow = 14;
    sheet.mergeCells(hrStartRow, 1, hrStartRow, 9);
    sheet.getCell(hrStartRow, 1).value = '';

    const hrHeaders = ['Name', 'Holiday Pay', 'Overtime Pay', 'Sick Hours', 'Absent', 'Vacation', 'Sick Leave', 'Leave without PAY', 'Comments'];
    const hrHeaderRow = hrStartRow + 1;
    hrHeaders.forEach((h, i) => {
      const cell = sheet.getCell(hrHeaderRow, i + 1);
      cell.value = h;
      cell.font = { bold: true, size: 10 };
      cell.fill = headerFill;
      cell.border = borderStyle;
    });

    const hrNames = ['Biliana', 'Devonte Burton-Charles', 'Nichelle Archibald'];
    hrNames.forEach((name, idx) => {
      const rowNum = hrHeaderRow + 1 + idx;
      const nameCell = sheet.getCell(rowNum, 1);
      nameCell.value = name;
      nameCell.border = borderStyle;
      for (let col = 2; col <= 9; col++) {
        const cell = sheet.getCell(rowNum, col);
        cell.value = '';
        cell.border = borderStyle;
      }
    });

    // Generate buffer
    const buffer = await workbook.xlsx.writeBuffer();

    const fileName = `Schedule_${startDate}_to_${endDate}.xlsx`;

    return new Response(buffer as ArrayBuffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${fileName}"`,
      },
    });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}
