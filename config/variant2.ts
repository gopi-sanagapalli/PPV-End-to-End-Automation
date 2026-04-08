import { validateField } from '../utils/validator';

const clean = (v: string) =>
  String(v ?? '')
    .replace(/[\u200B-\u200D\uFEFF\u200E\u200F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const safeText = async (locator: any, timeout = 2200) =>
  clean((await locator.first().textContent({ timeout }).catch(() => 'N/A')) ?? 'N/A');

const safeVisible = async (locator: any, timeout = 1500) =>
  await locator.first().isVisible({ timeout }).catch(() => false);

const inText = (haystack: string, re: RegExp) => re.test(clean(haystack || ''));

const hasSelectedRadioByText = async (page: any, re: RegExp) => {
  const selected = page.locator("[role='radio'][aria-checked='true']").filter({ hasText: re }).first();
  if (await selected.count().catch(() => 0)) {
    return await selected.isVisible().catch(() => false);
  }
  return false;
};

const findMoneyNear = (body: string, anchor: RegExp) => {
  const idx = body.search(anchor);
  if (idx >= 0) {
    const window = body.slice(Math.max(0, idx - 100), idx + 160);
    const m = window.match(/(\$|£|AUD\s*)\s?(\d+(?:\.\d{2})?)/i);
    if (m) return m[2];
  }
  const fallback = body.match(/(\$|£|AUD\s*)\s?(\d+(?:\.\d{2})?)/i);
  return fallback ? fallback[2] : 'N/A';
};

const getGoldHighlightStatus = async (page: any, minCount = 1) => {
  const goldMarkers = page.locator("img[alt*='tick-golden' i], [class*='gold' i], [data-testid*='gold' i]");
  const count = await goldMarkers.count().catch(() => 0);
  return count >= minCount ? 'Yes' : 'No';
};

const findTextNear = (body: string, anchor: RegExp, target: RegExp) => {
  const idx = body.search(anchor);
  if (idx >= 0) {
    const window = body.slice(Math.max(0, idx - 200), idx + 300);
    const m = window.match(target);
    if (m) return m[0];
  }
  const fallback = body.match(target);
  return fallback ? fallback[0] : 'N/A';
};

export const validateVariant2 = async (page: any, data: any[], results: any[]) => {
  const pageName = 'PPV Page';
  const variant = 'variant2';
  
  // Scroll to load all lazy-loaded content
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
  await page.waitForTimeout(1000);
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  await page.waitForTimeout(500);
  
  const body = clean(await page.locator('body').innerText().catch(() => ''));

  for (const row of data) {
    const field = row.Field;
    const expected = row.Expected;
    let actual: any = 'N/A';

    if (field === 'Page Title') {
      actual = await safeText(page.locator('h1').first());
    }
    else if (field === 'Header Full Copy') {
      actual = await safeText(
        page.getByText(/buy\s+chisora\s+vs\.?\s+wilder\s+with\s+dazn\s+standard\s+or\s+get\s+it\s+included\s+in\s+dazn\s+ultimate\.?/i).first()
      );
    }
    else if (field === 'Header Highlight Text' || field === 'Event Name' || field === 'PPV Name') {
      actual = await safeText(page.getByText(/chisora\s+vs\.?\s+wilder/i).first());
    }
    else if (field === 'Header Sub Text') {
      actual = await safeText(page.getByText(/get it included in dazn ultimate|pay-per-views included/i).first());
    }
    else if (field === 'PPV Image' || field === 'PPV Image Present') {
      // Look for PPV image near the PPV name or in the PPV section
      const ppvSection = page.locator('div,section,article').filter({ hasText: /chisora\s+vs\.?\s+wilder/i }).first();
      const ppvImg = ppvSection.locator('img').first();
      if (await safeVisible(ppvImg)) {
        actual = 'Yes';
      } else {
        // Fallback: look for any image in the PPV area
        const anyImg = page.locator('img[alt*="chisora" i], img[alt*="wilder" i], img[alt*="ppv" i], img[alt*="fight" i]').first();
        actual = (await safeVisible(anyImg)) ? 'Yes' : 'No';
      }
    }
    else if (field === 'Event Date and Time') {
      const fullDateText = await safeText(page.getByText(/saturday\s+at\s+\d{1,2}:\d{2}\s*[ap]m/i).first());
      actual = fullDateText === 'N/A' ? await safeText(page.getByText(/saturday/i).first()) : fullDateText;
    }
    else if (field === 'PPV checkbox present') {
      const hasRadio = await safeVisible(page.getByRole('radio', { name: /chisora\s+vs\.?\s+wilder/i }).first());
      const hasCheckbox = await safeVisible(page.locator("input[type='checkbox'], [role='checkbox']").first());
      actual = (hasRadio || hasCheckbox) ? 'Yes' : 'No';
    }
    else if (field === 'PPV Price') {
      actual = findMoneyNear(body, /chisora\s+vs\.?\s+wilder/i);
    }
    else if (field === 'PPV Selected') {
      const isSelected =
        (await hasSelectedRadioByText(page, /chisora\s+vs\.?\s+wilder/i)) ||
        (await safeVisible(page.locator("[role='checkbox'][aria-checked='true'], input[type='checkbox']:checked, [aria-checked='true']").first()));
      actual = isSelected ? 'Yes' : 'No';
    }
    else if (field === 'Subscription Section Title') {
      actual = await safeText(page.getByText(/choose your subscription/i).first());
    }
    else if (field === 'Trial Card Present' || field === 'Trial Title') {
      const trial = page.getByText(/7-day\s*free\s*trial|free\s*trial/i).first();
      if (field === 'Trial Card Present') actual = (await safeVisible(trial)) ? 'Yes' : 'No';
      else {
        const fullTrialTitle = page.getByText(/7-day\s*free\s*trial\s+of\s+dazn\s+standard/i).first();
        actual = await safeText(fullTrialTitle);
        if (actual === 'N/A') actual = await safeText(trial);
      }
    }
    else if (field === 'Trial Radio Present') {
      const trialCard = page.locator('div,section,article').filter({ hasText: /7-day\s*free\s*trial/i }).first();
      const hasRoleRadio = await safeVisible(trialCard.locator("[role='radio'], input[type='radio']").first());
      const hasCircle = await safeVisible(trialCard.locator("[aria-checked], [class*='radio' i], [class*='circle' i]").first());
      actual = (hasRoleRadio || hasCircle) ? 'Yes' : 'No';
    }
    else if (field === 'Trial Selected') {
      const selectedByState = await hasSelectedRadioByText(page, /7-day\s*free\s*trial|free\s*trial/i);
      const ctaText = await safeText(page.getByRole('button', { name: /continue/i }).first());
      const selectedByCTA = /free\s*trial/i.test(ctaText);
      actual = (selectedByState || selectedByCTA) ? 'Yes' : 'No';
    }
    else if (field === 'Trial Feature 1') {
      actual = await safeText(page.getByText(/7-days? free access to dazn standard\.?/i).first());
      if (actual === 'N/A') actual = await safeText(page.getByText(/7-days? free access/i).first());
    }
    else if (field === 'Trial Feature 2') {
      const trialParagraph = await safeText(
        page.getByText(/cancel anytime during the trial and only pay for the fight\./i).first()
      );
      if (trialParagraph !== 'N/A' && /monthly flex plan/i.test(trialParagraph)) {
        actual = trialParagraph;
      } else {
        actual = await safeText(page.getByText(/cancel anytime/i).first());
      }
    }
    else if (field === 'Upsell Section Present') {
      actual = (await safeVisible(page.getByText(/dazn ultimate|get it included in dazn ultimate/i).first())) ? 'Yes' : 'No';
    }
    else if (field === 'Upsell Label') {
      actual = await safeText(page.getByText(/pay-per-views included/i).first());
    }
    else if (field === 'Upsell Plan Name') {
      actual = (await safeVisible(page.getByText(/dazn ultimate/i).first())) ? 'DAZN Ultimate' : await safeText(page.getByText(/get it included in dazn ultimate/i).first());
    }
    else if (field === 'Upsell Price text' || field === 'Upsell Price text ') {
      // Look for "From" text near the upsell price
      const upsellSection = page.locator('div,section,article').filter({ hasText: /dazn\s+ultimate/i }).first();
      const fromText = upsellSection.getByText(/^from$/i).first();
      if (await safeVisible(fromText)) {
        actual = 'From';
      } else {
        // Try to find "From" in the body near DAZN Ultimate
        actual = findTextNear(body, /dazn\s+ultimate/i, /^from\s*\$/i) !== 'N/A' ? 'From' : 'N/A';
      }
    }
    else if (field === 'Upsell Price') {
      const upsellSectionText = await safeText(page.locator('div,section,article').filter({ hasText: /dazn\s+ultimate/i }).first());
      actual = findMoneyNear(upsellSectionText !== 'N/A' ? upsellSectionText : body, /dazn\s+ultimate/i);
    }
    else if (field === 'Upsell Price length') {
      // Look for "/ month" text near the upsell price
      const upsellSection = page.locator('div,section,article').filter({ hasText: /dazn\s+ultimate/i }).first();
      const monthText = upsellSection.getByText(/\/\s*month/i).first();
      if (await safeVisible(monthText)) {
        actual = await safeText(monthText);
      } else {
        // Try to find "/month" in the body near DAZN Ultimate
        const match = body.match(/dazn\s+ultimate[\s\S]{0,100}?\/\s*month/i);
        actual = match ? '/ month' : 'N/A';
      }
    }
    else if (field === 'Upsell Billing Text') {
      actual = await safeText(page.getByText(/annual contract\. auto renews\./i).first());
    }
    else if (field === 'Upsell Feature 1') {
      actual = await safeText(page.getByText(/pay-per-views included at no extra cost\.?/i).first());
    }
    else if (field === 'Upsell Feature 2') {
      actual = await safeText(page.getByText(/hdr and dolby 5\.1 surround sound on select events\.?/i).first());
    }
    else if (field === 'Upsell Feature 3') {
      actual = await safeText(page.getByText(/185\+ fights a year from the best promoters/i).first());
    }
    else if (field === 'Included PPV1 Name') {
      // Look for PPV1 name in the ultimate tier section
      const ultimateSection = page.locator('div,section,article').filter({ hasText: /dazn\s+ultimate/i }).first();
      const ppv1Name = ultimateSection.getByText(/chisora\s+vs\.?\s+wilder/i).first();
      actual = await safeText(ppv1Name);
    }
    else if (field === 'PPV1 Image Present on ultimate tier') {
      // Look for PPV1 image in the ultimate tier section
      const ultimateSection = page.locator('div,section,article').filter({ hasText: /dazn\s+ultimate/i }).first();
      const ppv1Img = ultimateSection.locator('img').first();
      actual = (await safeVisible(ppv1Img)) ? 'Yes' : 'No';
    }
    else if (field === 'PPV1 Date Text on ultimate tier') {
      // Look for PPV1 date in the ultimate tier section
      const ultimateSection = page.locator('div,section,article').filter({ hasText: /dazn\s+ultimate/i }).first();
      const ppv1Date = ultimateSection.getByText(/saturday\s+at\s+\d{1,2}:\d{2}\s*[ap]m/i).first();
      actual = await safeText(ppv1Date);
    }
    else if (field === 'PPV1 Included tag') {
      // Look for "Included" tag near PPV1 in ultimate tier
      const ultimateSection = page.locator('div,section,article').filter({ hasText: /dazn\s+ultimate/i }).first();
      const includedTag = ultimateSection.getByText(/included/i).first();
      actual = (await safeVisible(includedTag)) ? 'Yes' : 'No';
    }
    else if (field === 'Included PPV2 Name') {
      // Look for PPV2 name in the ultimate tier section
      const ultimateSection = page.locator('div,section,article').filter({ hasText: /dazn\s+ultimate/i }).first();
      const ppv2Name = ultimateSection.getByText(/wardley\s+vs\.?\s+dubois/i).first();
      actual = await safeText(ppv2Name);
    }
    else if (field === 'PPV2 Image Present on ultimate tier') {
      // Look for PPV2 image in the ultimate tier section
      const ultimateSection = page.locator('div,section,article').filter({ hasText: /dazn\s+ultimate/i }).first();
      const ppv2Img = ultimateSection.locator('img').nth(1);
      actual = (await safeVisible(ppv2Img)) ? 'Yes' : 'No';
    }
    else if (field === 'PPV2 Date Text on ultimate tier') {
      // Look for PPV2 date in the ultimate tier section
      const ultimateSection = page.locator('div,section,article').filter({ hasText: /dazn\s+ultimate/i }).first();
      const ppv2Date = ultimateSection.getByText(/saturday\s+\d{1,2}(?:st|nd|rd|th)?\s+may\s+at\s+\d{1,2}:\d{2}\s*[ap]m/i).first();
      actual = await safeText(ppv2Date);
    }
    else if (field === 'PPV2 Included tag') {
      // Look for "Included" tag near PPV2 in ultimate tier
      const ultimateSection = page.locator('div,section,article').filter({ hasText: /dazn\s+ultimate/i }).first();
      const includedTags = ultimateSection.getByText(/included/i);
      const count = await includedTags.count().catch(() => 0);
      actual = count >= 2 ? 'Yes' : 'No';
    }
    else if (field === 'Upsell Highlight text') {
      // Look for highlight text with gold markers
      const highlightText = page.locator('[class*="gold" i], [class*="highlight" i]').filter({ hasText: /chisora|wardley/i }).first();
      if (await safeVisible(highlightText)) {
        actual = await safeText(highlightText);
      } else {
        // Try to find the text in the body
        actual = findTextNear(body, /pay-per-views included at no extra cost/i, /chisora\s+vs\.?\s+wilder\s+&\s+wardley\s+vs\.?\s+dubois/i);
      }
    }
    else if (field === 'CTA Button') {
      actual = await safeText(page.getByRole('button', { name: /continue/i }).first());
    }
    else if (field === 'CTA without PPV') {
      // Look for "Subscribe without a pay-per-view" link/button
      const withoutPPV = page.getByText(/subscribe without a pay-per-view/i).first();
      actual = (await safeVisible(withoutPPV)) ? await safeText(withoutPPV) : 'N/A';
    }
    else if (field === 'Currency') {
      actual = /\$/i.test(body) ? '$' : (/£/i.test(body) ? '£' : 'N/A');
    }
    validateField(results, pageName, field, expected, String(actual).trim(), variant);
  }
};
