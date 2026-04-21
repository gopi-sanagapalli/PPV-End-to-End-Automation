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
  pageName:  string = 'PPV',
  flow?:     string   // ← new optional param: 'myaccount' | 'landing' | undefined
) => {
  if (!eventData) throw new Error('❌ eventData is missing');

  const normalizedVariant = variant.trim().toLowerCase();
  const normalizedFlow    = (flow || '').trim().toLowerCase();

  // ── Read tier & ratePlan from eventData ───────────────────────
  const tier     = (eventData.TIER      || 'standard').toLowerCase();
  const ratePlan = (eventData.RATE_PLAN || 'monthly').toLowerCase();

  const rules = data.filter(r => {
    const rv = (r.Variant  || '').trim().toLowerCase();
    const rt = (r.Tier     || '').trim().toLowerCase();
    const rf = (r.Flow     || '').trim().toLowerCase(); // ← new Flow column

    // ── Flow filtering ────────────────────────────────────────────
    // If row has a Flow restriction:
    //   - Only include if current flow matches
    //   - If no flow provided to validateVariant → exclude flow-restricted rows
    if (rf) {
      if (!normalizedFlow)          return false; // no flow context → skip restricted rows
      if (rf !== normalizedFlow)    return false; // flow mismatch → skip
    }

    // ── Variant / Tier filtering (existing logic) ─────────────────
    if (rv) return rv === normalizedVariant;
    if (rt) return rt === tier || rt === 'common';

    // No filter column — include all rows (Landing, Schedule, etc.)
    return true;
  });

  if (!rules.length) {
    throw new Error(`❌ No rules for variant: "${variant}" / tier: "${tier}"`);
  }

  console.log(`\n🔍 Validating ${pageName} — ${rules.length} fields`);
  console.log(`   💎 Tier: ${tier} | 📋 Rate Plan: ${ratePlan}`);
  if (normalizedFlow) {
    console.log(`   🔀 Flow: ${normalizedFlow}`);
  }

  // ── Scroll to trigger lazy load before snapshot ───────────────
  // Only scroll on pages that need lazy loading
  const url = page.url();
  const needsScroll =
    url.includes('/schedule') ||
    url.includes('/addon/purchase') ||     // Choose How To Buy
    url.includes('page=PlanDetails');      // DAZN Plan page

  if (needsScroll) {
    await page.evaluate(async () => {
      await new Promise<void>(resolve => {
        let scrolled = 0;
        const step   = 300;
        const delay  = 50;
        const timer  = setInterval(() => {
          window.scrollBy(0, step);
          scrolled += step;
          if (scrolled >= document.body.scrollHeight) {
            clearInterval(timer);
            resolve();
          }
        }, delay);
      });
    }).catch(() => {});

    await page.waitForTimeout(200);
    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
    await page.waitForTimeout(100);
  }

  // ── Wait for page content if on plan/upgrade pages ──────────
  const snapUrl = page.url();
  if (snapUrl.includes('PlanDetails')) {
    // Wait for plan page to load — look for radio buttons
    await page.waitForSelector('input[type="radio"]', 
      { state: 'visible', timeout: 3000 }
    ).catch(() => {});

    // FIX: If upgrade tier flow — wait for h1 to update from stale value
    // h1 may still show "Choose how to buy" from previous page
    if (snapUrl.includes('isUpgradeTierFlow=true')) {
      try {
        await page.waitForFunction(
          () => {
            const h1 = document.querySelector('h1');
            return h1 &&
              !h1.innerText.toLowerCase().includes('choose how to buy') &&
              h1.innerText.trim().length > 3;
          },
          { timeout: 4000 }
        );
        console.log('✅ h1 updated — taking snapshot');
      } catch {
        console.log('⚠️  h1 still stale — proceeding anyway');
      }
    }
  }
  if (snapUrl.includes('UpgradePlan')) {
    // Wait for confirm button
    await page.waitForSelector('button:has-text("Confirm")',
      { state: 'visible', timeout: 3000 }
    ).catch(() => {});
  }

  // ── Pre-fetch DOM snapshot ONCE ───────────────────────────────
  const snapshot = await getPageSnapshot(page);
  console.log(`📸 ${pageName} snapshot: ${snapshot.length} nodes`);

  // ── DEBUG — log all snapshot texts ───────────────────────────
  if (pageName === 'PPV' || pageName === 'DAZN Plan' || pageName === 'Upgrade Confirmation') {
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

    // ── Skip rate plan rows that don't match current rate plan ───
    const rowRatePlan = (rule['Rate Plan'] || '').trim().toLowerCase();
    if (
      rowRatePlan &&
      rowRatePlan !== 'all' &&
      rowRatePlan !== ratePlan
    ) {
      console.log(
        `  ⏭️  Skipping [${field}] — rate plan "${rowRatePlan}" != "${ratePlan}"`
      );
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