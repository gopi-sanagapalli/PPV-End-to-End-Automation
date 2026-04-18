import { formatNextPaymentDate } from './dateUtils';

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

  // ── Derived fields ──────────────────────────────────────────────

  // Next payment date
  base.NEXT_PAYMENT_DATE = formatNextPaymentDate(
    Number(base.NEXT_PAYMENT_DAYS_OFFSET ?? 7)
  );

  // Next payment price — fallback to MONTHLY_PRICE with currency if not set
  if (!base.NEXT_PAYMENT_PRICE) {
    base.NEXT_PAYMENT_PRICE = base.CURRENCY
      ? `${base.CURRENCY}${base.MONTHLY_PRICE}`
      : base.MONTHLY_PRICE;
  }

  // PPV_PRICE with currency prefix — if not already prefixed
  if (base.PPV_PRICE && !base.PPV_PRICE.startsWith(base.CURRENCY)) {
    base.PPV_PRICE_DISPLAY = `${base.CURRENCY}${base.PPV_PRICE}`;
  } else {
    base.PPV_PRICE_DISPLAY = base.PPV_PRICE;
  }

  // UPSELL_PRICE with currency prefix
  if (base.UPSELL_PRICE && !base.UPSELL_PRICE.startsWith(base.CURRENCY)) {
    base.UPSELL_PRICE_DISPLAY = `${base.CURRENCY}${base.UPSELL_PRICE}`;
  } else {
    base.UPSELL_PRICE_DISPLAY = base.UPSELL_PRICE;
  }

  // Upsell sub text — "Then ₹409 /month for 11 months."
 base.UPSELL_SUB_TEXT = 
  `Then ${base.CURRENCY}${base.ANNUAL_PRICE} /month for ${base.ANNUAL_MONTHS} months.`;
  // Trial description monthly price text
  base.TRIAL_MONTHLY_TEXT = `${base.CURRENCY}${base.MONTHLY_PRICE}`;

  // ── Normalise: every key also available as UPPER_CASE ───────────
  const keys = Object.keys(base);
  for (const k of keys) {
    const upper = k.toUpperCase();
    if (!(upper in base)) base[upper] = base[k];
  }

  console.log('📦 eventData built:', JSON.stringify(base, null, 2));
  return base;
}