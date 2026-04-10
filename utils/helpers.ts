import * as fs from 'fs';
import * as path from 'path';

/** Cookie state file path */
const COOKIE_STATE_FILE = 'auth/dazn-storage-state.json';

/**
 * Saves the current cookie acceptance state to a JSON file
 * @param page - Playwright page object
 */
export async function saveCookieState(page: any): Promise<void> {
  try {
    const storageState = await page.context().storageState();
    const authDir = path.dirname(COOKIE_STATE_FILE);
    if (!fs.existsSync(authDir)) {
      fs.mkdirSync(authDir, { recursive: true });
    }
    fs.writeFileSync(COOKIE_STATE_FILE, JSON.stringify(storageState, null, 2));
    console.log('💾 Cookie state saved');
  } catch (error) {
    console.log('⚠️ Could not save cookie state:', error);
  }
}

/**
 * Loads stored cookie acceptance state from JSON file
 * @returns Storage state object or null if file doesn't exist
 */
export function loadCookieState(): any {
  try {
    if (fs.existsSync(COOKIE_STATE_FILE)) {
      const state = fs.readFileSync(COOKIE_STATE_FILE, 'utf8');
      console.log('📂 Cookie state loaded from stored JSON');
      return JSON.parse(state);
    }
  } catch (error) {
    console.log('⚠️ Could not load cookie state:', error);
  }
  return null;
}

/**
 * Handles cookie consent popup if present.
 * Safe to call repeatedly; it exits silently when popup is not shown.
 * @param page - Playwright page object
 */
export async function handleCookies(page: any): Promise<void> {
  for (let i = 0; i < 5; i++) {
    try {
      const acceptBtn = page.locator(
        '#onetrust-accept-btn-handler, button:has-text("Accept"), button:has-text("Agree"), button:has-text("Allow all")'
      ).first();

      if (await acceptBtn.isVisible({ timeout: 1000 })) {
        await acceptBtn.click({ force: true });
        console.log('🍪 Cookies accepted');
        return;
      }
    } catch {
      // ignore and retry
    }

    await page.waitForTimeout(500);
  }
}
