import { Page, Locator } from '@playwright/test';
import selectors from '../config/selectors.json';

export class SignupPage {
  constructor(private page: Page) {}

  // ─────────────────────────────
  // FIND EMAIL INPUT (FAST + SAFE)
  // ─────────────────────────────
  async findEmailInput(): Promise<Locator | null> {
    const input = this.page.locator('input[type="email"]').first();

    if (await input.isVisible().catch(() => false)) {
      return input;
    }

    return null;
  }

  // ─────────────────────────────
  // ENTER EMAIL (FAST + RELIABLE)
  // ─────────────────────────────
  async enterEmail(emailValue: string) {
    const input = await this.page.locator('input[type="email"]').first();

 if (!(await input.isVisible().catch(() => false))) {
  await input.waitFor({ state: 'visible', timeout: 3000 });
}   await input.waitFor({ state: 'visible', timeout: 5000 });

    await input.click({ force: true });
    await input.fill(emailValue);

    // minimal trigger (enough for React)
    await input.dispatchEvent('input');

    const value = await input.inputValue();

    if (!value || value.length < 5) {
      throw new Error('❌ Email NOT entered properly');
    }
  }

  // ─────────────────────────────
  // CLICK CONTINUE (STRICT)
  // ─────────────────────────────
  async clickContinue() {
    const btn = this.page.locator('button:has-text("Continue")').first();

    await btn.waitFor({ state: 'visible', timeout: 5000 });

    await btn.click({ force: true });

    // wait for page transition OR next step
    await this.page.waitForLoadState('domcontentloaded').catch(() => {});
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
    const lastName = this.page.locator(selectors.signup.lastName);
    const password = this.page.locator(selectors.signup.password);

    await firstName.waitFor({ state: 'visible', timeout: 8000 });

    await firstName.fill(user.firstName || 'Test');
    await lastName.fill(user.lastName || 'User');
    await password.fill(user.password || 'Test@12345');

const btn = this.page.locator(selectors.signup.continueButtonStep2);

// just ensure visible — NOT enabled

// small stabilization (React forms)
await this.page.waitForTimeout(500);
  }

  // ─────────────────────────────
  // CLICK CONTINUE (PERSONAL DETAILS)
  // ─────────────────────────────
async clickPersonalDetailsContinue() {
  const btn = this.page.locator(selectors.signup.continueButtonStep2).first();

  // do NOT over-wait
  await this.page.waitForTimeout(500);

  if (!(await btn.isVisible().catch(() => false))) {
    throw new Error('❌ Continue button NOT visible on personal details page');
  }

  await btn.scrollIntoViewIfNeeded();

  // 🔥 FORCE CLICK (critical for DAZN)
  await btn.click({ force: true });

  await this.page.waitForLoadState('domcontentloaded').catch(() => {});
}
}