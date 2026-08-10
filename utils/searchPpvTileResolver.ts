import { Locator, Page } from '@playwright/test';
import { isLikelySamePpvTitle, isPpvVariant, normalizePpvTitle, ppvTitleTokens } from './ppvTitleMatcher';

const normalise = normalizePpvTitle;
const isVariant = isPpvVariant;

/**
 * Scores a result against the configured PPV name.  A named tile is preferred
 * over containers which happen to contain several search results.
 */
export function scoreSearchPPVTile(
  tileText: string,
  eventName: string,
  targetTitle = ''
): number {
  const eventPart = eventName.includes(':')
    ? eventName.split(':').slice(1).join(':').trim()
    : eventName.trim();
  const expected = normalise(eventPart || eventName);
  if (!expected || !tileText) return 0;

  const variant = isVariant(tileText) || isVariant(targetTitle);
  const titleMatches = (candidateTitle: string, expectedTitle: string): boolean => {
    const candidateTokens = ppvTitleTokens(candidateTitle);
    const expectedTokens = ppvTitleTokens(expectedTitle);
    return expectedTokens.length > 0 &&
      candidateTokens.length === expectedTokens.length &&
      isLikelySamePpvTitle(candidateTitle, expectedTitle);
  };
  const matchesExpectedTitle = (candidateTitle: string): boolean =>
    titleMatches(candidateTitle, eventPart || eventName) || titleMatches(candidateTitle, eventName);

  if (targetTitle && matchesExpectedTitle(targetTitle)) return variant ? 30 : 120;

  const lines = tileText.split(/\n+/).map(line => line.trim()).filter(Boolean);
  if (lines.some(matchesExpectedTitle)) return variant ? 25 : 100;

  return 0;
}

/**
 * The single source of truth for Search PPV selection.  Both the action and
 * all tile validations use this exact locator, preventing a parent container,
 * competitor result, or ancillary programme from being validated instead.
 */
export async function resolveSearchPPVTile(page: Page, eventName: string): Promise<Locator | null> {
  const selectors = [
    'article',
    '[class*="EventTile" i]',
    '[class*="event-tile" i]',
    '[class*="SearchResult" i]',
    '[class*="search-result" i]',
    '[class*="tile" i]',
    '[class*="card" i]',
    'li[class*="result" i]',
    'li',
  ];

  let bestTile: Locator | null = null;
  let bestScore = 0;

  for (const selector of selectors) {
    const tiles = page.locator(selector);
    const count = await tiles.count().catch(() => 0);

    for (let i = 0; i < Math.min(count, 200); i++) {
      const tile = tiles.nth(i);
      if (!await tile.isVisible().catch(() => false)) continue;

      const text = await tile.textContent().catch(() => '');
      if (!text || text.length > 800) continue;

      const hasDate = await tile.locator('[class*="badge" i], [class*="date" i], time').isVisible({ timeout: 500 }).catch(() => false);
      const hasLock = await tile.locator('[class*="lock" i], [class*="ppv" i]').isVisible({ timeout: 500 }).catch(() => false);
      const hasTestMarker = /\b(?:may|test)\b/i.test(text) || /\b(?:9\s*may|20:30)\b/i.test(text);
      if (!hasDate && !hasLock && !hasTestMarker) continue;

      const targetTitle = await tile.getAttribute('data-target-title').catch(() => '') || '';
      const score = scoreSearchPPVTile(text, eventName, targetTitle);
      if (score > bestScore) {
        bestTile = tile;
        bestScore = score;
      }
    }
  }

  return bestScore >= 60 ? bestTile : null;
}
