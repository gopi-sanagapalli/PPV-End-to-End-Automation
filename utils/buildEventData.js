"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildEventData = buildEventData;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const dateUtils_1 = require("./dateUtils");
function deepMerge(base, override) {
    const result = Object.assign({}, base);
    for (const key of Object.keys(override)) {
        if (override[key] !== null &&
            typeof override[key] === 'object' &&
            !Array.isArray(override[key]) &&
            base[key] !== undefined &&
            typeof base[key] === 'object') {
            result[key] = deepMerge(base[key], override[key]);
        }
        else {
            result[key] = override[key];
        }
    }
    return result;
}
function loadBaseConfig() {
    const basePath = path.resolve(process.cwd(), 'config/Wardley PPV config/Wardley_base.json');
    if (fs.existsSync(basePath)) {
        return JSON.parse(fs.readFileSync(basePath, 'utf-8'));
    }
    return {};
}
function buildEventData(json, region) {
    var _a, _b, _c, _d, _e;
    // Merge base config with flow config
    const baseConfig = loadBaseConfig();
    const merged = deepMerge(baseConfig, json);
    const regional = (_a = merged.regions) === null || _a === void 0 ? void 0 : _a[region];
    if (!regional) {
        const available = Object.keys(merged.regions || {}).join(', ');
        throw new Error(`❌ Region "${region}" not found in config.\n` +
            `   Available regions: ${available}`);
    }
    const base = Object.assign(Object.assign({ PPV_NAME: merged.PPV_NAME, SECONDARY_PPV: merged.SECONDARY_PPV }, merged.global), regional);
    base.TIER = (merged.TIER || 'standard').toLowerCase();
    base.RATE_PLAN = (merged.RATE_PLAN || 'monthly').toLowerCase();
    console.log(`💎 Tier      : ${base.TIER}`);
    console.log(`📋 Rate Plan : ${base.RATE_PLAN}`);
    // My Account specific fields
    if (merged.DAZN_TIER)
        base.DAZN_TIER = merged.DAZN_TIER;
    if (merged.SUBSCRIPTION_STATUS)
        base.SUBSCRIPTION_STATUS = merged.SUBSCRIPTION_STATUS;
    if (merged.PPV_STATUS)
        base.PPV_STATUS = merged.PPV_STATUS;
    if (merged.RATE_PLAN_LABEL)
        base.RATE_PLAN_LABEL = merged.RATE_PLAN_LABEL;
    if (merged.USER_EMAIL)
        base.USER_EMAIL = merged.USER_EMAIL;
    if (merged.USER_PASSWORD)
        base.USER_PASSWORD = merged.USER_PASSWORD;
    if (merged.PURCHASE_OPTION)
        base.PURCHASE_OPTION = merged.PURCHASE_OPTION;
    if (merged.FLOW_FROM_POPUP !== undefined) {
        base.FLOW_FROM_POPUP = String(merged.FLOW_FROM_POPUP);
    }
    // Page specific values from pages.plan
    const planPage = (_e = (_c = (_b = regional.pages) === null || _b === void 0 ? void 0 : _b.plan) !== null && _c !== void 0 ? _c : (_d = merged.pages) === null || _d === void 0 ? void 0 : _d.plan) !== null && _e !== void 0 ? _e : {};
    if (planPage.PAGE_TITLE)
        base.PLAN_PAGE_TITLE = planPage.PAGE_TITLE;
    if (planPage.CTA_BUTTON)
        base.PLAN_CTA_BUTTON = planPage.CTA_BUTTON;
    if (planPage.SELECTED_PLAN)
        base.PLAN_SELECTED = planPage.SELECTED_PLAN;
    // Direct top-level config fields — pass through if present
    const directFields = [
        'PPV_CTA_TEXT',
        'PLAN_PAGE_TITLE',
        'PLAN_CTA_BUTTON',
        'ANNUAL_PAY_MONTHLY_CONTRACT_TEXT',
        'ULTIMATE_FEATURE_2',
        'ULTIMATE_FEATURE_3',
        'SPORT',
        'TODAY_YOU_PAY_PRICE',
        'CANCELLATION_TEXT',
        'RATE_PLAN_LABEL',
        'INCLUDED_PPV2_NAME',
        'PPV2_IMAGE_PRESENT_ULTIMATE',
        'PPV2_INCLUDED_TAG_ULTIMATE',
        'PPV2_DATE_TEXT_ULTIMATE',
        'UPSELL_HIGHLIGHT_TEXT',
        'ULTIMATE_FEATURE_1',
        'ULTIMATE_FEATURE_1_HIGHLIGHT',
    ];
    for (const field of directFields) {
        const val = regional[field] !== undefined ? regional[field] : merged[field];
        if (val !== undefined) base[field] = val;
    }
    // Detect US region
    const isUSRegion = (base.BASE_URL || '').includes('/en-US');
    // Next payment date
    const ratePlanLower = base.RATE_PLAN.toLowerCase();
    if (ratePlanLower === 'annual pay upfront') {
        base.NEXT_PAYMENT_DATE = isUSRegion
            ? (0, dateUtils_1.formatNextPaymentDateYearlyUS)()
            : (0, dateUtils_1.formatNextPaymentDateYearly)();
        base.RENEWAL_DATE = isUSRegion
            ? (0, dateUtils_1.formatNextPaymentDateYearlyUS)()
            : (0, dateUtils_1.formatNextPaymentDateYearly)();
    }
    else if (ratePlanLower === 'annual pay monthly') {
        base.NEXT_PAYMENT_DATE = isUSRegion
            ? (0, dateUtils_1.formatNextPaymentDateMonthlyUS)()
            : (0, dateUtils_1.formatNextPaymentDateMonthly)();
        base.RENEWAL_DATE = isUSRegion
            ? (0, dateUtils_1.formatNextPaymentDateYearlyUS)()
            : (0, dateUtils_1.formatNextPaymentDateYearly)();
    }
    else if (merged.NEXT_PAYMENT_DAYS_OFFSET !== undefined) {
        base.NEXT_PAYMENT_DATE = isUSRegion
            ? (0, dateUtils_1.formatNextPaymentDateUS)(Number(merged.NEXT_PAYMENT_DAYS_OFFSET))
            : (0, dateUtils_1.formatNextPaymentDate)(Number(merged.NEXT_PAYMENT_DAYS_OFFSET));
        base.RENEWAL_DATE = isUSRegion
            ? (0, dateUtils_1.formatNextPaymentDateYearlyUS)()
            : (0, dateUtils_1.formatNextPaymentDateYearly)();
    }
    else {
        base.NEXT_PAYMENT_DATE = isUSRegion
            ? (0, dateUtils_1.formatNextPaymentDateMonthlyUS)()
            : (0, dateUtils_1.formatNextPaymentDateMonthly)();
        base.RENEWAL_DATE = isUSRegion
            ? (0, dateUtils_1.formatNextPaymentDateYearlyUS)()
            : (0, dateUtils_1.formatNextPaymentDateYearly)();
    }
    // Calculate UPFRONT_SAVE_AMOUNT dynamically
    if (base.ANNUAL_PAY_MONTHLY_PRICE && base.ANNUAL_UPFRONT_PRICE) {
        const monthly = parseFloat(base.ANNUAL_PAY_MONTHLY_PRICE.replace(/,/g, ''));
        const upfront = parseFloat(base.ANNUAL_UPFRONT_PRICE.replace(/,/g, ''));
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
    }
    else {
        base.PPV_PRICE_DISPLAY = base.PPV_PRICE;
    }
    if (base.UPSELL_PRICE && !base.UPSELL_PRICE.startsWith(base.CURRENCY)) {
        base.UPSELL_PRICE_DISPLAY = `${base.CURRENCY}${base.UPSELL_PRICE}`;
    }
    else {
        base.UPSELL_PRICE_DISPLAY = base.UPSELL_PRICE;
    }
    base.UPSELL_SUB_TEXT =
        `Then ${base.CURRENCY}${base.ANNUAL_PRICE} /month for ${base.ANNUAL_MONTHS} months.`;
    base.TRIAL_MONTHLY_TEXT = `${base.CURRENCY}${base.MONTHLY_PRICE}`;
    if (base.ANNUAL_PAY_MONTHLY_PRICE) {
        if (!base.ANNUAL_PAY_MONTHLY_PRICE.startsWith(base.CURRENCY)) {
            base.ANNUAL_PAY_MONTHLY_PRICE_DISPLAY =
                `${base.CURRENCY}${base.ANNUAL_PAY_MONTHLY_PRICE}`;
        }
        else {
            base.ANNUAL_PAY_MONTHLY_PRICE_DISPLAY = base.ANNUAL_PAY_MONTHLY_PRICE;
        }
    }
    if (base.ANNUAL_UPFRONT_PRICE) {
        if (!base.ANNUAL_UPFRONT_PRICE.startsWith(base.CURRENCY)) {
            base.ANNUAL_UPFRONT_PRICE_DISPLAY =
                `${base.CURRENCY}${base.ANNUAL_UPFRONT_PRICE}`;
        }
        else {
            base.ANNUAL_UPFRONT_PRICE_DISPLAY = base.ANNUAL_UPFRONT_PRICE;
        }
    }
    if (base.UPFRONT_SAVE_AMOUNT) {
        if (!base.UPFRONT_SAVE_AMOUNT.startsWith(base.CURRENCY)) {
            base.UPFRONT_SAVE_AMOUNT_DISPLAY =
                `${base.CURRENCY}${base.UPFRONT_SAVE_AMOUNT}`;
        }
        else {
            base.UPFRONT_SAVE_AMOUNT_DISPLAY = base.UPFRONT_SAVE_AMOUNT;
        }
    }
    // Upsell Feature 1 — resolve {{PPV_NAME}} placeholder
    if (base.UPSELL_FEATURE_1) {
        base.UPSELL_FEATURE_1 = base.UPSELL_FEATURE_1.replace(/\{\{PPV_NAME\}\}/g, base.PPV_NAME);
    }
    else {
        base.UPSELL_FEATURE_1 =
            `Pay-per-views included at no extra cost. Minimum of 12 events per year including ${base.PPV_NAME}.`;
    }
    if (base.ANNUAL_TOTAL) {
        if (!base.ANNUAL_TOTAL.startsWith(base.CURRENCY)) {
            base.ANNUAL_TOTAL_DISPLAY =
                `${base.CURRENCY}${base.ANNUAL_TOTAL}`;
        }
        else {
            base.ANNUAL_TOTAL_DISPLAY = base.ANNUAL_TOTAL;
        }
    }
    const keys = Object.keys(base);
    for (const k of keys) {
        const upper = k.toUpperCase();
        if (!(upper in base))
            base[upper] = base[k];
    }
    console.log('📦 eventData built:', JSON.stringify(base, null, 2));
    return base;
}
