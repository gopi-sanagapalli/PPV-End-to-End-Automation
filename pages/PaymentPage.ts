import { Page } from '@playwright/test';

export class PaymentPage {
  constructor(private page: Page) {}

  // ─────────────────────────────
  // DETECT PAYMENT PAGE (STRONG)
  // ─────────────────────────────
  async isPaymentPage(): Promise<boolean> {
    const url = this.page.url();

    // 🔥 Primary signal
    if (url.includes('payment') || url.includes('checkout')) {
      return true;
    }

    // 🔥 Fallback signal
    const total = this.page.locator('[data-test-id="summary_total_value"]');

    return await total.isVisible().catch(() => false);
  }

  // ─────────────────────────────
  // GET FIELD VALUE (SCOPED + SAFE)
  // ─────────────────────────────
  async getFieldValue(field: string): Promise<string> {

    const getText = async (locator: any) =>
      (await locator.first().textContent().catch(() => ''))?.trim() || 'N/A';

    switch (field.toLowerCase()) {

      case 'page title':
        return await getText(this.page.locator('h1'));

      case 'header':
        return await getText(this.page.locator('text=/payment/i'));

      case 'ppv name':
        return await getText(this.page.locator('text=/vs\\.?/i'));

      case 'ppv price':
        return await getText(this.page.locator('text=/\\$\\d+(\\.\\d{2})?/'));

      case 'today you pay price':
        return await getText(
          this.page.locator('[data-test-id="summary_total_value"]')
        );

      case 'cancellation text':
        return await getText(this.page.locator('text=/cancel/i'));

      default:
        return 'N/A';
    }
  }

  // ─────────────────────────────
  // VALIDATION (NORMALIZED)
  // ─────────────────────────────
  async validate(data: any[], results: any[]) {

    const normalize = (val: any) =>
      String(val ?? '')
        .replace('$', '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();

    for (const row of data) {
      const field = row['Field'];
      const expected = row['Expected'];

      const actual = await this.getFieldValue(field);

      const a = normalize(actual);
      const e = normalize(expected);

      const status = a.includes(e) ? 'PASS' : 'FAIL';

      results.push({
        page: 'Payment',
        field,
        expected,
        actual,
        status
      });
    }
  }
}