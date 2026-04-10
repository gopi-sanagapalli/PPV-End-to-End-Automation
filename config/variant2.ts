import { validateField } from '../utils/validator';
import { getActualValue } from '../utils/getActualValue';
import { resolveExpected } from '../utils/resolveExpected';

export const validateVariant2 = async (
  page: any,
  data: any[],
  results: any[],
  eventData: any
) => {

  const pageName = 'PPV page';
  const variant = 'variant2';

  console.log('🚀 Running Variant 2 Validation...');

  // 🔥 Stabilize page (lazy load fix)
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
  await page.waitForTimeout(800);
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  await page.waitForTimeout(400);

  for (const row of data) {

    const field = row.Field;
    const expectedTemplate = row.Expected;

    if (!field || field === 'Field') continue;

    // 🔥 Build expected dynamically
    const expected = resolveExpected(
      { Expected: expectedTemplate },
      eventData
    );

    // 🔥 Extract actual (centralized)
    const actual = await getActualValue(page, field);

    validateField(
      results,
      pageName,
      field,
      expected,
      String(actual).trim(),
      variant
    );
  }

  console.log('✅ Variant 2 Validation Complete');
};