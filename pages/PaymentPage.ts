import { Page }            from '@playwright/test';
import { getActualValue }  from '../utils/getActualValue';
import { resolveExpected } from '../utils/resolveExpected';
import { compare }         from '../utils/compare';

export class PaymentPage {
  constructor(private page: Page) {}

  // ─────────────────────────────
  // IS PAYMENT PAGE
  // ─────────────────────────────
  async isPaymentPage(): Promise<boolean> {
    // Guard — page may be closed
    if (this.page.isClosed()) {
      console.log('⚠️  Page is closed — cannot check payment page');
      return false;
    }

    const url = this.page.url();
    if (url.includes('payment') || url.includes('checkout')) return true;

    return this.page
      .locator('h1')
      .filter({ hasText: /pay/i })
      .isVisible()
      .catch(() => false);
  }

  // ─────────────────────────────
  // VALIDATE
  // ─────────────────────────────
  async validate(
    data:      any[],
    results:   any[],
    eventData: Record<string, string>
  ): Promise<void> {
    // Guard — page may be closed
    if (this.page.isClosed()) {
      console.log('⚠️  Page is closed — skipping payment validation');
      return;
    }

    console.log(`\n🧾 Validating Payment page — ${data.length} fields`);

    for (const row of data) {
      const field = (row['Field'] || '').trim();
      if (!field) continue;

      let expected: string;
      try {
        expected = resolveExpected(row, eventData);
      } catch (e: any) {
        console.warn(`⚠️  resolveExpected failed for "${field}": ${e.message}`);
        expected = String(row['Expected'] ?? '');
      }

      let actual: string;
      try {
        actual = await getActualValue(this.page, field, undefined, eventData);
      } catch {
        actual = 'N/A';
      }

      const status = compare(actual, expected, row['Type']) ? 'PASS' : 'FAIL';

      console.log(
        `  ${status === 'PASS' ? '✅' : '❌'} [${field}]` +
        `  expected="${expected}"  actual="${actual}"`
      );

      results.push({
        page:     'Payment',
        field,
        expected,
        actual,
        status,
      });
    }
  }
}