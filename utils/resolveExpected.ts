import { getDynamicDateBadge } from './dateUtils';

export function resolveExpected(
  rule: any,
  eventData: Record<string, string>
): string {
  console.log(`🔍 resolveExpected debug: rule =`, JSON.stringify(rule), `eventData =`, JSON.stringify(eventData));
  const rawField = rule.Field || rule.field || '';
  const field = rawField.trim().toLowerCase();
  const rawTier = rule.Tier || rule.tier || '';
  const tier = rawTier.trim().toLowerCase();
  const rawRatePlan = rule['Rate Plan'] || rule.ratePlan || rule['RatePlan'] || '';
  const ratePlan = rawRatePlan.trim().toLowerCase();

  let raw = rule.Expected ?? rule.Value;

  if (raw !== undefined && raw !== null) {
    const currentRatePlan = (eventData.RATE_PLAN || eventData.ratePlan || '').trim().toLowerCase();
    const currentSource = (eventData.SOURCE || eventData.source || '').trim().toLowerCase();

    if (field === 'header' || field === 'page header') {
      if (eventData.PAYMENT_HEADER) {
        raw = eventData.PAYMENT_HEADER;
      } else if (raw && typeof raw === 'string') {
        raw = raw + '|N/A';
      }
    }

    if (field === 'annual pay upfront save badge' || field === 'save badge') {
      const upfrontSaveDisplay = eventData.UPFRONT_SAVE_AMOUNT_DISPLAY || eventData.UPFRONT_SAVE_AMOUNT;
      if (upfrontSaveDisplay === 'N/A' || !upfrontSaveDisplay || parseFloat(upfrontSaveDisplay.replace(/[^\d.-]/g, '')) <= 0) {
        raw = 'N/A';
      }
    }

    if (field === 'upsell offer text' && (!eventData.UPSELL_PRICE || eventData.UPSELL_PRICE.trim() === '' || eventData.UPSELL_PRICE.trim().toUpperCase() === 'N/A')) {
      raw = 'N/A';
    } else if (field === 'annual pay monthly contract text' && (!eventData.UPSELL_PRICE || eventData.UPSELL_PRICE.trim() === '' || eventData.UPSELL_PRICE.trim().toUpperCase() === 'N/A')) {
      raw = 'Annual contract. Auto renews.';
    } else if (field === 'ppv name' && (currentSource === 'boxing-ultimate' || currentSource === 'boxing-bundle-ultimate')) {
      raw = 'N/A';
    } else if (field === 'ppv price' && (currentSource === 'boxing-ultimate' || currentSource === 'boxing-bundle-ultimate')) {
      raw = 'N/A';
    } else if (field === 'ultimate feature 1' || field === 'ultimate feature 2' || field === 'ultimate feature 3') {
      if (currentSource !== 'boxing-ultimate') {
        raw = 'N/A';
      }
    } else if (field === 'saturday badge') {
      const eventDate = eventData.PPV_DATE || '';
      const match = eventDate.match(/^([A-Za-z]+)\s+(\d+)(?:st|nd|rd|th)?\s+([A-Za-z]+)/i);
      if (match) {
        const shortDay = match[1].substring(0, 3).toUpperCase();
        const dateNum = match[2];
        const shortMonth = match[3].substring(0, 3).toUpperCase();
        
        const getOrdinalSuffix = (dStr: string) => {
          const d = parseInt(dStr, 10);
          if (isNaN(d)) return 'th';
          if (d >= 11 && d <= 13) return 'th';
          switch (d % 10) {
            case 1: return 'st';
            case 2: return 'nd';
            case 3: return 'rd';
            default: return 'th';
          }
        };
        
        raw = `${shortDay} ${dateNum}${getOrdinalSuffix(dateNum)} ${shortMonth}`;
      } else {
        const dayNames = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
        const matchedDays: string[] = [];
        for (const day of dayNames) {
          if (eventDate.toLowerCase().includes(day)) {
            matchedDays.push(day.toUpperCase());
          }
        }
        raw = matchedDays.length > 0 ? matchedDays.join('|') : 'SATURDAY';
      }
    } else if (field === 'next payment label') {
      if (ratePlan.includes('annual pay monthly')) {
        raw = 'Next payment on {{NEXT_PAYMENT_DATE}}';
      } else if (ratePlan.includes('annual pay upfront')) {
        raw = 'Next Annual payment on {{NEXT_PAYMENT_DATE}}';
      }
    } else if (field === 'next payment price') {
      if (ratePlan.includes('annual pay monthly')) {
        raw = '{{ANNUAL_PAY_MONTHLY_PRICE}}';
      } else if (ratePlan.includes('annual pay upfront')) {
        raw = '{{ANNUAL_UPFRONT_PRICE}}';
      }
    } else if (field === 'cancellation text' && tier === 'ultimate') {
      if (ratePlan.includes('annual pay monthly')) {
        raw = '{{CANCELLATION_TEXT_ULTIMATE_APM}}';
      } else if (ratePlan.includes('annual pay upfront')) {
        raw = '{{CANCELLATION_TEXT_ULTIMATE_APU}}';
      }
  } else if (field === 'cta button' && (rule.Flow === 'boxing-bundle-ppv' || rule.flow === 'boxing-bundle-ppv')) {
    const currentTier = (eventData.TIER || eventData.tier || '').trim().toLowerCase();
    if (currentTier === 'ultimate') {
      raw = 'Continue with DAZN Ultimate|Continue with pay-per-view';
    } else {
      raw = 'Continue with pay-per-view';
    }
  } else if (field === 'offer original price' || field === 'offer price original') {
    const offerAvailable = String(eventData.OFFER_AVAILABLE || 'false').toLowerCase() === 'true';
    if (!offerAvailable) {
      raw = 'N/A';
    } else if (raw && raw.includes('{{')) {
      const resolved = raw.replace(/\{\{(.*?)\}\}/g, (match: string, k: string) => {
        const val = eventData[k] || eventData[k.toUpperCase()] || eventData[k.toLowerCase()] || eventData[k.replace(/\s+/g, '_').toUpperCase()] || eventData[k.replace(/\s+/g, '_')];
        return val !== undefined ? String(val) : `{{${k}}}`;
      });
      raw = resolved;
    }
  } else if (field === 'offer discount' || field === 'offer discount amount' || field === 'offer save amount') {
    const offerAvailable = String(eventData.OFFER_AVAILABLE || 'false').toLowerCase() === 'true';
    if (!offerAvailable) {
      raw = 'N/A';
    } else if (raw && raw.includes('{{')) {
      const discountNum = parseFloat(String(eventData.OFFER_DISCOUNT_AMOUNT || '').replace(/[^0-9.]/g, ''));
      const discountText = !isNaN(discountNum) && discountNum > 0 ? `Save ${discountNum.toFixed(0)}%` : 'N/A';
      raw = raw.replace(/\{\{OFFER_DISCOUNT_AMOUNT\}\}/g, discountText).replace(/\{\{(.*?)\}\}/g, (match: string, k: string) => {
        const val = eventData[k] || eventData[k.toUpperCase()] || eventData[k.toLowerCase()] || eventData[k.replace(/\s+/g, '_').toUpperCase()] || eventData[k.replace(/\s+/g, '_')];
        return val !== undefined ? String(val) : `{{${k}}}`;
      });
    }
  } else if (field === 'offer badge' || field === 'offer description') {
    const offerAvailable = String(eventData.OFFER_AVAILABLE || 'false').toLowerCase() === 'true';
    if (!offerAvailable) {
      raw = 'N/A';
    } else if (raw && raw.includes('{{')) {
      const offerBadge = String(eventData.OFFER_BADGE || '');
      const offerDesc = String(eventData.OFFER_DESCRIPTION || '');
      if (field === 'offer badge') {
        raw = raw.replace(/\{\{OFFER_BADGE\}\}/g, offerBadge || 'N/A').replace(/\{\{(.*?)\}\}/g, (match: string, k: string) => {
          const val = eventData[k] || eventData[k.toUpperCase()] || eventData[k.toLowerCase()] || eventData[k.replace(/\s+/g, '_').toUpperCase()] || eventData[k.replace(/\s+/g, '_')];
          return val !== undefined ? String(val) : `{{${k}}}`;
        });
      } else {
        raw = raw.replace(/\{\{OFFER_DESCRIPTION\}\}/g, offerDesc || 'N/A').replace(/\{\{(.*?)\}\}/g, (match: string, k: string) => {
          const val = eventData[k] || eventData[k.toUpperCase()] || eventData[k.toLowerCase()] || eventData[k.replace(/\s+/g, '_').toUpperCase()] || eventData[k.replace(/\s+/g, '_')];
          return val !== undefined ? String(val) : `{{${k}}}`;
        });
      }
    }
  } else if (field === 'today you pay price' || field === 'today price' || (field.includes('today you pay') && !field.includes('text'))) {
    if (eventData.TODAY_YOU_PAY_PRICE) {
      raw = eventData.TODAY_YOU_PAY_PRICE;
    } else {
      const offerAvailable = String(eventData.OFFER_AVAILABLE || 'false').toLowerCase() === 'true';
      if (offerAvailable && (eventData.OFFER_EFFECTIVE_PPV_PRICE || eventData.UPSELL_PRICE)) {
        raw = eventData.OFFER_EFFECTIVE_PPV_PRICE || eventData.UPSELL_PRICE || raw;
      }
    }
  }

  const activeOfferPresent = String(eventData.ACTIVE_OFFER_PRESENT || 'false').toLowerCase() === 'true';
  if (activeOfferPresent && currentRatePlan === 'monthly') {
    if (field === 'flex badge') {
      raw = 'N/A';
    } else if (field === 'flex description') {
      raw = 'Pay for the fight and get your first month of DAZN Standard ';
    } else if (field === 'flex today text' || field === 'flex future text') {
      raw = '';
    } else if (field === 'first month free price' || field === 'first month free text') {
      raw = 'N/A';
    } else if (field === 'page title' && (rawField.toLowerCase().includes('pay') || rawField.toLowerCase().includes('payment'))) {
      raw = 'Choose how to pay';
    } else if (field === 'plan name') {
      raw = eventData.PAYMENT_PLAN_LABEL || 'Flex – Pay Monthly - First Month Only';
    }
  }
  }

  if (field === 'ppv card description') {
    const isStag = (process.env.DAZN_ENV || 'stag').toLowerCase().includes('stag');
    if (isStag && process.env.DEFAULT_SIGNUP === 'true') {
      raw = 'The fight, including one month of discounted DAZN Standard plan';
    }
  } else if (field === 'upsell section heading') {
    if (process.env.DEFAULT_SIGNUP === 'true') {
      raw = 'N/A';
    }
  }

  if (raw === undefined || raw === null || raw === '') {
    return '';
  }

  let template = String(raw);

  // Run replacement twice to handle nested placeholders
  // e.g., {{CANCELLATION_TEXT}} → "...{{NEXT_PAYMENT_DATE}}..." → "...23/06/2026..."
  for (let pass = 0; pass < 2; pass++) {
    template = template.replace(/\{\{(.*?)\}\}/g, (match, key) => {
      const k = key.trim();
      const value =
        eventData[k] ??
        eventData[k.toUpperCase()] ??
        eventData[k.toLowerCase()] ??
        eventData[k.replace(/\s+/g, '_').toUpperCase()] ??
        eventData[k.replace(/\s+/g, '_')];

      if (value === undefined) {
        if (pass === 0) return match;
        console.warn(`⚠️  resolveExpected: no value for {{${k}}} — leaving as-is`);
        return match;
      }

      return String(value);
    });

    if (!template.includes('{{')) break;
  }

  if (field === 'cta button' || field === 'cta button text') {
    if (template === 'Continue with PPV + 7-day free trial') {
      template = 'Continue with 7-day Free Trial';
    }
  } else if (field === 'cancellation text' || field === 'cancel text') {
    const isTrial = eventData.RATE_PLAN === 'monthly' && eventData.TRIAL_MONTHLY_PRICE && eventData.TRIAL_MONTHLY_PRICE !== 'N/A';
    if (isTrial) {
      template = eventData.CANCELLATION_TEXT_TRIAL || "In 7 days, you'll be charged {{CURRENCY}}{{MONTHLY_PRICE}}/month. Cancel anytime before the end of the trial.";
      template = template.replace(/\{\{CURRENCY\}\}/g, eventData.CURRENCY || '£')
                         .replace(/\{\{MONTHLY_PRICE\}\}/g, eventData.MONTHLY_PRICE || '25.99');
    } else {
      template = "Monthly subscription. Cancel with 30 days' notice. Your subscription auto-renews unless you cancel.";
    }
  }

  const dateFields = [
    'ppv date badge',
    'date badge',
    'banner date badge',
    'upsell date badge',
    'tile date badge',
    'ppv date',
    'popup date',
    'ppv date and time',
    'welcome tile date',
    'event date',
    'ppv date and time expected',
    'fury payment date',
    'ppv date and time text',
    'ppv1 date text on ultimate tier'
  ];
  if (dateFields.includes(field)) {
    return getDynamicDateBadge(template);
  }

  return template;
}