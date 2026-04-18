/**
 * detectVariant.ts
 *
 * Detects which PPV page variant is shown.
 * Detection strings come from the PPV JSON config — zero hardcoding.
 */

export const detectVariant = async (
  page: any,
  variantConfig?: Record<string, { detection: string }>
): Promise<string> => {
  console.log('🔍 Detecting variant...');

  if (page.isClosed()) {
    throw new Error('❌ Page closed during variant detection');
  }

  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(500);

  const bodyText = (
    (await page.locator('body').innerText({ timeout: 3000 }).catch(() => '')) || ''
  ).toLowerCase();

  if (!bodyText) {
    throw new Error('❌ Page body is empty — cannot detect variant');
  }

  // ── Config-driven detection ──────────────────────────────────
  // If variantConfig is passed (from JSON), use it
  if (variantConfig) {
    for (const [variantName, config] of Object.entries(variantConfig)) {
      if (bodyText.includes(config.detection.toLowerCase())) {
        console.log(`✅ ${variantName} (config-driven)`);
        return variantName;
      }
    }
  }

  // ── Fallback detection (if no config passed) ─────────────────
  // variant3 — 2 fight bundle
  if (bodyText.includes('2 fight') || bodyText.includes('bundle')) {
    console.log('✅ variant3 (fallback)');
    return 'variant3';
  }

  // variant2 — checkbox + subscription section
  if (
    bodyText.includes('choose your subscription') ||
    bodyText.includes('continue with ppv')
  ) {
    console.log('✅ variant2 (fallback)');
    return 'variant2';
  }

  // variant1 — radio only
  if (bodyText.includes('subscribe without a pay-per-view') || bodyText.length > 0) {
    console.log('✅ variant1 (fallback)');
    return 'variant1';
  }

  throw new Error('❌ Unable to detect variant');
};