import selectors from '../config/selectors.json';

export async function getActualValue(
  page: any,
  field: string
): Promise<string> {

  const keyRaw = field.replace(/\s+/g, ' ').trim().toLowerCase();
  const key = field.replace(/\s+/g, '').toLowerCase();

  const clean = (v: any) =>
    String(v ?? '').replace(/\s+/g, ' ').trim();

  const priceRegex = /(?:\$|₹|£)\s?\d+(?:,\d{3})*(?:\.\d{2})?/;

  const getText = async (locator: any) => {
    const count = await locator.count();

    for (let i = 0; i < count; i++) {
      const el = locator.nth(i);

      if (await el.isVisible().catch(() => false)) {
        const txt = await el.innerText().catch(() => '');
        if (txt && txt.trim().length > 2 && txt.length < 200) {
          return clean(txt);
        }
      }
    }

    return null;
  };

  const exists = async (locator: any) =>
    (await locator.first().isVisible().catch(() => false)) ? 'Yes' : 'No';

  try {

    // ───────── PAGE TYPE ─────────
    const url = page.url();

    let pageType: any = 'ppv';

    if (url.includes('PlanDetails')) pageType = 'daznPlan';
    else if (url.includes('payment')) pageType = 'payment';
    else if (url.includes('signup')) pageType = 'signup';

    const pageSelectors = selectors[pageType];

    // ───────── FIELD MAP ─────────
    const fieldMap: any = {
      pagetitle: 'pageTitle',
      headersubtext: 'pageSubHeader',
      eventname: 'eventName',
      ppvname: 'eventName',
      ppvprice: 'price',
      ctabutton: 'buyCTA',

      dazntier: 'tier',
      planchangecta: 'changeCTA',

      todayyoupaytext: 'todayText',
      todayyoupayprice: 'todayPrice',
      nextpaymentdate: 'nextPayment',
      cancellationtext: 'cancellation'
    };

    const selectorKey = fieldMap[key];

    // ─────────────────────────────────────
    // ✅ PRIMARY: SELECTOR-BASED
    // ─────────────────────────────────────
    if (selectorKey && pageSelectors?.[selectorKey]) {

      const locator = page.locator(pageSelectors[selectorKey]);

      if (key.includes('image') || key.includes('present')) {
        return await exists(locator);
      }

      const val = await getText(locator);
      if (val) return val;
    }

    // ─────────────────────────────────────
    // 🔥 FALLBACK (THIS SAVES YOUR TESTS)
    // ─────────────────────────────────────

    // TITLE
    if (keyRaw.includes('page title')) {
      return (await getText(page.locator('h1'))) || 'N/A';
    }

    // HEADER
    if (keyRaw.includes('header')) {
      return (
        (await getText(page.locator('h1 + p'))) ||
        (await getText(page.locator('p')))
      ) || 'N/A';
    }

    // EVENT NAME
    if (keyRaw.includes('ppv name') || keyRaw.includes('event name')) {
      return (
        (await getText(page.locator('text=/vs\\.?/i'))) ||
        (await getText(page.locator('h1, h2')))
      ) || 'N/A';
    }

    // PRICE
    if (keyRaw.includes('price')) {
      return (
        (await getText(page.locator(`text=/${priceRegex.source}/`)))
      ) || 'N/A';
    }

    // CTA
    if (keyRaw.includes('cta')) {
      return (
        (await getText(page.locator('button:visible')))
      ) || 'N/A';
    }

    // PLAN / TIER
    if (keyRaw.includes('tier') || keyRaw.includes('plan')) {
      return (
        (await getText(page.locator('text=/dazn/i')))
      ) || 'N/A';
    }

    // RADIO
    if (keyRaw.includes('selected') || keyRaw.includes('radio')) {
      const checked = await page.locator(
        'input[type="radio"]:checked, [aria-checked="true"]'
      ).count();

      return checked > 0 ? 'Yes' : 'No';
    }

    // IMAGE
    if (keyRaw.includes('image')) {
      return await exists(page.locator('img'));
    }

    // DATE
    if (keyRaw.includes('date') || keyRaw.includes('time')) {
      return (
        (await getText(page.locator('text=/Sat|Sun|Mon|Tue|Wed|Thu|Fri/i')))
      ) || 'N/A';
    }

    return 'N/A';

  } catch {
    return 'N/A';
  }
}