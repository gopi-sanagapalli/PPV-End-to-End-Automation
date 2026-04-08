type ValidationResult = {
  page: string;
  field: string;
  expected: unknown;
  actual: unknown;
  status: 'PASS' | 'FAIL';
  variant?: string;
};

/**
 * Displays test results in a formatted table
 * @param results - Array of validation results
 * @param variant - Detected variant name
 */
export function displayResultsTable(results: ValidationResult[], variant: string = 'unknown'): void {
  console.log('\n' + '═'.repeat(100));
  console.log('📊 TEST RESULTS SUMMARY');
  console.log('═'.repeat(100));

  const totalPass = results.filter(r => r.status === 'PASS').length;
  const totalFail = results.filter(r => r.status === 'FAIL').length;

  console.log(`Variant: ${variant}`);
  console.log(`Total: ${results.length} | ✅ Pass: ${totalPass} | ❌ Fail: ${totalFail}`);
  console.log('═'.repeat(100));
}