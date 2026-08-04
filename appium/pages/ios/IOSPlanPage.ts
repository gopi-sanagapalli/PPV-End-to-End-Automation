import { IOSBasePage, WdBrowser } from './IOSBasePage';
import { IOSValidationResult } from './IOSValidationPage';
import { IOSSafariValidationPage } from './IOSSafariValidationPage';
import { IOSPPVPage } from './IOSPPVPage';

/**
 * Handles the DAZN plan-selection page in Safari ("Choose a plan that's right
 * for you").
 *
 * This page displays radio-style plan cards (Flex, Annual Pay Monthly, Annual
 * Pay Upfront) and a Continue CTA. The default selection is "Annual - Pay
 * Monthly"; if the test requests a different plan (e.g. upfront), the correct
 * card must be clicked before validation and before Continue.
 */
export class IOSPlanPage extends IOSBasePage {
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

  /** Returns true when the visible page text/URL matches the DAZN plan page. */
  isPlanPage(bodyTextLower: string, url: string): boolean {
    return (
      /choose (your|the right) plan|choose how to buy/.test(bodyTextLower) ||
      (/page=PlanDetails/i.test(url) && /flex|annual|pay monthly|pay upfront/.test(bodyTextLower))
    );
  }

  /**
   * Resolve the requested plan/tier from environment variables.
   * Delegates to IOSPPVPage.getRequestedPlan() for consistency.
   */
  private getRequestedPlan() {
    // Re-use the shared resolver so both pages always agree.
    return new IOSPPVPage(this.driver).getRequestedPlan();
  }

  /**
   * Read selection state from the current document, rather than a plan-card
   * element retained across React's rerender after a radio click.
   */
  private async isRequestedPlanSelected(terms: string[]): Promise<boolean> {
    return this.driver.execute((requestedTerms: string[]) => {
      const hasTermsNear = (element: Element): boolean => {
        let node: HTMLElement | null = element as HTMLElement;
        // Stop before the page root: its text contains every plan and would
        // make the already-selected default card look like Pay Upfront.
        for (let depth = 0; node && node !== document.body && depth < 7; depth++, node = node.parentElement) {
          const text = (node.textContent || '').toLowerCase();
          if (requestedTerms.every(term => text.includes(term))) return true;
        }
        return false;
      };

      for (const radio of Array.from(document.querySelectorAll<HTMLInputElement>('input[type="radio"]'))) {
        if (radio.checked && hasTermsNear(radio)) return true;
      }
      for (const option of Array.from(document.querySelectorAll<HTMLElement>('label, [role="radio"], [role="option"]'))) {
        const selected = option.getAttribute('aria-checked') === 'true'
          || option.getAttribute('data-selected') === 'true'
          || option.getAttribute('data-state') === 'checked';
        if (selected && hasTermsNear(option)) return true;
      }
      return false;
    }, terms).catch(() => false);
  }

  /**
   * Click the plan card matching the test's requested tier/ratePlan.
   */
  async selectRequestedPlan(): Promise<void> {
    const requested = this.getRequestedPlan();
    const predicates = requested.terms.map(term =>
      `contains(translate(normalize-space(.), "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "${term}")`
    ).join(' and ');
    let option = await this.firstVisible([
      `//*[self::label or self::button or @role="radio" or @role="button" or @role="option"][${predicates}]`,
    ]);

    // Safari can expose a plan card as a generic container with only the
    // inner radio input accessible. In that tree the wrapper selector above
    // cannot see Annual/Upfront even though the requested card is available.
    if (!option) {
      const radios = await this.driver.$$('input[type="radio"]').catch(() => []);
      for (const radio of radios) {
        const matchesRequestedPlan = await this.driver.execute((input: HTMLInputElement, terms: string[]) => {
          const container = input.closest('label, [role="radio"], [role="option"]') || input.parentElement;
          if (!container) return false;
          const style = window.getComputedStyle(container);
          const box = container.getBoundingClientRect();
          if (style.display === 'none' || style.visibility === 'hidden' || box.width === 0 || box.height === 0) return false;
          const text = (container?.textContent || '').toLowerCase();
          return terms.every(term => text.includes(term));
        }, radio, requested.terms).catch(() => false);
        if (matchesRequestedPlan) {
          option = radio;
          break;
        }
      }
    }

    if (!option) {
      throw new Error(
        `Requested Safari plan "${requested.plan}" (${requested.label}) was not exposed on the plan screen; refusing to continue with DAZN's default plan.`
      );
    }

    await option.scrollIntoView().catch(() => { });

    // ── Step 1: JS-click the inner radio input directly ───────────────────────
    // React-based radio groups often require the <input> itself to be clicked,
    // not the wrapper card. A native click on the card div can fail silently.
    const clickMethod = await this.driver.execute((el: HTMLElement) => {
      const radio = (el.matches('input[type="radio"]') ? el as HTMLInputElement : null)
        ?? el.querySelector<HTMLInputElement>('input[type="radio"]')
        ?? el.closest<HTMLElement>('label')?.querySelector<HTMLInputElement>('input[type="radio"]');
      if (radio) { radio.click(); return 'radio-input'; }
      (el as HTMLElement).click();
      return 'element-js';
    }, option).catch(() => null as string | null);
    console.log(`🖱️ Plan selection click via: ${clickMethod ?? 'native-fallback'}`);

    // ── Step 2: Verify a fresh post-click document state ────────────────────
    let isNowSelected = await this.driver.waitUntil(
      () => this.isRequestedPlanSelected(requested.terms),
      { timeout: 3000, interval: 250, timeoutMsg: `Requested plan "${requested.plan}" did not become selected.` },
    ).then(() => true).catch(() => false);

    if (!isNowSelected) {
      // Fallback: native WdIO click (triggers real pointer events via Appium)
      console.log('⚠️ JS click did not update radio state — retrying with native click.');
      await option.click();
      isNowSelected = await this.driver.waitUntil(
        () => this.isRequestedPlanSelected(requested.terms),
        { timeout: 3000, interval: 250, timeoutMsg: `Requested plan "${requested.plan}" did not become selected after native click.` },
      ).then(() => true).catch(() => false);
      if (!isNowSelected) {
        throw new Error(`Requested Safari plan "${requested.plan}" did not become selected after clicking ${requested.label}.`);
      }
    }

    console.log(`✅ Selected Safari plan: ${requested.label}`);
  }

  /** Continue using the CTA for the plan tier that was just verified. */
  async continueWithSelectedPlan(): Promise<void> {
    const requested = this.getRequestedPlan();
    const wantsUltimate = requested.tier === 'ultimate';
    const cta = await this.firstVisible(wantsUltimate
      ? [
        'button*=Continue with DAZN Ultimate',
        'button*=Continue with Ultimate',
        '[role="button"]*=Continue with DAZN Ultimate',
      ]
      : [
        'button*=Continue with DAZN Standard',
        'button*=Continue',
        '[role="button"]*=Continue',
      ]);
    if (!cta) {
      throw new Error(`Requested Safari ${wantsUltimate ? 'Ultimate' : 'Standard'} plan did not expose its Continue CTA.`);
    }
    await cta.scrollIntoView().catch(() => { });
    const urlBeforeClick = await this.driver.getUrl().catch(() => '');
    await cta.click();
    await this.driver.waitUntil(async () => {
      if ((await this.driver.getUrl().catch(() => '')) !== urlBeforeClick) return true;
      return !(await cta.isExisting().catch(() => false));
    }, {
      timeout: 8000,
      interval: 250,
      timeoutMsg: `Safari ${wantsUltimate ? 'Ultimate' : 'Standard'} plan did not transition after Continue.`,
    }).catch(() => { });
    console.log(`✅ Continued with selected Safari ${wantsUltimate ? 'Ultimate' : 'Standard'} plan.`);
  }


  /**
   * Select the requested plan, wait for the radio state to settle, validate
   * the plan page fields, then return (Continue is clicked by the caller).
   */
  async validateAndSelect(
    results: IOSValidationResult[],
    eventData?: Record<string, any>,
  ): Promise<void> {
    // Select the plan card first so validation sees the correct radio state.
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
}
