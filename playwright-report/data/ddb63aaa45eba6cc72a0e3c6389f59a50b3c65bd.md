# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: new_user/schedule.spec.ts >> PPV flow via schedule
- Location: tests/new_user/schedule.spec.ts:26:5

# Error details

```
Error: locator.waitFor: Target page, context or browser has been closed
```

# Test source

```ts
  1   | import { test } from '@playwright/test';
  2   | import path from 'path';
  3   | 
  4   | import { SchedulePage } from '../../pages/schedulepage';
  5   | import { SignupPage } from '../../pages/SignupPage';
  6   | import { PaymentPage } from '../../pages/PaymentPage';
  7   | import { DAZNPlanPage } from '../../pages/DAZNPlanPage';
  8   | 
  9   | import { getPPVDataByVariant, readSheet } from '../../utils/excelReader';
  10  | import { detectVariant } from '../../flows/detectVariant';
  11  | import { validateVariant } from '../../flows/validateVariant';
  12  | import { buildEventData } from '../../utils/buildEventData';
  13  | import { displayResultsTable } from '../../utils/resultsDisplay';
  14  | import { writeResults } from '../../utils/excelWriter';
  15  | import { createTestUser } from '../../utils/testDataBuilder';
  16  | import { smartClick } from '../../utils/browserHelpers';
  17  | 
  18  | const DEFAULT_REGION = process.env.DAZN_REGION || 'AU';
  19  | const DEFAULT_EVENT_CONFIG = process.env.PPV_CONFIG || 'Chisora.json';
  20  | 
  21  | function loadEventConfig() {
  22  |   const configPath = path.resolve(process.cwd(), 'config', DEFAULT_EVENT_CONFIG);
  23  |   return require(configPath);
  24  | }
  25  | 
  26  | test('PPV flow via schedule', async ({ browser }) => {
  27  |   test.setTimeout(240000);
  28  | 
  29  |   const context = await browser.newContext({
  30  |     storageState: path.resolve(process.cwd(), 'auth/dazn-storage-state.json'),
  31  |   });
  32  | 
  33  |   await context.addInitScript(() => {
  34  |     try {
  35  |       localStorage.clear();
  36  |       sessionStorage.clear();
  37  |       localStorage.setItem('randomABPoint', Math.random().toString());
  38  |     } catch {}
  39  |   });
  40  | 
  41  |   const page = await context.newPage();
  42  |   const results: any[] = [];
  43  | 
  44  |   const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  45  | 
  46  |   // returns the most recently active non-closed page
  47  |   const getLivePage = async () => {
  48  |     await sleep(800);
  49  |     const pages = context.pages().filter(p => !p.isClosed());
  50  |     if (pages.length === 0) throw new Error('No active page found');
  51  |     const livePage = pages[pages.length - 1];
  52  |     await livePage.bringToFront().catch(() => {});
  53  |     return livePage;
  54  |   };
  55  | 
  56  |   const clickAndWaitForNav = async (p: any, btn: any, label: string) => {
  57  |     console.log(`clicking: ${label}`);
  58  |     const beforeUrl = p.url();
  59  |     await btn.scrollIntoViewIfNeeded().catch(() => {});
  60  |     await sleep(300);
  61  |     await btn.click({ force: true });
  62  |     await p.waitForFunction(
  63  |       (url) => window.location.href !== url,
  64  |       beforeUrl,
  65  |       { timeout: 10000 }
  66  |     ).catch(() => console.log(`${label}: no url change`));
  67  |     await sleep(2000);
  68  |   };
  69  | 
  70  |   try {
  71  |     const json = loadEventConfig();
  72  |     const eventData = buildEventData(json, DEFAULT_REGION);
  73  | 
  74  |     // -- schedule --
  75  |     const schedule = new SchedulePage(page);
  76  |     await schedule.navigate();
  77  | 
  78  |     const accept = page.locator('#onetrust-accept-btn-handler');
  79  |     const cookieBanner = page.locator('#onetrust-consent-sdk');
  80  |     await cookieBanner.waitFor({ state: 'attached', timeout: 10000 }).catch(() => {});
  81  |     if (await accept.isVisible().catch(() => false)) {
  82  |       await accept.click();
> 83  |       await cookieBanner.waitFor({ state: 'hidden', timeout: 10000 });
      |                          ^ Error: locator.waitFor: Target page, context or browser has been closed
  84  |     }
  85  | 
  86  |     await schedule.selectSport('Boxing');
  87  |     const eventCard = await schedule.findEvent(eventData.PPV_NAME);
  88  |     await schedule.clickEvent(eventCard);
  89  | 
  90  |     await schedule.clickBuyNow();
  91  | 
  92  |     // give DAZN time to navigate -- whether it opens a new tab or navigates in place
  93  |     await sleep(3000);
  94  | 
  95  |     let activePage = await getLivePage();
  96  |     console.log('landed on:', activePage.url());
  97  | 
  98  |     // validate
  99  |     const variant = await detectVariant(activePage).catch(() => 'unknown');
  100 |     console.log('🎯 variant:', variant);
  101 | 
  102 |     const landingData = readSheet('Landing page');
  103 |     await validateVariant(activePage, 'landing', landingData, results, eventData).catch(() => {});
  104 | 
  105 |     const ppvData = getPPVDataByVariant(variant);
  106 |     await validateVariant(activePage, variant, ppvData, results, eventData).catch(() => {});
  107 | 
  108 |     // -- step through PlanDetails pages --
  109 |     for (let i = 0; i < 3; i++) {
  110 |   activePage = await getLivePage();
  111 | 
  112 |   const isPPV = await activePage
  113 |     .getByText(/choose how to buy/i)
  114 |     .isVisible()
  115 |     .catch(() => false);
  116 | 
  117 | const isPlan = await activePage
  118 |   .locator('input[type="radio"], [role="radio"]')
  119 |   .first()
  120 |   .isVisible()
  121 |   .catch(() => false);
  122 | 
  123 | 
  124 |   console.log(`step ${i + 1}:`, {
  125 |     url: activePage.url(),
  126 |     isPPV,
  127 |     isPlan
  128 |   });
  129 | 
  130 |   // ───── PPV PAGE ─────
  131 |   if (isPPV) {
  132 |     console.log('👉 handling PPV page');
  133 | 
  134 |     const selectable = activePage.locator(
  135 |       'input[type="radio"], input[type="checkbox"], [role="radio"]'
  136 |     );
  137 | 
  138 |     if (await selectable.count() > 0) {
  139 |       await selectable.first().click({ force: true }).catch(() => {});
  140 |       await sleep(500);
  141 |     }
  142 | 
  143 |     const continueBtn = activePage.locator('button')
  144 |       .filter({ hasText: /continue/i })
  145 |       .last();
  146 | 
  147 |     await clickAndWaitForNav(activePage, continueBtn, 'PPV Continue');
  148 |     continue;
  149 |   }
  150 | 
  151 |   // ───── PLAN PAGE ─────
  152 | for (let i = 0; i < 3; i++) {
  153 |   activePage = await getLivePage();
  154 | 
  155 |   const isEmailPage = await activePage
  156 |     .locator('input[type="email"]')
  157 |     .isVisible()
  158 |     .catch(() => false);
  159 | 
  160 |   if (isEmailPage) {
  161 |     console.log('✅ reached email page — exiting loop');
  162 |     break;
  163 |   }
  164 | 
  165 |   const hasRadios = await activePage
  166 |     .locator('input[type="radio"], [role="radio"]')
  167 |     .count();
  168 | 
  169 |   const hasCheckbox = await activePage
  170 |     .locator('input[type="checkbox"]')
  171 |     .count();
  172 | 
  173 |   const isPPV = hasCheckbox > 0;
  174 |   const isPlan = hasRadios > 0 && !isPPV;
  175 | 
  176 |   console.log(`step ${i + 1}:`, {
  177 |     url: activePage.url(),
  178 |     isPPV,
  179 |     isPlan
  180 |   });
  181 | 
  182 |   if (isPPV) {
  183 |     console.log('👉 handling PPV page');
```