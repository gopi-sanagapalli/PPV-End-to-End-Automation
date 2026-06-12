const { chromium } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    locale: 'en-GB',
    timezoneId: 'Europe/London',
    geolocation: { latitude: 51.5074, longitude: -0.1278 },
    permissions: ['geolocation']
  });
  const page = await context.newPage();
  
  console.log('Navigating to welcome page...');
  await page.goto('https://www.dazn.com/en-GB/welcome', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('load', { timeout: 15000 }).catch(() => {});
  
  console.log('Current URL:', page.url());
  
  await page.waitForTimeout(5000);
  
  const html = await page.content();
  console.log('Page content length:', html.length);
  
  const scripts = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('script')).map(s => ({
      src: s.src,
      id: s.id,
      outerHTML: s.outerHTML.slice(0, 150)
    }));
  });
  
  console.log('Total script tags:', scripts.length);
  console.log('Script tags matching cookie/onetrust:');
  scripts.forEach(s => {
    if (s.src.includes('onetrust') || s.src.includes('cookielaw') || s.src.includes('consent') || s.outerHTML.includes('onetrust') || s.outerHTML.includes('cookielaw')) {
      console.log(' - Src:', s.src, ' | ID:', s.id, ' | HTML:', s.outerHTML);
    }
  });

  const bodyClasses = await page.evaluate(() => document.body.className);
  console.log('Body classes:', bodyClasses);

  const buttons = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('button')).map(b => b.innerText.trim());
  });
  console.log('All buttons on page:', buttons);
  
  await page.screenshot({ path: 'inspect_welcome.png' });
  console.log('Screenshot saved to inspect_welcome.png');
  
  await browser.close();
})();
