import { Page } from '@playwright/test';
import { BasePage } from './BasePage';
import { validateVariant } from '../flows/validateVariant';

/**
 * DefaultSignupPage — page object for the Default Signup flow.
 *
 * This page appears when DEFAULT_SIGNUP=true and is accessed via touchpoints
 * like "Get Started" on the Home/Welcome page.
 *
 * Key difference from the normal PPV page:
 * - Normal PPV: Only "Continue with pay-per-view" CTA
 * - Default Signup: Both "Continue with pay-per-view" AND "Subscribe without a pay-per-view"
 *
 * Validates:
 * - PPV card (title, description, price, radio state)
 * - Ultimate card (title, price, badge, features)
 * - "Continue with pay-per-view" CTA
 * - "Subscribe without a pay-per-view" link
 */
export class DefaultSignupPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  /**
   * Check if the current page is a Default Signup page.
   * The distinguishing feature is the presence of BOTH
   * "Continue with pay-per-view" AND "Subscribe without a pay-per-view".
   */
  async isDefaultSignupPage(): Promise<boolean> {
    const body = await this.page.locator('body')
      .innerText({ timeout: 3000 })
      .then(t => t.toLowerCase())
      .catch(() => '');
    return (
      body.includes('continue with pay-per-view') &&
      body.includes('subscribe without a pay-per-view')
    );
  }

  /**
   * Validate Default Signup page fields against Excel data.
   * Uses the 'Default Signup Page' sheet from the configured Excel file.
   */
  async validate(
    data: any[],
    results: any[],
    eventData: Record<string, string>,
    variant: string = 'variant1',
    flow?: string
  ): Promise<void> {
    console.log('📋 Validating Default Signup page...');
    await validateVariant(
      this.page,
      variant,
      data,
      results,
      eventData,
      'Default Signup',
      flow
    );
  }

  /**
   * Click "Continue with pay-per-view" CTA button.
   * This proceeds with the PPV + DAZN plan purchase.
   */
  async clickContinueWithPPV(): Promise<void> {
    console.log('🖱️ [DefaultSignup] Clicking "Continue with pay-per-view"...');
    const btn = this.page.locator(
      'button:has-text("Continue with pay-per-view"), ' +
      'a:has-text("Continue with pay-per-view")'
    ).first();
    await btn.waitFor({ state: 'visible', timeout: 10000 });
    await btn.scrollIntoViewIfNeeded().catch(() => { });
    await btn.click({ force: true });
    console.log('✅ [DefaultSignup] Clicked "Continue with pay-per-view"');
  }

  /**
   * Click "Subscribe without a pay-per-view" link.
   * This skips the PPV and subscribes to DAZN only.
   */
  async clickSubscribeWithoutPPV(): Promise<void> {
    console.log('🖱️ [DefaultSignup] Clicking "Subscribe without a pay-per-view"...');
    const link = this.page.locator(
      'button:has-text("Subscribe without a pay-per-view"), ' +
      'a:has-text("Subscribe without a pay-per-view"), ' +
      '*:has-text("Subscribe without a pay-per-view"):not(div):not(section):not(main):not(body)'
    ).first();
    await link.waitFor({ state: 'visible', timeout: 10000 });
    await link.scrollIntoViewIfNeeded().catch(() => { });
    await link.click({ force: true });
    console.log('✅ [DefaultSignup] Clicked "Subscribe without a pay-per-view"');
  }

  /**
   * Complete validation flow for Default Signup page, including Tiers validation and plan counts.
   */
  async verifyDefaultSignupFlow(
    eventData: Record<string, string>,
    tier: string,
    ratePlan: string,
    results: any[]
  ): Promise<void> {
    console.log('📋 Starting Default Signup flow verification...');

    // 1. Verify "Subscribe without a pay-per-view" is visible
    const noPpvLink = this.page.locator([
      'button:has-text("Subscribe without a pay-per-view")',
      'a:has-text("Subscribe without a pay-per-view")',
      '*:has-text("Subscribe without a pay-per-view"):not(div):not(section):not(main):not(body)'
    ].join(', ')).first();

    const isLinkVisible = await noPpvLink.isVisible({ timeout: 5000 }).catch(() => false);
    if (!isLinkVisible) {
      throw new Error('❌ [DefaultSignup] "Subscribe without a pay-per-view" link/button not visible. This is not a Default Signup page!');
    }
    console.log('✅ [DefaultSignup] Verified "Subscribe without a pay-per-view" link is visible.');
    results.push({
      page: 'Default Signup',
      field: 'Subscribe without a pay-per-view link',
      expected: 'Visible',
      actual: 'Visible',
      status: 'PASS'
    });

    // 2. Verify PPV is included in the journey (check event name or fighters in the page body)
    const ppvName = eventData.PPV_NAME || '';
    const nameClean = ppvName.replace(/[:\-–]/g, ' ');
    let matched = false;
    let actualPpvText = 'Not Found';
    if (nameClean.includes('vs')) {
      const fighters = nameClean.split(/\bvs\b/i).map((f: string) => f.trim());
      const f1 = fighters[0];
      const f2 = fighters[1];
      if (f1 && f2) {
        const hasF1 = await this.page.locator(`text=${f1}`).first().isVisible().catch(() => false);
        const hasF2 = await this.page.locator(`text=${f2}`).first().isVisible().catch(() => false);
        matched = hasF1 || hasF2;
        actualPpvText = matched ? `Found fighter(s): ${hasF1 ? f1 : ''} ${hasF2 ? f2 : ''}` : 'Not Found';
      }
    }
    if (!matched && ppvName) {
      matched = await this.page.locator(`text=${ppvName}`).first().isVisible().catch(() => false);
      actualPpvText = matched ? ppvName : 'Not Found';
    }

    console.log(`📊 [DefaultSignup] PPV matching: matched=${matched}, actualPpvText="${actualPpvText}"`);
    results.push({
      page: 'Default Signup',
      field: 'PPV included in journey',
      expected: 'Yes',
      actual: matched ? 'Yes' : 'No',
      status: matched ? 'PASS' : 'FAIL'
    });

    // 3. Click "Subscribe without a pay-per-view"
    await noPpvLink.scrollIntoViewIfNeeded().catch(() => {});
    await noPpvLink.click({ force: true });
    console.log('✅ [DefaultSignup] Clicked "Subscribe without a pay-per-view" link');

    // 4. Wait for Tiers page
    console.log('⏳ Waiting for Tiers page to load...');
    await this.page.waitForURL(url => url.toString().includes('page=TierPlans') || url.toString().includes('TierPlans'), { timeout: 15000 }).catch(() => {});
    await this.page.waitForLoadState('domcontentloaded');

    const bodyText = await this.page.locator('body').innerText({ timeout: 5000 }).then(t => t.toLowerCase()).catch(() => '');
    const isTiersPage = bodyText.includes('dazn ultimate') && bodyText.includes('dazn standard');
    results.push({
      page: 'Default Signup Tiers',
      field: 'Tiers Page Loaded',
      expected: 'Yes',
      actual: isTiersPage ? 'Yes' : 'No',
      status: isTiersPage ? 'PASS' : 'FAIL'
    });

    // 5. Test Continue with DAZN Ultimate -> 2 plans shown
    console.log('🖱️ Clicking "Continue with DAZN Ultimate"...');
    const ultimateCta = this.page.locator([
      'button:has-text("Continue with DAZN Ultimate")',
      'a:has-text("Continue with DAZN Ultimate")'
    ].join(', ')).first();
    await ultimateCta.waitFor({ state: 'visible', timeout: 10000 });
    await ultimateCta.click({ force: true });

    console.log('⏳ Waiting for Ultimate plan details page...');
    await this.page.waitForURL(url => url.toString().includes('page=PlanDetails') || url.toString().includes('PlanDetails'), { timeout: 15000 }).catch(() => {});
    await this.page.waitForLoadState('domcontentloaded');

    const optionsLocator = this.page.locator('input[type="radio"], [role="radio"], label:has(input[type="radio"])');
    const ultimateCount = await this.countVisibleOptions(optionsLocator);
    console.log(`📊 [DefaultSignup] Ultimate tier plan options count: ${ultimateCount}`);
    results.push({
      page: 'Default Signup Tiers',
      field: 'DAZN Ultimate Plan Count',
      expected: 2,
      actual: ultimateCount,
      status: ultimateCount === 2 ? 'PASS' : 'FAIL'
    });

    // 6. Go back to Tiers Page
    console.log('🖱️ Navigating back to Tiers page...');
    await this.page.goBack();
    await this.page.waitForURL(url => url.toString().includes('page=TierPlans') || url.toString().includes('TierPlans'), { timeout: 15000 }).catch(() => {});
    await this.page.waitForLoadState('domcontentloaded');

    // 7. Test Continue with Standard -> 3 plans shown
    console.log('🖱️ Clicking "Continue with Standard"...');
    const standardCta = this.page.locator([
      'button:has-text("Continue with Standard")',
      'a:has-text("Continue with Standard")',
      'button:has-text("Continue with DAZN Standard")',
      'a:has-text("Continue with DAZN Standard")'
    ].join(', ')).first();
    await standardCta.waitFor({ state: 'visible', timeout: 10000 });
    await standardCta.click({ force: true });

    console.log('⏳ Waiting for Standard plan details page...');
    await this.page.waitForURL(url => url.toString().includes('page=PlanDetails') || url.toString().includes('PlanDetails'), { timeout: 15000 }).catch(() => {});
    await this.page.waitForLoadState('domcontentloaded');

    const standardCount = await this.countVisibleOptions(optionsLocator);
    console.log(`📊 [DefaultSignup] Standard tier plan options count: ${standardCount}`);
    results.push({
      page: 'Default Signup Tiers',
      field: 'DAZN Standard Plan Count',
      expected: 3,
      actual: standardCount,
      status: standardCount === 3 ? 'PASS' : 'FAIL'
    });

    // 8. Go back from Standard PlanDetails page to Tiers page
    console.log('🔄 Navigating back to Tiers page...');
    await this.page.goBack();
    await this.page.waitForURL(url => url.toString().includes('page=TierPlans') || url.toString().includes('TierPlans'), { timeout: 15000 }).catch(() => {});
    await this.page.waitForLoadState('domcontentloaded');

    // 9. Go back from Tiers page to initial Default Signup page
    console.log('🔄 Navigating back to initial Default Signup page...');
    await this.page.goBack();
    await this.page.waitForURL(url => url.toString().includes('upsellTierShown=true') || url.toString().includes('upselltiershown'), { timeout: 15000 }).catch(() => {});
    await this.page.waitForLoadState('domcontentloaded');

    // 10. Proceed with PPV flow by clicking "Continue with pay-per-view"
    console.log('✅ Back on Default Signup page. Proceeding with PPV flow...');
    await this.clickContinueWithPPV();
  }

  /**
   * Helper to count visible options/radio buttons.
   */
  private async countVisibleOptions(locator: any): Promise<number> {
    await this.page.waitForTimeout(500);
    const count = await locator.count().catch(() => 0);
    let visibleCount = 0;
    for (let i = 0; i < count; i++) {
      if (await locator.nth(i).isVisible().catch(() => false)) {
        visibleCount++;
      }
    }
    if (visibleCount === 0) {
      const cards = this.page.locator('[class*="plan" i][class*="card" i], [class*="PlanOption" i], [class*="Option" i]');
      const cardCount = await cards.count().catch(() => 0);
      for (let i = 0; i < cardCount; i++) {
        if (await cards.nth(i).isVisible().catch(() => false)) {
          visibleCount++;
        }
      }
    }
    return visibleCount;
  }
}
