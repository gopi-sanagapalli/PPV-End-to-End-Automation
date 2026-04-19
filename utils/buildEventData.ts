import {
  formatNextPaymentDate,
  formatNextPaymentDateMonthly,
  formatNextPaymentDateYearly,
} from './dateUtils';

export function buildEventData(json: any, region: string): Record<string, string> {
  const regional = json.regions?.[region];

  if (!regional) {
    const available = Object.keys(json.regions || {}).join(', ');
    throw new Error(
      `❌ Region "${region}" not found in config.\n` +
      `   Available regions: ${available}`
    );
  }

  const base: Record<string, string> = {
    PPV_NAME:      json.PPV_NAME,
    SECONDARY_PPV: json.SECONDARY_PPV,
    ...json.global,
    ...regional,
  };

  base.TIER      = (json.TIER      || 'standard').toLowerCase();
  base.RATE_PLAN = (json.RATE_PLAN || 'monthly').toLowerCase();

  console.log(`💎 Tier      : ${base.TIER}`);
  console.log(`📋 Rate Plan : ${base.RATE_PLAN}`);

  // ── Next payment date — calculated from rate plan ───────────────
  // ✅ base is defined here — safe to use
// ── Next payment date — calculated from rate plan ───────────────
// ── Next payment date ───────────────────────────────────────────
// ── Next payment date — calculated from rate plan ───────────────
const ratePlanLower = base.RATE_PLAN.toLowerCase();

if (ratePlanLower === 'annual pay upfront') {
  base.NEXT_PAYMENT_DATE = formatNextPaymentDateYearly();
  base.RENEWAL_DATE      = formatNextPaymentDateYearly();

} else if (ratePlanLower === 'annual pay monthly') {
  base.NEXT_PAYMENT_DATE = formatNextPaymentDateMonthly();
  base.RENEWAL_DATE      = formatNextPaymentDateYearly();

} else if (json.NEXT_PAYMENT_DAYS_OFFSET !== undefined) {
  // ✅ monthly with free trial uses days offset (e.g. 7 days)
  base.NEXT_PAYMENT_DATE = formatNextPaymentDate(
    Number(json.NEXT_PAYMENT_DAYS_OFFSET)
  );
  base.RENEWAL_DATE      = formatNextPaymentDateYearly();

} else {
  base.NEXT_PAYMENT_DATE = formatNextPaymentDateMonthly();
  base.RENEWAL_DATE      = formatNextPaymentDateYearly();
}


  // ── rest of your existing code unchanged ───────────────────────
  if (!base.NEXT_PAYMENT_PRICE) {
    base.NEXT_PAYMENT_PRICE = base.CURRENCY
      ? `${base.CURRENCY}${base.MONTHLY_PRICE}`
      : base.MONTHLY_PRICE;
  }

  if (base.PPV_PRICE && !base.PPV_PRICE.startsWith(base.CURRENCY)) {
    base.PPV_PRICE_DISPLAY = `${base.CURRENCY}${base.PPV_PRICE}`;
  } else {
    base.PPV_PRICE_DISPLAY = base.PPV_PRICE;
  }

  if (base.UPSELL_PRICE && !base.UPSELL_PRICE.startsWith(base.CURRENCY)) {
    base.UPSELL_PRICE_DISPLAY = `${base.CURRENCY}${base.UPSELL_PRICE}`;
  } else {
    base.UPSELL_PRICE_DISPLAY = base.UPSELL_PRICE;
  }

  base.UPSELL_SUB_TEXT =
    `Then ${base.CURRENCY}${base.ANNUAL_PRICE} /month for ${base.ANNUAL_MONTHS} months.`;

  base.TRIAL_MONTHLY_TEXT = `${base.CURRENCY}${base.MONTHLY_PRICE}`;

  if (base.ANNUAL_PAY_MONTHLY_PRICE) {
    if (!base.ANNUAL_PAY_MONTHLY_PRICE.startsWith(base.CURRENCY)) {
      base.ANNUAL_PAY_MONTHLY_PRICE_DISPLAY =
        `${base.CURRENCY}${base.ANNUAL_PAY_MONTHLY_PRICE}`;
    } else {
      base.ANNUAL_PAY_MONTHLY_PRICE_DISPLAY = base.ANNUAL_PAY_MONTHLY_PRICE;
    }
  }

  if (base.ANNUAL_UPFRONT_PRICE) {
    if (!base.ANNUAL_UPFRONT_PRICE.startsWith(base.CURRENCY)) {
      base.ANNUAL_UPFRONT_PRICE_DISPLAY =
        `${base.CURRENCY}${base.ANNUAL_UPFRONT_PRICE}`;
    } else {
      base.ANNUAL_UPFRONT_PRICE_DISPLAY = base.ANNUAL_UPFRONT_PRICE;
    }
  }

  if (base.UPFRONT_SAVE_AMOUNT) {
    if (!base.UPFRONT_SAVE_AMOUNT.startsWith(base.CURRENCY)) {
      base.UPFRONT_SAVE_AMOUNT_DISPLAY =
        `${base.CURRENCY}${base.UPFRONT_SAVE_AMOUNT}`;
    } else {
      base.UPFRONT_SAVE_AMOUNT_DISPLAY = base.UPFRONT_SAVE_AMOUNT;
    }
  }

  if (base.ANNUAL_TOTAL) {
    if (!base.ANNUAL_TOTAL.startsWith(base.CURRENCY)) {
      base.ANNUAL_TOTAL_DISPLAY =
        `${base.CURRENCY}${base.ANNUAL_TOTAL}`;
    } else {
      base.ANNUAL_TOTAL_DISPLAY = base.ANNUAL_TOTAL;
    }
  }

  const keys = Object.keys(base);
  for (const k of keys) {
    const upper = k.toUpperCase();
    if (!(upper in base)) base[upper] = base[k];
  }

  console.log('📦 eventData built:', JSON.stringify(base, null, 2));
  return base;
}