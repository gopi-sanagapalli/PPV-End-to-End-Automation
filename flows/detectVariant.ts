export const detectVariant = async (page: any) => {
  console.log('🔍 Detecting variant...');

  // 🔥 guard against dead page
  if (page.isClosed()) {
    console.log('⚠️ Page closed → skipping detection');
    return 'unknown';
  }

  const bodyText = ((await page.textContent('body').catch(() => '')) || '').toLowerCase();

  if (
    bodyText.includes('2 fight ppv bundle') ||
    bodyText.includes('save 20%')
  ) {
    console.log('✅ variant3');
    return 'variant3';
  }

  if (
    bodyText.includes('choose how to buy') ||
    bodyText.includes('free trial')
  ) {
    console.log('✅ variant2');
    return 'variant2';
  }

  console.log('✅ variant1');
  return 'variant1';
};