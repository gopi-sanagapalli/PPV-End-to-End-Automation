import { IOSBasePage, WdBrowser } from './IOSBasePage';
import { IOSValidationResult } from './IOSValidationPage';
import { IOSSafariValidationPage } from './IOSSafariValidationPage';

/**
 * DAZN account creation in Safari. This is shared by every iOS source after
 * its source-specific Safari page has selected the PPV purchase CTA.
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

  private getRequestedPlan(): { plan: string; tier: string; ratePlan: string; label: string; terms: string[] } {
    const plan = (process.env.PLAN || 'standard_monthly').toLowerCase().replace(/[\s-]+/g, '_');
    // ppv.handoff.spec.ts resolves TIER/RATE_PLAN from DaznPlan.json before
    // this page object is created. The PLAN-based fallbacks keep this usable
    // for other iOS source flows as well.
    const tier = (process.env.TIER || process.env.PLAN_TIER ||
      (plan.includes('ultimate') ? 'ultimate' : 'standard')).toLowerCase();
    const ratePlan = (process.env.RATE_PLAN ||
      (plan.includes('upfront') ? 'annual pay upfront' : plan.includes('apm') || plan.includes('annual') ? 'annual pay monthly' : 'monthly')).toLowerCase();

    if (tier === 'ultimate') {
      // The Ultimate plan-selection screen labels its cards only with the
      // payment cadence (not "Ultimate"), so do not require the tier word in
      // the locator.  Requiring it made ultimate_upfront impossible to select.
      if (ratePlan.includes('upfront')) return { plan, tier, ratePlan, label: 'DAZN Ultimate – Annual Pay Upfront', terms: ['annual', 'upfront'] };
      if (ratePlan.includes('annual')) return { plan, tier, ratePlan, label: 'DAZN Ultimate – Annual Pay Monthly', terms: ['annual', 'pay monthly'] };
      return { plan, tier, ratePlan, label: 'DAZN Ultimate', terms: ['ultimate'] };
    }
    if (ratePlan.includes('upfront')) return { plan, tier, ratePlan, label: 'Annual – Pay Upfront', terms: ['annual', 'upfront'] };
    if (ratePlan.includes('annual')) return { plan, tier, ratePlan, label: 'Annual – Pay Monthly', terms: ['annual', 'pay monthly'] };
    return { plan, tier, ratePlan, label: 'Flex – Pay Monthly', terms: ['flex', 'pay monthly'] };
  }

  private async selectRequestedPlan(): Promise<void> {
    const requested = this.getRequestedPlan();
    const predicates = requested.terms.map(term =>
      `contains(translate(normalize-space(.), "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "${term}")`
    ).join(' and ');
    const option = await this.firstVisible([
      // DAZN exposes plan cards as labels/roles depending on the experiment.
      // Restrict the locator to actionable card elements so a heading or page
      // wrapper containing every plan cannot be selected by accident.
      `//*[self::label or self::button or @role="radio" or @role="button" or @role="option"][${predicates}]`,
    ]);

    if (!option) {
      throw new Error(
        `Requested Safari plan "${requested.plan}" (${requested.label}) was not exposed on the plan screen; refusing to continue with DAZN's default plan.`
      );
    }

    await option.scrollIntoView().catch(() => { });
    await option.click();
    await this.driver.pause(800);
    console.log(`✅ Selected Safari plan from DaznPlan.json: ${requested.label}`);
  }

  async completeToPayment(results: IOSValidationResult[], eventName = '', eventData?: Record<string, any>): Promise<void> {
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

    for (let step = 0; step < 12; step++) {
      const body = await this.text();
      const lower = body.toLowerCase();
      const url = await this.driver.getUrl();
      console.log(`Safari account step ${step + 1}: ${url}`);

      if (/payment method|choose how to pay|card number|payment details/.test(lower)) {
        // ── Validate Payment page before returning ──
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

      const passwordInput = await this.firstVisible([
        'input[type="password"]', 'input[name*="password" i]', 'input[autocomplete="current-password"]',
      ]);
      const firstNameInput = await this.firstVisible([
        'input[name*="first" i]', 'input[autocomplete="given-name"]', 'input[placeholder*="first name" i]',
      ]);
      if (firstNameInput && passwordInput) {
        await firstNameInput.setValue(firstName);
        // DAZN re-renders the personal-details form after every input event.
        // Re-find fields after each write instead of holding stale elements.
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

      // Existing users see a password-only screen after their email is
      // recognised. New users reach this branch only if DAZN presents a
      // combined sign-in page, in which case we deliberately stop instead of
      // submitting a new-user password into an existing account.
      if (passwordInput && isExistingUser) {
        await passwordInput.setValue(password);
        if (!await this.clickContinue()) throw new Error('Safari sign-in Continue button was not available.');
        continue;
      }

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

      const isContextualPpvPage = /pay-per-view, you.ll need a dazn plan|ultimate fan package/.test(lower);
      if (isContextualPpvPage) {
        // ── Validate PPV page before interacting ──
        if (eventData) {
          try {
            await new IOSSafariValidationPage(this.driver).validatePPVPage(eventData, results);
          } catch (err: any) {
            console.warn(`⚠️ PPV page validation error: ${err.message}`);
          }
        }
        const wantsUltimate = this.getRequestedPlan().tier === 'ultimate';
        const targetText = wantsUltimate ? 'Ultimate' : (eventName.split(/\s+vs\.?\s+/i)[0] || 'pay-per-view');
        const ppvOrUltimate = await this.firstVisible([
          `//*[self::label or self::button or @role="radio" or @role="button"][contains(translate(normalize-space(.), "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "${targetText.toLowerCase()}")]`,
        ]);
        if (!ppvOrUltimate) {
          throw new Error(`Requested contextual ${wantsUltimate ? 'Ultimate' : 'PPV'} option was not exposed.`);
        }
        await ppvOrUltimate.click();
        console.log(`✅ Selected contextual PPV option: ${wantsUltimate ? 'Ultimate' : 'PPV'}`);
        await this.driver.pause(800);
      }

      // The contextual PPV journey can present a plan page after account
      // creation/sign-in. Select the requested tier/rate plan before its
      // Continue CTA is used; otherwise DAZN's default selection can make the
      // test exercise the wrong product.
      if (!isContextualPpvPage && (/choose (your|the right) plan|choose how to buy/.test(lower) ||
        (/page=PlanDetails/i.test(url) && /flex|annual|pay monthly|pay upfront/.test(lower)))) {
        // Select first, then validate selection-dependent rows such as
        // "Flex Selected". Validating before this click only reports DAZN's
        // initial/default radio state, not the plan requested by the test.
        await this.selectRequestedPlan();

        // ── Validate the selected Plan page ──
        if (eventData) {
          try {
            await new IOSSafariValidationPage(this.driver).validatePlanPage(eventData, results);
          } catch (err: any) {
            console.warn(`⚠️ Plan page validation error: ${err.message}`);
          }
        }
      }

      const progressed = await this.firstVisible([
        'button*=Continue with pay-per-view', 'button*=Continue with PPV',
        'button*=Continue with DAZN', 'button*=Continue', 'button*=Next', 'button[type="submit"]',
      ]);
      if (!progressed) {
        // The account SPA can display its headings before it mounts the input
        // controls. Wait for that render instead of failing immediately after
        // landing on page=emailDetails.
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
