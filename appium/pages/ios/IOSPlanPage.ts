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
   * Click the plan card matching the test's requested tier/ratePlan.
   */
  async selectRequestedPlan(): Promise<void> {
    const requested = this.getRequestedPlan();
    const predicates = requested.terms.map(term =>
      `contains(translate(normalize-space(.), "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "${term}")`
    ).join(' and ');
    const option = await this.firstVisible([
      `//*[self::label or self::button or @role="radio" or @role="button" or @role="option"][${predicates}]`,
    ]);

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
      const radio = el.querySelector<HTMLInputElement>('input[type="radio"]')
        ?? el.closest<HTMLElement>('label')?.querySelector<HTMLInputElement>('input[type="radio"]');
      if (radio) { radio.click(); return 'radio-input'; }
      (el as HTMLElement).click();
      return 'element-js';
    }, option).catch(() => null as string | null);
    console.log(`🖱️ Plan selection click via: ${clickMethod ?? 'native-fallback'}`);
    await this.driver.pause(1500);

    // ── Step 2: Verify the radio state actually changed ───────────────────────
    const isNowSelected = await this.driver.execute((el: HTMLElement) => {
      const radio = el.querySelector<HTMLInputElement>('input[type="radio"]');
      if (radio) return radio.checked;
      return el.getAttribute('aria-checked') === 'true'
        || el.getAttribute('data-selected') === 'true'
        || el.getAttribute('data-state') === 'checked';
    }, option).catch(() => false);

    if (!isNowSelected) {
      // Fallback: native WdIO click (triggers real pointer events via Appium)
      console.log('⚠️ JS click did not update radio state — retrying with native click.');
      await option.click();
      await this.driver.pause(1500);
    }

    console.log(`✅ Selected Safari plan: ${requested.label}`);
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
