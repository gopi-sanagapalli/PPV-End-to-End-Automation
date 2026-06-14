import { Page } from '@playwright/test';
import { BasePage } from './BasePage';
import { resolveExpected } from '../utils/resolveExpected';
import { compare } from '../utils/compare';
import { captureFailures } from '../utils/failureCapture';

export class PaymentPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  // ─────────────────────────────
  // CHECK IF ON PAYMENT PAGE
  // ─────────────────────────────
  async isPaymentPage(): Promise<boolean> {
    if (this.page.isClosed()) {
      console.log('⚠️  Page is closed — cannot check payment page');
      return false;
    }

    const url = this.page.url();
    if (url.includes('paymentDetails') || url.includes('payment')) return true;

    try {
      const bodyText = (await this.page.locator('body')
        .innerText({ timeout: 3000 }).catch(() => '')).replace(/\u200B/g, '');
      const lower = bodyText.toLowerCase();
      return (
        lower.includes('choose how to pay') ||
        lower.includes('payment method') ||
        lower.includes('today you pay')
      );
    } catch {
      return false;
    }
  }

  // ─────────────────────────────
  // DYNAMIC VALIDATION
  // ─────────────────────────────
  async validate(
    data: any[],
    results: any[],
    eventData: Record<string, string>,
    flow?: string
  ): Promise<void> {
    if (this.page.isClosed()) {
      console.log('⚠️  Page is closed — skipping payment validation');
      return;
    }

    eventData.CURRENT_PAGE = 'payment';
    eventData['CURRENT_PAGE'] = 'payment';

    console.log(`\n🧾 Validating Payment page — ${data.length} fields`);

    // Wait for payment page to fully load — single smart wait, max 4s total
    await this.page.waitForLoadState('domcontentloaded').catch(() => {});
    await this.page.waitForFunction(() => {
      const body = document.body.innerText.toLowerCase();
      return (
        body.includes('choose how to pay') ||
        body.includes('payment method') ||
        body.includes('purchase summary') ||
        body.includes('today you pay')
      );
    }, { timeout: 4000 }).catch(() => {});

    // Wait for payment options to load (wait for "Credit" or "PayPal" or "Google Pay" text to become visible)
    console.log('⏳ Waiting for payment methods (Credit, PayPal, Google Pay) to load...');
    await this.page.locator('section[id*="Card" i], section[id*="Pay" i], .accordion-cta-refined___3csKv, button:has-text("Credit"), button:has-text("Pay")')
      .first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    
    // Also wait until the loading skeleton overlay disappears and the text is populated
    await this.page.waitForFunction(() => {
      const body = document.body.innerText.toLowerCase();
      return body.includes('credit') || body.includes('paypal') || body.includes('google pay');
    }, { timeout: 10000 }).catch(() => {
      console.log('⚠️ Warning: payment options text did not appear within 10s');
    });

    // Dynamically extract name from page — fast targeted selector
    let signedInText = '';
    try {
      const signedInEl = this.page.locator('text=/signed in as/i').first();
      if (await signedInEl.isVisible({ timeout: 1000 }).catch(() => false)) {
        const txt = (await signedInEl.textContent({ timeout: 1000 }).catch(() => '')) || '';
        const trimmed = txt.trim().replace(/\s+/g, ' ');
        if (/signed in as/i.test(trimmed) && trimmed.length < 100) {
          signedInText = trimmed;
        }
      }
    } catch { }

    if (signedInText) {
      console.log(`👤 [PaymentPage] Found live signed-in text: "${signedInText}"`);
      const namePart = signedInText.replace(/signed in as/i, '').trim();
      const nameParts = namePart.split(/\s+/);
      const fName = nameParts[0] || '';
      const lName = nameParts.slice(1).join(' ') || '';
      
      eventData.FIRST_NAME = fName;
      eventData.LAST_NAME = lName;
      eventData['FIRST_NAME'] = fName;
      eventData['LAST_NAME'] = lName;
      eventData.FULL_NAME = namePart;
      eventData.SIGNED_IN_AS_TEXT = signedInText;
      eventData['FULL_NAME'] = namePart;
      eventData['SIGNED_IN_AS_TEXT'] = signedInText;
    }

    // Get full page text once
    const bodyText = (await this.page.locator('body').innerText().catch(() => '')).replace(/\u200B/g, '');
    // Debug log removed for performance

    // Normalise flow for filtering
    const normalizedFlow = (flow || '').trim().toLowerCase();

    for (const row of data) {
      const field = (row['Field'] || '').trim();
      if (!field) continue;

      const fieldLower = field.toLowerCase().replace(/\s+/g, ' ').trim();
      if (fieldLower === 'next payment label' || fieldLower === 'next payment price') {
        console.log(`  ⏭️  Skipping [${field}] in standard loop — validated via validateNextPaymentDetails`);
        continue;
      }

      const rowFlow = (row['Flow'] || '').trim().toLowerCase();
      if (rowFlow) {
        if (!normalizedFlow) continue;
        if (rowFlow !== normalizedFlow) continue;
      }

      const expected = resolveExpected(row, eventData);

      let actual = 'N/A';
      try {
        actual = await this.getFieldValue(field, eventData, bodyText);
      } catch (e: any) {
        console.warn(`⚠️  Error getting "${field}": ${e.message}`);
      }

      const status = this.compareValues(actual, expected, field);
      const icon = status === 'PASS' ? '✅' : (status === 'SKIP' ? '⏭️' : '❌');
      console.log(`  ${icon} [${field}] expected="${expected}" actual="${actual}"`);
      results.push({ page: 'Payment', field, expected, actual, status });
    }

    // Determine planType
    let planType = '1_month_free_trial';
    const tier = (eventData.TIER || 'standard').toLowerCase();
    const offerType = (eventData.OFFER_TYPE || '').toLowerCase();
    const ratePlan = (eventData.RATE_PLAN || '').toLowerCase();
    if (tier === 'ultimate') {
      planType = 'ultimate';
    } else if (ratePlan.includes('annual')) {
      planType = '1_month_free_trial';
    } else if (offerType === '7_day_trial') {
      planType = '7_day_free_trial';
    }

    const region = eventData.REGION || eventData.region || process.env.DAZN_REGION || 'GB';
    // Capture red-boxed screenshots BEFORE validateNextPaymentDetails navigates away
    await captureFailures(this.page, results, 'Payment');

    await this.validateNextPaymentDetails(region, planType, results, eventData);

    // Capture any new failures from validateNextPaymentDetails
    await captureFailures(this.page, results, 'Payment');
  }

  // ─────────────────────────────
  // VALIDATE NEXT PAYMENT DETAILS
  // ─────────────────────────────
  async validateNextPaymentDetails(
    region: string,
    planType: string,
    results: any[],
    eventData: Record<string, string>
  ): Promise<void> {
    if (this.page.isClosed()) {
      console.log('⚠️  Page is closed — skipping next payment validation');
      return;
    }

    const bodyText = (await this.page.locator('body').innerText().catch(() => '')).replace(/\u200B/g, '');
    const lower = bodyText.toLowerCase();
    const regionUpper = region.toUpperCase();

    console.log(`🔍 Running validateNextPaymentDetails: region = "${regionUpper}", planType = "${planType}"`);

    const isAbsentCase = regionUpper === 'GB' || regionUpper === 'UK' || regionUpper === 'IE' || planType === '7_day_free_trial';

    if (isAbsentCase) {
      // Assert elements NOT present in DOM
      const hasLabel = /next\s+(?:annual\s+)?payment\s+on/i.test(bodyText);

      // Label check
      const labelExpected = 'Not present';
      const labelActual = hasLabel ? 'Present (found next payment label)' : 'Not present';
      const labelStatus = !hasLabel ? 'PASS' : 'FAIL';
      console.log(`  ${labelStatus === 'PASS' ? '✅' : '❌'} [Next Payment Label] expected="${labelExpected}" actual="${labelActual}"`);
      results.push({
        page: 'Payment',
        field: 'Next Payment Label',
        expected: labelExpected,
        actual: labelActual,
        status: labelStatus
      });

      // Price check
      const priceExpected = 'Not present';
      const priceActual = hasLabel ? 'Present' : 'Not present';
      const priceStatus = !hasLabel ? 'PASS' : 'FAIL';
      console.log(`  ${priceStatus === 'PASS' ? '✅' : '❌'} [Next Payment Price] expected="${priceExpected}" actual="${priceActual}"`);
      results.push({
        page: 'Payment',
        field: 'Next Payment Price',
        expected: priceExpected,
        actual: priceActual,
        status: priceStatus
      });

    } else {
      // Assert both elements are visible
      // Extract label
      let actualLabel = 'N/A';
      const lines = bodyText.split('\n').map(l => l.trim());
      for (const line of lines) {
        if (/next\s+(?:annual\s+)?payment\s+on/i.test(line)) {
          actualLabel = line;
          break;
        }
      }

      // Extract price
      let actualPrice = 'N/A';
      const nextIdx = lower.indexOf('next payment');
      const nextAnnualIdx = lower.indexOf('next annual payment');
      const idx = nextAnnualIdx >= 0 ? nextAnnualIdx : nextIdx;
      if (idx >= 0) {
        const afterText = bodyText.substring(idx, idx + 100);
        const priceMatch = afterText.match(/[\$£€₹]\s?\d+(?:\.\d{2})?/);
        if (priceMatch) {
          actualPrice = priceMatch[0].trim();
        }
      }

      if (planType === '1_month_free_trial') {
        // Label format check: "Next Annual payment on <date>"
        // Date can be DD/MM/YYYY or DD Month YYYY
        const labelValid = /next\s+(?:annual\s+)?payment\s+on\s+(?:\d{1,2}[\/\s]\d{2}[\/\s]\d{4}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4})/i.test(actualLabel);
        
        const labelExpected = 'Next [Annual] payment on <date>';
        const labelActual = labelValid ? actualLabel : (actualLabel === 'N/A' ? 'Not visible' : actualLabel);
        const labelStatus = labelValid ? 'PASS' : 'FAIL';
        console.log(`  ${labelStatus === 'PASS' ? '✅' : '❌'} [Next Payment Label] expected="${labelExpected}" actual="${labelActual}"`);
        results.push({
          page: 'Payment',
          field: 'Next Payment Label',
          expected: labelExpected,
          actual: labelActual,
          status: labelStatus
        });

        // Price check
        const expectedPrice = (eventData.RATE_PLAN || '').includes('upfront')
          ? (eventData.ANNUAL_UPFRONT_PRICE_DISPLAY || eventData.ANNUAL_UPFRONT_PRICE || '')
          : (eventData.ANNUAL_PAY_MONTHLY_PRICE_DISPLAY || eventData.ANNUAL_PAY_MONTHLY_PRICE || '');
        
        const priceValid = actualPrice !== 'N/A' && actualPrice.replace(/\s+/g, '') === expectedPrice.replace(/\s+/g, '');
        const priceStatus = priceValid ? 'PASS' : 'FAIL';
        console.log(`  ${priceStatus === 'PASS' ? '✅' : '❌'} [Next Payment Price] expected="${expectedPrice}" actual="${actualPrice}"`);
        results.push({
          page: 'Payment',
          field: 'Next Payment Price',
          expected: expectedPrice,
          actual: actualPrice,
          status: priceStatus
        });

      } else if (planType === 'ultimate') {
        // Label and price are displayed
        const labelPresent = actualLabel !== 'N/A';
        const labelExpected = 'Visible next payment label';
        const labelActual = labelPresent ? actualLabel : 'Not visible';
        const labelStatus = labelPresent ? 'PASS' : 'FAIL';
        console.log(`  ${labelStatus === 'PASS' ? '✅' : '❌'} [Next Payment Label] expected="${labelExpected}" actual="${labelActual}"`);
        results.push({
          page: 'Payment',
          field: 'Next Payment Label',
          expected: labelExpected,
          actual: labelActual,
          status: labelStatus
        });

        const pricePresent = actualPrice !== 'N/A';
        const priceExpected = 'Visible next payment price';
        const priceActual = pricePresent ? actualPrice : 'Not visible';
        const priceStatus = pricePresent ? 'PASS' : 'FAIL';
        console.log(`  ${priceStatus === 'PASS' ? '✅' : '❌'} [Next Payment Price] expected="${priceExpected}" actual="${priceActual}"`);
        results.push({
          page: 'Payment',
          field: 'Next Payment Price',
          expected: priceExpected,
          actual: priceActual,
          status: priceStatus
        });
      }
    }
  }

  // ─────────────────────────────
  // GET FIELD VALUE
  // ─────────────────────────────
  private async getFieldValue(
    field: string,
    eventData: Record<string, string>,
    bodyText: string
  ): Promise<string> {
    const fieldLower = field.toLowerCase().replace(/\s+/g, ' ').trim();
    const lower = bodyText.toLowerCase();
    const lines = bodyText.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    // ── Page title ─────────────────────────────────────────────
    if (fieldLower === 'page title' || fieldLower === 'pagetitle' || fieldLower === 'page heading') {
      const h1 = await this.page.locator('h1').first().textContent().catch(() => '');
      return (h1 || '').trim();
    }

    // ── Header ─────────────────────────────────────────────────
    if (fieldLower === 'header' || fieldLower === 'page header' || fieldLower === 'subheader') {
      const headerLines = bodyText.split('\n').map(l => l.trim()).filter(l => l.length > 20 && l.length < 200);
      
      const knownHeaders = [
        'payment is encrypted',
        'change how you pay',
        '81% off',
        '20% off',
        'first month free'
      ];
      if (eventData.PAYMENT_HEADER) {
        knownHeaders.push(eventData.PAYMENT_HEADER.toLowerCase());
      }

      for (const line of headerLines) {
        const lowerLine = line.toLowerCase();
        for (const kh of knownHeaders) {
          if (lowerLine.includes(kh)) return line;
        }
      }

      for (const line of headerLines) {
        if (/payment\s+is\s+encrypted/i.test(line)) return line;
        if (/secure/i.test(line) && /pay/i.test(line)) return line;
      }
      // Try live DOM search via locator for encrypted text (which might be hidden/collapsed)
      const liveEncrypted = await this.page.locator('p, span, div')
        .filter({ hasText: /encrypted/i })
        .first()
        .textContent()
        .then((t: string | null) => (t || '').trim())
        .catch(() => '');
      if (liveEncrypted && liveEncrypted.toLowerCase().includes('encrypted')) {
        return liveEncrypted;
      }
      
      // Fallback only to non-cancellation lines
      if (headerLines.length > 1) {
        const line = headerLines[1];
        const lowerLine = line.toLowerCase();
        if (
          !lowerLine.includes('cancel') &&
          !lowerLine.includes('charged') &&
          !lowerLine.includes('billed') &&
          !lowerLine.includes('minimum term')
        ) {
          return line;
        }
      }
      return 'N/A';
    }

    // ── DAZN Tier ──────────────────────────────────────────────
    if (fieldLower === 'dazn tier' || fieldLower === 'tier') {
      const tierMatch = bodyText.match(/DAZN\s+(Standard|Ultimate|Premium)/i);
      if (tierMatch) return tierMatch[0].trim();
      if (lower.includes('dazn ultimate')) return 'DAZN Ultimate';
      if (lower.includes('dazn standard')) return 'DAZN Standard';
      return 'N/A';
    }

    // ── Plan Change CTA ────────────────────────────────────────
    if (fieldLower === 'plan change cta' || fieldLower === 'change plan button') {
      const changeBtn = this.page.locator(
        'button:has-text("Change"), a:has-text("Change")'
      ).first();
      const visible = await changeBtn.isVisible({ timeout: 2000 }).catch(() => false);
      if (visible) {
        const text = await changeBtn.textContent().catch(() => '');
        return (text || '').trim();
      }
      return 'N/A';
    }

   // ── Plan Name ──────────────────────────────────────────────
    if (fieldLower === 'plan name' || fieldLower === 'plan type') {
      // Use DOM locators for precise extraction — find the plan name near the purchase summary
      // Look for text near "DAZN Standard" or "DAZN Ultimate" or near "Change" button

      // Strategy 1: Find plan name pattern in lines that look like a label (short, specific)
      const planPatterns = [
        /^Flex\s*[–\-]\s*Pay\s*Monthly\s*-\s*First\s*Month\s*Only$/i,
        /^Flex\s*[–\-]\s*Pay\s*Monthly$/i,
        /^Annual\s*[–\-]\s*Pay\s*(?:Monthly|Upfront|over\s*time)$/i,
      ];
      for (const pattern of planPatterns) {
        for (const line of lines) {
          if (pattern.test(line)) return line;
        }
      }

      // Strategy 2: Search in body text (non-anchored) — plan names before free text
      const bodyPatterns = [
        /Flex\s*[–\-]\s*Pay\s*Monthly\s*-\s*First\s*Month\s*Only/i,
        /Flex\s*[–\-]\s*Pay\s*Monthly/i,
        /Annual\s*[–\-]\s*Pay\s*(?:Monthly|Upfront|over\s*time)/i,
      ];
      for (const pattern of bodyPatterns) {
        const match = bodyText.match(pattern);
        if (match) return match[0].trim();
      }

      // Strategy 3: Fall back to free text badges if no plan name found
      const freeMatch = bodyText.match(/7[-\s]?days?\s+free/i);
      if (freeMatch) return freeMatch[0].trim();
      const monthFreeMatch = bodyText.match(/(?:first|1st)\s+month\s+free/i);
      if (monthFreeMatch) return monthFreeMatch[0].trim();

      return 'N/A';
    }
    // ── PPV Name ───────────────────────────────────────────────
    if (fieldLower === 'ppv name' || fieldLower === 'ppv event name' || fieldLower === 'event name') {
      const source = (eventData.SOURCE || eventData.source || '').toLowerCase();
      if (source === 'boxing-ultimate') return 'N/A';

      const ppvName = eventData.PPV_NAME || '';
      const regex = new RegExp(ppvName.split(/\s+/).join('.*'), 'i');
      const match = bodyText.match(regex);
      if (match) return match[0].trim();

      // Fallback: match by fighter names (handles "v" vs "vs." mismatch)
      // Extract distinct name parts (words > 3 chars, excluding separators)
      const nameParts = ppvName
        .split(/\bvs?\b\.?|\s*[-–—:]\s*/i)
        .map(p => p.trim())
        .filter(p => p.length > 2);
      if (nameParts.length >= 2) {
        const first = nameParts[0].toLowerCase();
        const last = nameParts[nameParts.length - 1].toLowerCase();
        for (const line of lines) {
          const lowerLine = line.toLowerCase();
          if (lowerLine.includes(first) && lowerLine.includes(last) && /\bvs?\b\.?/i.test(line) && line.length < 100) {
            return line;
          }
        }
        // Also try bodyText substring approach
        const firstIdx = lower.indexOf(first);
        const lastIdx = lower.indexOf(last);
        if (firstIdx >= 0 && lastIdx >= 0) {
          const start = Math.min(firstIdx, lastIdx);
          const end = Math.max(firstIdx, lastIdx) + last.length + 5;
          const snippet = bodyText.substring(start, Math.min(end, bodyText.length)).trim();
          if (snippet.length < 100 && /\bvs?\b\.?/i.test(snippet)) {
            return snippet;
          }
        }
      }

      // Look for a line containing "PPV:"
      for (const line of lines) {
        if (/^PPV:/i.test(line)) {
          return line.replace(/^PPV:\s*/i, '').trim();
        }
      }

      // Fallback: vsMatch excluding plan-related terms
      for (const line of lines) {
        const lowerLine = line.toLowerCase();
        if (lowerLine.includes('flex') || lowerLine.includes('annual') || lowerLine.includes('monthly') || lowerLine.includes('subscribe') || lowerLine.includes('payment') || lowerLine.includes('pay') || lowerLine.includes('change')) {
          continue;
        }
        const vsM = line.match(/([A-Za-z\s.]+\s+(?:vs?\.?|–|-)\s+[A-Za-z\s.]+?)/i);
        if (vsM) return vsM[0].trim();
      }

      return 'N/A';
    }

    // ── PPV Price ──────────────────────────────────────────────
    if (fieldLower === 'ppv price') {
      const source = (eventData.SOURCE || eventData.source || '').toLowerCase();
      if (source === 'boxing-ultimate') return 'N/A';

      const ppvName = eventData.PPV_NAME || '';
      let ppvIndex = -1;

      // Try to find matchup part in the text
      const parts = ppvName.toLowerCase().split(/[:\-–]/).map(p => p.trim());
      for (const part of parts) {
        const idx = lower.indexOf(part);
        if (idx >= 0) {
          ppvIndex = idx;
          break;
        }
      }
      if (ppvIndex === -1) {
        const words = ppvName.toLowerCase().split(/\s+/).filter(w => w.length > 3);
        for (const word of words) {
          const idx = lower.indexOf(word);
          if (idx >= 0) {
            ppvIndex = idx;
            break;
          }
        }
      }

      if (ppvIndex >= 0) {
        const nearText = bodyText.substring(ppvIndex, ppvIndex + 300);
        const priceMatch = nearText.match(/[\$£€₹]\s?\d+(?:\.\d{2})?/);
        if (priceMatch) return priceMatch[0].trim();
      }

      const expectedPrice = eventData.PPV_PRICE || '';
      if (expectedPrice && lower.includes(expectedPrice.toLowerCase())) {
        return expectedPrice;
      }

      const allPrices = bodyText.match(/[\$£€₹]\s?\d+(?:\.\d{2})?/g) || [];
      if (allPrices.length > 0) {
        const sorted = allPrices
          .map(p => ({ raw: p, val: parseFloat(p.replace(/[^\d.]/g, '')) }))
          .sort((a, b) => b.val - a.val);
        return sorted[0].raw.trim();
      }
      return 'N/A';
    }

    // ── First Month Free Price ─────────────────────────────────
    if (fieldLower === 'first month free price') {
      if (bodyText.includes('£0') || bodyText.includes('$0') || bodyText.includes('€0')) {
        const match = bodyText.match(/[\$£€₹]\s?0/);
        return match ? match[0].trim() : 'N/A';
      }
      return 'N/A';
    }

   // ── First Month Free Text ──────────────────────────────────
    if (fieldLower === 'first month free text' || fieldLower === 'payment free text') {
      const lines = bodyText.split('\n').map(l => l.trim());
      for (const line of lines) {
        if (/first\s+month\s+free/i.test(line) && line.length < 60) return line;
        if (/7[-\s]?days?\s+free/i.test(line) && line.length < 40) return line;
      }
      if (lower.includes('first month free')) return 'First month free';
      if (lower.includes('7-days free') || lower.includes('7 days free')) return '7-days free';
      return 'N/A';
    }
    
    // ── 7 Days Free Badge ──────────────────────────────────────
    if (fieldLower.includes('7 days free') || fieldLower.includes('7-days free')) {
      if (fieldLower.includes('price')) {
        const match = bodyText.match(/[\$£€₹]\s?0/);
        return match ? match[0].trim() : 'N/A';
      }
      const lines = bodyText.split('\n').map(l => l.trim());
      for (const line of lines) {
        if (/7[-\s]?days?\s+free/i.test(line) && line.length < 40) return line;
      }
      return lower.includes('7-days free') || lower.includes('7 days free') ? '7-days free' : 'N/A';
    }

    // ── Today You Pay Text ─────────────────────────────────────
    if (fieldLower === 'today you pay text') {
      return lower.includes('today you pay') ? 'Today you pay' : 'N/A';
    }

    // ── Today You Pay Price ────────────────────────────────────
    if (fieldLower === 'today you pay price' || fieldLower === 'today price') {
      const livePrice = await this.page.evaluate(() => {
        const isStrike = (el: HTMLElement): boolean => {
          if (el.closest('del, s') !== null) return true;
          const style = window.getComputedStyle(el);
          return !!(style.textDecorationLine?.includes('line-through') ||
                    style.textDecoration?.includes('line-through'));
        };

        const cleanText = (v: string) => v.replace(/\s+/g, ' ').trim();

        const allElements = Array.from(document.querySelectorAll<HTMLElement>('*'));
        const priceElements = allElements.filter(el => {
          if (el.children.length > 0) return false;
          const text = cleanText(el.textContent || '');
          return /^[£$€₹]\s?\d+(?:\.\d{2})?$/.test(text);
        });

        let todayEl: HTMLElement | null = null;
        for (const el of allElements) {
          const t = cleanText(el.textContent || '');
          if (/today\s+you\s+pay/i.test(t)) {
            if (!todayEl || el.textContent.length < todayEl.textContent.length) {
              todayEl = el;
            }
          }
        }

        if (todayEl) {
          let curr: HTMLElement | null = todayEl;
          while (curr && curr !== document.body) {
            const pricesInSection = Array.from(curr.querySelectorAll<HTMLElement>('*'))
              .filter(el => priceElements.includes(el));
            
            const strikePrices = pricesInSection.filter(el => isStrike(el));
            const activePrices = pricesInSection.filter(el => !isStrike(el));
            
            if (activePrices.length > 0) {
              const activePriceVal = activePrices[0].textContent?.trim();
              if (strikePrices.length > 0) {
                const strikePriceVal = strikePrices[0].textContent?.trim();
                if (strikePriceVal === activePriceVal) {
                  console.warn(`⚠️ Redundant strike-through price found showing same value: ${strikePriceVal}`);
                  return activePriceVal;
                }
              }
              return activePriceVal;
            }
            curr = curr.parentElement;
          }
        }
        return null;
      }).catch(() => null);

      if (livePrice) return livePrice;

      const todaySplit = bodyText.split(/today\s+you\s+pay/i);
      if (todaySplit.length > 1) {
        const afterToday = todaySplit[1];
        const prices = afterToday.match(/[\$£€₹]\s?\d+(?:\.\d{2})?/g) || [];
        const origPrice = eventData.ANNUAL_PAY_MONTHLY_ORIGINAL_PRICE || eventData.UPSELL_ORIGINAL_PRICE || '';
        const cleanOrig = origPrice.replace(/[^\d.]/g, '');
        for (const p of prices) {
          const cleanP = p.replace(/[^\d.]/g, '');
          if (cleanOrig && cleanP === cleanOrig) {
            continue;
          }
          return p.trim();
        }
        if (prices[0]) return prices[0].trim();
      }
      return 'N/A';
    }

    if (fieldLower === 'discount badge') {
      const hasActiveOffer = eventData.ACTIVE_OFFER_PRESENT === 'true';
      if (!hasActiveOffer) return 'N/A';

      const lines = bodyText.split('\n').map(l => l.trim());
      for (const line of lines) {
        if (line.toLowerCase().includes('off') && (line.toLowerCase().includes('months') || line.toLowerCase().includes('month')) && line.length < 50) {
          return line;
        }
      }
      for (const line of lines) {
        if (/\d+%\s*off/i.test(line) && line.length < 40) {
          return line;
        }
      }
      return 'N/A';
    }

    // ── Next Payment Date ──────────────────────────────────────
    if (fieldLower === 'next payment date' || fieldLower === 'next payment') {
      // Look for DD/MM/YYYY format
      const dateMatch = bodyText.match(/\d{1,2}\/\d{2}\/\d{4}/);
      if (dateMatch) return dateMatch[0].trim();
      // Look for "Next payment" text and extract date nearby
      const nextIdx = lower.indexOf('next payment');
      if (nextIdx >= 0) {
        const afterText = bodyText.substring(nextIdx, nextIdx + 150);
        const d = afterText.match(/\d{1,2}\/\d{2}\/\d{4}/);
        if (d) return d[0].trim();
        const dateAlt = afterText.match(
          /\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}/i
        );
        if (dateAlt) return dateAlt[0].trim();
      }
      return 'N/A';
    }

    // ── Next Payment Label ─────────────────────────────────────
    if (fieldLower === 'next payment label') {
      const lines = bodyText.split('\n').map(l => l.trim());
      for (const line of lines) {
        if (/next\s+(?:annual\s+)?payment\s+on/i.test(line)) return line;
      }
      const match = bodyText.match(/next\s+(?:annual\s+)?payment\s+on\s+\d{1,2}\/\d{2}\/\d{4}/i);
      if (match) return match[0].trim();
      const matchAlt = bodyText.match(/next\s+(?:annual\s+)?payment\s+on\s+\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}/i);
      if (matchAlt) return matchAlt[0].trim();
      return 'N/A';
    }

    // ── Next Payment Price ─────────────────────────────────────
    if (fieldLower === 'next payment price') {
      let nextIdx = lower.indexOf('next payment');
      if (nextIdx === -1) {
        nextIdx = lower.indexOf('next annual payment');
      }
      if (nextIdx >= 0) {
        const afterText = bodyText.substring(nextIdx, nextIdx + 100);
        const price = afterText.match(/[\$£€₹]\s?\d+(?:\.\d{2})?/);
        if (price) return price[0].trim();
      }
      return 'N/A';
    }

    // ── Cancellation Text ──────────────────────────────────────
    if (fieldLower === 'cancellation text' || fieldLower === 'cancel text') {
      const lines = bodyText.split('\n')
        .map(l => l.trim())
        .filter(l => !/terms of use|privacy policy|cookie notice|by signing up|agree to our terms/i.test(l));
      for (const line of lines) {
        if (/auto[-\s]?renews/i.test(line) && /cancel/i.test(line) && line.length < 350) return line;
        if (/first\s+month\s+free/i.test(line) && /month/i.test(line) && line.length > 40) return line;
      }
      // Prioritized: look for charge/billing terms combined with cancel/renew
      for (const line of lines) {
        if (line.length > 30 && line.length < 350) {
          const lowerLine = line.toLowerCase();
          if (
            (lowerLine.includes('charged') || lowerLine.includes('charge') || lowerLine.includes('pay') || lowerLine.includes('billed') || lowerLine.includes('billing')) &&
            (lowerLine.includes('cancel') || lowerLine.includes('renew') || lowerLine.includes('renewal')) &&
            (lowerLine.includes('month') || lowerLine.includes('trial') || lowerLine.includes('days') || lowerLine.includes('free') || lowerLine.includes('subscription'))
          ) {
            return line;
          }
        }
      }
      // Fallback: find paragraph with cancel, renew, subscription, contract, or term details
      for (const line of lines) {
        if (line.length > 30 && line.length < 350) {
          const lowerLine = line.toLowerCase();
          if (
            (lowerLine.includes('cancel') || lowerLine.includes('renew') || lowerLine.includes('renewal')) &&
            (lowerLine.includes('account') || lowerLine.includes('contract') || lowerLine.includes('term') || lowerLine.includes('cycle') || lowerLine.includes('month') || lowerLine.includes('year') || lowerLine.includes('free') || lowerLine.includes('subscription'))
          ) {
            return line;
          }
        }
      }
      return 'N/A';
    }

    // ── Ultimate Upsell Text ───────────────────────────────────
    if (fieldLower === 'ultimate upsell text') {
      const lines = bodyText.split('\n').map(l => l.trim());
      for (const line of lines) {
        if (/switch\s+to\s+dazn\s+ultimate/i.test(line)) return line;
      }
      return lower.includes('switch to dazn ultimate') ? 'Switch to DAZN Ultimate' : 'N/A';
    }

    // ── Bundle Name ───────────────────────────────────────────
    if (fieldLower === 'bundle name') {
      const bundleName = (eventData?.BUNDLE_NAME || 'The Contender Bundle').toLowerCase();
      const idx = lower.indexOf(bundleName);
      if (idx >= 0) {
        return bodyText.substring(idx, idx + bundleName.length);
      }
      return 'N/A';
    }

    // ── Bundle Price ──────────────────────────────────────────
    if (fieldLower === 'bundle price') {
      const bundleName = (eventData?.BUNDLE_NAME || 'The Contender Bundle').toLowerCase();
      const bundleIdx = lower.indexOf(bundleName);
      if (bundleIdx >= 0) {
        const afterText = bodyText.substring(bundleIdx, bundleIdx + 150);
        const prices = afterText.match(/[\$£€₹]\s?\d+(?:\.\d{2})?/g) || [];
        const originalPrice = eventData?.BUNDLE_ORIGINAL_PRICE || '';
        for (const p of prices) {
          if (originalPrice && p.trim().includes(originalPrice.replace(/[^\d.]/g, ''))) {
            continue;
          }
          return p.trim();
        }
        if (prices.length > 0 && prices[0]) return prices[0].trim();
      }
      const expectedPrice = eventData?.BUNDLE_PRICE || '';
      if (expectedPrice && lower.includes(expectedPrice.toLowerCase())) {
        return expectedPrice;
      }
      return 'N/A';
    }

    // ── Bundle Original Price ──────────────────────────────────
    if (fieldLower === 'bundle original price') {
      const bundleName = (eventData?.BUNDLE_NAME || 'The Contender Bundle').toLowerCase();
      const bundleIdx = lower.indexOf(bundleName);
      if (bundleIdx >= 0) {
        const afterText = bodyText.substring(bundleIdx, bundleIdx + 150);
        const prices = afterText.match(/[\$£€₹]\s?\d+(?:\.\d{2})?/g) || [];
        const bundlePriceVal = parseFloat((eventData?.BUNDLE_PRICE || '0').replace(/[^\d.]/g, ''));
        for (const p of prices) {
          const val = parseFloat(p.replace(/[^\d.]/g, ''));
          if (val > bundlePriceVal) return p.trim();
        }
      }
      const expectedOrig = eventData?.BUNDLE_ORIGINAL_PRICE || '';
      if (expectedOrig && lower.includes(expectedOrig.toLowerCase())) {
        return expectedOrig;
      }
      return 'N/A';
    }

    // ── Bundle Discount ────────────────────────────────────────
    if (fieldLower === 'bundle discount') {
      const bundleName = (eventData?.BUNDLE_NAME || 'The Contender Bundle').toLowerCase();
      const bundleIdx = lower.indexOf(bundleName);
      if (bundleIdx >= 0) {
        const afterText = bodyText.substring(bundleIdx, bundleIdx + 150);
        const discountMatch = afterText.match(/\d+%\s*(?:off|discount)/i) || afterText.match(/save\s+\d+%/i);
        if (discountMatch) return discountMatch[0].trim();
      }
      const expectedDisc = eventData?.BUNDLE_DISCOUNT || '';
      if (expectedDisc && lower.includes(expectedDisc.toLowerCase())) {
        return expectedDisc;
      }
      return 'N/A';
    }

    // ── Signed In As Text ──────────────────────────────────────
    if (fieldLower === 'signed in as text' || fieldLower === 'signed in as') {
      for (const line of lines) {
        if (line.toLowerCase().includes('signed in as')) {
          return line;
        }
      }
      const textFromPage = await this.page.locator('p, span, div')
        .filter({ hasText: /signed in as/i })
        .first()
        .textContent()
        .then((t: string | null) => (t || '').trim())
        .catch(() => '');
      if (textFromPage) return textFromPage;
      return 'N/A';
    }

   // ── Credit & Debit Card ────────────────────────────────────
    if (fieldLower.includes('credit') && (fieldLower.includes('option') || fieldLower.includes('available'))) {
      // Check section ID
      const sectionCount = await this.page.locator('section[id="Credit & Debit Card"]').count().catch(() => 0);
      if (sectionCount > 0) return 'Yes';
      // Check accordion text
      const accCount = await this.page.locator('.accordion-cta-refined___3csKv').filter({ hasText: /Credit/i }).count().catch(() => 0);
      if (accCount > 0) return 'Yes';
      // Check any text containing credit & debit
      const freshBody = await this.page.locator('body').innerText().catch(() => '');
      if (freshBody.toLowerCase().includes('credit') && freshBody.toLowerCase().includes('debit')) return 'Yes';
      return 'No';
    }

    // ── PayPal ─────────────────────────────────────────────────
    if (fieldLower.includes('paypal') && (fieldLower.includes('option') || fieldLower.includes('available'))) {
      const sectionCount = await this.page.locator('section[id="PayPal"]').count().catch(() => 0);
      if (sectionCount > 0) return 'Yes';
      const accCount = await this.page.locator('.accordion-cta-refined___3csKv').filter({ hasText: /PayPal/i }).count().catch(() => 0);
      if (accCount > 0) return 'Yes';
      const freshBody = await this.page.locator('body').innerText().catch(() => '');
      if (freshBody.toLowerCase().includes('paypal')) return 'Yes';
      return 'No';
    }

    // ── Google Pay ─────────────────────────────────────────────
    if (fieldLower.includes('google') && (fieldLower.includes('option') || fieldLower.includes('available'))) {
      const sectionCount = await this.page.locator('section[id="Google Pay"]').count().catch(() => 0);
      if (sectionCount > 0) return 'Yes';
      const accCount = await this.page.locator('.accordion-cta-refined___3csKv').filter({ hasText: /Google/i }).count().catch(() => 0);
      if (accCount > 0) return 'Yes';
      const freshBody = await this.page.locator('body').innerText().catch(() => '');
      if (freshBody.toLowerCase().includes('google pay')) return 'Yes';
      return 'No';
    }

    // ── Redeem Promo Code CTA ──────────────────────────────────
    if (fieldLower.includes('promo') || fieldLower.includes('redeem')) {
      const el = this.page.locator('text=/Redeem promo code/i, text=/promo code/i').first();
      if (await el.isVisible().catch(() => false)) return 'Yes';
      return lower.includes('promo code') || lower.includes('redeem') ? 'Yes' : 'No';
    }

    // ── Rate Plan ──────────────────────────────────────────────
    if (fieldLower === 'rate plan') {
      const planPatterns = [
        /Flex\s*[-–]\s*Pay\s*Monthly\s*-\s*First\s*Month\s*Only/i,
        /Annual\s*[-–]\s*Pay\s*Monthly/i,
        /Annual\s*[-–]\s*Pay\s*Upfront/i,
        /Flex\s*[-–]\s*Pay\s*Monthly/i,
        /Pay\s*Monthly\s*\(First\s*12\s*months\)/i,
      ];
      for (const pattern of planPatterns) {
        const match = bodyText.match(pattern);
        if (match) return match[0].trim();
      }
      return 'N/A';
    }

    // ── Rate Plan Original Price (strikethrough / crossed-out price) ──
    if (fieldLower === 'rate plan original price') {
      // Look for strikethrough elements (del, s) containing a price
      const strikeSelectors = ['del', 's', '[class*="strike"]', '[class*="crossed"]', '[class*="original"]', '[style*="line-through"]'];
      for (const sel of strikeSelectors) {
        const el = this.page.locator(sel).first();
        if (await el.isVisible({ timeout: 1000 }).catch(() => false)) {
          const text = (await el.textContent().catch(() => ''))?.trim() || '';
          const price = text.match(/[\$£€₹]\s?\d+(?:\.\d{2})?/);
          if (price) return price[0].trim();
        }
      }

      // Fallback: look for a price with strikethrough in the page HTML
      const strikePrice = await this.page.evaluate(() => {
        const els = document.querySelectorAll<HTMLElement>('del, s, [style*="line-through"]');
        for (const el of els) {
          const text = el.textContent || '';
          const match = text.match(/[\$£€₹]\s?\d+(?:\.\d{2})?/);
          if (match) return match[0].trim();
        }
        // Also check computed styles
        const allSpans = document.querySelectorAll<HTMLElement>('span, p, div');
        for (const el of allSpans) {
          const style = window.getComputedStyle(el);
          if (style.textDecorationLine?.includes('line-through')) {
            const text = el.textContent || '';
            const match = text.match(/[\$£€₹]\s?\d+(?:\.\d{2})?/);
            if (match) return match[0].trim();
          }
        }
        return null;
      }).catch(() => null);

      if (strikePrice) return strikePrice;
      return 'N/A';
    }

    // ── Rate Plan Discounted Price ─────────────────────────────
    if (fieldLower === 'rate plan discounted price') {
      // Look for £0/$0/€0 near the rate plan section (first month free / discounted price)
      // This typically appears near the plan label as a promotional price

      // Strategy 1: Find a zero price near the rate plan label
      const ratePlanIdx = lower.indexOf('annual') >= 0 ? lower.indexOf('annual') : lower.indexOf('flex');
      if (ratePlanIdx >= 0) {
        const nearText = bodyText.substring(Math.max(0, ratePlanIdx - 50), ratePlanIdx + 200);
        const zeroPrice = nearText.match(/[\$£€₹]\s?0(?:\.00)?/);
        if (zeroPrice) return zeroPrice[0].trim();
      }

      // Strategy 2: Look for elements showing discounted/free price
      const discountSelectors = ['[class*="discount"]', '[class*="promo"]', '[class*="free"]', '[class*="sale"]'];
      for (const sel of discountSelectors) {
        const el = this.page.locator(sel).first();
        if (await el.isVisible({ timeout: 500 }).catch(() => false)) {
          const text = (await el.textContent().catch(() => ''))?.trim() || '';
          const price = text.match(/[\$£€₹]\s?\d+(?:\.\d{2})?/);
          if (price) return price[0].trim();
        }
      }

      // Strategy 3: Check if page shows a zero price at all
      const zeroMatch = bodyText.match(/[\$£€₹]\s?0(?:\.00)?/);
      if (zeroMatch) return zeroMatch[0].trim();

      return 'N/A';
    }

    // ── Rate Plan Price ────────────────────────────────────────
    if (fieldLower === 'rate plan price') {
      const priceWithPeriod = bodyText.match(/[\$£€₹]\s?\d+(?:\.\d{2})?\s*\/\s*(?:month|year)/i);
      if (priceWithPeriod) return priceWithPeriod[0].trim();
      return 'N/A';
    }

    // ── Rate Plan Subtext / Contract Subtext ───────────────────
    if (fieldLower === 'rate plan subtext' || fieldLower === 'contract subtext') {
      const lines = bodyText.split('\n').map(l => l.trim());
      for (const line of lines) {
        if (/billed\s+monthly/i.test(line) || /12-month\s+contract/i.test(line)) return line;
        if (/pay.*full.*up[- ]?front/i.test(line) || /full\s+year\s+up[- ]?front/i.test(line) || (/up[- ]?front/i.test(line) && !/annual/i.test(line))) return line;
      }
      return 'N/A';
    }

    // ── Rate Plan Save Badge / Save Badge ───────────────────────
    if (fieldLower === 'rate plan save badge' || fieldLower === 'save badge') {
      const lines = bodyText.split('\n').map(l => l.trim());
      for (const line of lines) {
        if (/save\s+[\$£€₹]\d+(?:\.\d{2})?/i.test(line)) {
          const match = line.match(/save\s+[\$£€₹]\d+(?:\.\d{2})?/i);
          return match ? match[0].trim() : line;
        }
      }
      return 'N/A';
    }

    // ── Saved Card Present ─────────────────────────────────────
    if (fieldLower === 'saved card present') {
      const cardPattern = /(?:visa|mastercard|amex|discover|jcb|diners|card|ending)/i;
      const maskPattern = /\*{4}|•{4}|●{4}|[\u2022]{4}/;
      const isCardPresent = cardPattern.test(bodyText) && maskPattern.test(bodyText);
      if (isCardPresent) return 'Yes';
      const stored = await this.page.locator('[class*="stored-card" i], [class*="saved-card" i], [id*="stored-card" i], [id*="saved-card" i], [class*="savedCard" i]').count().catch(() => 0);
      if (stored > 0) return 'Yes';
      return 'No';
    }

    // ── Generic presence check ─────────────────────────────────
    if (fieldLower.endsWith('present') || fieldLower.endsWith('available') || fieldLower.endsWith('option')) {
      const keyword = field.replace(/\s*(present|available|option)\s*/i, '').trim().toLowerCase();
      return lower.includes(keyword) ? 'Yes' : 'No';
    }

    // ── Generic fallback ───────────────────────────────────────
    return 'N/A';
  }

  // ─────────────────────────────
  // COMPARE VALUES
  // ─────────────────────────────
  // Uses the shared compare() utility from utils/compare which handles:
  //   - Normalization (currency symbols, smart quotes, whitespace)
  //   - Yes/No/Gold matching
  //   - Pipe-separated multiple values
  //   - Contains / startsWith type overrides
  //   - Exact match with trailing period flexibility
  //   - Price comparison (numeric extraction)
  //   - Date flexibility (month + day matching)
  //   - Time match flexibility
  private compareValues(actual: string, expected: string, field: string): string {
    if (!expected) return 'SKIP';

    // Skip unresolved placeholders
    if (expected.includes('{{') && expected.includes('}}')) return 'SKIP';

    // Strictly validate N/A presence/absence rather than skipping
    if (expected.toUpperCase() === 'N/A') {
      return actual.toUpperCase() === 'N/A' ? 'PASS' : 'FAIL';
    }

    // Extract type from row (if available, passed via field context)
    // The compare utility handles all standard cases
    const result = compare(actual, expected);
    return result ? 'PASS' : 'FAIL';
  }
  // ─────────────────────────────
  // GET AVAILABLE PAYMENT METHODS
  // ─────────────────────────────
  async getAvailablePaymentMethods(): Promise<string[]> {
    const methods: string[] = [];

    try {
      const creditVisible = await this.page.locator('text=/Credit.*Debit/i')
        .first().isVisible({ timeout: 2000 }).catch(() => false);
      if (creditVisible) methods.push('Credit & Debit Card');

      const googlePayVisible = await this.page.locator('text=/Google Pay/i')
        .first().isVisible({ timeout: 2000 }).catch(() => false);
      if (googlePayVisible) methods.push('Google Pay');

      const paypalVisible = await this.page.locator('text=/PayPal/i')
        .first().isVisible({ timeout: 2000 }).catch(() => false);
      if (paypalVisible) methods.push('PayPal');
    } catch {
      console.warn('⚠️  Error getting payment methods');
    }

    return methods;
  }
}