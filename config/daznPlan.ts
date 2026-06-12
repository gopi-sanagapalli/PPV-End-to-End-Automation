import { getActualValue } from '../utils/getActualValue';
import { resolveExpected } from '../utils/resolveExpected';
import { compare } from '../utils/compare';

// Optional: keep this if you still want card expansion behavior
const expandInitialView = async (page: any) => {
  // Trigger lazy load
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
  await page.waitForTimeout(500);
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  await page.waitForTimeout(300);
};

export const validateDaznPlan = async (
  page: any,
  data: any[],
  results: any[],
  eventData: any
) => {

  const pageName = 'DAZN Plan Page';
  const variant = 'dazn-plan';

  console.log('🚀 Validating DAZN Plan Page...');

  // ─────────────────────────────
  // Step 1: Stabilize page
  // ─────────────────────────────
  await expandInitialView(page);

  // ─────────────────────────────
  // Step 2: Normalize data
  // ─────────────────────────────
  const rows = data
    .filter(row => row.Field && row.Field !== 'Field')
    .map(row => ({
      field: row.Field,
      expectedTemplate: row.Expected
    }));

  // ─────────────────────────────
  // Step 3: Validate each field
  // ─────────────────────────────
  for (const row of rows) {

    const field = row.field;

    // 🔥 Resolve expected from template
    const expected = resolveExpected(
      { Expected: row.expectedTemplate },
      eventData
    );

    // 🔥 Get actual from UI
    const actual = await getActualValue(page, field);

    // 🔥 Decide comparison type
    const type =
      /price|name|date|title|cta|tier/i.test(field)
        ? 'equals'
        : /present|selected/i.test(field)
        ? 'equals'
        : 'contains';

    const status = compare(type, actual, expected);

    results.push({
      page: pageName,
      field,
      expected,
      actual,
      status: status ? 'PASS' : 'FAIL'
    });

    if (!status) {
      console.log(`❌ ${field}`);
      console.log(`   Expected: ${expected}`);
      console.log(`   Actual  : ${actual}`);
    } else {
      console.log(`✅ ${field}`);
    }
  }

  console.log('🎯 DAZN Plan validation completed');
};