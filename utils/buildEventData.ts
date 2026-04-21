import * as fs   from 'fs';
import * as path from 'path';
import {
  formatNextPaymentDate,
  formatNextPaymentDateMonthly,
  formatNextPaymentDateYearly,
  formatNextPaymentDateMonthlyUS,
  formatNextPaymentDateYearlyUS,
  formatNextPaymentDateUS,
} from './dateUtils';

function deepMerge(base: any, override: any): any {
  const result = { ...base };
  for (const key of Object.keys(override)) {
    if (
      override[key] !== null &&
      typeof override[key] === 'object' &&
      !Array.isArray(override[key]) &&
      base[key] !== undefined &&
      typeof base[key] === 'object'
    ) {
      result[key] = deepMerge(base[key], override[key]);
    } else {
      result[key] = override[key];
    }
  }
  return result;
}

function loadBaseConfig(): any {
  const basePath = path.resolve(
    process.cwd(),
    'config/Wardley PPV config/Wardley_base.json'
  );
  if (fs.existsSync(basePath)) {
    return JSON.parse(fs.readFileSync(basePath, 'utf-8'));
  }
  return {};
}

export function buildEventData(json: any, region: string): Record<string, string> {

  // Merge base config with flow config
  const baseConfig = loadBaseConfig();
  const merged     = deepMerge(baseConfig, json);

  const regional = merged.regions?.[region];

  if (!regional) {
    const available = Object.keys(merged.regions || {}).join(', ');
    throw new Error(
      `❌ Region "${region}" not found in config.\n` +
      `   Available regions: ${available}`
    );
  }

  const base: Record<string, string> = {
    PPV_NAME:      merged.PPV_NAME,
    SECONDARY_PPV: merged.SECONDARY_PPV,
    ...merged.global,
    ...regional,
  };

  base.TIER      = (merged.TIER      || 'standard').toLowerCase();
  base.RATE_PLAN = (merged.RATE_PLAN || 'monthly').toLowerCase();

  console.log(`💎 Tier      : ${base.TIER}`);
  console.log(`📋 Rate Plan : ${base.RATE_PLAN}`);

  // My Account specific fields
  // regional takes priority over merged for account fields
  if (regional.DAZN_TIER           ?? merged.DAZN_TIER)           base.DAZN_TIER           = regional.DAZN_TIER           ?? merged.DAZN_TIER;
  if (regional.SUBSCRIPTION_STATUS ?? merged.SUBSCRIPTION_STATUS) base.SUBSCRIPTION_STATUS = regional.SUBSCRIPTION_STATUS ?? merged.SUBSCRIPTION_STATUS;
  if (regional.PPV_STATUS          ?? merged.PPV_STATUS)          base.PPV_STATUS           = regional.PPV_STATUS          ?? merged.PPV_STATUS;
  if (regional.RATE_PLAN_LABEL     ?? merged.RATE_PLAN_LABEL)     base.RATE_PLAN_LABEL      = regional.RATE_PLAN_LABEL     ?? merged.RATE_PLAN_LABEL;
  if (regional.USER_EMAIL          ?? merged.USER_EMAIL)          base.USER_EMAIL           = regional.USER_EMAIL          ?? merged.USER_EMAIL;
  if (regional.USER_PASSWORD       ?? merged.USER_PASSWORD)       base.USER_PASSWORD        = regional.USER_PASSWORD       ?? merged.USER_PASSWORD;
  if (regional.PURCHASE_OPTION     ?? merged.PURCHASE_OPTION)     base.PURCHASE_OPTION      = regional.PURCHASE_OPTION     ?? merged.PURCHASE_OPTION;
  if (merged.FLOW_FROM_POPUP !== undefined) {
    base.FLOW_FROM_POPUP = String(merged.FLOW_FROM_POPUP);
  }

  // Page specific values from pages.plan
  const planPage = regional.pages?.plan ?? merged.pages?.plan ?? {};
  if (planPage.PAGE_TITLE) base.PLAN_PAGE_TITLE = planPage.PAGE_TITLE;
  if (planPage.CTA_BUTTON) base.PLAN_CTA_BUTTON = planPage.CTA_BUTTON;
  if (planPage.SELECTED_PLAN) base.PLAN_SELECTED = planPage.SELECTED_PLAN;

  // Direct top-level config fields — pass through if present
  const directFields = [
    'PPV_CTA_TEXT',
    'PLAN_PAGE_TITLE',
    'PLAN_CTA_BUTTON',
    'ANNUAL_PAY_MONTHLY_CONTRACT_TEXT',
    'ULTIMATE_FEATURE_2',
    'ULTIMATE_FEATURE_3',
    'SPORT',
  ];
  for (const field of directFields) {
    const val = regional[field] ?? merged[field];
    if (val !== undefined) base[field] = val;  // always overwrite — top-level config wins
  }

  // Detect US region
  const isUSRegion = (base.BASE_URL || '').includes('/en-US');

  // Next payment date
  const ratePlanLower = base.RATE_PLAN.toLowerCase();

  if (ratePlanLower === 'annual pay upfront') {
    base.NEXT_PAYMENT_DATE = isUSRegion
      ? formatNextPaymentDateYearlyUS()
      : formatNextPaymentDateYearly();
    base.RENEWAL_DATE = isUSRegion
      ? formatNextPaymentDateYearlyUS()
      : formatNextPaymentDateYearly();

  } else if (ratePlanLower === 'annual pay monthly') {
    base.NEXT_PAYMENT_DATE = isUSRegion
      ? formatNextPaymentDateMonthlyUS()
      : formatNextPaymentDateMonthly();
    base.RENEWAL_DATE = isUSRegion
      ? formatNextPaymentDateYearlyUS()
      : formatNextPaymentDateYearly();

  } else if (merged.NEXT_PAYMENT_DAYS_OFFSET !== undefined) {
    base.NEXT_PAYMENT_DATE = isUSRegion
      ? formatNextPaymentDateUS(Number(merged.NEXT_PAYMENT_DAYS_OFFSET))
      : formatNextPaymentDate(Number(merged.NEXT_PAYMENT_DAYS_OFFSET));
    base.RENEWAL_DATE = isUSRegion
      ? formatNextPaymentDateYearlyUS()
      : formatNextPaymentDateYearly();

  } else {
    base.NEXT_PAYMENT_DATE = isUSRegion
      ? formatNextPaymentDateMonthlyUS()
      : formatNextPaymentDateMonthly();
    base.RENEWAL_DATE = isUSRegion
      ? formatNextPaymentDateYearlyUS()
      : formatNextPaymentDateYearly();
  }

  // Calculate UPFRONT_SAVE_AMOUNT dynamically
  if (base.ANNUAL_PAY_MONTHLY_PRICE && base.ANNUAL_UPFRONT_PRICE) {
    const monthly = parseFloat(
      base.ANNUAL_PAY_MONTHLY_PRICE.replace(/,/g, '')
    );
    const upfront = parseFloat(
      base.ANNUAL_UPFRONT_PRICE.replace(/,/g, '')
    );
    if (!isNaN(monthly) && !isNaN(upfront)) {
      const saved = (monthly * 12) - upfront;
      base.UPFRONT_SAVE_AMOUNT = saved % 1 === 0
        ? saved.toFixed(0)
        : saved.toFixed(2);
    }
  }

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

  // Upsell Feature 1 — resolve {{PPV_NAME}} placeholder
  if (base.UPSELL_FEATURE_1) {
    base.UPSELL_FEATURE_1 = base.UPSELL_FEATURE_1.replace(
      /\{\{PPV_NAME\}\}/g,
      base.PPV_NAME
    );
  } else {
    base.UPSELL_FEATURE_1 =
      `Pay-per-views included at no extra cost. Minimum of 12 events per year including ${base.PPV_NAME}.`;
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
