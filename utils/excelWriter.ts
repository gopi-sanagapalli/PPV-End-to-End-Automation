import * as XLSX from 'xlsx';
import * as fs from 'fs';

export const writeResults = async (results: any[]) => {
  try {
    // 📁 Ensure folder exists
    const dir = 'test-results/reports';

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const validRows = results.filter((r: any) => r?.field);

    // 📊 Landing rows
    const landingRows = validRows
      .filter((r: any) => /landing/i.test(String(r.page || '')))
      .map((r: any) => ({
        Field: r.field,
        Expected: r.expected,
        Actual: r.actual,
        Status: r.status,
      }));

    // 📊 PPV rows
    const ppvRows = validRows
      .filter((r: any) => /ppv/i.test(String(r.page || '')))
      .map((r: any) => ({
        Variant: r.variant || 'unknown',
        Field: r.field,
        Expected: r.expected,
        Actual: r.actual,
        Status: r.status,
      }));

    // 📊 DAZN Plan rows
    const daznPlanRows = validRows
      .filter((r: any) => /dazn.*plan/i.test(String(r.page || '')))
      .map((r: any) => ({
        Field: r.field,
        Expected: r.expected,
        Actual: r.actual,
        Status: r.status,
      }));

    // 🔥 NEW: PAYMENT PAGE ROWS
    const paymentRows = validRows
      .filter((r: any) => /payment/i.test(String(r.page || '')))
      .map((r: any) => ({
        Field: r.field,
        Expected: r.expected,
        Actual: r.actual,
        Status: r.status,
      }));

    // 📄 Create sheets
    const landingSheet = XLSX.utils.json_to_sheet(landingRows, {
      header: ['Field', 'Expected', 'Actual', 'Status'],
    });

    const ppvSheet = XLSX.utils.json_to_sheet(ppvRows, {
      header: ['Variant', 'Field', 'Expected', 'Actual', 'Status'],
    });

    const daznPlanSheet = XLSX.utils.json_to_sheet(daznPlanRows, {
      header: ['Field', 'Expected', 'Actual', 'Status'],
    });

    // 🔥 NEW: Payment sheet
    const paymentSheet = XLSX.utils.json_to_sheet(paymentRows, {
      header: ['Field', 'Expected', 'Actual', 'Status'],
    });

    // 📘 Create workbook
    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(workbook, landingSheet, 'Landing page');
    XLSX.utils.book_append_sheet(workbook, ppvSheet, 'PPV page');
    XLSX.utils.book_append_sheet(workbook, daznPlanSheet, 'DAZN Plan page');

    // 🔥 ADD PAYMENT SHEET
    XLSX.utils.book_append_sheet(workbook, paymentSheet, 'Payment page');

    // 📊 Summary
    const allRows = [
      ...landingRows,
      ...ppvRows,
      ...daznPlanRows,
      ...paymentRows   // 🔥 INCLUDED
    ];

    const passCount = allRows.filter(r => r.Status === 'PASS').length;
    const failCount = allRows.filter(r => r.Status === 'FAIL').length;
    const naCount = allRows.filter(r => r.Status === 'N/A').length;
    const totalCount = allRows.length;

    const summaryData = [
      { Metric: 'Total Tests', Value: totalCount },
      { Metric: 'PASS', Value: passCount },
      { Metric: 'FAIL', Value: failCount },
      { Metric: 'N/A', Value: naCount },
      { Metric: 'Pass Rate', Value: totalCount ? `${((passCount / totalCount) * 100).toFixed(1)}%` : '0%' },
    ];

    const summarySheet = XLSX.utils.json_to_sheet(summaryData, {
      header: ['Metric', 'Value'],
    });

    XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');

    // 📄 File path
    const filePath = `${dir}/ppv-report-${Date.now()}.xlsx`;

    // 💾 Write file
    XLSX.writeFile(workbook, filePath);

    console.log('📊 Excel Report Generated:', filePath);
    return filePath;

  } catch (err) {
    console.error('❌ Excel Write Failed:', err);
    return null;
  }
};