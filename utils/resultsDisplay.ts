

type Result = {
  page:     string;
  field:    string;
  expected: unknown;
  actual:   unknown;
  status:   'PASS' | 'FAIL';
  variant?: string;
};

export function displayResultsTable(
  results:  Result[],
  variant:  string = 'unknown',
  meta?: {
    event?:     string;
    region?:    string;
    excelPath?: string | null;
    videoPath?: string | null;
  }
): void {
  // Filter out non-applicable fields (where expected is N/A or empty)
  const filtered = results.filter((r: any) => {
    if (!r || !r.field) return false;
    const expNA = String(r.expected ?? '').trim().toUpperCase() === 'N/A';
    const expEmpty = String(r.expected ?? '').trim() === '';
    return !expNA && !expEmpty;
  });

  // Deduplicate results by page and field
  const seen = new Set<string>();
  const deduplicated = filtered.filter((r: any) => {
    const key = `${r.page}::${r.field}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (!deduplicated.length) {
    console.log('\n⚠️  No results to display');
    return;
  }

  // Define the logical flow order for pages
  const PAGE_ORDER = [
    'Schedule',
    'Landing',
    'Home Page',
    'Home of Boxing',
    'Boxing',
    'Paywall',
    'Sign In',
    'Standalone PPV',
    'PPV',
    'Default Signup',
    'Bundle PPV',
    'DAZN Plan',
    'Choose How To Buy',
    'Payment',
    'PPV Payment',
    'Upgrade Confirmation',
    'My Account',
    'Phone Number',
    'OTP',
    'Upsell First Success',
    'Upsell Second Success',
    'Upsell Payment'
  ];

  // Group results by page, preserving the original Excel field order
  const groupedByPage = new Map<string, any[]>();
  for (const r of deduplicated) {
    if (!groupedByPage.has(r.page)) {
      groupedByPage.set(r.page, []);
    }
    groupedByPage.get(r.page)!.push(r);
  }

  // Sort the pages according to PAGE_ORDER, but keep fields in original order
  const pages = Array.from(groupedByPage.keys()).sort((a, b) => {
    let idxA = PAGE_ORDER.findIndex(p => p.toLowerCase() === a.toLowerCase());
    let idxB = PAGE_ORDER.findIndex(p => p.toLowerCase() === b.toLowerCase());
    if (idxA === -1) idxA = 999;
    if (idxB === -1) idxB = 999;
    if (idxA !== idxB) return idxA - idxB;
    return a.localeCompare(b);
  });

  const line  = '─'.repeat(55);
  const dline = '═'.repeat(55);

  console.log(`\n${dline}`);
  console.log('  📊  TEST RESULTS SUMMARY');
  console.log(dline);

  if (meta?.event)  console.log(`  🥊  Event   : ${meta.event}`);
  if (meta?.region) console.log(`  🌍  Region  : ${meta.region}`);
  console.log(`  🎯  Variant : ${variant}`);
  console.log(line);

  // ── Per page breakdown ───────────────────────────────────────
  console.log('');

  for (const p of pages) {
    const pageResults = groupedByPage.get(p) || [];
    const pass  = pageResults.filter(r => r.status === 'PASS').length;
    const fail  = pageResults.filter(r => r.status === 'FAIL').length;
    const total = pageResults.length;
    const pct   = total ? ((pass / total) * 100).toFixed(0) : '0';

    console.log(
      `  ${pageIcon(p)}  ${p.padEnd(12)} ` +
      `✅ ${String(pass).padStart(2)}  ` +
      `❌ ${String(fail).padStart(2)}  ` +
      `Total ${String(total).padStart(2)}  (${pct}%)`
    );

    // ── Failed fields under each page ──────────────────────────
    const failed = pageResults.filter(r => r.status === 'FAIL');
    if (failed.length) {
      for (const f of failed) {
        const exp = String(f.expected ?? '');
        const act = String(f.actual   ?? '');
        console.log(`       ❌ ${f.field}`);
        console.log(`          expected : ${exp}`);
        console.log(`          actual   : ${act}`);
      }
      console.log('');
    }
  }

  // ── Overall totals ───────────────────────────────────────────
  const totalPass = deduplicated.filter((r: any) => r.status === 'PASS').length;
  const totalFail = deduplicated.filter((r: any) => r.status === 'FAIL').length;
  const total     = deduplicated.length;
  const totalPct  = total ? ((totalPass / total) * 100).toFixed(1) : '0';

  console.log(line);
  console.log(`  ✅  Passed  : ${totalPass} / ${total}`);
  console.log(`  ❌  Failed  : ${totalFail} / ${total}`);
  console.log(`  📈  Pass %  : ${totalPct}%`);
  console.log(line);

  // ── File paths ───────────────────────────────────────────────
  if (meta?.excelPath) {
  }

  if (meta?.videoPath) {
  } else {
  }

  console.log(`${dline}\n`);
}

// ── Helpers ──────────────────────────────────────────────────────
function pageIcon(page: string): string {
  const p = page.toLowerCase();
  if (p.includes('schedule')) return '📅';
  if (p.includes('landing'))  return '🏠';
  if (p.includes('ppv'))      return '🥊';
  if (p.includes('plan'))     return '📋';
  if (p.includes('payment'))  return '💳';
  if (p.includes('otp'))      return '🔑';
  if (p.includes('phone'))    return '📱';
  return '📄';
}