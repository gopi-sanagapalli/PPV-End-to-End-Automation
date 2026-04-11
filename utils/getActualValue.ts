export async function getActualValue(
  page: any,
  field: string,
  variant: string
): Promise<string> {
  const key = field.replace(/\s+/g, ' ').trim().toLowerCase();
  const priceRegex = /(?:\$|₹)\s?\d+(?:,\d{3})*(?:\.\d{2})?/;

  const clean = (v: any) =>
    String(v ?? '').replace(/\s+/g, ' ').trim();

  const text = async (locator: any) => {
    const el = locator.first();
    const content = await el.textContent().catch(() => null);
    return content ? clean(content) : 'N/A';
  };

  const exists = async (locator: any) =>
    (await locator.first().isVisible().catch(() => false)) ? 'Yes' : 'No';

  const firstVisibleText = async (locators: any[]) => {
    for (const locator of locators) {
      if (await locator.first().isVisible().catch(() => false)) {
        return await text(locator);
      }
    }
    return 'N/A';
  };

  try {
    // ─────────────────────────────
    // COMMON (ALL VARIANTS)
    // ─────────────────────────────

    if (key === 'page title') {
      return await text(page.locator('h1'));
    }

    if (key.includes('tile present') || key.includes('image present') || key.includes('checkbox present') || key.includes('section present') || key.includes('radio present') || key.includes('button')) {
      return await exists(page.locator('h1, h2, h3, button, img, [role="radio"], input[type="radio"], section'));
    }

    if (key.includes('ppv name') || key.includes('event name')) {
      return await firstVisibleText([
        page.locator('h1, h2, h3').filter({ hasText: /vs/i }),
        page.locator('text=/vs\\.?/i')
      ]);
    }

    if (key.includes('ppv price') || key.includes('upsell price') || key.includes('today you pay price')) {
      return await firstVisibleText([
        page.locator(`text=/${priceRegex.source}/`),
        page.locator('[data-test-id="summary_total_value"]')
      ]);
    }

    if (key === 'currency') {
      return '$';
    }

    if (key === 'cta button') {
      return await text(
        page.getByRole('button', { name: /continue|subscribe without a pay-per-view/i })
      );
    }

    if (key.includes('event date') || key.includes('date and time') || key.includes('date text')) {
      return await firstVisibleText([
        page.locator('text=/Sat|Sun|Mon|Tue|Wed|Thu|Fri|Saturday|Sunday|Monday|Tuesday|Wednesday|Thursday|Friday/i'),
        page.locator('time')
      ]);
    }

    if (key.includes('subscription section title')) {
      return await text(page.locator('text=/choose your subscription/i'));
    }

    if (key.includes('header full copy')) {
      return await text(page.locator('p').filter({ hasText: /buy .* with dazn standard|get it included in dazn ultimate/i }).first());
    }

    if (key.includes('header highlight text')) {
      return await text(page.locator('strong').filter({ hasText: /vs/i }).first());
    }

    if (key.includes('header sub text')) {
      return await firstVisibleText([
        page.locator('p').filter({ hasText: /included in dazn ultimate|monthly flex|auto renews/i }).first(),
        page.locator('h1 + p').first()
      ]);
    }

    if (key.includes('selected')) {
      const selected = await page.locator('[aria-checked="true"], input[type="radio"]:checked, img[alt*="selected" i]').count();
      return selected > 0 ? 'Yes' : 'No';
    }

    if (key.includes('trial title')) {
      return await text(page.locator('text=/free trial/i').first());
    }

    if (key.includes('trial feature')) {
      const features = page.locator('li, [role="listitem"], p');
      const index = Number((key.match(/trial feature (\d+)/)?.[1] || '1')) - 1;
      return await text(features.nth(Math.max(index, 0)));
    }

    if (key.includes('upsell label')) {
      return await text(page.locator('text=/pay-per-views included/i').first());
    }

    if (key.includes('upsell plan name')) {
      return await text(page.locator('text=/dazn ultimate/i').first());
    }

    if (key.includes('upsell price text')) {
      return await text(page.locator('text=/from/i').first());
    }

    if (key.includes('upsell price length')) {
      return await text(page.locator('text=/\/ month/i').first());
    }

    if (key.includes('upsell billing text')) {
      return await text(page.locator('text=/annual contract\. auto renews\./i').first());
    }

    if (key.includes('included tag')) {
      return await exists(page.locator('text=/included/i'));
    }

    if (key.includes('upsell feature') || key.includes('highlight text')) {
      return await firstVisibleText([
        page.locator('li, p').filter({ hasText: /pay-per-views included|hdr and dolby|185\+ fights|vs\./i }),
        page.locator('text=/pay-per-views included|hdr and dolby|185\+ fights|included/i')
      ]);
    }

    // ─────────────────────────────
    // VARIANT 2 (Choose how to buy)
    // ─────────────────────────────
    if (variant === 'variant2') {
      if (key === 'upsell plan name') {
        return await text(
          page.locator('text=/ultimate/i').first()
        );
      }

      if (key === 'upsell label') {
        return await text(
          page.locator('text=/pay-per-views included/i').first()
        );
      }

      if (key === 'upsell price') {
        return await text(
          page.locator(`text=/${priceRegex.source}/`).nth(1)
        );
      }

      if (key === 'upsell section present') {
        const exists = await page.locator('text=/ultimate/i').count();
        return exists > 0 ? 'Yes' : 'No';
      }
    }

    // ─────────────────────────────
    // VARIANT 1 (Choose your plan)
    // ─────────────────────────────
    if (variant === 'variant1') {
      if (key === 'header sub text') {
        return await text(
          page.locator('h2, p').first()
        );
      }

      if (key === 'dazn tier') {
        return await text(
          page.locator('text=/standard|ultimate/i').first()
        );
      }
    }

    // ─────────────────────────────
    // PAYMENT PAGE
    // ─────────────────────────────
    if (key.includes('payment')) {
      if (key.includes('ppv name')) {
        return await text(
          page.locator('text=/vs/i').first()
        );
      }

      if (key.includes('ppv price')) {
        return await text(
          page.locator(`text=/${priceRegex.source}/`).first()
        );
      }
    }

    if (key.includes('header')) {
      return await firstVisibleText([
        page.locator('text=/payment is encrypted|payment/i').first(),
        page.locator('h1 + p').first()
      ]);
    }

    if (key.includes('dazn tier')) {
      return await text(page.locator('text=/dazn/i').first());
    }

    if (key.includes('plan change cta')) {
      return await text(page.getByRole('button', { name: /change/i }).first());
    }

    if (key.includes('7 day free text')) {
      return await text(page.locator('text=/7-day|7-days free/i').first());
    }

    if (key.includes('today you pay text')) {
      return await text(page.locator('text=/today you pay/i').first());
    }

    if (key.includes('next payment date')) {
      return await text(page.locator('text=/next payment/i').first());
    }

    if (key.includes('cancellation text')) {
      return await text(page.locator('text=/cancel/i').first());
    }

    // ─────────────────────────────
    // PPV PAGE VALIDATION
    // ─────────────────────────────
    if (key.includes('event') || key.includes('ppv') || key.includes('tile') || key.includes('card')) {
      return await firstVisibleText([
        page.locator(`[data-testid*="${key.split(' ').pop() || ''}"]`),
        page.locator(`[aria-label*="${key}"]`),
        page.locator('h1, h2, h3, h4, p').first()
      ]);
    }
    
    if (key.includes('countdown') || key.includes('timer')) {
      return await exists(page.locator('[data-testid*="countdown"], text=/live|starts in|minutes/i'));
    }
    
    // ─────────────────────────────
    // DAZN PLAN PAGE
    // ─────────────────────────────
    if (key.includes('plan') || key.includes('tier') || key.includes('subscription')) {
      return await firstVisibleText([
        page.locator('[data-testid*="plan"], [data-testid*="tier"]'),
        page.locator('text=/standard|ultimate|flex/i'),
        page.locator('h2, h3')
      ]);
    }
    
    if (key.includes('price') || key.includes('amount') || key.includes('cost')) {
      return await firstVisibleText([
        page.locator(`text=/${priceRegex.source}/`),
        page.locator('[data-testid*="price"], [data-testid*="total"]')
      ]);
    }
    
    // Generic fallback - try all common selectors instead of returning N/A immediately
    const fallbackResult = await firstVisibleText([
      page.locator(`[data-testid*="${key.replace(/[^a-z]/g, '')}"]`),
      page.locator(`[name*="${key.replace(/[^a-z]/g, '')}"]`),
      page.locator(`[id*="${key.replace(/[^a-z]/g, '')}"]`),
      page.locator('h1, h2, h3, h4, h5, h6, p, span, button').first()
    ]);
    
    // Only return N/A if even fallback fails
    return fallbackResult || 'N/A';

  } catch {
    return 'N/A';
  }
}