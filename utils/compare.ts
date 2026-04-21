export function compare(
  actual:   string,
  expected: string,
  type?:    string
): boolean {
  if (!expected) return true;

  // ── N/A expected ───────────────────────────────────────────────
  if (expected.trim().toUpperCase() === 'N/A') {
    return actual.trim().toUpperCase() === 'N/A';
  }

  const norm = (s: string) =>
    s.replace(/[£$€₹]/g, '')
     .replace(/\s+/g, ' ')
     .trim()
     .toLowerCase();

  const a = norm(actual);
  const e = norm(expected);

  // ── Yes/No ─────────────────────────────────────────────────────
  if (e === 'yes') return a === 'yes' || actual === 'Yes';
  if (e === 'no')  return a === 'no'  || actual === 'No';

  // ── Gold ───────────────────────────────────────────────────────
  if (e === 'gold') return a === 'gold' || actual === 'Gold';

  // ── Pipe-separated multiple valid values ───────────────────────
  // e.g. "Choose how to buy|Choose your plan"
  if (expected.includes('|')) {
    const options = expected.split('|').map(o => norm(o.trim()));
    return options.some(opt =>
      a === opt ||
      a.replace(/\.$/, '') === opt.replace(/\.$/, '')
    );
  }

  // ── Type overrides ─────────────────────────────────────────────
  if (type === 'contains')   return a.includes(e);
  if (type === 'startsWith') return a.startsWith(e);

  // ── Exact match ────────────────────────────────────────────────
  if (a === e) return true;

  // ── Trailing period flexibility ────────────────────────────────
  // "7-days free access to DAZN Standard" vs "7-days free access to DAZN Standard."
  if (a.replace(/\.$/, '') === e.replace(/\.$/, '')) return true;

  // ── Price comparison ───────────────────────────────────────────
  const normPrice = (s: string) =>
    s.replace(/[£$€₹,\s]/g, '').trim();
  const aPrice = normPrice(actual);
  const ePrice = normPrice(expected);
  if (aPrice && ePrice && aPrice === ePrice) return true;

  // ── Contains with length guard ─────────────────────────────────
  if (a.includes(e) && actual.length < expected.length * 10) return true;

  // ── Date flexibility ───────────────────────────────────────────
  const extractDateParts = (s: string) => {
    const months = [
      'jan','feb','mar','apr','may','jun',
      'jul','aug','sep','oct','nov','dec'
    ];
    const month = months.find(m => s.toLowerCase().includes(m));
    const day   = s.match(/\b(\d{1,2})(st|nd|rd|th)?\b/)?.[1];
    return { month, day };
  };

  const aParts = extractDateParts(a);
  const eParts = extractDateParts(e);

  if (
    aParts.month && eParts.month &&
    aParts.day   && eParts.day   &&
    aParts.month === eParts.month &&
    aParts.day   === eParts.day
  ) return true;

  return false;
}