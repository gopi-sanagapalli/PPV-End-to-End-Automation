import { Page, Locator } from '@playwright/test';
import { smartClick } from '../utils/browserHelpers';
import selectors from '../config/selectors.json';

export class SignupPage {
  constructor(private page: Page) {}

  // ─────────────────────────────
  // FIND EMAIL INPUT
  // ─────────────────────────────
  async findEmailInput(): Promise<Locator> {
  const input = this.page.locator('input[type="email"]');
  await input.waitFor({ state: 'visible', timeout: 15000 });
  return input;
}

  // ─────────────────────────────
  // ENTER EMAIL
  // ─────────────────────────────
 async enterEmail(emailValue: string) {
  const input = await this.findEmailInput();

  await input.click({ force: true });
  await input.fill('');
await input.fill(emailValue);

// trigger React properly
await input.dispatchEvent('input');
await input.dispatchEvent('change');

  const value = await input.inputValue();

  if (!value || value.length < 5) {
    throw new Error('❌ Email NOT entered properly');
  }
}

  // ─────────────────────────────
  // CLICK CONTINUE (EMAIL PAGE)
  // ─────────────────────────────
async clickContinue() {
  const btn = this.page.locator('button[type="submit"]');

  await btn.waitFor({ state: 'visible', timeout: 10000 });

  const before = this.page.url();

  await btn.click({ force: true });

  await this.page.waitForTimeout(2500);

  const stillOnEmail = await this.page
    .locator('input[type="email"]')
    .isVisible()
    .catch(() => false);

  if (stillOnEmail) {
    console.log('⚠️ retrying submit');
    await btn.click({ force: true });
  }
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