import { IOSBasePage, WdBrowser } from './IOSBasePage';
import { IOSValidationResult } from './IOSValidationPage';
import { IOSSafariValidationPage } from './IOSSafariValidationPage';
import { IOSPPVPage } from './IOSPPVPage';
import { IOSPlanPage } from './IOSPlanPage';
import { IOSMyAccountPage } from './IOSMyAccountPage';

/**
 * DAZN account creation / sign-in in Safari. This page object handles only
 * the signup and signin screens (email, password, personal details, payment).
 *
 * Contextual PPV page logic is in IOSPPVPage.
 * Plan selection logic is in IOSPlanPage.
 */
export class IOSSignupPage extends IOSBasePage {
  constructor(driver: WdBrowser) {
    super(driver);
  }

  private async firstVisible(selectors: string[]): Promise<any | null> {
    for (const selector of selectors) {
      try {
        const elements = await this.driver.$$(selector);
        for (const element of elements) {
          if (await element.isDisplayed().catch(() => false)) return element;
        }
      } catch { }
    }
    return null;
  }

  private async clickContinue(): Promise<boolean> {
    const button = await this.firstVisible([
      'button[type="submit"]', 'button*=Continue', '[role="button"]*=Continue',
    ]);
    if (!button) return false;
    await button.click();
    await this.driver.pause(1800);
    // Account transitions can re-open OneTrust. This was the established
    // working Safari behaviour; keep the check at transition boundaries.
    await this.handleSafariCookies(5000);
    return true;
  }

  private async text(): Promise<string> {
    return this.driver.execute(() => document.body?.innerText || '').catch(() => '');
  }

  async completeToPayment(results: IOSValidationResult[], eventName = '', eventData?: Record<string, any>): Promise<void> {
    this.resetCookieConsentCache();
    await this.handleSafariCookies(5000);
    const userState = (process.env.USER_STATE || 'new').toLowerCase();
    const isExistingUser = !userState.startsWith('new') || !!process.env.USER_EMAIL;
    const email = isExistingUser
      ? (process.env.USER_EMAIL || '')
      : `newuser.ios.${Date.now()}@yopmail.com`;
    const firstName = process.env.IOS_NEW_USER_FIRST_NAME || 'UAT';
    const lastName = process.env.IOS_NEW_USER_LAST_NAME || 'User';
    const password = isExistingUser
      ? (process.env.USER_PASSWORD || '')
      : (process.env.IOS_NEW_USER_PASSWORD || 'Dazn@1234');

    if (isExistingUser && (!email || !password)) {
      throw new Error('Existing-user Safari checkout requires USER_EMAIL and USER_PASSWORD.');
    }

    const ppvPage = new IOSPPVPage(this.driver);
    const planPage = new IOSPlanPage(this.driver);

    for (let step = 0; step < 12; step++) {
      const body = await this.text();
      const lower = body.toLowerCase();
      const url = await this.driver.getUrl();
      console.log(`Safari account step ${step + 1}: ${url}`);

      // ── Payment page (terminal) ──
      if (/payment method|choose how to pay|card number|payment details/.test(lower)) {
        if (eventData) {
          try {
            await new IOSSafariValidationPage(this.driver).validatePaymentPage(eventData, results);
          } catch (err: any) {
            console.warn(`⚠️ Payment page validation error: ${err.message}`);
          }
        }
        results.push({ page: 'iOS Safari', field: 'Payment page reached', expected: 'Yes', actual: 'Yes', status: 'PASS' });
        return;
      }

      // ── PPV Payment page (active_standard saved-card checkout) ──
      if (/one time payment|pay now/i.test(lower) && /visa|mastercard|amex|\*{4}|saved card/i.test(lower)) {
        if (eventData) {
          try {
            await new IOSSafariValidationPage(this.driver).validatePPVPaymentPage(eventData, results);
          } catch (err: any) {
            console.warn(`⚠️ PPV payment page validation error: ${err.message}`);
          }
        }
        results.push({ page: 'iOS Safari', field: 'PPV Payment page reached', expected: 'Yes', actual: 'Yes', status: 'PASS' });
        return;
      }

      // ── My Account PPV page (active_ultimate — PPV already purchased) ──
      const myAccountPage = new IOSMyAccountPage(this.driver);
      if (myAccountPage.isSafariPurchasedPPVPage(lower, url)) {
        await myAccountPage.validateSafariPurchasedPPV(results as any, eventName);
        return;
      }


      // ── Personal details (first name + password visible) ──
      const passwordInput = await this.firstVisible([
        'input[type="password"]', 'input[name*="password" i]', 'input[autocomplete="current-password"]',
      ]);
      const firstNameInput = await this.firstVisible([
        'input[name*="first" i]', 'input[autocomplete="given-name"]', 'input[placeholder*="first name" i]',
      ]);
      if (firstNameInput && passwordInput) {
        await firstNameInput.setValue(firstName);
        const lastNameInput = await this.firstVisible([
          'input[name*="last" i]', 'input[autocomplete="family-name"]', 'input[placeholder*="last name" i]',
        ]);
        if (!lastNameInput) throw new Error('Safari sign-up last-name field disappeared after entering first name.');
        await lastNameInput.setValue(lastName);
        const freshPasswordInput = await this.firstVisible([
          'input[type="password"]', 'input[name*="password" i]', 'input[autocomplete="new-password"]',
        ]);
        if (!freshPasswordInput) throw new Error('Safari sign-up password field disappeared after entering personal details.');
        await freshPasswordInput.setValue(password);
        if (!await this.clickContinue()) throw new Error('Safari sign-up personal-details Continue button was not available.');
        continue;
      }

      // ── Existing user sign-in (password only) ──
      if (passwordInput && isExistingUser) {
        await passwordInput.setValue(password);
        if (!await this.clickContinue()) throw new Error('Safari sign-in Continue button was not available.');
        continue;
      }

      // ── Email entry ──
      const emailInput = await this.firstVisible([
        'input[type="email"]', 'input[name*="email" i]', 'input[autocomplete="email"]',
        'input[placeholder*="email" i]', 'input[aria-label*="email" i]', 'input', '[role="textbox"]',
      ]);
      if (emailInput) {
        await emailInput.click();
        await emailInput.setValue(email);
        if (!await this.clickContinue()) throw new Error('Safari sign-up email Continue button was not available.');
        continue;
      }

      // ── Contextual PPV page (delegated to IOSPPVPage) ──
      const isContextualPpvPage = ppvPage.isContextualPPVPage(lower);
      if (isContextualPpvPage) {
        await ppvPage.validateAndSelectOption(results, eventName, eventData);
      }

      // ── "Choose how to buy" page (active_standard users, delegated to IOSPPVPage) ──
      if (!isContextualPpvPage && ppvPage.isChooseHowToBuyPage(lower)) {
        await ppvPage.validateAndClickBuyNow(results, eventData);
        continue;
      }

      // ── Plan selection page (delegated to IOSPlanPage) ──
      if (!isContextualPpvPage && planPage.isPlanPage(lower, url)) {
        await planPage.validateAndSelect(results, eventData);
      }

      // ── Click Continue / Next to progress ──
      const progressed = await this.firstVisible([
        'button*=Continue with pay-per-view', 'button*=Continue with PPV',
        'button*=Continue with DAZN', 'button*=Continue', 'button*=Next', 'button[type="submit"]',
      ]);
      if (!progressed) {
        if (/log in or sign up|email address|finish signing up/.test(lower) || /page=(emailDetails|personalDetails)/i.test(url)) {
          console.log('⏳ Safari account form is still rendering; waiting for editable controls.');
          await this.driver.pause(1500);
          continue;
        }
        const inputs = await this.driver.$$('input, [role="textbox"]');
        const descriptions: string[] = [];
        for (const input of inputs) {
          descriptions.push([
            await input.getAttribute('type').catch(() => ''),
            await input.getAttribute('name').catch(() => ''),
            await input.getAttribute('placeholder').catch(() => ''),
            await input.getAttribute('aria-label').catch(() => ''),
          ].filter(Boolean).join(':'));
        }
        throw new Error(`Safari account page exposed no supported action. Inputs: ${descriptions.join(', ') || 'none'}`);
      }
      await progressed.click();
      await this.driver.pause(1800);
      await this.handleSafariCookies(5000);
    }

    results.push({ page: 'iOS Safari', field: 'Payment page reached', expected: 'Yes', actual: 'No', status: 'FAIL' });
    throw new Error('Safari sign-up did not reach the payment page.');
  }
}
