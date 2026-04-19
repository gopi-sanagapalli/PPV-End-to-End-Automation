import * as XLSX from 'xlsx';
import * as fs   from 'fs';
import * as path from 'path';

// ── Column name maps — matches PPV_Input sheet names exactly ─────
const SCHEDULE_HEADERS  = ['Field', 'Expected', 'Actual', 'Status'];
const PPV_HEADERS       = ['Variant', 'Field', 'Expected', 'Actual', 'Status'];
const PLAN_HEADERS      = ['Tier', 'Field', 'Expected', 'Actual', 'Status'];
const PAYMENT_HEADERS   = ['Tier', 'Rate Plan', 'Field', 'Expected', 'Actual', 'Status'];
const LANDING_HEADERS   = ['Field', 'Expected', 'Actual', 'Status'];
const SUMMARY_HEADERS   = ['Metric', 'Value'];
const PAGE_SUM_HEADERS  = ['Page', 'Total', 'Passed', 'Failed', 'Pass %'];

// ── Style helpers ────────────────────────────────────────────────
const applyStyles = (ws: XLSX.WorkSheet, data: any[]) => {
  if (!data.length) return;

  // Column widths
  const colWidths = Object.keys(data[0]).map(k => ({
    wch: Math.max(
      k.length,
      ...data.map(r => String(r[k] ?? '').length)
    ) + 4,
  }));
  ws['!cols'] = colWidths;
};

export const writeResults = async (
  results: any[]
): Promise<{ excelPath: string | null; videoPath: string | null }> => {

  // ── Find video ───────────────────────────────────────────────
  let videoPath: string | null = null;
  try {
    const videoDirs = [
      path.resolve(process.cwd(), 'test-results', 'videos'),
      path.resolve(process.cwd(), 'test-results', 'artifacts'),
      path.resolve(process.cwd(), 'test-results'),
    ];
    const findVideo = (dir: string): string | null => {
      if (!fs.existsSync(dir)) return null;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          const found = findVideo(full);
          if (found) return found;
        } else if (e.name.endsWith('.webm') || e.name.endsWith('.mp4')) {
          return full;
        }
      }
      return null;
    };
    for (const dir of videoDirs) {
      videoPath = findVideo(dir);
      if (videoPath) break;
    }
  } catch {}

  try {
    // ── Output dir ───────────────────────────────────────────
    const dir = path.resolve(process.cwd(), 'test-results');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const validRows = results.filter((r: any) => r?.field);

    // ── Map results to sheet rows ────────────────────────────
    const toRow = (r: any, includeVariant = false, includeTier = false, includeRatePlan = false) => {
      const base: any = {
        Field:    r.field    ?? '',
        Expected: r.expected ?? '',
        Actual:   r.actual   ?? '',
        Status:   r.status   ?? '',
      };

      // Add Tier column if needed
      if (includeTier) {
        return {
          Tier: r.tier ?? '',
          ...base,
        };
      }

      // Add Tier + Rate Plan columns if needed
      if (includeRatePlan) {
        return {
          Tier:        r.tier     ?? '',
          'Rate Plan': r.ratePlan ?? '',
          ...base,
        };
      }

      // Add Variant column if needed
      if (includeVariant) {
        return { Variant: r.variant ?? '', ...base };
      }

      return base;
    };

    // ── Filter by page ───────────────────────────────────────
    const byPage = (
      pattern:        RegExp,
      includeVariant  = false,
      includeTier     = false,
      includeRatePlan = false
    ) =>
      validRows
        .filter((r: any) => pattern.test(String(r.page ?? '')))
        .map((r: any) => toRow(r, includeVariant, includeTier, includeRatePlan));

    const scheduleRows = byPage(/^schedule$/i);
    const landingRows  = byPage(/^landing$/i);
    const ppvRows      = byPage(/^ppv$/i,       true,  false, false);
    const planRows     = byPage(/^dazn plan$/i, false, true,  false);
    const paymentRows  = byPage(/^payment$/i,   false, false, true);

    // ── Overall summary ──────────────────────────────────────
    const allRows   = [...scheduleRows, ...landingRows, ...ppvRows, ...planRows, ...paymentRows];
    const total     = allRows.length;
    const passCount = allRows.filter(r => r.Status === 'PASS').length;
    const failCount = allRows.filter(r => r.Status === 'FAIL').length;

    const overallSummary = [
      { Metric: 'Total Tests', Value: total     },
      { Metric: 'Passed',      Value: passCount },
      { Metric: 'Failed',      Value: failCount },
      { Metric: 'Pass Rate',   Value: total
          ? `${((passCount / total) * 100).toFixed(1)}%`
          : '0%'
      },
      { Metric: 'Run Date',    Value: new Date().toLocaleString() },
    ];

    // ── Per-page summary ─────────────────────────────────────
    const pageGroups = [
      { name: 'Schedule', rows: scheduleRows },
      { name: 'Landing',  rows: landingRows  },
      { name: 'PPV',      rows: ppvRows      },
      { name: 'DAZN Plan',rows: planRows     },
      { name: 'Payment',  rows: paymentRows  },
    ].filter(g => g.rows.length > 0);

    const pageSummary = pageGroups.map(p => ({
      Page:     p.name,
      Total:    p.rows.length,
      Passed:   p.rows.filter(r => r.Status === 'PASS').length,
      Failed:   p.rows.filter(r => r.Status === 'FAIL').length,
      'Pass %': p.rows.length
        ? `${((p.rows.filter(r => r.Status === 'PASS').length / p.rows.length) * 100).toFixed(1)}%`
        : '0%',
    }));

    // ── Build workbook ───────────────────────────────────────
    const wb = XLSX.utils.book_new();

    const addSheet = (
      name:    string,
      data:    any[],
      headers: string[]
    ) => {
      const rows    = data.length ? data : [Object.fromEntries(headers.map(h => [h, '']))];
      const ws      = XLSX.utils.json_to_sheet(rows, { header: headers });
      applyStyles(ws, rows);

      // Colour PASS/FAIL cells
      const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1');
      for (let R = range.s.r + 1; R <= range.e.r; R++) {
        const statusCol = headers.indexOf('Status');
        if (statusCol === -1) continue;
        const cellAddr = XLSX.utils.encode_cell({ r: R, c: statusCol });
        const cell     = ws[cellAddr];
        if (!cell) continue;
        cell.s = {
          fill: {
            patternType: 'solid',
            fgColor: { rgb: cell.v === 'PASS' ? 'C6EFCE' : 'FFC7CE' },
          },
          font: {
            color: { rgb: cell.v === 'PASS' ? '276221' : '9C0006' },
            bold: true,
          },
        };
      }

      XLSX.utils.book_append_sheet(wb, ws, name);
    };

    // ── Always add summary sheets first ─────────────────────
    addSheet('Summary',      overallSummary, SUMMARY_HEADERS);
    addSheet('Page Summary', pageSummary,    PAGE_SUM_HEADERS);

    // ── Page sheets — only if data exists ───────────────────
    if (scheduleRows.length) addSheet('Schedule page',  scheduleRows, SCHEDULE_HEADERS);
    if (landingRows.length)  addSheet('Landing page',   landingRows,  LANDING_HEADERS);
    if (ppvRows.length)      addSheet('PPV page',       ppvRows,      PPV_HEADERS);
    if (planRows.length)     addSheet('Dazn Plan page', planRows,     PLAN_HEADERS);
    if (paymentRows.length)  addSheet('Payment page',   paymentRows,  PAYMENT_HEADERS);

    // ── Write file ───────────────────────────────────────────
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, '-')
      .slice(0, 19);

    const excelPath = path.join(dir, `ppv-report-${timestamp}.xlsx`);
    XLSX.writeFile(wb, excelPath, { bookType: 'xlsx', type: 'binary' });

    console.log(`\n📊 Excel saved: ${excelPath}`);
    return { excelPath, videoPath };

  } catch (err) {
    console.error('❌ Excel Write Failed:', err);
    return { excelPath: null, videoPath };
  }
};