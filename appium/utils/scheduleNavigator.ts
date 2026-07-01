type WdBrowser = any;
type WdElement = any;

/**
 * Swipe up gesture (scroll down the page)
 */
export async function scrollDown(driver: WdBrowser): Promise<void> {
  const { width, height } = await driver.getWindowRect();

  await driver.performActions([
    {
      type: 'pointer',
      id: 'finger1',
      parameters: { pointerType: 'touch' },
      actions: [
        { type: 'pointerMove', duration: 0, x: width / 2, y: height * 0.75 },
        { type: 'pointerDown', button: 0 },
        { type: 'pause', duration: 200 },
        { type: 'pointerMove', duration: 300, x: width / 2, y: height * 0.35 },
        { type: 'pointerUp', button: 0 }
      ]
    }
  ]);

  await driver.releaseActions();
}


/**
 * Tap using coordinates
 */
export async function tap(driver: WdBrowser, x: number, y: number): Promise<void> {
  await driver.performActions([
    {
      type: 'pointer',
      id: 'finger1',
      parameters: { pointerType: 'touch' },
      actions: [
        { type: 'pointerMove', duration: 0, x, y },
        { type: 'pointerDown', button: 0 },
        { type: 'pause', duration: 100 },
        { type: 'pointerUp', button: 0 }
      ]
    }
  ]);

  await driver.releaseActions();
}


/**
 * Get element center coordinates
 * (Replacement for getRect which is not supported)
 */
export async function getElementCenter(
  el: WdElement
): Promise<{ x: number; y: number }> {

  const location = await el.getLocation();
  const size = await el.getSize();

  return {
    x: location.x + size.width / 2,
    y: location.y + size.height / 2
  };
}


/**
 * Wait for element safely (no crash)
 */
export async function waitForElement(
  driver: WdBrowser,
  selector: string,
  timeout: number = 5000
): Promise<WdElement> {

  const el = await driver.$(selector);
  await el.waitForExist({ timeout });
  await el.waitForDisplayed({ timeout });

  return el;
}


/**
 * Scroll until element is found
 */
export async function findWithScroll(
  driver: WdBrowser,
  selector: string,
  maxScrolls: number = 8
): Promise<WdElement> {

  for (let i = 0; i < maxScrolls; i++) {
    const el = await driver.$(selector);

    if (await el.isExisting()) {
      console.log(`✅ Found element after ${i} scroll(s)`);
      return el;
    }

    console.log(`🔄 Scroll attempt ${i + 1}`);
    await scrollDown(driver);
  }

  throw new Error(`❌ Element not found after ${maxScrolls} scrolls`);
}


/**
 * Alternative: Use Android native scroll (better if RecyclerView)
 */
export async function scrollIntoViewAndroid(
  driver: WdBrowser,
  text: string
): Promise<WdElement> {

  const selector = `android=new UiScrollable(new UiSelector().scrollable(true)).scrollIntoView(new UiSelector().textContains("${text}"))`;

  const el = await driver.$(selector);
  await el.waitForDisplayed({ timeout: 10000 });

  return el;
}


/**
 * Navigate to PPV tile (Joshua vs Prenga)
 */
export async function navigateToPPVTile(driver: WdBrowser, event?: { PPV_NAME?: string }): Promise<void> {

  // ✅ Robust selector handles all variations
  const ppvName = event?.PPV_NAME || process.env.PPV_NAME || 'Joshua';
  const escapedPpvName = ppvName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const selector =
    `android=new UiSelector().textMatches(".*${escapedPpvName}.*")`;

  let tile: WdElement;

  try {
    // First try standard scroll
    tile = await findWithScroll(driver, selector, 8);
  } catch (err) {
    console.log('⚠️ Fallback to UiScrollable...');
    tile = await scrollIntoViewAndroid(driver, ppvName.split(/\s+/)[0] || ppvName);
  }

  await tile.waitForDisplayed({ timeout: 5000 });

  const { x, y } = await getElementCenter(tile);

  console.log(`🎯 Tapping PPV tile at (${x}, ${y})`);

  await tap(driver, x, y);
}


/**
 * Generic reusable function: scroll + tap any text
 */
export async function scrollAndTapByText(driver: WdBrowser, text: string): Promise<void> {

  const selector =
    `android=new UiSelector().textMatches(".*${text}.*")`;

  const el = await findWithScroll(driver, selector);

  const { x, y } = await getElementCenter(el);

  console.log(`🎯 Tap on "${text}" at (${x}, ${y})`);

  await tap(driver, x, y);
}
