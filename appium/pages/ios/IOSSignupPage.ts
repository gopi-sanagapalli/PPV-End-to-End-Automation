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
    const selectors = [
      'button[type="submit"]', 'input[type="submit"]', 'button*=Continue',
      '[role="button"]*=Continue', '[aria-label*="Continue" i]',
    ];
    let button: any | null = null;
    const available = await this.driver.waitUntil(async () => {
      button = await this.firstVisible(selectors);
      return Boolean(button) && await button.isEnabled().catch(() => false);
    }, {
      timeout: 10000,
      interval: 250,
      timeoutMsg: 'Safari Continue button did not become available.',
    }).then(() => true).catch(() => false);
    if (!available || !button) return false;

    // The enabled-state update can replace the button node. Re-query it so
    // the click never uses the pre-validation element reference.
    button = await this.firstVisible(selectors);
    if (!button || !await button.isEnabled().catch(() => false)) return false;

    const urlBeforeClick = await this.driver.getUrl().catch(() => '');
    await button.click();
    // Email validation re-renders this form asynchronously in Safari. Wait
    // for an observable transition instead of assuming the next page has
    // mounted after a fixed delay.
    await this.driver.waitUntil(async () => {
      if ((await this.driver.getUrl().catch(() => '')) !== urlBeforeClick) return true;
      return !(await button.isExisting().catch(() => false));
    }, {
      timeout: 8000,
      interval: 250,
      timeoutMsg: 'Safari account form did not transition after Continue.',
    }).catch(() => { });
    return true;
  }

  private async text(): Promise<string> {
    return this.driver.execute(() => document.body?.innerText || '').catch(() => '');
  }

  private async acceptKeepMeUpdatedPrompt(): Promise<boolean> {
    const keepMeUpdated = await this.firstVisible([
      'button*=Keep me updated', '[role="button"]*=Keep me updated',
      '[aria-label*="Keep me updated" i]',
    ]);
    if (!keepMeUpdated) return false;

    await keepMeUpdated.click();
    await this.driver.waitUntil(async () => !(await this.firstVisible([
      'button*=Keep me updated', '[role="button"]*=Keep me updated',
      '[aria-label*="Keep me updated" i]',
    ])), {
      timeout: 8000,
      interval: 250,
      timeoutMsg: 'Keep me updated prompt remained open after selecting it.',
    });
    console.log('✅ Selected Safari “Keep me updated” prompt.');
    return true;
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
      const isActiveStandardAddonPage = userState.startsWith('active_standard') &&
        /\/account\/addon\/purchase/i.test(url) &&
        /isupselltieronppv=true/i.test(url);
      console.log(`Safari account step ${step + 1}: ${url}`);
      if (!body.trim() && /\/account\//i.test(url)) {
        console.log('⏳ Safari account page is still rendering; waiting for WebKit content or the next redirect...');
        const pageAdvanced = await this.driver.waitUntil(async () => {
          const nextUrl = await this.driver.getUrl().catch(() => '');
          const nextText = await this.text();
          if (isActiveStandardAddonPage) {
            return /choose how to buy|one time payment|pay now/.test(nextText.toLowerCase());
          }
          return nextUrl !== url || Boolean(nextText.trim());
        }, {
          timeout: Number(process.env.IOS_SAFARI_SETTLE_TIMEOUT_MS || 35000),
          interval: Number(process.env.IOS_SAFARI_SETTLE_POLL_MS || 2000),
          timeoutMsg: `Safari account checkout did not render after loading ${url}`,
        }).then(() => true).catch(() => false);
        if (!pageAdvanced) {
          throw new Error(`Safari account checkout did not render after loading ${url}`);
        }
        continue;
      }

      // DAZN can show this optional marketing prompt immediately after either
      // sign-in or sign-up. Accept the requested option before evaluating the
      // underlying account or payment page.
      if (/keep me updated/i.test(lower) && await this.acceptKeepMeUpdatedPrompt()) continue;

      // ── PPV Payment page (active_standard checkout) ──
      // This must be evaluated before the generic payment-page condition:
      // both saved-card and payment-options PPV screens contain the
      // "Payment method" heading.
      if (/one time payment|pay now/i.test(lower) &&
        (/payment method|visa|mastercard|amex|\*{4}|saved card/i.test(lower))) {
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
        await this.driver.pause(500);
        // Re-fetch the input after click to avoid stale element references
        // caused by React re-renders. The click can trigger DOM updates that
        // invalidate the element reference held by firstVisible().
        const freshEmail = await this.firstVisible([
          'input[type="email"]', 'input[name*="email" i]', 'input[autocomplete="email"]',
          'input[placeholder*="email" i]', 'input[aria-label*="email" i]', 'input', '[role="textbox"]',
        ]);
        if (freshEmail) {
          try {
            await freshEmail.setValue(email);
          } catch {
            // If the element is still not interactable, skip email entry and
            // let the next iteration handle password entry (existing user).
            console.log('⚠️ Email input not interactable after click — skipping email entry.');
            continue;
          }
        } else {
          console.log('⚠️ Email input disappeared after click — skipping email entry.');
          continue;
        }
        if (!await this.clickContinue()) throw new Error('Safari sign-up email Continue button was not available.');
        continue;
      }

      // ── Contextual PPV page (delegated to IOSPPVPage) ──
      const isContextualPpvPage = await ppvPage.isContextualPPVPage(lower, url);
      if (isContextualPpvPage) {
        await ppvPage.validateAndSelectOption(results, eventName, eventData);
        // validateAndSelectOption submits the CTA associated with the chosen
        // PPV/Ultimate option. Do not fall through to the generic Continue
        // locator below, which prioritises the PPV CTA.
        continue;
      }

      // ── "Choose how to buy" page (active_standard users, delegated to IOSPPVPage) ──
      if (!isContextualPpvPage && ppvPage.isChooseHowToBuyPage(lower)) {
        await ppvPage.validateAndClickBuyNow(results, eventData);
        continue;
      }

      // ── Upgrade Confirmation page (active_standard → ultimate upgrade) ──
      // After selecting Ultimate on Choose How To Buy → Plan page → Continue,
      // the user lands on the Upgrade Confirmation page.
      const isUpgradeConfirmationPage = /your plan will be changed|confirm plan change|upgrade/i.test(lower) &&
        (url.includes('upgradePlan') || url.includes('upgradeTier') || url.includes('upgradeplan') || url.includes('upgradetier') || lower.includes('confirm'));
      if (isUpgradeConfirmationPage) {
        console.log('✅ Upgrade Confirmation page detected.');
        if (eventData) {
          try {
            await new IOSSafariValidationPage(this.driver).validateUpgradeConfirmationPage(eventData, results);
          } catch (err: any) {
            console.warn(`⚠️ Upgrade Confirmation page validation error: ${err.message}`);
          }
        }
        results.push({ page: 'iOS Safari', field: 'Upgrade Confirmation page reached', expected: 'Yes', actual: 'Yes', status: 'PASS' });
        return;
      }

      // ── Payment page (terminal) ──
      if (!userState.startsWith('active_standard') &&
        /payment method|choose how to pay|card number|payment details/.test(lower)) {
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

      // ── Plan selection page (delegated to IOSPlanPage) ──
      if (!isContextualPpvPage && planPage.isPlanPage(lower, url)) {
        await planPage.validateAndSelect(results, eventData);
        // The plan card has been verified above. Use its tier-specific CTA;
        // do not let the generic PPV-first Continue list choose a different
        // purchase path.
        await planPage.continueWithSelectedPlan();
        continue;
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
        // After sign-in DAZN may briefly land on /home or /welcome before
        // redirecting to the contextual PPV flow. Wait and retry.
        if (/\/home(?:[/?#]|$)|\/welcome(?:[/?#]|$)/i.test(url)) {
          console.log('⏳ Transient redirect to home/welcome after sign-in; waiting for contextual redirect...');
          await this.driver.pause(3000);
          continue;
        }
        // Account pages (e.g. /addon/purchase, /choosePlan) can take several
        // seconds to render their interactive content after the URL resolves.
        // Wait and retry so the next iteration can match the page text.
        if (/\/account\//i.test(url)) {
          if (isActiveStandardAddonPage) {
            console.log('⏳ Waiting for the active-standard add-on page to resolve...');
            await this.driver.waitUntil(async () => {
              const nextText = (await this.text()).toLowerCase();
              return /choose how to buy|one time payment|pay now/.test(nextText);
            }, {
              timeout: 15000,
              interval: 250,
              timeoutMsg: 'Active-standard add-on page did not resolve to Choose How To Buy or PPV payment.',
            }).catch(() => { });
            continue;
          }
          console.log(`⏳ Account page still rendering (${url.split('?')[0].split('/').pop()}); waiting...`);
          await this.driver.pause(3000);
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
    }

    results.push({ page: 'iOS Safari', field: 'Payment page reached', expected: 'Yes', actual: 'No', status: 'FAIL' });
    throw new Error('Safari sign-up did not reach the payment page.');
  }
}
