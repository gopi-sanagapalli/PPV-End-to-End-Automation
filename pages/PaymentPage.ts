import { Page }            from '@playwright/test';
import { getActualValue }  from '../utils/getActualValue';
import { resolveExpected } from '../utils/resolveExpected';
import { compare }         from '../utils/compare';
import { getPageSnapshot } from '../utils/helpers';

export class PaymentPage {
  constructor(private page: Page) {}

  // ─────────────────────────────
  // IS PAYMENT PAGE
  // ─────────────────────────────
  async isPaymentPage(): Promise<boolean> {
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
    if (this.page.isClosed()) {
      console.log('⚠️  Page is closed — skipping payment validation');
      return;
    }

    console.log(`\n🧾 Validating Payment page — ${data.length} fields`);

    // ── Wait for payment page to fully load ──────────────────────
    await this.page.waitForLoadState('domcontentloaded').catch(() => {});

    // Wait for key payment element to appear
    await this.page.waitForSelector(
      'text=/Today you pay|Choose how to pay|encrypted/i',
      { timeout: 10000 }
    ).catch(() => console.log('⚠️  Payment content signal not found'));

    // ── Take snapshot ONCE for all fields ────────────────────────
    const snapshot = await getPageSnapshot(this.page);
    console.log(`📸 Payment snapshot: ${snapshot.length} nodes`);

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
        actual = await getActualValue(
          this.page,
          field,
          undefined,
          eventData,
          snapshot  // ← pass snapshot
        );
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