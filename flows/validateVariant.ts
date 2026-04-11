import { resolveExpected } from '../utils/resolveExpected';
import { getActualValue } from '../utils/getActualValue';
import { compare } from '../utils/compare';

export const validateVariant = async (
  page: any,
  variant: string,
  data: any[],
  results: any[],
  eventData: any
) => {
  if (!eventData) {
    throw new Error('❌ eventData is missing — validation is invalid');
  }

  // console.log('🚀 Running Validation...');
  // console.log('🧠 Variant:', variant);

  const rules = data.filter(r => {
    return !r.Variant || r.Variant.trim() === variant;
  });

  for (const rule of rules) {
    const actual = await getActualValue(page, rule.Field, variant);
    const expected = resolveExpected(rule, eventData);
    const status = compare(actual, expected, rule.Type);

    if (actual === 'N/A' || actual === '') {
      // console.log(`⚠️ EMPTY ACTUAL for field: ${rule.Field}`);
    }

    if (!status) {
      // console.log(`❌ [${variant}] ${rule.Field}`);
      // console.log(`   Expected: ${expected}`);
      // console.log(`   Actual  : ${actual}`);
      // console.log(`   Type    : ${rule.Type}`);
    }

    results.push({
      page: variant,
      field: rule.Field,
      expected,
      actual,
      status: status ? 'PASS' : 'FAIL'
    });
  }
};