type ValidationResult = {
  page: string;
  field: string;
  expected: unknown;
  actual: unknown;
  status: 'PASS' | 'FAIL';
  variant?: string;
};

/**
 * Displays concise summary of validation results
 */
export function displayResultsTable(
  results: ValidationResult[],
  variant: string = 'unknown'
): void {

  const total = results.length;
  const totalPass = results.filter(r => r.status === 'PASS').length;
  const totalFail = results.filter(r => r.status === 'FAIL').length;

  const passPercent = total === 0
    ? 0
    : ((totalPass / total) * 100).toFixed(2);

  console.log('\n' + '═'.repeat(60));
  console.log('📊 TEST SUMMARY');
  console.log('═'.repeat(60));

  console.table([
    {
      Variant: variant,
      Total: total,
      Passed: totalPass,
      Failed: totalFail,
      'Pass %': `${passPercent}%`,
    }
  ]);

  console.log('═'.repeat(60));

  // 🔥 OPTIONAL: show failed fields only (high signal)
  if (totalFail > 0) {
    console.log('\n❌ FAILED FIELDS:');

    console.table(
      results
        .filter(r => r.status === 'FAIL')
        .map(r => ({
          Page: r.page,
          Field: r.field,
          Expected: r.expected,
          Actual: r.actual,
        }))
    );
  }
}