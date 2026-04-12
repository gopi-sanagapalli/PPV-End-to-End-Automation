# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: new_user/schedule.spec.ts >> PPV flow via schedule
- Location: tests/new_user/schedule.spec.ts:26:5

# Error details

```
Error: 40 validation(s) failed
```

# Test source

```ts
  199 |     console.log('👉 handling DAZN plan page');
  200 | 
  201 |     const firstRadio = activePage
  202 |       .locator('input[type="radio"], [role="radio"]')
  203 |       .first();
  204 | 
  205 |     await firstRadio.click({ force: true });
  206 |     await sleep(500);
  207 | 
  208 |     const continueBtn = activePage.locator('button[type="submit"]');
  209 | 
  210 |     await clickAndWaitForNav(activePage, continueBtn, 'Plan Continue');
  211 |     continue;
  212 |   }
  213 | 
  214 |   break;
  215 | }
  216 | }
  217 | 
  218 |     activePage = await getLivePage();
  219 |     console.log('after plan pages:', activePage.url());
  220 | 
  221 |     // -- signup --
  222 |    const signupPage = new SignupPage(activePage);
  223 |     const emailInput = await signupPage.findEmailInput();
  224 | 
  225 |     if (emailInput) {
  226 |       const testUser = createTestUser();
  227 |       console.log('📧 email:', testUser.email);
  228 | 
  229 |       await signupPage.enterEmail(testUser.email);
  230 |       await sleep(500);
  231 |       await signupPage.clickContinue();
  232 | 
  233 |       const firstNameField = activePage.locator('[data-test-id="FIRST_NAME"]');
  234 |       let onPersonalDetails = false;
  235 | 
  236 |       for (let attempt = 0; attempt < 3; attempt++) {
  237 |         if (await firstNameField.isVisible().catch(() => false)) {
  238 |           onPersonalDetails = true;
  239 |           break;
  240 |         }
  241 |         const step = await signupPage.detectPageType();
  242 |         if (step === 'password') break;
  243 | 
  244 |         console.log(`still on email step, retry ${attempt + 1}`);
  245 |         await signupPage.clickContinue();
  246 |         await sleep(1500);
  247 |       }
  248 | 
  249 |       if (onPersonalDetails) {
  250 |         await signupPage.fillPersonalDetails(testUser);
  251 |         await signupPage.clickPersonalDetailsContinue();
  252 |       }
  253 |     }
  254 | 
  255 |     // -- payment --
  256 |     const paymentReady = activePage.locator('[data-test-id="summary_next_payment_header_value_refined"]');
  257 |     await paymentReady.waitFor({ state: 'visible', timeout: 15000 })
  258 |       .catch(() => console.log('payment summary not visible in time'));
  259 | 
  260 |     await sleep(1500);
  261 |     activePage = await getLivePage();
  262 | 
  263 |     const paymentPage = new PaymentPage(activePage);
  264 |     if (await paymentPage.isPaymentPage()) {
  265 |       console.log('✅ payment page loaded');
  266 |       const paymentData = readSheet('Monthly Payment page');      if (paymentData?.length) {
  267 |         await paymentPage.validate(paymentData, results);
  268 |       }
  269 |     } else {
  270 |       throw new Error(`Payment page not detected. URL: ${activePage.url()}`);
  271 |     }
  272 | 
  273 |    displayResultsTable(results, variant);
  274 | 
  275 | const filePath = await writeResults(results);
  276 | 
  277 | const passed = results.filter(r => r.status === 'PASS').length;
  278 | const failed = results.filter(r => r.status === 'FAIL').length;
  279 | const total = results.length;
  280 | 
  281 | const passPercent = total > 0
  282 |   ? ((passed / total) * 100).toFixed(2)
  283 |   : '0';
  284 | 
  285 | console.log(`
  286 | ═══════════════════════════════════════
  287 | 🎯 Variant: ${variant}
  288 | 📊 Total: ${total}
  289 | ✅ Passed: ${passed}
  290 | ❌ Failed: ${failed}
  291 | 📈 Pass %: ${passPercent}%
  292 | 📁 Report: ${filePath}
  293 | ═══════════════════════════════════════
  294 | `);
  295 | 
  296 | 
  297 | // 🔴 THROW ONLY AFTER LOGGING
  298 | if (failed > 0) {
> 299 |   throw new Error(`${failed} validation(s) failed`);
      |         ^ Error: 40 validation(s) failed
  300 | }
  301 | 
  302 |   } catch (error) {
  303 |     console.error('❌ Test failed with error:', error);
  304 |     throw error;
  305 |   } finally {
  306 |     await context.close();
  307 |   }
  308 | });
  309 | 
```