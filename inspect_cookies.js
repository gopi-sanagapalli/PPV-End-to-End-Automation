const { chromium } = require('@playwright/test');

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: 'en-US',
    timezoneId: 'America/New_York',
    geolocation: { latitude: 40.7128, longitude: -74.0060 },
    permissions: ['geolocation'],
  });
  const page = await context.newPage();

  console.log('Navigating to landing page...');
  await page.goto('https://www.dazn.com/en-US/welcome');
  await page.waitForTimeout(5000);

  // Take screenshot to verify what's visible
  await page.screenshot({ path: 'inspect_screenshot.png' });
  console.log('Saved screenshot to inspect_screenshot.png');

  const content = await page.content();
  console.log(`Content length: ${content.length}`);

  // Let's print all buttons
  const buttons = page.locator('button');
  const btnCount = await buttons.count();
  console.log(`Found ${btnCount} button elements:`);
  for (let i = 0; i < btnCount; i++) {
    const text = await buttons.nth(i).innerText().catch(() => '');
    const id = await buttons.nth(i).getAttribute('id').catch(() => '') || '';
    const cls = await buttons.nth(i).getAttribute('class').catch(() => '') || '';
    console.log(`  Button ${i}: text="${text.trim()}", id="${id}", class="${cls}"`);
  }

  // Let's print all elements containing text "Accept"
  console.log('Searching for any text "Accept" in HTML...');
  const bodyText = await page.locator('body').innerText();
  console.log(`Contains 'Accept': ${bodyText.includes('Accept')}`);
  console.log(`Contains 'accept': ${bodyText.includes('accept')}`);

  await browser.close();
}

main().catch(console.error);
