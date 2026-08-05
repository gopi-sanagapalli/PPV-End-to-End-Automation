import { IOSBasePage, IOSFlowHooks, WdBrowser, WdElement } from './IOSBasePage';

export interface IOSLoginCredentials {
  email?: string;
  password?: string;
  navigateToHomeAfterLogin?: boolean;
}

const LOGIN_SCREENSHOT_PATH = './test-results/ios_native_login_failure.png';

const loginButtonSelectors = [
  '-ios predicate string:type == "XCUIElementTypeButton" AND (name == "Log in" OR label == "Log in")',
  '~Log in',
  '-ios predicate string:type == "XCUIElementTypeStaticText" AND (name == "Log in" OR label == "Log in")',
];

const emailFieldSelectors = [
  '-ios predicate string:type == "XCUIElementTypeTextField" AND (name CONTAINS[c] "Email" OR label CONTAINS[c] "Email" OR value CONTAINS[c] "Email")',
  '-ios predicate string:type == "XCUIElementTypeTextField"',
];

const passwordFieldSelectors = [
  '-ios predicate string:type == "XCUIElementTypeSecureTextField" AND (name CONTAINS[c] "Password" OR label CONTAINS[c] "Password" OR value CONTAINS[c] "Password")',
  '-ios predicate string:type == "XCUIElementTypeSecureTextField"',
];

const emailContinueSelectors = [
  '-ios predicate string:type == "XCUIElementTypeButton" AND (name == "Continue" OR label == "Continue")',
  '~Continue',
];

const passwordSubmitSelectors = [
  '-ios predicate string:type == "XCUIElementTypeButton" AND (name == "Sign In" OR label == "Sign In" OR name == "Sign in" OR label == "Sign in")',
  '-ios predicate string:type == "XCUIElementTypeButton" AND (name == "Continue" OR label == "Continue")',
  '-ios predicate string:type == "XCUIElementTypeButton" AND (name == "Log in" OR label == "Log in" OR name == "Log In" OR label == "Log In")',
  '~Sign In',
  '~Sign in',
  '~Continue',
  '~Log in',
];

const profileSelectors = [
  '-ios predicate string:type == "XCUIElementTypeButton" AND (name CONTAINS[c] "Profile" OR label CONTAINS[c] "Profile" OR name CONTAINS[c] "Account" OR label CONTAINS[c] "Account")',
  '-ios predicate string:type == "XCUIElementTypeButton" AND name MATCHES "^[A-Z]$"',
  '-ios predicate string:type == "XCUIElementTypeImage" AND (name CONTAINS[c] "avatar" OR name CONTAINS[c] "profile")',
];

async function firstVisible(driver: WdBrowser, selectors: string[]): Promise<WdElement | null> {
  for (const selector of selectors) {
    try {
      const elements = await driver.$$(selector);
      for (const element of elements) {
        if (await element.isDisplayed().catch(() => false)) return element;
      }
    } catch {
      // A locator can be absent while the native screen is transitioning.
    }
  }
  return null;
}

async function dismissKnownSystemAlert(driver: WdBrowser): Promise<boolean> {
  const dismissLabels = ["Don't Allow", 'Ask App Not to Track', 'Not Now', 'OK'];
  try {
    if (await driver.isAlertOpen()) {
      const buttons = await driver.execute('mobile: alert', { action: 'getButtons' }) as string[];
      const button = dismissLabels.find(label => buttons?.some(value => value?.trim() === label));
      if (button) {
        await driver.execute('mobile: alert', { action: 'accept', buttonLabel: button });
        console.log(`  Dismissed iOS system alert with "${button}".`);
        return true;
      }
    }
  } catch {
    // Fall through to the native accessibility tree. Some real devices do not
    // expose a system alert through isAlertOpen immediately.
  }

  const button = await firstVisible(driver, dismissLabels.flatMap(label => [
    `-ios predicate string:type == "XCUIElementTypeButton" AND (name == "${label}" OR label == "${label}")`,
    `~${label}`,
  ]));
  if (!button) return false;

  await button.click();
  console.log('  Dismissed visible iOS system alert.');
  return true;
}

export class IOSMyAccountPage extends IOSBasePage {
  async preLoginFlow(baseUrl: string, credentials: IOSLoginCredentials = {}): Promise<void> {
    void baseUrl;
    if (!credentials.email || !credentials.password) {
      throw new Error('Native iOS login requires both an email and password.');
    }

    console.log('\nPRE-LOGIN FLOW: Signing in existing iOS user through the native app...');
    try {
      await this.driver.switchContext('NATIVE_APP');

      if (await firstVisible(this.driver, profileSelectors)) {
        console.log('  Logged-in profile control is already visible; skipping native login.');
        await this.navigateHomeAfterLogin(credentials.navigateToHomeAfterLogin);
        return;
      }

      // Dismiss any system alerts (e.g. ATT tracking) on the landing page
      // before looking for login controls.
      await dismissKnownSystemAlert(this.driver);

      let emailField = await firstVisible(this.driver, emailFieldSelectors);
      if (!emailField) {
        const loginButton = await this.waitForNativeElement(loginButtonSelectors, 15000, 'landing-page "Log in" button');
        console.log('  Opening the native login screen from the landing page...');
        await loginButton.click();

        // The Face ID prompt is optional. Poll for the actual next screen, and
        // dismiss only known opt-out/info buttons if a system dialog appears.
        await this.driver.waitUntil(async () => {
          await dismissKnownSystemAlert(this.driver);
          emailField = await firstVisible(this.driver, emailFieldSelectors);
          return Boolean(emailField);
        }, {
          timeout: 15000,
          interval: 300,
          timeoutMsg: 'Native iOS login screen did not show an email field after tapping "Log in".',
        });
      }

      console.log('  Entering email address...');
      await emailField!.click();
      await emailField!.clearValue().catch(() => {});
      await emailField!.setValue(credentials.email);

      const continueButton = await this.waitForNativeElement(emailContinueSelectors, 10000, 'email "Continue" button');
      console.log('  Submitting email address...');
      await continueButton.click();

      let passwordField: WdElement | null = null;
      await this.driver.waitUntil(async () => {
        await dismissKnownSystemAlert(this.driver);
        passwordField = await firstVisible(this.driver, passwordFieldSelectors);
        return Boolean(passwordField);
      }, {
        timeout: 15000,
        interval: 300,
        timeoutMsg: 'Password field did not appear after submitting the email address.',
      });

      console.log('  Entering password...');
      await passwordField!.click();
      await passwordField!.clearValue().catch(() => {});
      await passwordField!.setValue(credentials.password);

      // The native Log in control remains above the iOS keyboard. WDA cannot
      // reliably dismiss this app's keyboard, so submit directly once enabled.
      const signInButton = await this.waitForNativeElement(passwordSubmitSelectors, 10000, 'enabled password submit button', true);
      console.log('  Submitting native login credentials...');
      await signInButton.click();

      await this.driver.waitUntil(async () => {
        await dismissKnownSystemAlert(this.driver);
        return Boolean(await firstVisible(this.driver, profileSelectors));
      }, {
        timeout: 30000,
        interval: 500,
        timeoutMsg: 'Native iOS login did not reach a logged-in state (profile control was not visible).',
      });

      console.log('✅ Native iOS login completed; logged-in profile control is visible.\n');
      await this.navigateHomeAfterLogin(credentials.navigateToHomeAfterLogin);
    } catch (error: any) {
      await this.driver.saveScreenshot(LOGIN_SCREENSHOT_PATH).catch(() => {});
      throw new Error(`Native iOS login failed. Screenshot: ${LOGIN_SCREENSHOT_PATH}. ${error?.message || error}`);
    }
  }

  private async waitForNativeElement(
    selectors: string[],
    timeoutMs: number,
    description: string,
    requireEnabled = false,
  ): Promise<WdElement> {
    let element: WdElement | null = null;
    await this.driver.waitUntil(async () => {
      element = await firstVisible(this.driver, selectors);
      return Boolean(element) && (!requireEnabled || await element!.isEnabled().catch(() => false));
    }, {
      timeout: timeoutMs,
      interval: 300,
      timeoutMsg: `Could not find ${description}.`,
    });
    return element!;
  }

  private async navigateHomeAfterLogin(navigateToHomeAfterLogin = true): Promise<void> {
    if (!navigateToHomeAfterLogin) {
      console.log('  Skipping Home navigation for the requested flow.');
      return;
    }

    const home = await firstVisible(this.driver, [
      '-ios predicate string:type == "XCUIElementTypeButton" AND (name == "Home" OR label == "Home")',
      '~Home',
    ]);
    if (home) {
      await home.click();
      console.log('  Navigated to Home using the native tab control.');
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

  // ─────────────────────────────────────────────────────────────────────────
  // SAFARI: My Account PPV page  (active_ultimate_* users — PPV purchased)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Returns true when the Safari WebView has landed on the My Account PPV
   * page, which means the user's PPV is already purchased / included.
   */
  isSafariPurchasedPPVPage(bodyTextLower: string, url: string): boolean {
    const isAccountUrl = /\/account|\/my-account|\/myaccount/i.test(url);
    const hasPurchasedText =
      /purchased|your dazn pass|already purchased|you already own/i.test(bodyTextLower);
    return isAccountUrl && hasPurchasedText;
  }

  /**
   * Record a validation row confirming the active_ultimate user's PPV is
   * purchased on the My Account page in Safari.
   */
  async validateSafariPurchasedPPV(
    results: { page: string; field: string; expected: string; actual: string; status: string }[],
    ppvName: string,
  ): Promise<void> {
    console.log('✅ [My Account Safari] PPV already purchased — recording result.');
    results.push({
      page: 'My Account (Safari)',
      field: 'PPV Purchased',
      expected: 'Yes',
      actual: 'Yes',
      status: 'PASS',
    });

    // Best-effort: also check the PPV name is visible on the page
    try {
      const bodyText: string = await this.driver.execute(() => document.body?.innerText || '').catch(() => '');
      const nameMatch = ppvName
        ? bodyText.toLowerCase().includes(ppvName.split(/[\s:]+/)[0].toLowerCase())
        : true;
      results.push({
        page: 'My Account (Safari)',
        field: 'PPV Name Visible',
        expected: 'Yes',
        actual: nameMatch ? 'Yes' : 'No',
        status: nameMatch ? 'PASS' : 'FAIL',
      });
    } catch {
      // non-fatal
    }
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
