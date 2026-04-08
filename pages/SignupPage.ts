import { Page, Locator } from '@playwright/test';
import { smartClick } from '../utils/browserHelpers';
import selectors from '../config/selectors.json';

export class SignupPage {
  constructor(private page: Page) {}

  // ─────────────────────────────────────────────
  // FIND EMAIL INPUT
  // ─────────────────────────────────────────────
  async findEmailInput(): Promise<Locator | null> {
    const email = this.page.locator(selectors.signup.email).first();

    if (await email.isVisible().catch(() => false)) {
      console.log('✅ Email input found');
      return email;
    }

    console.log('⚠️ Email input not found');
    return null;
  }

  // ─────────────────────────────────────────────
  // ENTER EMAIL
  // ─────────────────────────────────────────────
  async enterEmail(emailValue: string) {
    const email = await this.findEmailInput();

    if (!email) {
      throw new Error('❌ Email input not found');
    }

    await email.fill(emailValue);
    console.log('✅ Email entered');
  }

  // ─────────────────────────────────────────────
  // CLICK CONTINUE (EMAIL PAGE)
  // ─────────────────────────────────────────────
  async clickContinue() {
    const btn = this.page.getByRole('button', {
      name: /continue|next|sign up/i
    }).first();

    await smartClick(this.page, btn, 'Signup Continue CTA', {
      waitForNav: true
    });

    console.log('✅ Signup continue clicked');
  }

  // ─────────────────────────────────────────────
  // DETECT PAGE TYPE
  // ─────────────────────────────────────────────
  async detectPageType(): Promise<'email' | 'personalDetails' | 'password' | 'unknown'> {
  const url = this.page.url();

  if (url.includes('personalDetails')) return 'personalDetails';
  if (url.includes('password')) return 'password';
  if (url.includes('emailDetails')) return 'email';

  return 'unknown';
}

  // ─────────────────────────────────────────────
  // FILL PERSONAL DETAILS
  // ─────────────────────────────────────────────
  async fillPersonalDetails(user: any) {
    console.log('🧾 Filling personal details...');

    const firstName = this.page.locator(selectors.signup.firstName);
    const lastName = this.page.locator(selectors.signup.lastName);
    const password = this.page.locator(selectors.signup.password);

    await firstName.waitFor({ state: 'visible', timeout: 10000 });

    await firstName.fill(user.firstName || 'Test');
    await lastName.fill(user.lastName || 'User');
    await password.fill(user.password || 'Test@12345');

    console.log('✅ Personal details filled');

    // wait for CTA enable
    const selector = selectors.signup.continueButtonStep2;

    await this.page.waitForFunction(
      (sel) => {
        const el = document.querySelector(sel);
        return el && !el.hasAttribute('disabled');
      },
      selector,
      { timeout: 7000 }
    );

    console.log('✅ Continue enabled');
  }

  // ─────────────────────────────────────────────
  // FIND CONTINUE BUTTON (PERSONAL DETAILS)
  // ─────────────────────────────────────────────
  async findContinueButton(): Promise<Locator | null> {
    const btn = this.page.locator(selectors.signup.continueButtonStep2).first();

    if (await btn.isVisible().catch(() => false)) {
      return btn;
    }

    console.log('⚠️ Personal details Continue button not found');
    return null;
  }

  // ─────────────────────────────────────────────
  // CLICK CONTINUE (PERSONAL DETAILS)
  // ─────────────────────────────────────────────
  async clickPersonalDetailsContinue() {
    const btn = await this.findContinueButton();

    if (!btn) {
      throw new Error('❌ Continue button not found on personal details page');
    }

    console.log('🖱️ Clicking personal details Continue...');

    await btn.scrollIntoViewIfNeeded();
    await this.page.waitForTimeout(500);

    await btn.click();

    await this.page.waitForLoadState('domcontentloaded');

    console.log('✅ Navigated after personal details');
  }
}