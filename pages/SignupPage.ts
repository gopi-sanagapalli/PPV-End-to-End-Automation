import { Page, Locator } from '@playwright/test';
import { smartClick } from '../utils/browserHelpers';
import selectors from '../config/selectors.json';

export class SignupPage {
  constructor(private page: Page) {}

  // ─────────────────────────────
  // FIND EMAIL INPUT
  // ─────────────────────────────
  async findEmailInput(): Promise<Locator | null> {
    const email = this.page.locator(selectors.signup.email).first();

    if (await email.isVisible().catch(() => false)) {
      return email;
    }

    return null;
  }

  // ─────────────────────────────
  // ENTER EMAIL
  // ─────────────────────────────
  async enterEmail(emailValue: string) {
    const email = await this.findEmailInput();

    if (!email) {
      throw new Error('❌ Email input not found');
    }

    await email.fill(emailValue);
  }

  // ─────────────────────────────
  // CLICK CONTINUE (EMAIL PAGE)
  // ─────────────────────────────
  async clickContinue() {
    const btn = this.page.getByRole('button', {
      name: /continue|next|sign up/i
    }).first();

    await smartClick(this.page, btn, 'Signup Continue CTA', {
      waitForNav: true
    });
  }

  // ─────────────────────────────
  // 🔥 WAIT FOR NEXT STEP (FIXES RACE CONDITION)
  // ─────────────────────────────
  async waitForNextStep(): Promise<'personalDetails' | 'next'> {
    const firstName = this.page.locator(selectors.signup.firstName);
    const emailStill = this.page.locator(selectors.signup.email);

    try {
      await Promise.race([
        firstName.waitFor({ state: 'visible', timeout: 7000 }),
        emailStill.waitFor({ state: 'detached', timeout: 7000 })
      ]);
    } catch {}

    if (await firstName.isVisible().catch(() => false)) {
      return 'personalDetails';
    }

    return 'next';
  }

  // ─────────────────────────────
  // FILL PERSONAL DETAILS
  // ─────────────────────────────
  async fillPersonalDetails(user: any) {
    const firstName = this.page.locator(selectors.signup.firstName);
    const lastName = this.page.locator(selectors.signup.lastName);
    const password = this.page.locator(selectors.signup.password);

    await firstName.waitFor({ state: 'visible', timeout: 10000 });

    await firstName.fill(user.firstName || 'Test');
    await lastName.fill(user.lastName || 'User');
    await password.fill(user.password || 'Test@12345');

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
  }

  // ─────────────────────────────
  // CLICK CONTINUE (PERSONAL DETAILS)
  // ─────────────────────────────
  async clickPersonalDetailsContinue() {
    const btn = this.page.locator(selectors.signup.continueButtonStep2).first();

    if (!(await btn.isVisible().catch(() => false))) {
      throw new Error('❌ Continue button not found on personal details page');
    }

    await btn.scrollIntoViewIfNeeded();
    await btn.click();

    await this.page.waitForLoadState('domcontentloaded');
  }
}