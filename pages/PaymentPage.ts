import { Page } from '@playwright/test';
import selectors from '../config/selectors.json';
import { validateField } from '../utils/validator';

export class PaymentPage {
  constructor(private page: Page) {}

  // ─────────────────────────────────────────────
  // CHECK IF ON PAYMENT PAGE
  // ─────────────────────────────────────────────
  async isPaymentPage(): Promise<boolean> {
    return await this.page
      .locator(selectors.payment.pageTitle)
      .isVisible()
      .catch(() => false);
  }

  // ─────────────────────────────────────────────
  // GET FIELD VALUE
  // ─────────────────────────────────────────────
  async getFieldValue(field: string): Promise<string> {
    try {
      switch (field) {

        case 'Page title':
          return (await this.page.locator(selectors.payment.pageTitle).textContent())?.trim() || '';

        case 'Header':
          return (await this.page.locator(selectors.payment.header).textContent())?.trim() || '';

        case 'Dazn tier':
          return (await this.page.locator(selectors.payment.tier).textContent())?.trim() || '';

        case 'plan change cta':
          return (await this.page.getByRole('button', { name: 'Change' }).textContent())?.trim() || '';

        case 'PPV name':
          return (await this.page.locator(selectors.payment.ppvName).textContent())?.trim() || '';

        case 'PPV price':
          return (await this.page.locator(selectors.payment.priceAll).first().textContent())?.trim() || '';

        case '7 day free text':
          return (await this.page.locator(selectors.payment.freeTrial).textContent())?.trim() || '';

        // ───────── TODAY YOU PAY TEXT ─────────
        case 'Today you pay text': {
          const el = this.page.locator('text=/Today\\s+you\\s+pay/i').first();

          if (await el.isVisible().catch(() => false)) {
            return (await el.innerText()).trim();
          }

          return 'N/A';
        }

        // ───────── TODAY YOU PAY PRICE ─────────
        case 'Today you pay price': {
          const el = this.page.locator('[data-test-id="summary_total_value"]');

          if (await el.isVisible().catch(() => false)) {
            return (await el.textContent())?.trim() || '';
          }

          return (await this.page.getByText('$').nth(3).textContent())?.trim() || 'N/A';
        }

        // ───────── NEXT PAYMENT DATE ─────────
        case 'Next payment date': {
          const text = await this.page
            .getByText(/Next payment on/i)
            .innerText()
            .catch(() => '');

          const match = text.match(/\d{2}\/\d{2}\/\d{4}/);

          if (!match) return 'FAIL';

          const [day, month, year] = match[0].split('/').map(Number);

          const actualDate = new Date(year, month - 1, day);

          const today = new Date();
          const expectedDate = new Date();
          expectedDate.setDate(today.getDate() + 7);

          actualDate.setHours(0, 0, 0, 0);
          expectedDate.setHours(0, 0, 0, 0);

          const diffDays =
            (actualDate.getTime() - expectedDate.getTime()) /
            (1000 * 60 * 60 * 24);

          return Math.abs(diffDays) <= 1 ? 'PASS' : `FAIL (${match[0]})`;
        }

        // ───────── CANCELLATION ─────────
        case 'cancellation text':
          return (await this.page.locator(selectors.payment.cancellation).textContent())?.trim() || '';

        default:
          return 'N/A';
      }
    } catch (err) {
      console.log(`⚠️ Error extracting ${field}:`, err);
      return 'N/A';
    }
  }

  // ─────────────────────────────────────────────
  // VALIDATE PAYMENT PAGE
  // ─────────────────────────────────────────────
  async validate(data: any[], results: any[]) {
    console.log('📊 Validating Payment Page...');

    for (const row of data) {
      const field = row['Field'];
      const expected = row['Expected'];

      let actual = 'N/A';

      try {
        actual = await this.getFieldValue(field);

        if (typeof actual === 'string') {
          actual = actual.trim();
        }
      } catch {
        console.log(`⚠️ Failed to extract value for ${field}`);
      }

      validateField(
        results,
        'Payment Page',
        field,
        expected,
        actual,
        'payment'
      );
    }

    console.log('✅ Payment validation completed');
  }
}