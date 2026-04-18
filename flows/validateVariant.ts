import { resolveExpected }              from '../utils/resolveExpected';
import { getActualValue }               from '../utils/getActualValue';
import { compare }                      from '../utils/compare';
import { getPageSnapshot, DOMNode }     from '../utils/helpers';

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

  const rules = data.filter(r => {
    const rv = (r.Variant || '').trim().toLowerCase();
    return !rv || rv === normalizedVariant;
  });

  if (!rules.length) {
    throw new Error(`❌ No rules for variant: "${variant}"`);
  }

  console.log(`\n🔍 Validating ${pageName} — ${rules.length} fields`);

  // ── Pre-fetch DOM snapshot ONCE — avoids repeated DOM queries ──
  const snapshot = await getPageSnapshot(page);

  // ── Run ALL field validations in parallel ──────────────────────
  const validations = rules.map(async (rule) => {
    const field = (rule.Field || '').trim();
    if (!field) return null;

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

  // Wait for all validations to complete
  const validationResults = await Promise.all(validations);

  // Log and push results in order
  for (const result of validationResults) {
    if (!result) continue;

    const { field, expected, actual, status } = result;

    console.log(
      `  ${status === 'PASS' ? '✅' : '❌'} [${field}]` +
      `  expected="${expected}"  actual="${actual}"`
    );

    results.push({
      page:    pageName,
      variant,
      field,
      expected,
      actual,
      status,
    });
  }
};