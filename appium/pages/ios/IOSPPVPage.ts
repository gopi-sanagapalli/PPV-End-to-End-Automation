import { IOSBasePage, WdBrowser } from './IOSBasePage';
import { IOSValidationResult } from './IOSValidationPage';
import { IOSSafariValidationPage } from './IOSSafariValidationPage';

/**
 * Handles the DAZN contextual PPV page in Safari.
 *
 * This page appears when the user needs to choose between a standalone PPV
 * purchase and DAZN Ultimate. It presents radio-style cards for each option.
 */
export class IOSPPVPage extends IOSBasePage {
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

  /** Returns true when the visible page text matches the contextual PPV page. */
  isContextualPPVPage(bodyTextLower: string): boolean {
    return /pay-per-view, you.ll need a dazn plan|ultimate fan package/.test(bodyTextLower);
  }

  /**
   * Resolve the requested plan/tier from environment variables.
   * Shared logic — also used by IOSPlanPage.
   */
  getRequestedPlan(): { plan: string; tier: string; ratePlan: string; label: string; terms: string[] } {
    const plan = (process.env.PLAN || 'standard_monthly').toLowerCase().replace(/[\s-]+/g, '_');
    const tier = (process.env.TIER || process.env.PLAN_TIER ||
      (plan.includes('ultimate') ? 'ultimate' : 'standard')).toLowerCase();
    const ratePlan = (process.env.RATE_PLAN ||
      (plan.includes('upfront') ? 'annual pay upfront' : plan.includes('apm') || plan.includes('annual') ? 'annual pay monthly' : 'monthly')).toLowerCase();

    if (tier === 'ultimate') {
      if (ratePlan.includes('upfront')) return { plan, tier, ratePlan, label: 'DAZN Ultimate – Annual Pay Upfront', terms: ['annual', 'upfront'] };
      if (ratePlan.includes('annual')) return { plan, tier, ratePlan, label: 'DAZN Ultimate – Annual Pay Monthly', terms: ['annual', 'pay monthly'] };
      return { plan, tier, ratePlan, label: 'DAZN Ultimate', terms: ['ultimate'] };
    }
    if (ratePlan.includes('upfront')) return { plan, tier, ratePlan, label: 'Annual – Pay Upfront', terms: ['annual', 'upfront'] };
    if (ratePlan.includes('annual')) return { plan, tier, ratePlan, label: 'Annual – Pay Monthly', terms: ['annual', 'pay monthly'] };
    return { plan, tier, ratePlan, label: 'Flex – Pay Monthly', terms: ['flex', 'pay monthly'] };
  }

  /**
   * Validate the contextual PPV page fields, then select the PPV or Ultimate
   * option based on the requested plan.
   */
  async validateAndSelectOption(
    results: IOSValidationResult[],
    eventName: string,
    eventData?: Record<string, any>,
  ): Promise<void> {
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
}
