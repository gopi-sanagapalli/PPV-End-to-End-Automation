import selectors from '../config/selectors.json';

const clean = (v: any) =>
  String(v ?? '')
    .replace(/\s+/g, ' ')
    .trim();

export async function getActualValue(page: any, field: string): Promise<string> {
  try {
    const key = field.trim().toLowerCase();

    // ─────────────────────────────
    // HELPERS
    // ─────────────────────────────
    const getText = async (selector: string) => {
      const el = page.locator(selector).first();
      if (await el.isVisible().catch(() => false)) {
        return clean(await el.textContent());
      }
      return 'N/A';
    };

    const exists = async (selector: string) => {
      const el = page.locator(selector).first();
      return (await el.isVisible().catch(() => false)) ? 'Yes' : 'No';
    };

    const getPrice = async () => {
      const body = await page.locator('body').innerText().catch(() => '');
      const match = body.match(/(\$|£|AUD\s*)\s?(\d+(?:\.\d{2})?)/i);
      return match ? match[2] : 'N/A';
    };

    // ─────────────────────────────
    // FIELD MAPPING (NORMALIZED)
    // ─────────────────────────────
    switch (key) {

      // ───────── LANDING / PPV COMMON ─────────
      case 'ppv tile present':
      case 'ppv image present':
        return await exists(selectors.ppv.image);

      case 'ppv name':
      case 'event name':
        return await getText(selectors.ppv.eventName);

      case 'ppv date and time':
      case 'event date and time':
        return await getText(selectors.ppv.date);

      case 'buy now button':
        return await exists(selectors.ppv.buyCTA);

      // ───────── PPV PAGE ─────────
      case 'page title':
        return await getText(selectors.ppv.pageTitle);

      case 'header sub text':
        return await getText('p');

      case 'ppv price':
        return await getText(selectors.ppv.price);

      case 'currency': {
        const body = await page.locator('body').innerText();
        if (body.includes('$')) return '$';
        if (body.includes('£')) return '£';
        return 'N/A';
      }

      case 'upsell section present':
        return await exists(selectors.ppv.upsellSection);

      case 'upsell label':
        return await getText(selectors.ppv.upsellLabel);

      case 'upsell plan name':
        return await getText(selectors.ppv.upsellPlan);

      case 'upsell price':
        return await getPrice();

      case 'upsell price text': {
        const body = await page.locator('body').innerText();
        return /from/i.test(body) ? 'From' : 'N/A';
      }

      // ───────── VARIANT / BUNDLE ─────────
      case 'bundle card present':
        return await exists(selectors.ppv.bundleCard);

      case 'bundle price':
      case 'bundle original price':
        return await getPrice();

      case 'bundle discount label':
        return await getText(selectors.ppv.bundleDiscount);

      case 'included ppv2 name':
        return await getText(selectors.ppv.bundleSecondEvent);

      // ───────── PLAN PAGE ─────────
      case 'cta button':
        return await getText(selectors.daznPlan.ctaContinue);

      case 'trial card present':
        return await exists(selectors.daznPlan.trialCard);

      case 'trial title':
        return await getText(selectors.daznPlan.trialTitle);

      case 'trial description':
        return await getText(selectors.daznPlan.trialDescription);

      case 'upsell card present':
        return await exists(selectors.daznPlan.upsellCard);

      case 'upsell sub text':
        return await getText(selectors.daznPlan.upsellSubText);

      case 'upsell feature 1':
        return await getText(selectors.daznPlan.upsellFeature1);

      case 'upsell feature 2':
        return await getText(selectors.daznPlan.upsellFeature2);

      case 'upsell feature 3':
        return await getText(selectors.daznPlan.upsellFeature3);

      // ───────── PAYMENT PAGE ─────────
      case 'page title payment':
      case 'page title':
        return await getText(selectors.payment.pageTitle);

      case 'header':
        return await getText(selectors.payment.header);

      case 'dazn tier':
        return await getText(selectors.payment.tier);

      case 'plan change cta':
        return await getText(selectors.payment.changeCTA);

      case 'ppv name payment':
        return await getText(selectors.payment.ppvName);

      case 'ppv price payment':
        return await getPrice();

      case '7 day free text':
        return await getText(selectors.payment.freeTrial);

      case 'today you pay text':
        return await getText(selectors.payment.todayText);

      case 'today you pay price':
        return await getText(selectors.payment.todayPrice);

      case 'next payment date':
        return await getText(selectors.payment.nextPayment);

      case 'cancellation text':
        return await getText(selectors.payment.cancellation);

      // ───────── DEFAULT ─────────
      default:
        return 'N/A';
    }

  } catch (err) {
    return 'N/A';
  }
}