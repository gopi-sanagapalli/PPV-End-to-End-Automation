const STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'from', 'ppv', 'pay', 'per', 'view', 'live', 'watch', 'vs', 'v']);
const VARIANT_PATTERN = /\b(press\s*conference|weigh[\s-]?in|prelims?|preliminary|undercard|open\s*workout|workout|face\s*off|highlights?|trailer|preview|countdown|full\s*fight|full\s*event|replay|promo|interview|final\s+words|fight\s*night\s*raw|behind\s+the\s+scenes|episode|documentary)\b/i;

function normalizePpvTitle(value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\bv(?:s)?\.?\b/g, ' vs ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleTokens(value: string): string[] {
  return normalizePpvTitle(value)
    .split(' ')
    .filter(token => token.length > 2 && !STOP_WORDS.has(token));
}

function isOneEditAway(expected: string, actual: string): boolean {
  if (expected === actual) return true;
  if (expected.length < 4 || actual.length < 4) return false;
  if (Math.abs(expected.length - actual.length) > 1) return false;

  let edits = 0;
  let i = 0;
  let j = 0;
  while (i < expected.length && j < actual.length) {
    if (expected[i] === actual[j]) {
      i++;
      j++;
      continue;
    }
    edits++;
    if (edits > 1) return false;
    if (expected.length === actual.length) {
      if (
        i + 1 < expected.length &&
        j + 1 < actual.length &&
        expected[i] === actual[j + 1] &&
        expected[i + 1] === actual[j]
      ) {
        i += 2;
        j += 2;
      } else {
        i++;
        j++;
      }
    } else if (expected.length > actual.length) {
      i++;
    } else {
      j++;
    }
  }

  return edits + (expected.length - i) + (actual.length - j) <= 1;
}

export function isLikelySamePpvTitle(candidateTitle: string, expectedTitle: string): boolean {
  const expected = normalizePpvTitle(expectedTitle);
  const candidate = normalizePpvTitle(candidateTitle);
  if (!expected || !candidate) return false;
  if (/[_]/.test(expectedTitle) || /^ppv[-_]/i.test(expectedTitle)) return candidate === expected;
  if (candidate === expected) return true;
  const titleParts = expectedTitle
    .split(/[:\-–]/)
    .map(part => part.trim())
    .filter(part => part.length > 3 && normalizePpvTitle(part) !== expected);
  if (titleParts.some(part => isLikelySamePpvTitle(candidateTitle, part))) return true;
  if (VARIANT_PATTERN.test(candidateTitle) && !VARIANT_PATTERN.test(expectedTitle)) return false;

  const expectedTokens = titleTokens(expectedTitle);
  const candidateTokens = titleTokens(candidateTitle);
  if (expectedTokens.length < 2 || candidateTokens.length < expectedTokens.length) return false;
  return expectedTokens.every(expectedToken =>
    candidateTokens.some(candidateToken => isOneEditAway(expectedToken, candidateToken))
  );
}
