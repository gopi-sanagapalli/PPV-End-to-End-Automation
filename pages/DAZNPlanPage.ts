import { Page, Locator } from '@playwright/test';
import selectors from '../config/selectors.json';

export class DAZNPlanPage {
  constructor(private page: Page) {}

  // ─────────────────────────────
  // CHECK IF ON PLAN PAGE
  // ─────────────────────────────
  async isPlanPage(): Promise<boolean> {
    try {
      const url = this.page.url();
      if (url.includes('PlanDetails') || url.includes('upsellTierSkipped=true')) return true;

      const bodyText = await this.page.locator('body')
        .innerText({ timeout: 3000 }).catch(() => '');
      const lower = bodyText.toLowerCase();

      return (
        lower.includes("choose a plan that's right") ||
        lower.includes('pick a plan to go with') ||
        lower.includes('choose your plan')
      );
    } catch {
      return false;
    }
  }

  // ─────────────────────────────
  // WAIT FOR PAGE STABLE
  // ─────────────────────────────
  async waitForLoad(): Promise<void> {
    await this.page.waitForLoadState('domcontentloaded').catch(() => {});
    await this.page.waitForSelector('input[type="radio"], [role="radio"]', { timeout: 8000 }).catch(() => {});
    await this.page.waitForTimeout(500);
  }

  // ─────────────────────────────
  // DYNAMIC VALIDATION — reads from Excel data
  // No hardcoded copies/prices
  // ─────────────────────────────
  async validate(
    data: any[],
    results: any[],
    eventData: Record<string, string>,
    pageName: string = 'DAZN Plan'
  ): Promise<void> {
    console.log(`\n📋 Validating ${pageName} page — ${data.length} fields`);

    // Scroll to trigger lazy content
    await this.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
    await this.page.waitForTimeout(500);
    await this.page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
    await this.page.waitForTimeout(300);

    const bodyText = await this.page.locator('body').innerText().catch(() => '');

    for (const row of data) {
      const field = (row['Field'] || '').trim();
      const expected = (row['Value'] || row['Expected'] || '').toString().trim();
      if (!field) continue;

      // Flow filtering
      const rowFlow = (row['Flow'] || '').trim().toLowerCase();
      if (rowFlow) continue; // Skip flow-restricted rows for new user

      let actual = 'N/A';

      try {
        actual = await this.getFieldValue(field, eventData, bodyText);
      } catch (e: any) {
        console.warn(`⚠️  Error getting "${field}": ${e.message}`);
      }

      const status = this.compareValues(actual, expected, field);

      console.log(
        `  ${status === 'PASS' ? '✅' : '❌'} [${field}]` +
        `  expected="${expected}"  actual="${actual}"`
      );

      results.push({ page: pageName, field, expected, actual, status });
    }
  }

  // ─────────────────────────────
  // GET FIELD VALUE — dynamically extracts from page
  // ─────────────────────────────
  private async getFieldValue(
    field: string,
    eventData: Record<string, string>,
    bodyText: string
  ): Promise<string> {
    const fieldLower = field.toLowerCase().replace(/\s+/g, ' ').trim();
    const lower = bodyText.toLowerCase();

    // ── Page-level fields ──────────────────────────────────────
    if (fieldLower === 'page title' || fieldLower === 'pagetitle') {
      const h1 = await this.page.locator('h1').first().textContent().catch(() => '');
      return (h1 || '').trim();
    }

    if (fieldLower === 'pagesubheader' || fieldLower === 'page subtitle' || fieldLower === 'page sub header') {
      const subtitle = await this.page.locator('h1 + p, h1 ~ p, [class*="subtitle"], [class*="subheader"]')
        .first().textContent().catch(() => '');
      if (subtitle && subtitle.trim()) return subtitle.trim();
      // Fallback: second meaningful line
      const lines = bodyText.split('\n').map(l => l.trim()).filter(l => l.length > 10 && l.length < 150);
      if (lines.length > 1) return lines[1];
      return 'N/A';
    }

    if (fieldLower === 'cta button' || fieldLower === 'continue button') {
      const btn = this.page.locator(
        'button[data-test-id*="plan"], button:has-text("Continue")'
      ).first();
      const text = await btn.textContent().catch(() => '');
      return (text || '').trim() || 'N/A';
    }

    // ── Trial Card fields ──────────────────────────────────────
    if (fieldLower === 'trial card present') {
      const hasTrialCard = lower.includes('trial') ||
        lower.includes('flex') ||
        lower.includes('7-day free') ||
        lower.includes('7 day free');
      return hasTrialCard ? 'Yes' : 'No';
    }

    if (fieldLower === 'trial title') {
      const lines = bodyText.split('\n').map(l => l.trim());
      for (const line of lines) {
        if (/7[-\s]?day\s+free\s+trial/i.test(line) && line.length < 100) return line;
        if (/flex\s*[-–]\s*pay\s*monthly/i.test(line) && line.length < 100) return line;
        if (/trial\s+of\s+dazn/i.test(line) && line.length < 100) return line;
      }
      return 'N/A';
    }

    if (fieldLower === 'trial description') {
      const lines = bodyText.split('\n').map(l => l.trim());
      for (const line of lines) {
        if (line.length > 30 && line.length < 400) {
          if (/cancel\s+anytime/i.test(line) || /after\s+the\s+trial/i.test(line) ||
              /move\s+onto/i.test(line) || /trial\s+and\s+only/i.test(line)) {
            return line;
          }
        }
      }
      return 'N/A';
    }

    if (fieldLower === 'trial selected') {
      // Check first radio / flex radio
      const flexRadio = this.page.locator('[role="radio"]').first();
      if (await flexRadio.isVisible({ timeout: 2000 }).catch(() => false)) {
        const aria = await flexRadio.getAttribute('aria-checked').catch(() => 'false');
        if (aria === 'true') return 'Yes';
      }
      const radios = this.page.locator('input[type="radio"]');
      const count = await radios.count().catch(() => 0);
      if (count > 0) {
        const checked = await radios.first().isChecked().catch(() => false);
        return checked ? 'Yes' : 'No';
      }
      return 'N/A';
    }

    if (fieldLower.startsWith('trial feature') || fieldLower === 'trial highlight') {
      const featureNum = parseInt(field.replace(/\D/g, '')) || 1;
      return this.extractFeatureFromSection(bodyText, 'trial', featureNum);
    }

    // ── Upsell Card fields ─────────────────────────────────────
    if (fieldLower === 'upsell card present') {
      const hasUpsell = lower.includes('annual') ||
        lower.includes('save') ||
        lower.includes('first month free');
      return hasUpsell ? 'Yes' : 'No';
    }

    if (fieldLower === 'upsell badge') {
      const lines = bodyText.split('\n').map(l => l.trim());
      for (const line of lines) {
        if (line === line.toUpperCase() && line.length > 3 && line.length < 50) {
          if (/FREE|MONTH|SAVE|OFFER/i.test(line)) return line;
        }
      }
      return 'N/A';
    }

    if (fieldLower === 'upsell plan name') {
      const planPatterns = [
        /Annual\s*[-–]\s*[Pp]ay\s*(?:over\s*time|[Mm]onthly|[Uu]pfront)/,
        /Flex\s*[-–]\s*[Pp]ay\s*[Mm]onthly/,
        /Annual\s*[-–]\s*[Pp]ay\s*[Mm]onthly/,
      ];
      for (const pattern of planPatterns) {
        const match = bodyText.match(pattern);
        if (match) return match[0].trim();
      }
      return 'N/A';
    }

    if (fieldLower === 'first month free text') {
      const lines = bodyText.split('\n').map(l => l.trim());
      for (const line of lines) {
        if (/first\s+month\s+free/i.test(line) && line.length < 60) {
          return line.toLowerCase();
        }
      }
      return lower.includes('first month free') ? 'first month free' : 'N/A';
    }

    if (fieldLower === 'upsell price') {
      const upsellStart = bodyText.search(/annual|save/i);
      const upsellText = upsellStart >= 0 ? bodyText.substring(upsellStart) : bodyText;
      const prices = upsellText.match(/[\$£€₹]\s?\d+(?:\.\d{2})?/g);
      if (prices && prices.length > 0) return prices[0].replace(/[^\d.]/g, '');
      return 'N/A';
    }

    if (fieldLower === 'upsell sub text') {
      const subPatterns = [
        /[Tt]hen\s+[\$£€₹]?\s?\d+(?:\.\d{2})?\s*\/month\s+for\s+\d+\s+months\.?/,
        /[\$£€₹]\s?\d+(?:\.\d{2})?\s*\/month\s+for\s+\d+\s+months/,
        /[Ff]irst\s+month\s+FREE,?\s+then\s+[\$£€₹]?\s?\d+(?:\.\d{2})?\s+per\s+month/,
      ];
      for (const pattern of subPatterns) {
        const match = bodyText.match(pattern);
        if (match) return match[0].trim();
      }
      return 'N/A';
    }

    if (fieldLower === 'upsell selected') {
      const radios = this.page.locator('input[type="radio"]');
      const count = await radios.count().catch(() => 0);
      if (count > 1) {
        const secondChecked = await radios.nth(1).isChecked().catch(() => false);
        return secondChecked ? 'Yes' : 'No';
      }
      // Check aria-checked on second role=radio
      const ariaRadios = this.page.locator('[role="radio"]');
      const ariaCount = await ariaRadios.count().catch(() => 0);
      if (ariaCount > 1) {
        const aria = await ariaRadios.nth(1).getAttribute('aria-checked').catch(() => 'false');
        return aria === 'true' ? 'Yes' : 'No';
      }
      return 'No';
    }

    if (fieldLower === 'upsell renewal text') {
      const renewPatterns = [
        /[Aa]nnual\s+contract\.?\s*[Aa]uto\s*[-\s]?renews\.?/,
        /[Mm]onthly\s+subscription\.?/,
        /[Cc]ancel\s+with\s+\d+\s+days/,
      ];
      for (const pattern of renewPatterns) {
        const match = bodyText.match(pattern);
        if (match) return match[0].trim();
      }
      return 'N/A';
    }

    if (fieldLower.startsWith('upsell feature')) {
      const featureNum = parseInt(field.replace(/\D/g, '')) || 1;
      return this.extractFeatureFromSection(bodyText, 'upsell', featureNum);
    }

    if (fieldLower.startsWith('ultimate feature')) {
      const featureNum = parseInt(field.replace(/\D/g, '')) || 1;
      return this.extractFeatureFromSection(bodyText, 'ultimate', featureNum);
    }

    // ── Savings badge ──────────────────────────────────────────
    if (fieldLower === 'savings badge' || fieldLower === 'upsell savings badge') {
      const saveMatch = bodyText.match(/SAVE\s+[\$£€₹]?\s?\d+(?:\.\d{2})?\s+A\s+YEAR/i);
      if (saveMatch) return saveMatch[0].trim();
      return 'N/A';
    }

    // ── Back button ────────────────────────────────────────────
    if (fieldLower === 'back button') {
      const backBtn = this.page.locator('button:has(img[alt]), button[aria-label*="back" i]').first();
      const visible = await backBtn.isVisible({ timeout: 2000 }).catch(() => false);
      return visible ? 'Yes' : 'No';
    }

    // ── Generic fallback ───────────────────────────────────────
    return 'N/A';
  }

  // ─────────────────────────────
  // HELPER: Extract feature bullets from section
  // ─────────────────────────────
  private extractFeatureFromSection(bodyText: string, section: string, featureNum: number): string {
    const lines = bodyText.split('\n').map(l => l.trim()).filter(l => l.length > 10 && l.length < 200);

    let sectionStart = 0;
    let sectionEnd = lines.length;

    if (section === 'trial') {
      sectionStart = lines.findIndex(l => /trial|flex|7[-\s]?day/i.test(l));
      const nextSection = lines.findIndex((l, i) => i > sectionStart + 1 && /annual|ultimate|save/i.test(l));
      if (nextSection > 0) sectionEnd = nextSection;
    } else if (section === 'upsell') {
      sectionStart = lines.findIndex(l => /annual|ultimate|save|first month free/i.test(l));
    } else if (section === 'ultimate') {
      sectionStart = lines.findIndex(l => /ultimate/i.test(l));
    }

    if (sectionStart < 0) sectionStart = 0;

    const sectionLines = lines.slice(sectionStart, sectionEnd);

    const featurePatterns = [
      /\d+\+?\s+fights/i,
      /free\s+(?:access|trial)/i,
      /(?:HD|4K|HDR|Full\s+HD)\s*(?:video|resolution)?/i,
      /[Aa]dditional\s+cost/i,
      /[Dd]olby/i,
      /[Pp]ay-per-view/i,
      /days?\s+free\s+access/i,
      /access\s+to\s+dazn/i,
      /cancel\s+with/i,
      /monthly\s+subscription/i,
    ];

    const features: string[] = [];
    for (const line of sectionLines) {
      for (const pattern of featurePatterns) {
        if (pattern.test(line) && !features.includes(line)) {
          features.push(line);
          break;
        }
      }
    }

    if (featureNum <= features.length) {
      return features[featureNum - 1];
    }
    return 'N/A';
  }

  // ─────────────────────────────
  // COMPARE VALUES
  // ─────────────────────────────
  private compareValues(actual: string, expected: string, field: string): string {
    if (!expected || expected === 'N/A') return 'SKIP';

    // Boolean fields
    if (expected.toLowerCase() === 'yes' || expected.toLowerCase() === 'no') {
      return actual.toLowerCase() === expected.toLowerCase() ? 'PASS' : 'FAIL';
    }

    // Numeric comparison (prices)
    const actualNum = parseFloat(actual.replace(/[^\d.]/g, ''));
    const expectedNum = parseFloat(expected.replace(/[^\d.]/g, ''));
    if (!isNaN(actualNum) && !isNaN(expectedNum) && actualNum > 0 && expectedNum > 0) {
      return actualNum === expectedNum ? 'PASS' : 'FAIL';
    }

    // Text comparison — case-insensitive contains
    const actualNorm = actual.toLowerCase().replace(/\s+/g, ' ').trim();
    const expectedNorm = expected.toLowerCase().replace(/\s+/g, ' ').trim();

    if (actualNorm === expectedNorm) return 'PASS';
    if (actualNorm.includes(expectedNorm) || expectedNorm.includes(actualNorm)) return 'PASS';

    return 'FAIL';
  }

  // ─────────────────────────────
  // SELECT PLAN BY RATE
  // ─────────────────────────────
  async selectPlan(ratePlan: string): Promise<void> {
    const rateLower = ratePlan.toLowerCase();
    console.log(`📋 Selecting plan: ${ratePlan}`);

    if (rateLower === 'annual pay monthly' || rateLower === 'annual') {
      // Try label-based click first
      const annualCard = this.page.locator(
        'label:has-text("Annual"), [role="radio"]:has-text("Annual")'
      ).first();

      if (await annualCard.isVisible({ timeout: 3000 }).catch(() => false)) {
        await annualCard.scrollIntoViewIfNeeded().catch(() => {});
        await annualCard.click({ force: true }).catch(() => {});
        console.log('✅ Clicked Annual card');
      } else {
        // Fallback to second radio
        const radio = this.page.locator('input[type="radio"]').nth(1);
        if (await radio.isVisible({ timeout: 1500 }).catch(() => false)) {
          await radio.scrollIntoViewIfNeeded().catch(() => {});
          await radio.click({ force: true }).catch(() => {});
          console.log('✅ Selected Annual radio (fallback)');
        }
      }
    } else if (rateLower === 'annual pay upfront') {
      const upfrontCard = this.page.locator(
        'label:has-text("Upfront"), label:has-text("Pay Upfront"), [role="radio"]:has-text("Upfront")'
      ).first();

      if (await upfrontCard.isVisible({ timeout: 3000 }).catch(() => false)) {
        await upfrontCard.scrollIntoViewIfNeeded().catch(() => {});
        await upfrontCard.click({ force: true }).catch(() => {});
        console.log('✅ Clicked Upfront card');
      } else {
        const radio = this.page.locator('input[type="radio"]').nth(1);
        if (await radio.isVisible({ timeout: 1500 }).catch(() => false)) {
          await radio.scrollIntoViewIfNeeded().catch(() => {});
          await radio.click({ force: true }).catch(() => {});
          console.log('✅ Selected Upfront radio (fallback)');
        }
      }
    } else {
      // Monthly / Flex / Trial — select first radio
      const flexCard = this.page.locator(
        'label:has-text("Flex"), label:has-text("Monthly"), [role="radio"]:has-text("Flex")'
      ).first();

      if (await flexCard.isVisible({ timeout: 3000 }).catch(() => false)) {
        await flexCard.scrollIntoViewIfNeeded().catch(() => {});
        await flexCard.click({ force: true }).catch(() => {});
        console.log('✅ Clicked Flex/Monthly card');
      } else {
        const radio = this.page.locator('input[type="radio"]').first();
        if (await radio.isVisible({ timeout: 1500 }).catch(() => false)) {
          await radio.scrollIntoViewIfNeeded().catch(() => {});
          await radio.click({ force: true }).catch(() => {});
          console.log('✅ Selected first radio (fallback)');
        }
      }
    }

    await this.page.waitForTimeout(500);
  }

  // ─────────────────────────────
  // GET CONTINUE BUTTON
  // ─────────────────────────────
  async getContinueButton(): Promise<Locator | null> {
    const selectors = [
      'button[data-test-id*="plan"]',
      'button:has-text("Continue with")',
      'button:has-text("Continue")',
    ];

    for (const sel of selectors) {
      const btn = this.page.locator(sel).first();
      if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
        return btn;
      }
    }

    // Scroll down to find it
    for (let i = 0; i < 4; i++) {
      await this.page.keyboard.press('PageDown');
      await this.page.waitForTimeout(300);
      for (const sel of selectors) {
        const btn = this.page.locator(sel).first();
        if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
          return btn;
        }
      }
    }

    return null;
  }

  // ─────────────────────────────
  // CLICK CONTINUE
  // ─────────────────────────────
  async clickContinue(): Promise<void> {
    const btn = await this.getContinueButton();
    if (!btn) throw new Error('❌ Continue button not found on Plan page');

    await btn.scrollIntoViewIfNeeded().catch(() => {});
    await this.page.waitForTimeout(300);

    const enabled = await btn.isEnabled().catch(() => false);
    if (!enabled) {
      console.log('⚠️ Plan Continue CTA disabled — force clicking');
    }

    await btn.click({ force: true }).catch(() => {});
    console.log('✅ Plan Continue clicked');
    await this.page.waitForLoadState('domcontentloaded').catch(() => {});
  }
}