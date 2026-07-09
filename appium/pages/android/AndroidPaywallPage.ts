import {
  AndroidBasePage,
  AndroidCopyResult,
  WdBrowser,
  adbTap,
  getScreenSize,
  adb,
  adbSwipe,
} from './AndroidBasePage';

export interface AndroidCopyOptions {
  screenshotPrefix?: string;
  retrySwipeBackToPPV?: boolean;
  ppvName?: string;
}

export class AndroidPaywallPage extends AndroidBasePage {
  async copyImmediateCheckoutUrl(label: string, options: AndroidCopyOptions = {}): Promise<AndroidCopyResult> {
    const screenshotPrefix = options.screenshotPrefix || label.replace(/[^a-z0-9]+/gi, '_').toLowerCase();

    console.log(`  Paywall overlay displayed - clicking Copy button immediately (${label})...`);
    await this.driver.pause(800);
    await this.driver.saveScreenshot(`./test-results/android_${screenshotPrefix}_paywall.png`);

    await this.clickCopyButton(label);
    await this.driver.pause(1500);
    await this.driver.saveScreenshot(`./test-results/android_${screenshotPrefix}_after_copy.png`);

    let url = await this.readClipboardText();
    if (this.isValidCheckoutUrl(url)) {
      console.log(`  URL captured from clipboard (${label}): ${url.substring(0, 100)}...`);
      return { captured: true, url };
    }

    console.log('  Clipboard did not contain a valid DAZN URL. Will retry in shared block...');

    if (options.retrySwipeBackToPPV && options.ppvName) {
      const retryUrl = await this.retryCopyAfterSwipingBack(options.ppvName, label);
      if (this.isValidCheckoutUrl(retryUrl)) {
        return { captured: true, url: retryUrl };
      }
      url = retryUrl || url;
    }

    return { captured: false, url };
  }

  private async clickCopyButton(label: string): Promise<void> {
    const screen = getScreenSize();
    try {
      const copyBtn = await this.driver.$('//android.view.View[@resource-id="ItemContent"]/android.view.View/android.widget.Button');
      await copyBtn.waitForDisplayed({ timeout: 3000 });
      await copyBtn.click();
      console.log(`  Clicked Copy button (XPath) on ${label} paywall`);
    } catch (e: any) {
      console.log(`  XPath Copy click failed: ${e.message}. Trying coordinate tap...`);
      const copyX = Math.round(screen.width * 0.19);
      const copyY = Math.round(screen.height * 0.89);
      adbTap(copyX, copyY);
      console.log(`  Tapped Copy button at (${copyX}, ${copyY}) on ${label} paywall`);
    }
  }

  private async retryCopyAfterSwipingBack(ppvName: string, label: string): Promise<string> {
    console.log('  Carousel may have auto-swiped - swiping back to PPV banner and retrying...');
    const { width, height } = await this.driver.getWindowSize();
    const screen = getScreenSize();
    const copyX = Math.round(screen.width * 0.19);
    const copyY = Math.round(screen.height * 0.89);

    for (let swipeBack = 0; swipeBack < 5; swipeBack++) {
      const ppvVisible = await this.isVisible(ppvName, 1000);
      console.log(`  PPV banner visible before swipe ${swipeBack + 1}: ${ppvVisible}`);

      if (ppvVisible) {
        console.log(`  PPV banner found after ${swipeBack} swipe(s) back`);
        for (let retryWait = 0; retryWait < 10; retryWait++) {
          await this.driver.pause(500);
          try {
            const copyBtn = await this.driver.$('//android.view.View[@resource-id="ItemContent"]/android.view.View/android.widget.Button');
            if (await copyBtn.isDisplayed({ timeout: 500 })) {
              console.log(`  Copy button appeared after ${(retryWait + 1) * 500}ms on retry`);
              await copyBtn.click();
              break;
            }
          } catch {}

          if (await this.isVisible('Copy', 500)) {
            console.log(`  Copy button text appeared after ${(retryWait + 1) * 500}ms on retry`);
            adbTap(copyX, copyY);
            break;
          }
        }

        await this.driver.pause(1000);
        const retryUrl = await this.readClipboardText();
        if (this.isValidCheckoutUrl(retryUrl)) {
          console.log(`  URL captured from clipboard after swipe back (${label}): ${retryUrl.substring(0, 100)}...`);
          return retryUrl;
        }
      }

      await this.driver.action('pointer')
        .move({ x: Math.round(width * 0.2), y: Math.round(height * 0.35) })
        .down()
        .move({ x: Math.round(width * 0.8), y: Math.round(height * 0.35) })
        .up()
        .perform();
      await this.driver.pause(800);
      console.log(`  Swiped right (attempt ${swipeBack + 1})...`);
    }

    return '';
  }

  async captureHandoffUrl(options: { label: string; ppvName?: string }): Promise<string> {
    console.log("\n── Capturing Handoff URL from Paywall Screen ──────────────────");
    
    // First, scroll up slightly to ensure Copy button is fully visible
    console.log("  Scrolling up to ensure Copy button is visible...");
    const screenSize = getScreenSize();
    
    adbSwipe(Math.round(screenSize.width / 2), 
             Math.round(screenSize.height * 0.85), 
             Math.round(screenSize.width / 2), 
             Math.round(screenSize.height * 0.75));
    await this.driver.pause(1000);
    
    // Try clicking the parent element of the Copy button
    try {
      const parentCopyBtn = await this.driver.$(`//android.view.View[./android.widget.TextView[@text="Copy"]]`);
      console.log("  Found parent of Copy button, waiting for display...");
      await parentCopyBtn.waitForDisplayed({ timeout: 5000 });
      console.log("  Parent displayed, attempting click...");
      await parentCopyBtn.click();
      console.log("  ✅ Clicked parent of Copy button");
      await this.driver.pause(2000);
      await this.driver.saveScreenshot("./test-results/android_after_copy_click.png");
    } catch (e: any) {
      console.log(`  ❌ Failed to click parent: ${e.message}`);
      console.log("  Trying coordinate tap as fallback...");
      
      const copyBtnX = Math.round(screenSize.width * 0.19);
      const copyBtnY = Math.round(screenSize.height * 0.89);
      
      console.log(`  Tapping Copy button at coordinates (${copyBtnX}, ${copyBtnY})`);
      adbTap(copyBtnX, copyBtnY);
      await this.driver.pause(2000);
      await this.driver.saveScreenshot("./test-results/android_after_copy_tap.png");
    }
    
    let checkoutUrl = '';
    try {
      const base64Content = await this.driver.getClipboard();
      checkoutUrl = Buffer.from(base64Content, 'base64').toString('utf8');
      console.log(`  Appium clipboard content: ${checkoutUrl.substring(0, 100)}...`);
    } catch (e: any) {
      console.log(`  Failed to get clipboard via Appium: ${e.message}`);
      checkoutUrl = adb("shell am clipht get");
      console.log(`  ADB Clipboard content: ${checkoutUrl.substring(0, 100)}...`);
    }
    
    if (checkoutUrl && (checkoutUrl.includes("dazn.com") || checkoutUrl.includes("amazonaws.com"))) {
      console.log("✅ URL captured from clipboard");
    } else {
      await this.driver.saveScreenshot("./test-results/android_url_not_found.png");
      throw new Error(`❌ Could not capture checkout URL from paywall.\n   Clipboard content: ${checkoutUrl}`);
    }
    
    return checkoutUrl;
  }
}

export async function copyImmediateCheckoutUrl(
  driver: WdBrowser,
  label: string,
  options: AndroidCopyOptions = {},
): Promise<AndroidCopyResult> {
  return new AndroidPaywallPage(driver).copyImmediateCheckoutUrl(label, options);
}

export async function captureHandoffUrl(
  driver: WdBrowser,
  options: { label: string; ppvName?: string },
): Promise<string> {
  return new AndroidPaywallPage(driver).captureHandoffUrl(options);
}
