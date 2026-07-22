import fs from 'fs';

type WdBrowser = any;

function isLikelyCheckoutUrl(value: string): boolean {
  return !!value && value.startsWith('http') && value.includes('dazn.com');
}

export async function decodeCheckoutUrlFromQr(
  driver: WdBrowser,
  screenshotPath = './test-results/android_tv_qr.png',
): Promise<string> {
  try {
    const pngBase64 = await driver.takeScreenshot();
    const pngBuffer = Buffer.from(pngBase64, 'base64');
    fs.writeFileSync(screenshotPath, pngBuffer);

    // Keep runtime optional: if QR libs are unavailable, TV flow still uses
    // existing copy/webview capture without failing startup.
    const { PNG } = require('pngjs');
    const jsQR = require('jsqr');

    const parsed = PNG.sync.read(pngBuffer);
    const code = jsQR(parsed.data, parsed.width, parsed.height);
    const candidate = (code?.data || '').trim();

    if (isLikelyCheckoutUrl(candidate)) {
      return candidate;
    }

    if (candidate) {
      console.log(`ℹ️ QR decoded text is not a DAZN checkout URL: ${candidate.slice(0, 120)}`);
    } else {
      console.log('ℹ️ No QR payload detected in screenshot.');
    }

    return '';
  } catch (err: any) {
    console.log(`ℹ️ QR decode unavailable/failed: ${err.message}`);
    return '';
  }
}
