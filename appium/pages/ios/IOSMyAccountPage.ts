import { IOSBasePage, IOSFlowHooks, WdBrowser, WdElement } from './IOSBasePage';

export interface IOSLoginCredentials {
  email?: string;
  password?: string;
  navigateToHomeAfterLogin?: boolean;
}

export class IOSMyAccountPage extends IOSBasePage {
  async preLoginFlow(baseUrl: string, credentials: IOSLoginCredentials = {}): Promise<void> {
    void baseUrl;
    console.log('\nPRE-LOGIN FLOW: Signing in existing iOS user...');
    await this.driver.pause(500);

    // Check if we are already on email input screen
    let emailInput = await this.driver.$('//XCUIElementTypeTextField');
    let emailInputVisible = await emailInput.isDisplayed().catch(() => false);

    const directLoginSelectors = [
      '-ios predicate string:type == "XCUIElementTypeButton" AND (name == "Sign In" OR name == "Sign in" OR name == "Log In" OR name == "Log in" OR name == "Login")',
      '~Sign In',
      '~Sign in',
      '~Log In',
      '~Log in',
      '~Login',
    ];

    let loginClicked = emailInputVisible;
    for (const selector of emailInputVisible ? [] : directLoginSelectors) {
      try {
        const loginBtn = await this.driver.$(selector);
        if (await loginBtn.isDisplayed()) {
          console.log(`  Found direct login button with selector: ${selector}, clicking...`);
          await loginBtn.click();
          await this.driver.pause(1500);
          loginClicked = true;
          break;
        }
      } catch {}
    }

    if (!loginClicked) {
      console.log('  Direct login button not found, trying via Profile/Account icon...');
      const profileSelectors = [
        '~Profile',
        '~Account',
        '-ios predicate string:name CONTAINS[c] "Profile" OR label CONTAINS[c] "Profile"',
        '-ios predicate string:name CONTAINS[c] "Account" OR label CONTAINS[c] "Account"',
      ];

      let profileFound = false;
      for (const selector of profileSelectors) {
        try {
          const profileBtn = await this.driver.$(selector);
          if (await profileBtn.isDisplayed()) {
            console.log('  Found Profile/Account button, tapping...');
            await profileBtn.click();
            await this.driver.pause(800);
            profileFound = true;
            break;
          }
        } catch {}
      }

      if (!profileFound) {
        console.log('  Profile button not found via selectors, trying top-right coordinate tap...');
        const { width } = await this.driver.getWindowSize();
        // Top right coordinate (around 90% width, 60px height)
        await this.driver.performActions([{
          type: 'pointer', id: 'pt', parameters: { pointerType: 'touch' },
          actions: [
            { type: 'pointerMove', duration: 0, x: Math.round(width * 0.90), y: 60 },
            { type: 'pointerDown', button: 0 },
            { type: 'pause', duration: 60 },
            { type: 'pointerUp', button: 0 },
          ],
        }]);
        await this.driver.releaseActions();
        await this.driver.pause(1000);
      }

      for (const selector of directLoginSelectors) {
        try {
          const signInBtn = await this.driver.$(selector);
          if (await signInBtn.isDisplayed()) {
            console.log('  Found Sign In button in profile menu, tapping...');
            await signInBtn.click();
            await this.driver.pause(1500);
            loginClicked = true;
            break;
          }
        } catch {}
      }
    }

    if (credentials.email) {
      console.log(`  Entering email: ${credentials.email}`);
      emailInput = await this.driver.$('//XCUIElementTypeTextField');
      if (!await emailInput.isDisplayed().catch(() => false)) {
        // Try other selector matches
        emailInput = await this.driver.$('-ios predicate string:type == "XCUIElementTypeTextField" OR name CONTAINS[c] "email" OR label CONTAINS[c] "email"');
      }

      await emailInput.waitForDisplayed({ timeout: 10000 });
      await emailInput.click();
      await this.driver.pause(500);
      await emailInput.setValue(credentials.email);
      await this.driver.pause(500);

      // Tap Go / Next / Continue button
      const continueSelectors = [
        '~Get Started',
        '~Get started',
        '~Continue',
        '~Next',
        '-ios predicate string:type == "XCUIElementTypeButton" AND (name MATCHES[c] "Get started|Get Started|Continue|Next")',
      ];

      for (const selector of continueSelectors) {
        try {
          const continueBtn = await this.driver.$(selector);
          if (await continueBtn.isDisplayed()) {
            await continueBtn.click();
            await this.driver.pause(2000);
            break;
          }
        } catch {}
      }
    }

    if (credentials.password) {
      console.log('  Entering password...');
      const passwordInput = await this.driver.$('//XCUIElementTypeSecureTextField');
      await passwordInput.waitForDisplayed({ timeout: 10000 });
      await passwordInput.click();
      await this.driver.pause(500);
      await passwordInput.setValue(credentials.password);
      await this.driver.pause(500);

      // Hide keyboard if present by tapping return or done
      if (await this.driver.isKeyboardShown().catch(() => false)) {
        try {
          const doneButton = await this.driver.$('~Done');
          if (await doneButton.isDisplayed()) {
            await doneButton.click();
          } else {
            const hideKey = await this.driver.$('~Hide keyboard');
            if (await hideKey.isDisplayed()) {
              await hideKey.click();
            } else {
              // Tap somewhere safe to dismiss keyboard
              const { width, height } = await this.driver.getWindowSize();
              await this.driver.performActions([{
                type: 'pointer', id: 'pt', parameters: { pointerType: 'touch' },
                actions: [
                  { type: 'pointerMove', duration: 0, x: Math.round(width * 0.5), y: Math.round(height * 0.1) },
                  { type: 'pointerDown', button: 0 },
                  { type: 'pause', duration: 60 },
                  { type: 'pointerUp', button: 0 },
                ],
              }]);
              await this.driver.releaseActions();
            }
          }
        } catch {}
        await this.driver.pause(1000);
      }

      const signInSelectors = [
        '-ios predicate string:type == "XCUIElementTypeButton" AND (name MATCHES[c] "Sign In|Sign in|Log In|Log in")',
        '~Sign In',
        '~Sign in',
        '~Log In',
        '~Log in',
      ];

      for (const selector of signInSelectors) {
        try {
          const signInBtnFinal = await this.driver.$(selector);
          if (await signInBtnFinal.isDisplayed()) {
            await signInBtnFinal.click();
            await this.driver.pause(3000);
            break;
          }
        } catch {}
      }
    }

    await this.driver.pause(2000);

    if (credentials.navigateToHomeAfterLogin !== false) {
      console.log('Ensuring navigation to Home page after login...');
      const homeSelectorsAfterLogin = [
        '-ios predicate string:(name == "Home" OR label == "Home") AND type == "XCUIElementTypeButton"',
        '~Home',
      ];

      let homeFound = false;
      for (const selector of homeSelectorsAfterLogin) {
        try {
          const homeEl = await this.driver.$(selector);
          if (await homeEl.isDisplayed()) {
            console.log('  Found Home tab, tapping to navigate home...');
            await homeEl.click();
            await this.driver.pause(2000);
            homeFound = true;
            break;
          }
        } catch {}
      }

      if (!homeFound) {
        console.log('  Home tab not found via selectors, trying bottom-left coordinate tap...');
        const { width, height } = await this.driver.getWindowSize();
        // Bottom left tab (around 12.5% width, 95% height)
        await this.driver.performActions([{
          type: 'pointer', id: 'pt', parameters: { pointerType: 'touch' },
          actions: [
            { type: 'pointerMove', duration: 0, x: Math.round(width * 0.125), y: Math.round(height * 0.95) },
            { type: 'pointerDown', button: 0 },
            { type: 'pause', duration: 60 },
            { type: 'pointerUp', button: 0 },
          ],
        }]);
        await this.driver.releaseActions();
        await this.driver.pause(2000);
      }
      console.log('Post-login navigation to Home completed\n');
    } else {
      console.log('Skipping Home navigation (myaccount flow)\n');
    }
  }

  async navigateToMyAccount(): Promise<void> {
    console.log('Navigating to My Account...');
    const myAccountSelectors = [
      '-ios predicate string:name CONTAINS[c] "My Account" OR label CONTAINS[c] "My Account"',
      '-ios predicate string:name CONTAINS[c] "Account" OR label CONTAINS[c] "Account"',
      '~My Account',
      '~Account',
    ];

    for (const selector of myAccountSelectors) {
      try {
        const el = await this.driver.$(selector);
        if (await el.isDisplayed()) {
          console.log('  Found My Account, tapping...');
          await el.click();
          await this.driver.pause(3000);
          return;
        }
      } catch {}
    }

    const { width } = await this.driver.getWindowSize();
    // Profile/Account menu button top right coordinate tap
    await this.driver.performActions([{
      type: 'pointer', id: 'pt', parameters: { pointerType: 'touch' },
      actions: [
        { type: 'pointerMove', duration: 0, x: Math.round(width * 0.90), y: 60 },
        { type: 'pointerDown', button: 0 },
        { type: 'pause', duration: 60 },
        { type: 'pointerUp', button: 0 },
      ],
    }]);
    await this.driver.releaseActions();
    await this.driver.pause(2000);

    const myAccountMenu = await this.findEl('-ios predicate string:name CONTAINS[c] "My Account"', 3000);
    if (myAccountMenu) {
      await myAccountMenu.click();
      await this.driver.pause(3000);
    }
    console.log('Navigated to My Account\n');
  }

  async openMyAccountPPVPaywall(hooks: IOSFlowHooks = {}): Promise<boolean> {
    await this.navigateToMyAccount();
    await this.driver.pause(3000);

    console.log(`Looking for PPV: "${this.ppvName}" in My Account...`);
    let ppvAvailable = false;
    for (let i = 0; i < 10; i++) {
      if (await this.isVisible(this.ppvName, 2000)) {
        console.log(`Found PPV: "${this.ppvName}"`);
        ppvAvailable = true;
        break;
      }
      await this.scrollDown();
      await this.driver.pause(1000);
    }

    if (!ppvAvailable) {
      const shot = hooks.saveScreenshot
        ? await hooks.saveScreenshot('./test-results/ios_myaccount_ppv_not_found.png')
        : undefined;
      hooks.recordAvailability?.(false, shot, 'My Account');
      await hooks.generateAvailabilityFailureReport?.(`PPV "${this.ppvName}" not found in My Account`);
      throw new Error(`PPV "${this.ppvName}" not found in My Account. See test-results/ios_myaccount_ppv_not_found.png`);
    }

    hooks.recordAvailability?.(true, undefined, 'My Account');

    const buyNowSelectors = [
      '-ios predicate string:name CONTAINS[c] "Buy now" OR label CONTAINS[c] "Buy now"',
      '-ios predicate string:name CONTAINS[c] "Buy" OR label CONTAINS[c] "Buy"',
      '~Buy Now',
      '~Buy now',
      '~Buy',
    ];

    for (const selector of buyNowSelectors) {
      const buyBtn = await this.findEl(selector, 2000);
      if (buyBtn) {
        console.log('  Found Buy button, tapping...');
        await buyBtn.click();
        await this.driver.pause(3000);
        return true;
      }
    }

    await this.driver.saveScreenshot('./test-results/ios_myaccount_buy_not_found.png');
    throw new Error(`Could not find Buy button for PPV: "${this.ppvName}" in My Account`);
  }

  async getPPVStatus(ppvName: string): Promise<string> {
    await this.navigateToMyAccount();
    await this.driver.pause(2000);

    // Scroll to find the PPV card
    for (let i = 0; i < 10; i++) {
      if (await this.isVisible(ppvName, 2000)) break;
      await this.scrollDown();
      await this.driver.pause(800);
    }

    // Check for Purchased / Included status first
    const statusSelectors = [
      '-ios predicate string:label CONTAINS[c] "Purchased" OR name CONTAINS[c] "Purchased"',
      '-ios predicate string:label CONTAINS[c] "Included" OR name CONTAINS[c] "Included"',
      '~Purchased',
      '~Included',
    ];
    for (const selector of statusSelectors) {
      try {
        const el = await this.driver.$(selector);
        if (await el.isDisplayed()) {
          const text = await el.getAttribute('label');
          if (text) return text.trim();
        }
      } catch {}
    }

    // Check for Buy button (not purchased)
    const buySelectors = [
      '-ios predicate string:label CONTAINS[c] "Buy now" OR label CONTAINS[c] "Buy Now" OR label CONTAINS[c] "Buy" OR label CONTAINS[c] "Purchase"',
      '~Buy now',
      '~Buy Now',
      '~Buy',
    ];
    for (const selector of buySelectors) {
      try {
        const el = await this.driver.$(selector);
        if (await el.isDisplayed()) {
          return 'Available';
        }
      } catch {}
    }

    return 'Unknown';
  }

  async hasPPVImage(ppvName: string): Promise<boolean> {
    await this.navigateToMyAccount();
    await this.driver.pause(2000);

    for (let i = 0; i < 10; i++) {
      if (await this.isVisible(ppvName, 2000)) break;
      await this.scrollDown();
      await this.driver.pause(800);
    }

    // Look for image near the PPV card
    const imageSelectors = [
      '//XCUIElementTypeImage',
    ];
    for (const selector of imageSelectors) {
      try {
        const els = await this.driver.$(selector);
        if (await els.isDisplayed()) return true;
      } catch {}
    }
    return false;
  }

  async getPPVName(ppvName: string): Promise<string> {
    await this.navigateToMyAccount();
    await this.driver.pause(2000);

    for (let i = 0; i < 10; i++) {
      if (await this.isVisible(ppvName, 2000)) break;
      await this.scrollDown();
      await this.driver.pause(800);
    }

    try {
      const el = await this.driver.$(`-ios predicate string:label CONTAINS[c] '${ppvName}' OR name CONTAINS[c] '${ppvName}'`);
      if (await el.isDisplayed()) {
        const label = await el.getAttribute('label');
        return label?.trim() || ppvName;
      }
    } catch {}

    return ppvName;
  }

  async getPPVDate(ppvName: string): Promise<string> {
    await this.navigateToMyAccount();
    await this.driver.pause(2000);

    for (let i = 0; i < 10; i++) {
      if (await this.isVisible(ppvName, 2000)) break;
      await this.scrollDown();
      await this.driver.pause(800);
    }

    try {
      const textViews = await this.driver.$$('//XCUIElementTypeStaticText');
      const allTexts: string[] = [];
      for (const tv of textViews) {
        try {
          const text = await tv.getAttribute('label');
          if (text && text.trim()) allTexts.push(text.trim());
        } catch {}
      }

      const dateRe = /\b(\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4})\b/i;
      const timeRe = /(\d{1,2}:\d{2}(\s*[aApP][mM])?)/;

      for (const t of allTexts) {
        if (dateRe.test(t)) {
          console.log(`  Found date text: "${t}"`);
          return t;
        }
      }
      for (const t of allTexts) {
        if (timeRe.test(t) && t.toLowerCase().includes('ppv')) {
          console.log(`  Found fallback time/date text: "${t}"`);
          return t;
        }
      }
    } catch {}

    return 'N/A';
  }
}

export async function preLoginFlow(
  driver: WdBrowser,
  baseUrl: string,
  credentials: IOSLoginCredentials = {},
): Promise<void> {
  return new IOSMyAccountPage(driver).preLoginFlow(baseUrl, credentials);
}

export async function openMyAccountPPVPaywall(
  driver: WdBrowser,
  ppvName: string,
  hooks: IOSFlowHooks = {},
): Promise<boolean> {
  return new IOSMyAccountPage(driver, ppvName).openMyAccountPPVPaywall(hooks);
}
