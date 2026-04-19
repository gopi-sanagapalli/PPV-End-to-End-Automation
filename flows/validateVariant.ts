import { resolveExpected }          from '../utils/resolveExpected';
import { getActualValue }           from '../utils/getActualValue';
import { compare }                  from '../utils/compare';
import { getPageSnapshot, DOMNode } from '../utils/helpers';

export const validateVariant = async (
  page:      any,
  variant:   string,
  data:      any[],
  results:   any[],
  eventData: Record<string, string>,
  pageName:  string = 'PPV'
) => {
  if (!eventData) throw new Error('❌ eventData is missing');

  const normalizedVariant = variant.trim().toLowerCase();

  // ── Read tier & ratePlan from eventData ───────────────────────
  const tier     = (eventData.TIER      || 'standard').toLowerCase();
  const ratePlan = (eventData.RATE_PLAN || 'monthly').toLowerCase();

  const rules = data.filter(r => {
    const rv = (r.Variant || '').trim().toLowerCase();
    const rt = (r.Tier    || '').trim().toLowerCase();

    // If row has Variant column — filter by variant
    if (rv) return rv === normalizedVariant;

    // If row has Tier column — filter by tier
    if (rt) return rt === tier || rt === 'common';

    // No filter column — include all rows (Landing, Schedule)
    return true;
  });

  if (!rules.length) {
    throw new Error(`❌ No rules for variant: "${variant}" / tier: "${tier}"`);
  }

  console.log(`\n🔍 Validating ${pageName} — ${rules.length} fields`);
  console.log(`   💎 Tier: ${tier} | 📋 Rate Plan: ${ratePlan}`);

  // ── Scroll to trigger lazy load before snapshot ───────────────
 // ── Scroll to trigger lazy load before snapshot ───────────────
// ── Scroll to trigger lazy load before snapshot ───────────────
const url = page.url();
if (!url.includes('/schedule')) {
  await page.evaluate(async () => {
    await new Promise<void>(resolve => {
      let scrolled = 0;
      const step   = 300;
      const delay  = 50;
      const timer  = setInterval(() => {
        window.scrollBy(0, step);  // ← SCROLLS TO BOTTOM
        scrolled += step;
        if (scrolled >= document.body.scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, delay);
    });
  }).catch(() => {});

    await page.waitForTimeout(300);
    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
    await page.waitForTimeout(100);
  }

  // ── Pre-fetch DOM snapshot ONCE ───────────────────────────────
  const snapshot = await getPageSnapshot(page);
  console.log(`📸 ${pageName} snapshot: ${snapshot.length} nodes`);

  // ── DEBUG — log all snapshot texts ───────────────────────────
  if (pageName === 'PPV' || pageName === 'DAZN Plan') {
    console.log(`\n📋 Snapshot contents for ${pageName}:`);
    snapshot.forEach((n, i) => {
      console.log(
        `  [${i}] ${n.tag.padEnd(6)} | ` +
        `children:${n.childCount} | ` +
        `modal:${n.isInModal} | ` +
        `classes:"${n.classes.substring(0, 40)}" | ` +
        `"${n.text.substring(0, 60)}"`
      );
    });
    console.log(`📋 End snapshot\n`);
  }

  // ── Run ALL field validations in parallel ─────────────────────
  const validations = rules.map(async (rule) => {
    const field = (rule.Field || '').trim();
    if (!field) return null;

    // ── Skip rate plan rows that don't match current rate plan ──
    const rowRatePlan = (rule['Rate Plan'] || '').trim().toLowerCase();
    if (
      rowRatePlan &&
      rowRatePlan !== 'all' &&
      rowRatePlan !== ratePlan
    ) {
      console.log(`  ⏭️  Skipping [${field}] — rate plan "${rowRatePlan}" != "${ratePlan}"`);
      return null;
    }

    let expected: string;
    try {
      expected = resolveExpected(rule, eventData);
    } catch (e: any) {
      expected = String(rule.Expected ?? '');
    }

    let actual: string;
    try {
      actual = await getActualValue(page, field, variant, eventData, snapshot);
    } catch {
      actual = 'N/A';
    }

    const status = compare(actual, expected, rule.Type) ? 'PASS' : 'FAIL';
    return { field, expected, actual, status };
  });

  const validationResults = await Promise.all(validations);

  for (const result of validationResults) {
    if (!result) continue;
    const { field, expected, actual, status } = result;
    console.log(
      `  ${status === 'PASS' ? '✅' : '❌'} [${field}]` +
      `  expected="${expected}"  actual="${actual}"`
    );

    // ── Push result with tier & ratePlan for excelWriter ────────
    results.push({
      page:     pageName,
      variant,
      tier,
      ratePlan,
      field,
      expected,
      actual,
      status,
    });
  }
};