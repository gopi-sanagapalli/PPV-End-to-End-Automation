export const detectVariant = async (page: any) => {
  console.log('🔍 Detecting variant...');

  // Check if page is still valid
  if (page.isClosed()) {
    console.log('⚠️ Page is closed, cannot detect variant');
    return 'unknown';
  }

  // Wait for page to be in PPV context
  let ppvContext = false;
  for (let i = 0; i < 10; i++) {
    // Check if page is still valid before each iteration
    if (page.isClosed()) {
      console.log('⚠️ Page is closed during variant detection');
      return 'unknown';
    }

    const url = page.url();
    ppvContext =
      /contextualPpvId|\/account\/content\/dazn\/signup/i.test(url) ||
      (await page.getByText(/choose your plan|choose your pass|choose how to buy/i).first().isVisible().catch(() => false)) ||
      (await page.getByRole('button', { name: /continue/i }).first().isVisible().catch(() => false));
    
    if (ppvContext) {
      console.log('✅ PPV context detected');
      break;
    }
    
    console.log(`⏳ Waiting for PPV context (attempt ${i + 1}/10)...`);
    await page.waitForTimeout(1000);
  }

  if (!ppvContext) {
    console.log('⚠️ PPV context not detected yet');
    return 'unknown';
  }

  // Check if page is still valid before waiting
  if (page.isClosed()) {
    console.log('⚠️ Page is closed before waiting for page load');
    return 'unknown';
  }

  // Short settle only (avoid long static wait)
  await page.waitForTimeout(500);

  // Check if page is still valid before detecting variants
  if (page.isClosed()) {
    console.log('⚠️ Page is closed before detecting variants');
    return 'unknown';
  }

  const bodyText = ((await page.textContent('body').catch(() => '')) || '').toLowerCase();

  const pageTitleText = ((await page.locator('h1').first().textContent().catch(() => '')) || '').toLowerCase();

  // Variant 3 → bundle exists
  const bundleCard = page.locator('div, section, article').filter({ hasText: /2 Fight PPV Bundle/i }).first();
  if (await bundleCard.isVisible().catch(() => false)) {
    console.log('✅ Variant 3 detected (bundle card found)');
    return 'variant3';
  }
  
  // Also check for "Save 20%" specifically in a card context
  const saveCard = page.locator('div, section, article').filter({ hasText: /Save 20%/i }).first();
  if (await saveCard.isVisible().catch(() => false)) {
    console.log('✅ Variant 3 detected (save card found)');
    return 'variant3';
  }

  // Content-level fallback (handles hidden/lazy sections where card may not be visible yet)
  if (bodyText.includes('2 fight ppv bundle') || bodyText.includes('save 20%')) {
    console.log('✅ Variant 3 detected (content fallback)');
    return 'variant3';
  }

  // Variant 2 → "choose how to buy" / free trial style page
  if (pageTitleText.includes('choose how to buy') || bodyText.includes('choose how to buy')) {
    console.log('✅ Variant 2 detected (choose how to buy)');
    return 'variant2';
  }

  // Variant 2 → free trial exists (check for free trial card)
  const freeTrialCard = page.locator('div, section, article').filter({ hasText: /7-day free trial/i }).first();
  if (await freeTrialCard.isVisible().catch(() => false)) {
    console.log('✅ Variant 2 detected (free trial card found)');
    return 'variant2';
  }

  if (bodyText.includes('7-day free trial') || bodyText.includes('free trial')) {
    console.log('✅ Variant 2 detected (content fallback)');
    return 'variant2';
  }

  // Default → Variant 1
  console.log('✅ Variant 1 detected');
  return 'variant1';
};
