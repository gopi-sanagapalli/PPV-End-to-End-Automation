# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: new_user/schedule.spec.ts >> PPV flow via schedule
- Location: tests/new_user/schedule.spec.ts:24:5

# Error details

```
Error: 41 validation(s) failed
```

# Test source

```ts
  122 | 
  123 |         if (!ppvValidated) {
  124 |           console.log('🧾 Validating PPV page...');
  125 | 
  126 |           // 🔥 REAL FIX (WAIT FOR UI)
  127 |           await activePage.waitForLoadState('domcontentloaded');
  128 | 
  129 |           await activePage.waitForSelector('text=/vs\\.?/i', { timeout: 15000 });
  130 |           await activePage.waitForSelector('text=/\\$\\d+/', { timeout: 15000 });
  131 | 
  132 |           // trigger lazy load
  133 |           await activePage.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  134 |           await activePage.waitForTimeout(800);
  135 | 
  136 |           await activePage.evaluate(() => window.scrollTo(0, 0));
  137 |           await activePage.waitForTimeout(500);
  138 | 
  139 |           const ppvData = getPPVDataByVariant(variant);
  140 | 
  141 |           await validateVariant(activePage, variant, ppvData, results, eventData)
  142 |             .catch(() => {});
  143 | 
  144 |           ppvValidated = true;
  145 |         }
  146 | 
  147 |         const checkbox = activePage.locator('input[type="checkbox"]').first();
  148 |         if (await checkbox.isVisible().catch(() => false)) {
  149 |           await checkbox.click({ force: true });
  150 |         }
  151 | 
  152 |         const btn = activePage.locator('button:has-text("Continue")').last();
  153 |         await clickAndWaitForNav(activePage, btn, 'PPV Continue');
  154 |         continue;
  155 |       }
  156 | 
  157 |       // ───── PLAN PAGE ─────
  158 |       if (isPlan) {
  159 |         console.log('👉 PLAN page');
  160 | 
  161 |         const radio = activePage.locator('input[type="radio"]').first();
  162 |         if (await radio.isVisible().catch(() => false)) {
  163 |           await radio.click({ force: true });
  164 |         }
  165 | 
  166 |         const btn = activePage.locator('button:has-text("Continue")');
  167 |         await clickAndWaitForNav(activePage, btn, 'Plan Continue');
  168 |         continue;
  169 |       }
  170 | 
  171 |       break;
  172 |     }
  173 | 
  174 |     activePage = await getLivePage();
  175 | 
  176 |     // ───────── SIGNUP ─────────
  177 |     const signup = new SignupPage(activePage);
  178 |     const user = createTestUser();
  179 | 
  180 |     await signup.enterEmail(user.email);
  181 |     await signup.clickContinue();
  182 | 
  183 |     activePage = await getLivePage();
  184 | 
  185 |     const firstName = activePage.locator('[data-test-id="FIRST_NAME"]');
  186 | 
  187 |     if (await firstName.isVisible()) {
  188 |       const signup2 = new SignupPage(activePage);
  189 |       await signup2.fillPersonalDetails(user);
  190 |       await signup2.clickPersonalDetailsContinue();
  191 |     }
  192 | 
  193 |     // ───────── PAYMENT ─────────
  194 |     await activePage.waitForTimeout(1500);
  195 |     activePage = await getLivePage();
  196 | 
  197 |     const payment = new PaymentPage(activePage);
  198 | 
  199 |     if (await payment.isPaymentPage()) {
  200 |       console.log('✅ payment page');
  201 | 
  202 |       const paymentData = readSheet('Monthly Payment page');
  203 |       await payment.validate(paymentData, results);
  204 |     }
  205 | 
  206 |     displayResultsTable(results, variant);
  207 |     const filePath = await writeResults(results);
  208 | 
  209 |     const passed = results.filter(r => r.status === 'PASS').length;
  210 |     const total = results.length;
  211 | 
  212 |     console.log(`
  213 | ═══════════════════════════════════════
  214 | 🎯 Variant: ${variant}
  215 | 📊 Total: ${total}
  216 | ✅ Passed: ${passed}
  217 | 📁 Report: ${filePath}
  218 | ═══════════════════════════════════════
  219 | `);
  220 | 
  221 |     if (passed < total) {
> 222 |       throw new Error(`${total - passed} validation(s) failed`);
      |             ^ Error: 41 validation(s) failed
  223 |     }
  224 | 
  225 |   } finally {
  226 |     await context.close();
  227 |   }
  228 | });
```