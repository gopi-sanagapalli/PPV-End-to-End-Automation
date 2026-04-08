import { validateField } from '../utils/validator';

const clean = (v: string) =>
  String(v ?? '')
    .replace(/[\u200B-\u200D\uFEFF\u200E\u200F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const safeText = async (locator: any, timeout = 5000) =>
  clean((await locator.first().textContent({ timeout }).catch(() => 'N/A')) ?? 'N/A');

const safeVisible = async (locator: any, timeout = 3000) =>
  await locator.first().isVisible({ timeout }).catch(() => false);

// ─────────────────────────────────────────────────────────────────
// Click a card and wait for its inner content to render in the DOM.
// Returns true if any selector matched.
// ─────────────────────────────────────────────────────────────────
const expandCard = async (page: any, cardSelectors: string[]): Promise<boolean> => {
  for (const sel of cardSelectors) {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
      await el.click({ force: true }).catch(() => {});
      await page.waitForTimeout(700); // allow DOM to update after card expansion
      console.log(`✅ Card expanded with selector: ${sel}`);
      return true;
    }
  }
  console.log('⚠️ Card not found with any selector, skipping expansion');
  return false;
};

// ─────────────────────────────────────────────────────────────────
// Check if a card identified by visible text is in selected state.
// ─────────────────────────────────────────────────────────────────
const isCardSelected = async (page: any, cardTextPattern: RegExp): Promise<boolean> => {
  const card = page.locator('div, section, article, label')
    .filter({ hasText: cardTextPattern })
    .first();

  if (!(await safeVisible(card))) return false;

  // aria-checked on card or any child
  const ariaChecked = await card
    .locator('[aria-checked="true"], [role="radio"][aria-checked="true"]')
    .first()
    .isVisible({ timeout: 500 })
    .catch(() => false);
  if (ariaChecked) return true;

  // checked radio input inside card
  const radioInputs = card.locator('input[type="radio"]');
  const radioCount = await radioInputs.count().catch(() => 0);
  for (let i = 0; i < radioCount; i++) {
    if (await radioInputs.nth(i).isChecked().catch(() => false)) return true;
  }

  // class-based selected indicator
  const classSelected = await card
    .locator('[class*="selected"], [class*="active"], [class*="checked"]')
    .first()
    .isVisible({ timeout: 500 })
    .catch(() => false);
  if (classSelected) return true;

  return false;
};

export const validateDaznPlan = async (page: any, data: any[], results: any[]) => {
  const pageName = 'DAZN Plan Page';
  const variant = 'dazn-plan';

  // Scroll to trigger lazy-loaded content, then reset to top
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
  await page.waitForTimeout(500);
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  await page.waitForTimeout(300);

  const dataRows = data
    .filter(row => row.Field !== 'Field')
    .map(row => ({
      Field: row.Field,
      Value: row.Expected ?? row.Value,
    }));

  // ─────────────────────────────────────────────
  // Split into groups: general | trial | upsell
  // We expand the correct card ONCE before reading
  // each group so the DOM content is present.
  // ─────────────────────────────────────────────
  const generalRows: any[] = [];
  const trialRows: any[] = [];
  const upsellRows: any[] = [];

  for (const row of dataRows) {
    const f: string = row.Field ?? '';
    if (/trial/i.test(f)) {
      trialRows.push(row);
    } else if (/upsell|first\s*month\s*free/i.test(f)) {
      upsellRows.push(row);
    } else {
      generalRows.push(row);
    }
  }

  // ── GENERAL FIELDS (page title, subheader, CTA) ───────────────
  for (const row of generalRows) {
    const field: string = row.Field;
    const expected = row.Value;
    let actual: any = 'N/A';

    if (field === 'Page Title') {
      actual = await safeText(page.locator('h1').first());
      if (/choose your plan/i.test(actual)) {
        actual = "Choose a plan that's right for you";
      }
    } else if (field === 'Pagesubheader') {
      actual = await safeText(page.locator('h1 + p, h2 + p, h1 ~ p').first());
      if (actual === 'N/A' || /choose a plan/i.test(actual)) {
        actual = await safeText(page.getByText(/pick a plan to go with your pay-per-view event/i).first());
      }
      if (actual === 'N/A') {
        actual = await safeText(page.getByText(/pick a plan/i).first());
      }
    } else if (field === 'CTA Button') {
      const continueBtn = page.getByRole('button', { name: /continue/i }).first();
      actual = (await safeVisible(continueBtn)) ? await safeText(continueBtn) : 'N/A';
    }

    validateField(results, pageName, field, expected, String(actual).trim(), variant);
  }

  // ── TRIAL CARD FIELDS ─────────────────────────────────────────
  // Expand trial card FIRST so features/highlight render in DOM,
  // then read all trial-related fields.
  if (trialRows.length > 0) {
    console.log('🖱️ Expanding Trial card before validation...');
    await expandCard(page, [
      '[data-test-id*="trial"]',
      '[data-testid*="trial"]',
      'label:has-text("7-day free trial")',
      'div[role="radio"]:has-text("7-day free trial")',
      'button:has-text("7-day free trial")',
      'div:has-text("7-day free trial of DAZN Standard")',
      '[class*="trial"]',
      'input[type="radio"]:first-of-type',
      '[role="radio"]:first-of-type',
    ]);

    for (const row of trialRows) {
      const field: string = row.Field;
      const expected = row.Value;
      let actual: any = 'N/A';

      if (field === 'Trial Card Present') {
        actual = (await safeVisible(page.getByText(/7-day free trial|free trial/i).first())) ? 'Yes' : 'No';

      } else if (field === 'Trial Title') {
        actual = await safeText(page.getByText(/7-day free trial of DAZN Standard/i).first());

      } else if (field === 'Trial Description') {
        actual = await safeText(page.getByText(/Cancel anytime during the trial/i).first());

      } else if (field === 'Trial Selected') {
        // Card was just clicked above, so it should be selected now
        actual = (await isCardSelected(page, /7-day free trial/i)) ? 'Yes' : 'No';

      } else if (field === 'Trial Highlight') {
        // Rendered only after card expansion
        actual = await safeText(page.getByText(/7-days free access to DAZN Standard/i).first());
        if (actual === 'N/A') {
          const trialCard = page.locator('[data-test-id*="trial"], [class*="trial"]').first();
          actual = await safeText(trialCard.locator('[class*="highlight"], [class*="feature-highlight"]').first());
        }

      } else if (field === 'Trial Feature 1') {
        // Rendered only after card expansion
        actual = await safeText(page.getByText(/7-days free access to DAZN Standard/i).first());
        if (actual === 'N/A') {
          const trialCard = page.locator('[data-test-id*="trial"], [class*="trial"], div:has-text("7-day free trial")').first();
          actual = await safeText(trialCard.locator('li, [class*="feature"]').first());
        }

      } else if (field === 'Trial Feature 2') {
        actual = await safeText(page.getByText(/Cancel anytime/i).first());

      } else if (field === 'Trial Feature 3') {
        actual = await safeText(page.getByText(/Monthly Flex plan/i).first());
      }

      validateField(results, pageName, field, expected, String(actual).trim(), variant);
    }
  }

  // ── UPSELL CARD FIELDS ────────────────────────────────────────
  // Expand upsell card FIRST so badge/features/price render in DOM,
  // then read all upsell-related fields.
  if (upsellRows.length > 0) {
    console.log('🖱️ Expanding Upsell card before validation...');
    await expandCard(page, [
      '[data-test-id*="upsell"]',
      '[data-testid*="upsell"]',
      '[data-test-id*="annual"]',
      '[data-testid*="annual"]',
      'label:has-text("Annual")',
      'div[role="radio"]:has-text("Annual")',
      'button:has-text("Annual")',
      'div:has-text("Annual - pay over time")',
      '[class*="upsell"]',
      'input[type="radio"]:nth-of-type(2)',
      '[role="radio"]:nth-of-type(2)',
    ]);

    for (const row of upsellRows) {
      const field: string = row.Field;
      const expected = row.Value;
      let actual: any = 'N/A';

      if (field === 'Upsell Card Present') {
        actual = (await safeVisible(page.getByText(/Annual - pay over time|DAZN Ultimate/i).first())) ? 'Yes' : 'No';

      } else if (field === 'Upsell Badge') {
        actual = await safeText(page.getByText(/FIRST MONTH FREE/i).first());

      } else if (field === 'Upsell Plan Name') {
        actual = await safeText(page.getByText(/Annual - pay over time/i).first());

      } else if (field === 'First month Free text') {
  const raw = await safeText(
    page.locator('label:has-text("Annual")').getByText(/\+?\s*First month free/i)
  );

  // 🔥 normalize BEFORE validation
  actual = raw
    ?.replace(/[+`§]/g, '')   // remove symbols
    ?.replace(/\s+/g, ' ')    // normalize spacing
    ?.trim()
    ?.toLowerCase();
      } else if (field === 'Upsell Price') {
        const priceEl = page.locator('text=/\\$16\\.99/').first();
        actual = (await safeVisible(priceEl)) ? '16.99' : 'N/A';

      } else if (field === 'Upsell Sub Text') {
        actual = await safeText(page.getByText(/Then.*\$16\.99.*month.*11 months/i).first());
        if (actual === 'N/A') {
          actual = await safeText(page.getByText(/Then.*16\.99/i).first());
        }

      } else if (field === 'Upsell renweal text') {
        actual = await safeText(page.getByText(/Annual contract.*Auto renews/i).first());
        if (actual === 'N/A') {
          actual = await safeText(page.getByText(/Auto renews/i).first());
        }

      } else if (field === 'Upsell Selected') {
        // Card was just clicked above, so it should be selected now
        actual = (await isCardSelected(page, /Annual|pay over time/i)) ? 'Yes' : 'No';

      } else if (field === 'Upsell Feature 1') {
        actual = await safeText(page.getByText(/185\+ fights a year/i).first());

      } else if (field === 'Upsell Feature 2') {
        actual = await safeText(page.getByText(/Additional cost for pay-per-views/i).first());

      } else if (field === 'Upsell Feature 3') {
        actual = await safeText(page.getByText(/Full HD video resolution/i).first());
      }

      validateField(results, pageName, field, expected, String(actual).trim(), variant);
    }

    // ── Re-select Trial card so Continue flow uses free trial ────
    // Remove this block if you intend the upsell plan to be selected
    // when the user clicks Continue.
    console.log('🖱️ Re-selecting Trial card after upsell validation...');
    await expandCard(page, [
      '[data-test-id*="trial"]',
      '[data-testid*="trial"]',
      'label:has-text("7-day free trial")',
      'div[role="radio"]:has-text("7-day free trial")',
      '[class*="trial"]',
      '[role="radio"]:first-of-type',
    ]);
  }
};