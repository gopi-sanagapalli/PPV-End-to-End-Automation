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

  // ─────────────────────────────────────────────────────────────────────────
  // CHOOSE HOW TO BUY PAGE  (active_standard_* users)
  // ─────────────────────────────────────────────────────────────────────────

  /** Returns true when the visible page text is the "Choose how to buy" surface. */
  isChooseHowToBuyPage(bodyTextLower: string): boolean {
    return /choose how to buy/.test(bodyTextLower);
  }

  /**
   * Validate the "Choose how to buy" page fields (Excel sheet rows),
   * then select the appropriate option (PPV or Ultimate) based on the
   * requested plan, and click the matching CTA.
   *
   * PPV path:  validates → clicks "Buy now" / "Continue" → advances to PPV Payment
   * Ultimate path: validates → selects Ultimate → clicks "Continue with DAZN Ultimate"
   *              → lands on Plan page (handled by IOSPlanPage)
   */
  async validateAndClickBuyNow(
    results: IOSValidationResult[],
    eventData?: Record<string, any>,
  ): Promise<void> {
    if (eventData) {
      try {
        await new IOSSafariValidationPage(this.driver).validateChooseHowToBuyPage(eventData, results);
      } catch (err: any) {
        console.warn(`⚠️ Choose how to buy validation error: ${err.message}`);
      }
    }

    // Determine if the user wants Ultimate upgrade or PPV-only
    const requested = this.getRequestedPlan();
    const wantsUltimate = requested.tier === 'ultimate';

    if (wantsUltimate) {
      // ── Ultimate path ─────────────────────────────────────────────
      console.log('💎 [Choose How To Buy] Selecting DAZN Ultimate...');
      const ultimateOption = await this.firstVisible([
        '//*[self::label or self::button or @role="radio" or @role="button"][contains(translate(normalize-space(.), "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "ultimate")]',
        '//*[contains(translate(normalize-space(.), "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "dazn ultimate")]',
      ]);
      if (!ultimateOption) {
        throw new Error('DAZN Ultimate option was not found on the "Choose how to buy" page.');
      }
      await ultimateOption.click();
      await this.driver.pause(800);

      // Click "Continue with DAZN Ultimate" CTA
      const ultimateCta = await this.firstVisible([
        '//button[contains(translate(normalize-space(.), "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "continue with dazn ultimate")]',
        '//button[contains(translate(normalize-space(.), "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "continue")]',
        'button[type="submit"]',
      ]);
      if (!ultimateCta) {
        throw new Error('"Continue with DAZN Ultimate" CTA not found on "Choose how to buy" page.');
      }
      await ultimateCta.click();
      await this.driver.pause(1500);
      console.log('✅ Clicked "Continue with DAZN Ultimate" on "Choose how to buy" page.');
    } else {
      // ── PPV only path ─────────────────────────────────────────────
      console.log('🥊 [Choose How To Buy] Selecting PPV only...');

      // Click the PPV "Buy now" / "Continue" CTA to advance to PPV Payment
      const buyNow = await this.firstVisible([
        '//button[contains(translate(normalize-space(.), "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "buy now")]',
        '//button[contains(translate(normalize-space(.), "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "continue")]',
        '[role="button"]',
      ]);
      if (!buyNow) throw new Error('"Buy now" CTA not found on "Choose how to buy" page.');
      await buyNow.click();
      await this.driver.pause(1500);
      console.log('✅ Clicked "Buy now" on "Choose how to buy" page.');
    }
  }
}

