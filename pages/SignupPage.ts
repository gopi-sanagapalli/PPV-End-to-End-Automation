import { Page, Locator } from '@playwright/test';
import selectors from '../config/selectors.json';

export class SignupPage {
  constructor(private page: Page) {}

  // ─────────────────────────────
  // FIND EMAIL INPUT
  // ─────────────────────────────
  async findEmailInput(): Promise<Locator | null> {
    const input = this.page.locator('input[type="email"]').first();
    if (await input.isVisible().catch(() => false)) {
      return input;
    }
    return null;
  }

  // ─────────────────────────────
  // ENTER EMAIL
  // ─────────────────────────────
  async enterEmail(emailValue: string) {
    const input = this.page.locator('input[type="email"]').first();

    // Single clean wait — no double waitFor
    await input.waitFor({ state: 'visible', timeout: 10000 });

    await input.click({ force: true });
    await input.fill(emailValue);

    // Trigger React onChange
    await input.dispatchEvent('input');

    const value = await input.inputValue();
    if (!value || value.length < 5) {
      throw new Error('❌ Email NOT entered properly');
    }

    console.log(`✅ Email entered: ${emailValue}`);
  }

  // ─────────────────────────────
  // CLICK CONTINUE (EMAIL STEP)
  // ─────────────────────────────
  async clickContinue() {
    const btn = this.page.locator('button:has-text("Continue")').first();

    await btn.waitFor({ state: 'visible', timeout: 8000 });
    await btn.scrollIntoViewIfNeeded().catch(() => {});
    await btn.click({ force: true });

    // Wait for SPA transition
    await this.page.waitForLoadState('domcontentloaded').catch(() => {});
    await this.page.waitForTimeout(500);
  }

  // ─────────────────────────────
  // WAIT FOR NEXT STEP
  // ─────────────────────────────
  async waitForNextStep(): Promise<'personalDetails' | 'next'> {
    const firstName = this.page.locator(selectors.signup.firstName);
    try {
      await firstName.waitFor({ state: 'visible', timeout: 5000 });
      return 'personalDetails';
    } catch {}
    return 'next';
  }

  // ─────────────────────────────
  // FILL PERSONAL DETAILS
  // ─────────────────────────────
  async fillPersonalDetails(user: any) {
    const firstName = this.page.locator(selectors.signup.firstName);
    const lastName  = this.page.locator(selectors.signup.lastName);
    const password  = this.page.locator(selectors.signup.password);

    // Wait for form to be ready
    await firstName.waitFor({ state: 'visible', timeout: 10000 });

    // Ensure page is not closed before filling
    if (this.page.isClosed()) {
      throw new Error('❌ Page closed before filling personal details');
    }

    await firstName.fill(user.firstName || 'Test');
    await lastName.fill(user.lastName  || 'User');
    await password.fill(user.password  || 'Test@12345');

    // Small stabilization for React forms
    await this.page.waitForTimeout(500);

    console.log('✅ Personal details filled');
  }

  // ─────────────────────────────
  // CLICK CONTINUE (PERSONAL DETAILS)
  // ─────────────────────────────
  async clickPersonalDetailsContinue() {
    const btn = this.page.locator(selectors.signup.continueButtonStep2).first();

    await this.page.waitForTimeout(500);

    if (!(await btn.isVisible().catch(() => false))) {
      throw new Error('❌ Continue button NOT visible on personal details page');
    }

    await btn.scrollIntoViewIfNeeded().catch(() => {});
    await btn.click({ force: true });

    await this.page.waitForLoadState('domcontentloaded').catch(() => {});
    console.log('✅ Personal details Continue clicked');
  }
}