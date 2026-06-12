import { validateField }    from '../utils/validator';
import { getActualValue }   from '../utils/getActualValue';
import { resolveExpected }  from '../utils/resolveExpected';

export const validateVariant1 = async (
  page:      any,
  data:      any[],
  results:   any[],
  eventData: any
) => {
  const pageName = 'PPV page';
  const variant  = 'variant1';

  console.log('🚀 Running Variant 1 Validation...');

  // Stabilize lazy content
  await page.evaluate(
    () => window.scrollTo(0, document.body.scrollHeight)
  ).catch(() => {});
  await page.waitForTimeout(800);
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  await page.waitForTimeout(400);

  for (const row of data) {
    const field            = row.Field;
    const expectedTemplate = row.Expected;

    if (!field || field === 'Field') continue;

    const expected = resolveExpected(
      { Expected: expectedTemplate },
      eventData
    );

    const actual = await getActualValue(page, field, variant, eventData);

    validateField(
      results,
      pageName,
      field,
      expected,
      String(actual).trim(),
      variant
    );
  }

  console.log('✅ Variant 1 Validation Complete');
};