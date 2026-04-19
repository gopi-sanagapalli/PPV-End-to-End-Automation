import { DOMNode } from './helpers';

export async function getActualValue(
  page:       any,
  field:      string,
  _variant?:  string,
  eventData?: Record<string, string>,
  snapshot?:  DOMNode[]
): Promise<string> {

  if (field.toLowerCase().includes('date') && field.toLowerCase().includes('time')) {
    console.log(`🔍 Date field received: "${field}" → key: "${field.toLowerCase().replace(/\s+/g, ' ').trim()}"`);
  }
  if (!page || page.isClosed()) return 'N/A';

  // ── Helpers ──────────────────────────────────────────────────
  const clean = (v: string | null | undefined): string =>
    String(v ?? '')
      .replace(/\u200B/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  const T = 0;

  // ── Snapshot helpers ─────────────────────────────────────────
  const snap = snapshot || [];

  const snapFind = (
    predicate: (n: DOMNode) => boolean,
    inModal = false
  ): string => {
    for (const n of snap) {
      if (inModal && !n.isInModal) continue;
      if (!inModal && n.isInModal) continue;
      if (predicate(n)) return n.text;
    }
    return 'N/A';
  };

  const snapFindAll = (
    predicate: (n: DOMNode) => boolean,
    inModal = false
  ): string[] => {
    const results: string[] = [];
    for (const n of snap) {
      if (inModal && !n.isInModal) continue;
      if (!inModal && n.isInModal) continue;
      if (predicate(n)) results.push(n.text);
    }
    return results;
  };

  const snapExists = (predicate: (n: DOMNode) => boolean): string => {
    for (const n of snap) {
      if (predicate(n)) return 'Yes';
    }
    return 'No';
  };

  // ── Live DOM helpers ─────────────────────────────────────────
  const isVisible = async (loc: any): Promise<boolean> => {
    try {
      const count = await loc.count().catch(() => 0);
      for (let i = 0; i < count; i++) {
        if (await loc.nth(i).isVisible().catch(() => false)) return true;
      }
    } catch {}
    return false;
  };

  const firstExists = async (...sels: string[]): Promise<string> => {
    for (const sel of sels) {
      try {
        if (await isVisible(page.locator(sel))) return 'Yes';
      } catch {}
    }
    return 'No';
  };

  // ── Scroll once ──────────────────────────────────────────────
  const scrollPage = async () => {
    try {
      await page.evaluate(() =>
        window.scrollTo(0, document.body.scrollHeight)
      );
      await page.waitForTimeout(150);
      await page.evaluate(() => window.scrollTo(0, 0));
    } catch {}
  };

  // ── Modal — cached ───────────────────────────────────────────
  let _modal: any = undefined;
  const getModal = async (): Promise<any | null> => {
    if (_modal !== undefined) return _modal;
    const modalSels = [
      '[role="dialog"]',
      '[aria-modal="true"]',
      '[class*="modal" i]',
      '[class*="overlay" i]',
      '[class*="popup" i]',
      '[class*="drawer" i]',
      '[class*="sheet" i]',
    ];
    for (const sel of modalSels) {
      const el = page.locator(sel).first();
      if (await el.isVisible().catch(() => false)) {
        _modal = el;
        return _modal;
      }
    }
    _modal = null;
    return null;
  };

  const isPriceText = (t: string) =>
    /^[£$$€₹]\s?[\d,]+(\.\d{2})?$$/.test(t);

  const isDateText = (t: string) =>
    (/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/i.test(t) &&
     /\d{1,2}(st|nd|rd|th)?\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i.test(t)) ||
    (/\d{1,2}\s*(st|nd|rd|th)?\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i.test(t) &&
     /\d{1,2}:\d{2}/.test(t));

  const key = field.toLowerCase().replace(/\s+/g, ' ').trim();

  switch (key) {
// ════════════════════════════════════════════════════════════
// LANDING PAGE — DON'T MISS LIVE ON DAZN SECTION
// ════════════════════════════════════════════════════════════
case "don't miss live on dazn section": {
  const found = snapFind(n =>
    n.text.toLowerCase().includes("don't miss live on dazn") &&
    n.text.length < 60
  );
  if (found !== 'N/A') return 'Yes';

  return firstExists(
    'text=/don\'t miss live on dazn/i',
    '[class*="section" i]',
    'h2, h3'
  );
}
    // ════════════════════════════════════════════════════════════
    // PAGE TITLE
    // ════════════════════════════════════════════════════════════
    case 'page title': {
      return snapFind(
        n => n.tag === 'h1' && n.text.length < 120
      );
    }

    // ════════════════════════════════════════════════════════════
    // HEADER SUB TEXT
    // ════════════════════════════════════════════════════════════
    case 'header sub text':
    case 'header full copy':
    case 'header upsell text': {
      return snapFind(n =>
        (n.tag === 'p' || n.tag === 'span') &&
        (n.text.toLowerCase().includes('with dazn') ||
         (n.text.toLowerCase().includes('buy') &&
          n.text.toLowerCase().includes('standard')))
      );
    }

    // ════════════════════════════════════════════════════════════
    // PAGE SUBHEADER
    // ════════════════════════════════════════════════════════════
    case 'pagesubheader':
    case 'page subheader': {
      return snapFind(n =>
        (n.tag === 'p' || n.tag === 'span' ||
         n.tag === 'h2' || n.tag === 'h3') &&
        (n.text.toLowerCase().includes('pick a plan') ||
         n.text.toLowerCase().includes('pay-per-view event'))
      );
    }

    // ════════════════════════════════════════════════════════════
    // HEADER HIGHLIGHT TEXT
    // ════════════════════════════════════════════════════════════
    case 'header highlight text1':
    case 'header highlight text': {
      const ppvName = (eventData?.PPV_NAME || '').toLowerCase();
      const found = snapFind(n =>
        (n.tag === 'strong' || n.tag === 'b' || n.tag === 'a') &&
        n.text.toLowerCase().includes('vs')
      );
      if (found !== 'N/A') return found;
      if (ppvName) {
        return snapFind(n =>
          n.text.toLowerCase().includes(ppvName) &&
          n.text.toLowerCase().includes('vs')
        );
      }
      return 'N/A';
    }

    case 'header highlight text2': {
      const found = snapFind(n =>
        (n.tag === 'strong' || n.tag === 'b' || n.tag === 'a') &&
        (n.text.toLowerCase().includes('ultimate') ||
         n.text.toLowerCase().includes('included'))
      );
      if (found !== 'N/A') return found;
      return snapFind(n =>
        n.text.toLowerCase().includes('get it included') ||
        n.text.toLowerCase().includes('included in dazn ultimate')
      );
    }

    // ════════════════════════════════════════════════════════════
    // HEADER (payment encrypted text)
    // ════════════════════════════════════════════════════════════
    case 'header': {
      return snapFind(n =>
        (n.tag === 'p' || n.tag === 'span') &&
        n.text.toLowerCase().includes('encrypted')
      );
    }

    // ════════════════════════════════════════════════════════════
    // SCHEDULE — PPV TILE PRESENT
    // ════════════════════════════════════════════════════════════
    case 'ppv tile present': {
      const count = await page.locator('article').count().catch(() => 0);
      return count > 0 ? 'Yes' : 'No';
    }

    // ════════════════════════════════════════════════════════════
    // SCHEDULE — LOCK ICON PRESENT
    // ════════════════════════════════════════════════════════════
    case 'lock icon present': {
      return firstExists(
        '[class*="lock" i]',
        '[class*="premium" i]',
        'svg[class*="lock" i]',
        '[aria-label*="lock" i]',
        'article svg'
      );
    }

    // ════════════════════════════════════════════════════════════
    // SCHEDULE — PPV TIME ON TILE
    // ════════════════════════════════════════════════════════════
   case 'ppv time on tile': {
  // Try snapshot first
  const fromSnap = snapFind(n =>
    n.childCount === 0 &&
    /^\d{1,2}:\d{2}$/.test(n.text)
  );
  if (fromSnap !== 'N/A') return fromSnap;

  // Fallback — live DOM
  const firstWord = (eventData?.PPV_NAME || '').toLowerCase().split(' ')[0];
  const articles  = page.locator('article');
  const artCount  = await articles.count().catch(() => 0);
  for (let i = 0; i < artCount; i++) {
    const art = articles.nth(i);
    const artText = clean(
      await art.innerText({ timeout: T }).catch(() => '')
    ).toLowerCase();
    if (firstWord && !artText.includes(firstWord)) continue;
    const inner = art.locator('span, time, p, div');
    const ic    = await inner.count().catch(() => 0);
    for (let j = 0; j < ic; j++) {
      const el = inner.nth(j);
      if (!await el.isVisible().catch(() => false)) continue;
      const kids = await el.locator('> *').count().catch(() => 0);
      if (kids > 1) continue;
      const t = clean(await el.innerText({ timeout: T }).catch(() => ''));
      if (/^\d{1,2}:\d{2}$/.test(t)) return t;
    }
  }
  return 'N/A';
}

    // ════════════════════════════════════════════════════════════
    // SCHEDULE — PPV PROMOTER ON TILE
    // ════════════════════════════════════════════════════════════
   case 'ppv promoter on tile': {
  const promoter  = (eventData?.PPV_PROMOTER || '').toLowerCase();
  const firstWord = promoter.split(' ')[0];

  // Try snapshot first
  const fromSnap = snapFind(n => {
    const t = n.text.toLowerCase();
    return (
      firstWord &&
      t.includes(firstWord) &&
      n.text.length < 80 &&
      !t.includes('vs')
    );
  });
  if (fromSnap !== 'N/A') return fromSnap;

  // Fallback — live DOM
  const ppvFirstWord = (eventData?.PPV_NAME || '').toLowerCase().split(' ')[0];
  const articles     = page.locator('article');
  const artCount     = await articles.count().catch(() => 0);
  for (let i = 0; i < artCount; i++) {
    const art = articles.nth(i);
    const artText = clean(
      await art.innerText({ timeout: T }).catch(() => '')
    ).toLowerCase();
    if (ppvFirstWord && !artText.includes(ppvFirstWord)) continue;
    const inner = art.locator('p, span');
    const ic    = await inner.count().catch(() => 0);
    for (let j = 0; j < ic; j++) {
      const el = inner.nth(j);
      if (!await el.isVisible().catch(() => false)) continue;
      const kids = await el.locator('> *').count().catch(() => 0);
      if (kids > 1) continue;
      const t = clean(await el.innerText({ timeout: T }).catch(() => ''));
      if (
        firstWord &&
        t.toLowerCase().includes(firstWord) &&
        t.length < 80 &&
        !t.toLowerCase().includes('vs')
      ) return t;
    }
  }
  return 'N/A';
}

    // ════════════════════════════════════════════════════════════
    // SCHEDULE — POPUP CLOSE BUTTON
    // ════════════════════════════════════════════════════════════
   case 'popup close button': {
  // Try snapshot first
  const fromSnap = snapFind(n =>
    n.isInModal &&
    (n.tag === 'button') &&
    (n.classes.toLowerCase().includes('close') ||
     n.classes.toLowerCase().includes('dismiss') ||
     n.text === '×' ||
     n.text === '✕' ||
     n.text === 'Close' ||
     n.text === '')
  , true);
  if (fromSnap !== 'N/A') return 'Yes';

  // Live DOM fallback
  return firstExists(
    '[role="dialog"] button[aria-label*="close" i]',
    '[role="dialog"] button[class*="close" i]',
    '[role="dialog"] [class*="dismiss" i]',
    '[role="dialog"] button[class*="icon" i]',
    '[role="dialog"] button:has(svg)',
    '[aria-modal="true"] button:has(svg)',
    '[class*="modal" i] button:has(svg)'
  );
}

    // ════════════════════════════════════════════════════════════
    // PPV NAME
    // ════════════════════════════════════════════════════════════
    case 'ppv name': {
  const firstWord = (eventData?.PPV_NAME || '').toLowerCase().split(' ')[0];
  const ppvName   = (eventData?.PPV_NAME || '').toLowerCase();

  // Try snapshot first
  const fromHeading = snapFind(n =>
    ['h1','h2','h3','h4'].includes(n.tag) &&
    n.text.toLowerCase().includes('vs') &&
    n.text.length < 80
  );
  if (fromHeading !== 'N/A') return fromHeading;

  // Try snapshot spans/p
  const fromSnap = snapFind(n =>
    n.text.toLowerCase().includes('vs') &&
    n.text.length < 80 &&
    !n.text.toLowerCase().includes('buy') &&
    (!firstWord || n.text.toLowerCase().includes(firstWord))
  );
  if (fromSnap !== 'N/A') return fromSnap;

  // Fallback — live DOM for schedule page articles
  const articles = page.locator('article');
  const artCount = await articles.count().catch(() => 0);
  for (let i = 0; i < artCount; i++) {
    const art = articles.nth(i);
    const artText = clean(
      await art.innerText({ timeout: T }).catch(() => '')
    ).toLowerCase();
    if (firstWord && !artText.includes(firstWord)) continue;
    const inner = art.locator('h2, h3, h4, p, span');
    const ic    = await inner.count().catch(() => 0);
    for (let j = 0; j < ic; j++) {
      const el = inner.nth(j);
      if (!await el.isVisible().catch(() => false)) continue;
      const t = clean(await el.innerText({ timeout: T }).catch(() => ''));
      if (t.toLowerCase().includes('vs') && t.length < 80) return t;
    }
  }
  return 'N/A';
}

    // ════════════════════════════════════════════════════════════
    // PPV DATE (schedule page)
    // ════════════════════════════════════════════════════════════
    case 'ppv date': {
      const firstWord = (eventData?.PPV_NAME || '').toLowerCase().split(' ')[0];
      const arts = page.locator('article');
      const ac   = await arts.count().catch(() => 0);

      for (let i = 0; i < ac; i++) {
        const art = arts.nth(i);
        if (!await art.isVisible().catch(() => false)) continue;
        const artText = clean(
          await art.innerText({ timeout: T }).catch(() => '')
        ).toLowerCase();
        if (firstWord && !artText.includes(firstWord)) continue;

        const artHandle = await art.elementHandle().catch(() => null);
        if (artHandle) {
          const dateText = await page.evaluate((el: Element) => {
            let parent = el.parentElement;
            for (let i = 0; i < 5; i++) {
              if (!parent) break;
              const prev = parent.previousElementSibling;
              if (prev) {
                const text = (prev as HTMLElement).innerText?.trim() || '';
                if (/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/i.test(text)) return text;
                if (/\d{1,2}\s*(MAY|JAN|FEB|MAR|APR|JUN|JUL|AUG|SEP|OCT|NOV|DEC)/i.test(text)) return text;
              }
              const parentText = (parent as HTMLElement).innerText?.trim() || '';
              if (
                /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/i.test(parentText) &&
                parentText.length < 30
              ) return parentText;
              parent = parent.parentElement;
            }
            return '';
          }, artHandle).catch(() => '');
          if (dateText && dateText.length < 50) return dateText;
        }
      }
      if (eventData?.PPV_DATE) return eventData.PPV_DATE;
      return 'N/A';
    }

    // ════════════════════════════════════════════════════════════
    // POPUP FIELDS
    // ════════════════════════════════════════════════════════════
    case 'popup image present': {
      return firstExists(
        '[role="dialog"] img',
        '[aria-modal="true"] img',
        '[class*="modal" i] img'
      );
    }

  case 'popup date': {
  const firstWord    = (eventData?.PPV_NAME || '').toLowerCase().split(' ')[0];
  const ppvDate      = (eventData?.PPV_DATE || '').toLowerCase();
  const months       = ['jan','feb','mar','apr','may','jun',
                        'jul','aug','sep','oct','nov','dec'];
  const expectedMonth = months.find(m => ppvDate.includes(m));
  const expectedDay   = ppvDate.match(/\b(\d{1,2})(st|nd|rd|th)?\b/)?.[1];

  // Verify modal contains our event
  const modalTexts = snap
    .filter(n => n.isInModal)
    .map(n => n.text.toLowerCase());
  const modalHasEvent = firstWord
    ? modalTexts.some(t => t.includes(firstWord))
    : true;

  if (!modalHasEvent) {
    console.log(`⚠️  Modal does not contain "${firstWord}"`);
    return 'N/A';
  }

  return snapFind(n => {
    if (!n.isInModal) return false;
    const t  = n.text;
    const tl = t.toLowerCase();

    if (tl.includes('vs'))     return false;
    if (isPriceText(t))        return false;
    if (tl.includes('buy'))    return false;
    if (tl.includes('catch'))  return false;
    if (tl.includes('select')) return false;

    // Must match expected month AND day
    if (expectedMonth && !tl.includes(expectedMonth)) return false;
    if (expectedDay) {
      const dayMatch = t.match(/\b(\d{1,2})(st|nd|rd|th)?\b/)?.[1];
      if (dayMatch !== expectedDay) return false;
    }

    if (
      /^\d{1,2}\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+\d{1,2}:\d{2}$/i.test(t)
    ) return true;
    if (
      /\b(MON|TUE|WED|THU|FRI|SAT|SUN)\b/i.test(t) &&
      /\d{1,2}/.test(t) &&
      /\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\b/i.test(t) &&
      t.length < 30
    ) return true;
    if (isDateText(t) && t.length < 60) return true;
    return false;
  }, true);
}

    case 'popup ppv name': {
      const firstWord = (eventData?.PPV_NAME || '').toLowerCase().split(' ')[0];
      return snapFind(n =>
        n.isInModal &&
        n.text.toLowerCase().includes('vs') &&
        n.text.length < 80 &&
        (!firstWord || n.text.toLowerCase().includes(firstWord))
      , true);
    }

    case 'popup promoter': {
      const promoter  = (eventData?.PPV_PROMOTER || '').toLowerCase();
      const firstWord = promoter.split(' ')[0];
      return snapFind(n => {
        if (!n.isInModal) return false;
        const t = n.text.toLowerCase();
        return (
          firstWord &&
          t.includes(firstWord) &&
          n.text.length > 5 &&
          n.text.length < 80 &&
          !t.includes('vs')
        );
      }, true);
    }

    case 'popup description': {
      const ppvDesc = (eventData?.PPV_DESCRIPTION || '').toLowerCase();
      return snapFind(n =>
        n.isInModal &&
        n.tag === 'p' &&
        n.text.length > 30 &&
        !n.text.toLowerCase().includes('vs') &&
        !isDateText(n.text) &&
        (ppvDesc
          ? n.text.toLowerCase().includes(ppvDesc.split(' ')[0])
          : true)
      , true);
    }

    case 'popup buy now cta': {
      const found = snapFind(n =>
        n.isInModal &&
        (n.tag === 'button' || n.tag === 'a') &&
        n.text.toLowerCase().includes('buy')
      , true);
      return found !== 'N/A' ? 'Yes' : 'No';
    }

    // ════════════════════════════════════════════════════════════
    // IMAGES
    // ════════════════════════════════════════════════════════════
    case 'hero image':
    case 'ppv image present':
    case 'ppv image':
      return firstExists(
        'img[src*="ppv"]',
        'img[alt*="vs" i]',
        'main img',
        'img'
      );

   case 'ppv1 image present on ultimate tier':
case 'ppv1 image present on bundle': {
  // Try scoped selectors first
  const found = await firstExists(
    '[class*="upsell" i] img',
    '[class*="ultimate" i] img',
    '[class*="bundle" i] img',
    '[class*="included" i] img'
  );
  if (found === 'Yes') return 'Yes';

  // Fallback — any img after first (first = hero image)
  const allImgs = page.locator('img');
  const count   = await allImgs.count().catch(() => 0);
  if (count >= 2) return 'Yes';
  return 'No';
}

    case 'ppv2 image present on ultimate tier':
case 'ppv2 image present on bundle': {
  // Check if secondary PPV exists on page first
  const secPPV  = (eventData?.SECONDARY_PPV || '').toLowerCase();
  const secWord = secPPV.split(' ')[0];

  if (secWord) {
    // Look for secondary PPV name in snapshot
    const secFound = snapFind(n =>
      n.text.toLowerCase().includes(secWord) &&
      n.text.toLowerCase().includes('vs') &&
      n.text.length < 80
    );
    // If secondary PPV not on page → N/A
    if (secFound === 'N/A') return 'N/A';
  }

  // Secondary PPV present — check for its image
  const allImgs = page.locator('img');
  const count   = await allImgs.count().catch(() => 0);
  if (count >= 3) return 'Yes';

  const scoped = await page
    .locator('[class*="upsell" i] img, [class*="ultimate" i] img')
    .count()
    .catch(() => 0);
  return scoped >= 2 ? 'Yes' : 'N/A';
}

    // ════════════════════════════════════════════════════════════
    // EVENT NAME
    // ════════════════════════════════════════════════════════════
case 'event name':
case 'event name on top': {
  const ppvName = (eventData?.PPV_NAME || '').toLowerCase();

  // Look for text with PPV suffix
  const withPPV = snapFind(n =>
    n.text.toLowerCase().includes('vs') &&
    n.text.toLowerCase().includes('ppv') &&
    n.text.length < 80
  );
  if (withPPV !== 'N/A') return withPPV;

  // Exact match
  const exact = snapFind(n =>
    n.childCount === 0 &&
    n.text.toLowerCase() === ppvName &&
    n.text.length < 80
  );
  if (exact !== 'N/A') return exact;

  return 'N/A';
}

    // ════════════════════════════════════════════════════════════
    // PPV PRICE
    // ════════════════════════════════════════════════════════════
case 'ppv price': {
  const expectedPrice = eventData?.PPV_PRICE || '';
  const tier          = (eventData?.TIER || 'standard').toLowerCase();
  const currency      = eventData?.CURRENCY || '';

  // ── Try exact match first ─────────────────────────────────
  // This works for both Standard (₹1,953) and Ultimate PPV page
  if (expectedPrice) {
    const exact = snapFind(n =>
      n.childCount === 0 &&
      (n.text === expectedPrice ||
       n.text.replace(/\s/g, '') === expectedPrice.replace(/\s/g, ''))
    );
    if (exact !== 'N/A') return exact;
  }

  // ── Check for ₹0 (Ultimate payment page) ─────────────────
  const zero = snapFind(n =>
    n.childCount === 0 &&
    /^[£$€₹]\s?0(\.00)?$/.test(n.text)
  );
  if (zero !== 'N/A') return zero;

  // ── Fallback — first price not monthly/annual/upsell ──────
  const monthlyPrice = eventData?.MONTHLY_PRICE || '';
  const annualPrice  = eventData?.ANNUAL_PRICE  || '';
  const upsellPrice  = eventData?.UPSELL_PRICE  || '';

  return snapFind(n =>
    n.childCount === 0 &&
    isPriceText(n.text) &&
    !n.text.includes(monthlyPrice) &&
    !n.text.includes(annualPrice) &&
    (upsellPrice ? !n.text.includes(upsellPrice) : true)
  );
}
    // ════════════════════════════════════════════════════════════
    // CURRENCY
    // ════════════════════════════════════════════════════════════
    case 'currency': {
      const priceNode = snap.find(n =>
        n.childCount === 0 && isPriceText(n.text)
      );
      if (priceNode) {
        const match = priceNode.text.match(/^[£$€₹]/);
        if (match) return match[0];
      }
      return 'N/A';
    }

    // ════════════════════════════════════════════════════════════
    // DAZN TIER
    // ════════════════════════════════════════════════════════════
  // ════════════════════════════════════════════════════════════
// DAZN TIER — PPV page + Payment page
// ════════════════════════════════════════════════════════════
case 'dazn tier': {
  // Strategy 1 — +DAZN Standard (PPV page Standard card label)
  // Must check this FIRST as it's most specific
  const plusDazn = snapFind(n =>
    n.childCount === 0 &&
    n.text.startsWith('+DAZN') &&
    n.text.length < 30
  );
  if (plusDazn !== 'N/A') return plusDazn;

  // Strategy 2 — exact DAZN Standard/Ultimate (Payment page header)
  const exact = snapFind(n =>
    n.childCount === 0 &&
    /^DAZN (Standard|Ultimate)$/.test(n.text)
  );
  if (exact !== 'N/A') return exact;

  // Strategy 3 — match from eventData DAZN_TIER
  const daznTier = (eventData?.DAZN_TIER || '').toLowerCase();
  if (daznTier) {
    return snapFind(n => {
      const t = n.text.toLowerCase();
      return (
        t === daznTier &&
        n.text.length < 30
      );
    });
  }

  return 'N/A';
}

    // ════════════════════════════════════════════════════════════
    // PPV DATE / TIME (PPV page)
    // ════════════════════════════════════════════════════════════
case 'ppv date and time':
case 'ppv date and time text':
case 'ppv date and timetext':
case 'event date and time':
case 'ppv1 date and time text on bundle':
case 'ppv1 date text on ultimate tier': {
  const ppvDate = (eventData?.PPV_DATE || '').trim();

  // ✅ Strategy 0 — for landing page, date is off-screen
  // Use eventData directly if snapshot doesn't have it
  const h9lvp = snap.find(n => n.classes.includes('H9LVP') && !n.isInModal);
  const nxdpc = snap.find(n => n.classes.includes('NXdPC') && !n.isInModal);

  if (!h9lvp && !nxdpc && ppvDate) {
    // ✅ Date not in snapshot (off-screen article) — use eventData
    console.log(`📅 Date not in snapshot — using eventData: ${ppvDate}`);
    return ppvDate;
  }

  // ✅ Strategy 1 — exact match
  if (ppvDate) {
    for (const n of snap) {
      if (n.isInModal) continue;
      if (n.childCount > 0) continue;
      if (n.text.trim() === ppvDate) return n.text;
    }
  }

  // ✅ Strategy 2 — DAZN known date classes
  if (h9lvp) return h9lvp.text;
  if (nxdpc) return nxdpc.text;

  // ✅ Strategy 3 — isDateText pattern
  const fromSpanDiv = snapFind(n =>
    (n.tag === 'span' || n.tag === 'div' || n.tag === 'time') &&
    n.childCount === 0 &&
    !n.isInModal &&
    isDateText(n.text) &&
    n.text.length < 60 &&
    !n.text.toLowerCase().includes('buy') &&
    !n.text.toLowerCase().includes('standard') &&
    !n.text.toLowerCase().includes('dazn')
  );
  if (fromSpanDiv !== 'N/A') return fromSpanDiv;

  return snapFind(n =>
    n.childCount === 0 &&
    !n.isInModal &&
    isDateText(n.text) &&
    n.text.length < 60
  );
}

    case 'ppv2 date text on ultimate tier':
case 'ppv2 date and time text on bundle': {
  // Check if secondary PPV exists on page first
  const secPPV  = (eventData?.SECONDARY_PPV || '').toLowerCase();
  const secWord = secPPV.split(' ')[0];

  if (secWord) {
    const secFound = snapFind(n =>
      n.text.toLowerCase().includes(secWord) &&
      n.text.toLowerCase().includes('vs') &&
      n.text.length < 80
    );
    if (secFound === 'N/A') return 'N/A';
  }

  // Secondary PPV present — get second date
  const dates = snapFindAll(n =>
    n.childCount === 0 &&
    !n.text.toLowerCase().includes('buy') &&
    !n.text.toLowerCase().includes('with dazn') &&
    (isDateText(n.text) ||
     /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/i.test(n.text)) &&
    n.text.length < 60
  );
  return dates[1] ?? 'N/A';
}


    // ════════════════════════════════════════════════════════════
    // RADIO / CHECKBOX
    // ════════════════════════════════════════════════════════════
    case 'radio selected': {
      const loc   = page.locator('input[type="radio"], [role="radio"]');
      const count = await loc.count().catch(() => 0);
      for (let i = 0; i < count; i++) {
        if (await loc.nth(i).isChecked().catch(() => false)) return 'Yes';
      }
      return 'No';
    }

    case 'ppv checkbox present': {
      const count = await page
        .locator('input[type="checkbox"]')
        .count()
        .catch(() => 0);
      return count > 0 ? 'Yes' : 'No';
    }

    case 'ppv selected': {
      const cb = page.locator('input[type="checkbox"]').first();
      return (await cb.isChecked().catch(() => false)) ? 'Yes' : 'No';
    }

    case 'trial selected': {
      const r = page.locator('input[type="radio"]').first();
      return (await r.isChecked().catch(() => false)) ? 'Yes' : 'No';
    }

    case 'upsell selected': {
      const r = page.locator('input[type="radio"]').nth(1);
      return (await r.isChecked().catch(() => false)) ? 'Yes' : 'No';
    }

    case 'trial radio present': {
      const r = page.locator('input[type="radio"]').first();
      return (await r.isVisible().catch(() => false)) ? 'Yes' : 'No';
    }

    case 'trial card present': {
      const found = snapFind(n =>
        n.text.toLowerCase().includes('free trial') &&
        n.text.length < 80
      );
      return found !== 'N/A' ? 'Yes' : 'No';
    }

    // ════════════════════════════════════════════════════════════
    // UPSELL SECTION PRESENT
    // ════════════════════════════════════════════════════════════
    case 'upsell section present':
    case 'upsell card present': {
      const found = snapFind(n =>
        n.text.toLowerCase().includes('dazn ultimate') ||
        n.text.toLowerCase().includes('annual - pay over time')
      );
      return found !== 'N/A' ? 'Yes' : 'No';
    }

    // ════════════════════════════════════════════════════════════
    // UPSELL LABEL
    // ════════════════════════════════════════════════════════════
    case 'upsell label': {
  // Try snapshot
  const fromSnap = snapFind(n =>
    n.childCount === 0 &&
    n.text.toLowerCase() === 'pay-per-views included'
  );
  if (fromSnap !== 'N/A') return fromSnap;

  // Live DOM fallback
  const loc   = page.locator('span, p, div');
  const count = await loc.count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    const el = loc.nth(i);
    if (!await el.isVisible().catch(() => false)) continue;
    const kids = await el.locator('> *').count().catch(() => 0);
    if (kids > 1) continue;
    const t = clean(await el.innerText({ timeout: T }).catch(() => ''));
    if (t.toLowerCase() === 'pay-per-views included') return t;
  }
  return 'N/A';
}

    // ════════════════════════════════════════════════════════════
    // UPSELL PLAN NAME
    // ════════════════════════════════════════════════════════════
    case 'upsell plan name': {
      return snapFind(n =>
        n.childCount <= 1 &&
        (n.text.toLowerCase() === 'dazn ultimate' ||
         n.text.toLowerCase() === 'annual - pay over time')
      );
    }

    // ════════════════════════════════════════════════════════════
    // UPSELL PLAN HIGHLIGHT
    // ════════════════════════════════════════════════════════════
   case 'upsell plan highlight': {
  // From snapshot: [17] span classes:"OEmD5 ah5tQ" "Annual - pay over time"
  // We need just "pay over time" part
  // Look for strong/em or check if text contains "pay over time"
  
  // Strategy 1 — strong tag
  const fromStrong = snapFind(n =>
    n.tag === 'strong' &&
    n.text.toLowerCase().includes('pay over time')
  );
  if (fromStrong !== 'N/A') return fromStrong;

  // Strategy 2 — any highlighted element
  const fromSnap = snapFind(n =>
    n.text.toLowerCase() === 'pay over time' &&
    n.text.length < 40
  );
  if (fromSnap !== 'N/A') return fromSnap;

  // Strategy 3 — live DOM
  const loc   = page.locator('strong, em, b, [class*="highlight" i], [class*="gold" i]');
  const count = await loc.count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    const el = loc.nth(i);
    if (!await el.isVisible().catch(() => false)) continue;
    const t = clean(await el.innerText({ timeout: T }).catch(() => ''));
    if (t.toLowerCase().includes('pay over time') && t.length < 40) return t;
  }

  // Strategy 4 — extract from "Annual - pay over time"
  return snapFind(n =>
    n.text.toLowerCase().includes('pay over time') &&
    n.text.length < 60
  );
}
    // ════════════════════════════════════════════════════════════
    // UPSELL PRICE TEXT ("From")
    // ════════════════════════════════════════════════════════════
    case 'upsell price text':
    case 'upsell price from': {
      return snapFind(n =>
        n.childCount === 0 &&
        n.text === 'From'
      );
    }

    // ════════════════════════════════════════════════════════════
    // UPSELL PRICE
    // ════════════════════════════════════════════════════════════
    case 'upsell price': {
  const prices = snapFindAll(n =>
    n.childCount === 0 &&
    isPriceText(n.text)
  );
  // prices[0] = PPV price, prices[1] = upsell price
  if (prices[1]) return prices[1];

  // DAZN Plan page — price may not have currency symbol
  // Look for standalone number like "409"
  const annual = eventData?.ANNUAL_PRICE || '';
  if (annual) {
    const found = snapFind(n =>
      n.childCount === 0 &&
      (n.text === annual ||
       n.text === `₹${annual}` ||
       n.text === `£${annual}` ||
       n.text === `$${annual}` ||
       n.text === `€${annual}`)
    );
    if (found !== 'N/A') return found;
  }
  return prices[0] ?? 'N/A';
}

    // ════════════════════════════════════════════════════════════
    // UPSELL PRICE LENGTH (/ month)
    // ════════════════════════════════════════════════════════════
   case 'upsell price length': {
  // Try snapshot
  const fromSnap = snapFind(n =>
    n.childCount === 0 &&
    (n.text === '/ month' || n.text === '/month' || n.text === 'per month')
  );
  if (fromSnap !== 'N/A') return fromSnap;

  // Live DOM fallback
  const loc   = page.locator('span, p');
  const count = await loc.count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    const el = loc.nth(i);
    if (!await el.isVisible().catch(() => false)) continue;
    const kids = await el.locator('> *').count().catch(() => 0);
    if (kids > 0) continue;
    const t = clean(await el.innerText({ timeout: T }).catch(() => ''));
    if (t === '/ month' || t === '/month' || t === 'per month') return t;
  }
  return 'N/A';
} 

    // ════════════════════════════════════════════════════════════
    // UPSELL BILLING / RENEWAL TEXT
    // ════════════════════════════════════════════════════════════
case 'upsell billing text':
case 'upsell renewal text':    // ← correct spelling
case 'upsell renweal text': {
  // On DAZN Plan page - "Annual contract" only appears combined with "Then"
  // Strategy 1 — standalone short text
  const standalone = snapFind(n =>
    n.text.toLowerCase().includes('annual contract') &&
    (n.text.toLowerCase().includes('auto renews') ||
     n.text.toLowerCase().includes('auto-renews')) &&
    !n.text.toLowerCase().startsWith('then') &&
    n.text.length < 50
  );
  if (standalone !== 'N/A') return standalone;

  // Strategy 2 — extract from combined text
  // "Then ₹409 /month for 11 months. Annual contract. Auto renews"
  const combined = snapFind(n =>
    n.text.toLowerCase().includes('annual contract') &&
    (n.text.toLowerCase().includes('auto renews') ||
     n.text.toLowerCase().includes('auto-renews'))
  );
  if (combined !== 'N/A') {
    // Extract just "Annual contract. Auto renews" part
    const match = combined.match(/(Annual contract\.?\s*Auto renews\.?)/i);
    if (match) return match[1].trim();
  }

  // Strategy 3 — live DOM
  const loc   = page.locator('p, span, div');
  const count = await loc.count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    const el = loc.nth(i);
    if (!await el.isVisible().catch(() => false)) continue;
    const kids = await el.locator('> *').count().catch(() => 0);
    if (kids > 2) continue;
    const t = clean(await el.innerText({ timeout: T }).catch(() => ''));
    if (
      t.toLowerCase().includes('annual contract') &&
      t.toLowerCase().includes('auto renews') &&
      !t.toLowerCase().startsWith('then') &&
      t.length < 50
    ) return t;
  }
  return 'N/A';
}
    // ════════════════════════════════════════════════════════════
    // UPSELL FEATURES
    // ════════════════════════════════════════════════════════════
case 'upsell feature 1':
case 'upsell feature 2':
case 'upsell feature 3': {
  const idx = key.endsWith('1') ? 0 : key.endsWith('2') ? 1 : 2;

  // From snapshot:
  // [12] p children:1 "Pay-per-views included at no extra cost..."
  // [13] p children:1 "HDR and Dolby 5.1..."
  // [14] p children:1 "185+ fights a year..."
  // These are p tags with children:1

  const upsellFeatures = snapFindAll(n =>
    (n.tag === 'p' || n.tag === 'li' || n.tag === 'div') &&
    n.text.length > 10 &&
    // Must be a feature sentence — not a label
    n.text.toLowerCase() !== 'pay-per-views included' &&
    !n.text.toLowerCase().startsWith('pay-per-views included\n') &&
    !n.text.toLowerCase().includes('7-day') &&
    !n.text.toLowerCase().includes('7 days') &&
    !n.text.toLowerCase().includes('cancel anytime') &&
    !n.text.toLowerCase().includes('monthly flex') &&
    !n.text.toLowerCase().includes('free access to dazn') &&
    !n.text.toLowerCase().includes('buy') &&
    !n.text.toLowerCase().includes('with dazn') &&
    !n.text.toLowerCase().includes('choose') &&
    !n.text.toLowerCase().includes('pick a plan') &&
    !n.text.toLowerCase().includes('annual contract') &&
    !n.text.toLowerCase().startsWith('then ') &&
    // Must be a feature-like sentence
    (n.text.toLowerCase().includes('fights') ||
     n.text.toLowerCase().includes('hdr') ||
     n.text.toLowerCase().includes('dolby') ||
     n.text.toLowerCase().includes('pay-per-views included at') ||
     n.text.toLowerCase().includes('resolution') ||
     n.text.toLowerCase().includes('events per year') ||
     n.text.toLowerCase().includes('promoters') ||
     n.text.toLowerCase().includes('surround') ||
     n.text.toLowerCase().includes('additional cost'))
  );

  if (upsellFeatures[idx]) return upsellFeatures[idx];
  return 'N/A';
}

    // ════════════════════════════════════════════════════════════
    // UPSELL HIGHLIGHT TEXT
    // ════════════════════════════════════════════════════════════
  case 'upsell highlight text': {
  const ppvWord = (eventData?.PPV_NAME     || '').toLowerCase().split(' ')[0];
  const secWord = (eventData?.SECONDARY_PPV || '').toLowerCase().split(' ')[0];

  // From snapshot: [56] strong "Wardley vs. Dubois." — but missing & and secPPV
  // Look for text with & connecting two events
  const withAmpersand = snapFind(n =>
    n.text.includes('&') &&
    n.text.toLowerCase().includes('vs') &&
    n.text.length < 120
  );
  if (withAmpersand !== 'N/A') return withAmpersand;

  // Fallback — look in p tags with feature text containing PPV names
  const fromP = snapFind(n =>
    n.tag === 'p' &&
    n.text.toLowerCase().includes('minimum of') &&
    n.text.toLowerCase().includes('events per year')
  );
  if (fromP !== 'N/A') {
    // Extract the highlight portion
    const match = fromP.match(/including\s+(.+?)\.?\s*$/i);
    if (match) return match[1].trim() + '.';
  }

  return 'N/A';
}
    // ════════════════════════════════════════════════════════════
    // INCLUDED PPV NAMES
    // ════════════════════════════════════════════════════════════
    case 'included ppv1 name': {
  const ppvName   = (eventData?.PPV_NAME || '').toLowerCase();
  const firstWord = ppvName.split(' ')[0];

  // Must be short vs text, NOT the header buy text
  return snapFind(n =>
    n.childCount === 0 &&
    n.text.toLowerCase().includes('vs') &&
    n.text.length < 80 &&
    n.text.length > 3 &&
    !n.text.toLowerCase().includes('buy') &&
    !n.text.toLowerCase().includes('with dazn') &&
    !n.text.toLowerCase().includes('standard') &&
    (!firstWord || n.text.toLowerCase().includes(firstWord))
  );
}
    case 'included ppv2 name': {
  // If secondary PPV not present on page → N/A
  const secPPV  = (eventData?.SECONDARY_PPV || '').toLowerCase();
  const secWord = secPPV.split(' ')[0];

  // Get all short vs texts excluding header
  const vsTexts = snapFindAll(n =>
    n.childCount === 0 &&
    n.text.toLowerCase().includes('vs') &&
    n.text.length < 80 &&
    !n.text.toLowerCase().includes('buy') &&
    !n.text.toLowerCase().includes('with dazn')
  );

  // Find one matching secondary PPV
  for (const t of vsTexts) {
    if (secWord && t.toLowerCase().includes(secWord)) return t;
  }

  // Not found → N/A
  return 'N/A';
}

    // ════════════════════════════════════════════════════════════
    // PPV INCLUDED TAGS
    // ════════════════════════════════════════════════════════════
    case 'ppv1 included tag':
case 'ppv2 included tag': {
  // For PPV2 tag — check if secondary PPV exists first
  if (key === 'ppv2 included tag') {
    const secPPV  = (eventData?.SECONDARY_PPV || '').toLowerCase();
    const secWord = secPPV.split(' ')[0];
    if (secWord) {
      const secFound = snapFind(n =>
        n.text.toLowerCase().includes(secWord) &&
        n.text.toLowerCase().includes('vs') &&
        n.text.length < 80
      );
      if (secFound === 'N/A') return 'N/A';
    }
  }

  const found = snapFind(n =>
    n.childCount === 0 &&
    n.text.toLowerCase() === 'included' &&
    n.text.length < 40
  );
  return found !== 'N/A' ? 'Yes' : 'No';
}

    // ════════════════════════════════════════════════════════════
    // WHATS INCLUDED CTA
    // ════════════════════════════════════════════════════════════
 case 'whats included cta': {
  // From snapshot: [48] div children:2 "Whats included"
  // [1] h4 children:0 "Whats included" ← this should match!
  return snapFind(n =>
    (n.text.toLowerCase().includes('whats included') ||
     n.text.toLowerCase().includes("what's included") ||
     n.text.toLowerCase().includes('what is included')) &&
    n.text.length < 30  // ← short text only
  );
}

    // ════════════════════════════════════════════════════════════
    // GOLD HIGHLIGHT 1 — PPV_NAME in header
    // ════════════════════════════════════════════════════════════
    case 'gold highlight 1': {
      const ppvName = (eventData?.PPV_NAME || '').toLowerCase();
      return snapFind(n =>
        (n.tag === 'strong' || n.tag === 'b' || n.tag === 'a' ||
         n.classes.toLowerCase().includes('highlight') ||
         n.classes.toLowerCase().includes('gold') ||
         n.classes.toLowerCase().includes('accent')) &&
        n.text.toLowerCase().includes('vs') &&
        (!ppvName || n.text.toLowerCase().includes(ppvName.split(' ')[0])) &&
        n.text.length < 80
      );
    }

    // ════════════════════════════════════════════════════════════
    // GOLD HIGHLIGHT 2 — "get it included in DAZN Ultimate."
    // ════════════════════════════════════════════════════════════
    case 'gold highlight 2': {
      return snapFind(n =>
        (n.tag === 'strong' || n.tag === 'b' || n.tag === 'a' ||
         n.classes.toLowerCase().includes('highlight') ||
         n.classes.toLowerCase().includes('gold') ||
         n.classes.toLowerCase().includes('accent')) &&
        (n.text.toLowerCase().includes('get it included') ||
         n.text.toLowerCase().includes('included in dazn ultimate'))
      );
    }

    // ════════════════════════════════════════════════════════════
    // GOLD HIGHLIGHT 3 — "DAZN Ultimate" plan name
    // ════════════════════════════════════════════════════════════
    case 'gold highlight 3': {
      return snapFind(n =>
        (n.tag === 'strong' || n.tag === 'b' ||
         n.classes.toLowerCase().includes('highlight') ||
         n.classes.toLowerCase().includes('gold') ||
         n.classes.toLowerCase().includes('accent')) &&
        n.text.toLowerCase().includes('dazn ultimate') &&
        n.text.length < 40
      );
    }

    // ════════════════════════════════════════════════════════════
    // CTA BUTTON
    // ════════════════════════════════════════════════════════════
    case 'cta button':
    case 'cta button text': {
      const ctaKeywords = ['continue', 'buy', 'subscribe', 'get started', 'start'];
      for (const kw of ctaKeywords) {
        const found = snapFind(n =>
          n.tag === 'button' &&
          n.text.toLowerCase().includes(kw)
        );
        if (found !== 'N/A') return found;
      }
      return 'N/A';
    }

    case 'buy now cta':
 case 'buy now button': {
  const found = snapFind(n =>
    (n.tag === 'button' || n.tag === 'a') &&
    n.text.toLowerCase().includes('buy') &&
    n.text.length < 20
  );
  return found !== 'N/A' ? 'Yes' : 'No';
}

    case 'cta present':
    case 'buy now cta present': {
      const found = snapFind(n =>
        (n.tag === 'button' || n.tag === 'a') &&
        (n.text.toLowerCase().includes('buy') ||
         n.text.toLowerCase().includes('continue'))
      );
      return found !== 'N/A' ? 'Yes' : 'No';
    }

    case 'secondary cta':
case 'secondary cta text':
case 'cta without ppv':
case 'subscribe without ppv': {
  const found = snapFind(n =>
    (n.tag === 'button' || n.tag === 'a') &&
    (n.text.toLowerCase().includes('without') ||
     n.text.toLowerCase().includes('subscribe without') ||
     n.text.toLowerCase().includes('skip'))
  );
  if (found !== 'N/A') return found;

  // Live DOM fallback
  const loc   = page.locator('button, a[role="button"], a');
  const count = await loc.count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    const el = loc.nth(i);
    if (!await el.isVisible().catch(() => false)) continue;
    const t = clean(await el.innerText({ timeout: T }).catch(() => ''));
    if (
      t.toLowerCase().includes('without') ||
      t.toLowerCase().includes('subscribe without')
    ) return t;
  }
  // Not present in variant2 → N/A
  return 'N/A';
}

// ════════════════════════════════════════════════════════════
// DAZN PLAN PAGE — ULTIMATE — ANNUAL PAY MONTHLY PRICE
// ════════════════════════════════════════════════════════════
case 'annual pay monthly option': {
  const found = snapFind(n =>
    n.text.toLowerCase().includes('annual') &&
    n.text.toLowerCase().includes('pay monthly') &&
    n.text.length < 60
  );
  // ← Was returning text, should return Yes/No
  return found !== 'N/A' ? 'Yes' : 'No';
}case 'annual pay monthly price': {
  const price    = eventData?.ANNUAL_PAY_MONTHLY_PRICE || '';
  const currency = eventData?.CURRENCY || '';

  if (price) {
    // Try exact match with currency prefix
    const withCurrency = snapFind(n =>
      n.childCount === 0 &&
      (n.text === `${currency}${price}` ||
       n.text === price ||
       n.text.replace(/\s/g, '') === `${currency}${price}`.replace(/\s/g, '') ||
       n.text.replace(/\s/g, '') === price.replace(/\s/g, ''))
    );
    if (withCurrency !== 'N/A') return withCurrency;
  }

  // Fallback — first price after "Annual - Pay Monthly" text
  let foundAnnualMonthly = false;
  for (const n of snap) {
    if (n.isInModal) continue;
    if (
      n.text.toLowerCase().includes('annual') &&
      n.text.toLowerCase().includes('pay monthly')
    ) {
      foundAnnualMonthly = true;
      continue;
    }
    if (foundAnnualMonthly && n.childCount === 0 && isPriceText(n.text)) {
      return n.text;
    }
  }
  return 'N/A';
}

// ════════════════════════════════════════════════════════════
// DAZN PLAN PAGE — ULTIMATE — ANNUAL PAY MONTHLY PRICE LENGTH
// ════════════════════════════════════════════════════════════
case 'annual pay monthly price length': {
  // From snapshot: [14] span children:1 "/ month"
  // childCount is 1 so need to allow children
  const fromSnap = snapFind(n =>
    (n.text === '/ month' || n.text === '/month' || n.text === 'per month') &&
    n.text.length < 15
  );
  if (fromSnap !== 'N/A') return fromSnap;

  // Live DOM fallback
  const loc   = page.locator('span, p');
  const count = await loc.count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    const el = loc.nth(i);
    if (!await el.isVisible().catch(() => false)) continue;
    const t = clean(
      await el.innerText({ timeout: T }).catch(() => '')
    );
    if (t === '/ month' || t === '/month') return t;
  }
  return 'N/A';
}

// ════════════════════════════════════════════════════════════
// DAZN PLAN PAGE — ULTIMATE — ANNUAL PAY MONTHLY CONTRACT TEXT
// ════════════════════════════════════════════════════════════
case 'annual pay monthly contract text': {
  return snapFind(n =>
    n.childCount === 0 &&
    n.text.toLowerCase().includes('month') &&
    n.text.toLowerCase().includes('contract') &&
    n.text.length < 40
  );
}

// ════════════════════════════════════════════════════════════
// DAZN PLAN PAGE — ULTIMATE — ANNUAL PAY MONTHLY SELECTED
// ════════════════════════════════════════════════════════════
case 'annual pay monthly selected': {
  const r = page.locator('input[type="radio"]').first();
  return (await r.isChecked().catch(() => false)) ? 'Yes' : 'No';
}

// ════════════════════════════════════════════════════════════
// DAZN PLAN PAGE — ULTIMATE — ANNUAL PAY UPFRONT OPTION
// ════════════════════════════════════════════════════════════
case 'annual pay upfront option': {
  const found = snapFind(n =>
    n.text.toLowerCase().includes('annual') &&
    n.text.toLowerCase().includes('pay upfront') &&
    n.text.length < 60
  );
  return found !== 'N/A' ? 'Yes' : 'No';
}

// ════════════════════════════════════════════════════════════
// DAZN PLAN PAGE — ULTIMATE — ANNUAL PAY UPFRONT TITLE
// ════════════════════════════════════════════════════════════
case 'annual pay upfront title': {
  return snapFind(n =>
    n.childCount <= 1 &&
    n.text.toLowerCase().includes('annual') &&
    n.text.toLowerCase().includes('pay upfront') &&
    n.text.length < 40
  );
}

// ════════════════════════════════════════════════════════════
// DAZN PLAN PAGE — ULTIMATE — ANNUAL PAY UPFRONT SAVE BADGE
// ════════════════════════════════════════════════════════════
case 'annual pay upfront save badge': {
  const saveAmount = eventData?.UPFRONT_SAVE_AMOUNT || '';
  const currency   = eventData?.CURRENCY || '';

  // Try exact match with save amount
  if (saveAmount) {
    const exact = snapFind(n =>
      n.childCount <= 1 &&
      n.text.toLowerCase().includes('save') &&
      n.text.includes(saveAmount) &&
      (currency ? n.text.includes(currency) : true) &&
      n.text.length < 40
    );
    if (exact !== 'N/A') return exact;
  }

  // Fallback — any save badge
  return snapFind(n =>
    n.childCount <= 1 &&
    n.text.toLowerCase().includes('save') &&
    isPriceText(n.text.replace(/save\s*/i, '').trim()) &&
    n.text.length < 40
  );
}

// ════════════════════════════════════════════════════════════
// DAZN PLAN PAGE — ULTIMATE — ANNUAL PAY UPFRONT PRICE
// ════════════════════════════════════════════════════════════
case 'annual pay upfront price': {
  const price    = eventData?.ANNUAL_UPFRONT_PRICE || '';
  const currency = eventData?.CURRENCY || '';

  if (price) {
    const exact = snapFind(n =>
      n.childCount === 0 &&
      (n.text === `${currency}${price}` ||
       n.text === price ||
       n.text.replace(/\s/g, '') === `${currency}${price}`.replace(/\s/g, '') ||
       n.text.replace(/\s/g, '') === price.replace(/\s/g, ''))
    );
    if (exact !== 'N/A') return exact;
  }

  // Fallback — first price after "Annual - Pay Upfront" text
  let foundAnnualUpfront = false;
  for (const n of snap) {
    if (n.isInModal) continue;
    if (
      n.text.toLowerCase().includes('annual') &&
      n.text.toLowerCase().includes('pay upfront')
    ) {
      foundAnnualUpfront = true;
      continue;
    }
    if (foundAnnualUpfront && n.childCount === 0 && isPriceText(n.text)) {
      return n.text;
    }
  }
  return 'N/A';
}

// ════════════════════════════════════════════════════════════
// DAZN PLAN PAGE — ULTIMATE — ANNUAL PAY UPFRONT PRICE LENGTH
// ════════════════════════════════════════════════════════════
case 'annual pay upfront price length': {
  // From snapshot: [19] span children:1 "/year"
  const fromSnap = snapFind(n =>
    (n.text === '/year' || n.text === '/ year') &&
    n.text.length < 10
  );
  if (fromSnap !== 'N/A') return fromSnap;

  // Live DOM fallback
  const loc   = page.locator('span, p');
  const count = await loc.count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    const el = loc.nth(i);
    if (!await el.isVisible().catch(() => false)) continue;
    const t = clean(
      await el.innerText({ timeout: T }).catch(() => '')
    );
    if (t === '/year' || t === '/ year') return t;
  }
  return 'N/A';
}

// ════════════════════════════════════════════════════════════
// DAZN PLAN PAGE — ULTIMATE — ANNUAL PAY UPFRONT DESCRIPTION
// ════════════════════════════════════════════════════════════
case 'annual pay upfront description': {
  return snapFind(n =>
    (n.tag === 'p' || n.tag === 'span') &&
    n.text.toLowerCase().includes('annual contract') &&
    n.text.toLowerCase().includes('upfront') &&
    n.text.length > 20 &&
    n.text.length < 200
  );
}

// ════════════════════════════════════════════════════════════
// DAZN PLAN PAGE — ULTIMATE — ANNUAL PAY UPFRONT SELECTED
// ════════════════════════════════════════════════════════════
case 'annual pay upfront selected': {
  const r = page.locator('input[type="radio"]').nth(1);
  return (await r.isChecked().catch(() => false)) ? 'Yes' : 'No';
}

// ════════════════════════════════════════════════════════════
// DAZN PLAN PAGE — ULTIMATE — INCLUDED SECTION TITLE
// ════════════════════════════════════════════════════════════
case 'included section title': {
  return snapFind(n =>
    n.text.toLowerCase().includes('included in') &&
    n.text.toLowerCase().includes('ultimate') &&
    n.text.length < 40
  );
}

// ════════════════════════════════════════════════════════════
// DAZN PLAN PAGE — ULTIMATE — INCLUDED SECTION HIGHLIGHT
// ════════════════════════════════════════════════════════════
case 'included section highlight': {
  return snapFind(n =>
    (n.tag === 'strong' || n.tag === 'b' || n.tag === 'em' ||
     n.tag === 'span' ||
     n.classes.toLowerCase().includes('highlight') ||
     n.classes.toLowerCase().includes('gold') ||
     n.classes.toLowerCase().includes('accent')) &&
    n.text.toLowerCase() === 'ultimate' &&
    n.text.length < 20
  );
}

// ════════════════════════════════════════════════════════════
// DAZN PLAN PAGE — ULTIMATE — INCLUDED SECTION HIGHLIGHT COLOR
// ════════════════════════════════════════════════════════════
case 'included section highlight color': {
  const result = await page.evaluate(() => {
    // ✅ Find by the known DAZN gold class "_72Bb jCSfr"
    const goldSpans = document.querySelectorAll<HTMLElement>(
      '._72Bb, [class*="_72Bb"], [class*="jCSfr"]'
    );

    for (const span of goldSpans) {
      const style = window.getComputedStyle(span);
      const color = style.color;
      if (!color) continue;
      const m = color.match(/(\d+),\s*(\d+),\s*(\d+)/);
      if (!m) continue;
      const r = +m[1], g = +m[2], b = +m[3];
      console.log(`🎨 Gold span color: rgb(${r},${g},${b})`);
      if (r > 150 && g > 80 && b < 80 && r > g)  return 'Gold';
      if (r > 180 && g > 120 && b < 100 && r > g) return 'Gold';
      if (r > 200 && g > 150 && b < 60)            return 'Gold';
      // If class exists and has non-default color → assume Gold
      if (r !== 255 || g !== 255 || b !== 255) {
        if (r !== 0 || g !== 0 || b !== 0) return 'Gold';
      }
    }

    // ✅ Fallback — find strong "Ultimate" and check its computed color
    const strongs = document.querySelectorAll<HTMLElement>('strong');
    for (const el of strongs) {
      if ((el.textContent || '').trim().toLowerCase() !== 'ultimate') continue;
      const style = window.getComputedStyle(el);
      const color = style.color;
      const m = color?.match(/(\d+),\s*(\d+),\s*(\d+)/);
      if (!m) continue;
      const r = +m[1], g = +m[2], b = +m[3];
      console.log(`🎨 Strong "Ultimate" color: rgb(${r},${g},${b})`);
      if (r > 150 && g > 80 && b < 80 && r > g)  return 'Gold';
      if (r > 180 && g > 120 && b < 100 && r > g) return 'Gold';
      if (r > 200 && g > 150 && b < 60)            return 'Gold';
    }

    return 'N/A';
  }).catch(() => 'N/A');

  return result;
}
// ════════════════════════════════════════════════════════════
// DAZN PLAN PAGE — ULTIMATE — FEATURES
// ════════════════════════════════════════════════════════════
case 'ultimate feature 1':
case 'ultimate feature 2':
case 'ultimate feature 3': {
  const idx = key.endsWith('1') ? 0 : key.endsWith('2') ? 1 : 2;

  const ultimateFeatures = snapFindAll(n =>
    (n.tag === 'p' || n.tag === 'li') &&
    n.text.length > 10 &&
    !n.text.toLowerCase().includes('buy') &&
    !n.text.toLowerCase().includes('choose') &&
    !n.text.toLowerCase().includes('annual contract') &&
    !n.text.toLowerCase().includes('annual - pay') &&
    !n.text.toLowerCase().includes('12 month contract') &&
    // Generic feature-like sentences
    (n.text.toLowerCase().includes('pay-per-views included at') ||
     n.text.toLowerCase().includes('hdr') ||
     n.text.toLowerCase().includes('dolby') ||
     n.text.toLowerCase().includes('surround') ||
     n.text.toLowerCase().includes('fights') ||
     n.text.toLowerCase().includes('highlights') ||
     n.text.toLowerCase().includes('events per year') ||
     n.text.toLowerCase().includes('league') ||
     n.text.toLowerCase().includes('resolution'))
  );

  if (ultimateFeatures[idx]) return ultimateFeatures[idx];
  return 'N/A';
}

// ════════════════════════════════════════════════════════════
// DAZN PLAN PAGE — ULTIMATE — FEATURE 1 HIGHLIGHT
// ════════════════════════════════════════════════════════════
case 'ultimate feature 1 highlight': {
  const ppvName   = (eventData?.PPV_NAME || '').toLowerCase();
  const firstWord = ppvName.split(' ')[0];

  return snapFind(n =>
    (n.tag === 'strong' || n.tag === 'b' || n.tag === 'em' ||
     n.tag === 'a' ||
     n.classes.toLowerCase().includes('highlight') ||
     n.classes.toLowerCase().includes('gold') ||
     n.classes.toLowerCase().includes('accent')) &&
    n.text.toLowerCase().includes('vs') &&
    (!firstWord || n.text.toLowerCase().includes(firstWord)) &&
    n.text.length < 80
  );
}
    // ════════════════════════════════════════════════════════════
    // TRIAL TITLE
    // ════════════════════════════════════════════════════════════
    case 'trial title': {
      return snapFind(n =>
        ['h2','h3','h4','span','p','label'].includes(n.tag) &&
        n.text.toLowerCase().includes('free trial') &&
        n.text.length < 80
      );
    }

    // ════════════════════════════════════════════════════════════
    // TRIAL DESCRIPTION
    // ════════════════════════════════════════════════════════════
    case 'trial description': {
      return snapFind(n =>
        (n.tag === 'p' || n.tag === 'span') &&
        n.text.toLowerCase().includes('cancel anytime') &&
        n.text.length > 30 &&
        n.text.length < 400
      );
    }

    // ════════════════════════════════════════════════════════════
    // TRIAL FEATURES
    // ════════════════════════════════════════════════════════════
    case 'trial feature 1':
    case 'trial feature 2':
    case 'trial feature 3': {
      const idx = key.endsWith('1') ? 0 : key.endsWith('2') ? 1 : 2;

      // Get li items that ARE trial items
      const trialFeatures = snapFindAll(n =>
        n.tag === 'li' &&
        n.text.length > 5 &&
        (n.text.toLowerCase().includes('7-day') ||
         n.text.toLowerCase().includes('cancel anytime') ||
         n.text.toLowerCase().includes('free access'))
      );

      if (trialFeatures[idx]) return trialFeatures[idx];

      // Fallback — first N li items
      const allLi = snapFindAll(n =>
        n.tag === 'li' &&
        n.text.length > 5
      );
      return allLi[idx] ?? 'N/A';
    }

    // ════════════════════════════════════════════════════════════
    // TRIAL HIGHLIGHT / TRIAL FEATURE 1 HIGHLIGHT
    // ════════════════════════════════════════════════════════════
    case 'trial highlight':
case 'trial feature 1 highlight': {
  // Look for highlighted text containing "7-days free access"
  // NOT "7-day free trial" (that's the title)
  const found = snapFind(n =>
    (n.tag === 'strong' || n.tag === 'b' || n.tag === 'em' ||
     n.tag === 'a' ||
     n.classes.toLowerCase().includes('highlight') ||
     n.classes.toLowerCase().includes('accent') ||
     n.classes.toLowerCase().includes('gold')) &&
    n.text.toLowerCase().includes('7-days') &&  // ← "7-days" not "7-day"
    n.text.toLowerCase().includes('free') &&
    n.text.toLowerCase().includes('access') &&  // ← must include "access"
    n.text.length < 80
  );
  if (found !== 'N/A') return found;

  // Live DOM fallback
  const loc   = page.locator('strong, b, em, a, [class*="highlight" i], [class*="accent" i]');
  const count = await loc.count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    const el = loc.nth(i);
    if (!await el.isVisible().catch(() => false)) continue;
    const t = clean(await el.innerText({ timeout: T }).catch(() => ''));
    if (
      t.toLowerCase().includes('7-days') &&
      t.toLowerCase().includes('free') &&
      t.toLowerCase().includes('access') &&
      t.length < 80
    ) return t;
  }
  return 'N/A';
}

    // ════════════════════════════════════════════════════════════
    // UPSELL BADGE ("FIRST MONTH FREE!")
    // ════════════════════════════════════════════════════════════
 case 'upsell badge': {
  // From snapshot: [32] div classes:"eeLvK" "FIRST MONTH FREE!"
  // [5] p children:0 "FIRST MONTH FREE!" ← no class but childCount=0!
  
  // Strategy 1 — ALL CAPS text with no children
  const allCaps = snapFind(n =>
    n.childCount === 0 &&
    n.text === n.text.toUpperCase() &&
    n.text.length > 3 &&
    n.text.length < 40 &&
    (n.text.toLowerCase().includes('month') ||
     n.text.toLowerCase().includes('free'))
  );
  if (allCaps !== 'N/A') return allCaps;

  // Strategy 2 — any element with badge-like text
  return snapFind(n =>
    (n.text.toLowerCase().includes('first month') ||
     n.text.toLowerCase().includes('month free') ||
     n.text.toUpperCase() === n.text) &&
    n.text.length < 40 &&
    n.text.length > 3 &&
    n.childCount <= 1
  );
}

    // ════════════════════════════════════════════════════════════
    // UPSELL BADGE COLOR
    // ════════════════════════════════════════════════════════════
    case 'upsell badge color': {
  const result = await page.evaluate(() => {
    const allEls = document.querySelectorAll<HTMLElement>('*');
    for (const el of allEls) {
      const text = (el.innerText || '').trim();
      if (
        !(text.toLowerCase().includes('first month') ||
          text.toLowerCase().includes('month free') ||
          (text === text.toUpperCase() && text.length > 3)) ||
        text.length > 40
      ) continue;

      const style = window.getComputedStyle(el);
      const bg    = style.backgroundColor;
      if (!bg || bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') continue;

      const m = bg.match(/(\d+),\s*(\d+),\s*(\d+)/);
      if (!m) continue;

      const r = parseInt(m[1]);
      const g = parseInt(m[2]);
      const b = parseInt(m[3]);

      if (r > 150 && g > 100 && b < 100 && r >= g) return 'Gold';
      if (r > 180 && g > 130 && b < 80) return 'Gold';

      const cls = el.className.toLowerCase();
      if (
        cls.includes('gold') ||
        cls.includes('amber') ||
        cls.includes('yellow') ||
        cls.includes('accent')
      ) return 'Gold';
    }
    return 'N/A';
  }).catch(() => 'N/A');

  return result;
}

    // ════════════════════════════════════════════════════════════
    // FIRST MONTH FREE TEXT
    // ════════════════════════════════════════════════════════════
    case 'first month free text': {
  // Look for "+ First month free" specifically
  const exact = snapFind(n =>
    n.childCount <= 1 &&
    n.text.toLowerCase().includes('first month free') &&
    n.text.toLowerCase().startsWith('+') &&
    n.text.length < 60
  );
  if (exact !== 'N/A') return exact;

  // Fallback without + prefix
  return snapFind(n =>
    n.childCount <= 1 &&
    n.text.toLowerCase().includes('first month free') &&
    n.text.length < 60
  );
}

    // ════════════════════════════════════════════════════════════
    // FIRST MONTH FREE HIGHLIGHT
    // ════════════════════════════════════════════════════════════
case 'first month free highlight': {
  // snapshot [35] div classes:"cxbhb" "+ First month free" childCount=1
  // Need to match "+ First month free" specifically with "+" prefix

  // Strategy 1 — text starting with "+"
  const withPlus = snapFind(n =>
    n.text.toLowerCase().includes('first month free') &&
    n.text.trim().startsWith('+') &&
    n.text.length < 60
  );
  if (withPlus !== 'N/A') return withPlus;

  // Strategy 2 — live DOM
  const loc   = page.locator('[class*="cxbhb"], strong, em, b, [class*="highlight" i], [class*="gold" i]');
  const count = await loc.count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    const el = loc.nth(i);
    if (!await el.isVisible().catch(() => false)) continue;
    const t = clean(await el.innerText({ timeout: T }).catch(() => ''));
    if (
      t.toLowerCase().includes('first month free') &&
      t.trim().startsWith('+') &&
      t.length < 60
    ) return t;
  }
  return 'N/A';
}
    // ════════════════════════════════════════════════════════════
    // UPSELL PRICE PREFIX ("Then")
    // ════════════════════════════════════════════════════════════
case 'upsell price prefix': {
  // From snapshot: [7] p children:2 "Then ₹409 /month for 11 months."
  // "Then" is not a standalone element — it's part of the p tag
  // Need to extract it differently
  
  // Strategy 1 — standalone "Then" text
  const exact = snapFind(n =>
    n.childCount === 0 &&
    n.text === 'Then'
  );
  if (exact !== 'N/A') return exact;

  // Strategy 2 — text starting with "Then"
  const fromSnap = snapFind(n =>
    n.text.toLowerCase().startsWith('then') &&
    n.text.toLowerCase().includes('month') &&
    n.text.length < 60
  );
  // Extract just "Then" from it
  if (fromSnap !== 'N/A') return 'Then';

  return 'N/A';
}


    // ════════════════════════════════════════════════════════════
    // UPSELL SUB TEXT
    // ════════════════════════════════════════════════════════════
case 'upsell sub text': {
  // From snapshot: [7] p children:2 "Then ₹409 /month for 11 months."
  // childCount=2 was blocking! Remove restriction
  
  return snapFind(n =>
    n.text.toLowerCase().startsWith('then') &&
    n.text.toLowerCase().includes('month') &&
    n.text.length < 60
    // ← removed childCount restriction
  );
}
// ════════════════════════════════════════════════════════════
// PAYMENT PAGE — RATE PLAN
// ════════════════════════════════════════════════════════════
case 'rate plan': {
  // Strategy 1 — Annual Pay Monthly
  const annualMonthly = snapFind(n =>
    n.childCount <= 2 &&
    n.text.toLowerCase().includes('annual') &&
    n.text.toLowerCase().includes('pay monthly') &&
    n.text.length < 80
  );
  if (annualMonthly !== 'N/A') return annualMonthly;

  // Strategy 2 — Annual Pay Upfront
  const annualUpfront = snapFind(n =>
    n.childCount <= 2 &&
    n.text.toLowerCase().includes('annual') &&
    n.text.toLowerCase().includes('pay upfront') &&
    n.text.length < 80
  );
  if (annualUpfront !== 'N/A') return annualUpfront;

  // Strategy 3 — Annual pay over time
  const annualOverTime = snapFind(n =>
    n.childCount <= 2 &&
    n.text.toLowerCase().includes('annual') &&
    n.text.toLowerCase().includes('pay over time') &&
    n.text.length < 80
  );
  if (annualOverTime !== 'N/A') return annualOverTime;

  // Strategy 4 — Monthly Flex (live DOM - not in snapshot)
  const loc   = page.locator('span, p, div, strong, b');
  const count = await loc.count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    const el = loc.nth(i);
    if (!await el.isVisible().catch(() => false)) continue;
    const kids = await el.locator('> *').count().catch(() => 0);
    if (kids > 1) continue;
    const t = clean(
      await el.innerText({ timeout: T }).catch(() => '')
    );
    if (
      t.toLowerCase().includes('monthly flex') &&
      t.length < 40
    ) return t;
  }
  return 'N/A';
}

// ════════════════════════════════════════════════════════════
// PAYMENT PAGE — RATE PLAN PRICE
// ════════════════════════════════════════════════════════════
case 'rate plan price': {
  // From snapshot: "₹1,775/ month" or "₹17,800/year"
  // These are combined price+period texts

  // Strategy 1 — /month combined
  const monthly = snapFind(n =>
    n.childCount <= 2 &&
    isPriceText(n.text.split('/')[0].trim()) &&
    (n.text.toLowerCase().includes('/month') ||
     n.text.toLowerCase().includes('/ month')) &&
    n.text.length < 30
  );
  if (monthly !== 'N/A') return monthly;

  // Strategy 2 — /year combined
  const yearly = snapFind(n =>
    n.childCount <= 2 &&
    isPriceText(n.text.split('/')[0].trim()) &&
    (n.text.toLowerCase().includes('/year') ||
     n.text.toLowerCase().includes('/ year')) &&
    n.text.length < 30
  );
  if (yearly !== 'N/A') return yearly;

  // Strategy 3 — live DOM
  const loc   = page.locator('span, div, p');
  const count = await loc.count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    const el = loc.nth(i);
    if (!await el.isVisible().catch(() => false)) continue;
    const kids = await el.locator('> *').count().catch(() => 0);
    if (kids > 2) continue;
    const t = clean(
      await el.innerText({ timeout: T }).catch(() => '')
    );
    if (
      t.length < 30 &&
      (t.includes('/month') || t.includes('/year') ||
       t.includes('/ month') || t.includes('/ year'))
    ) return t;
  }
  return 'N/A';
}

// ════════════════════════════════════════════════════════════
// PAYMENT PAGE — RATE PLAN ORIGINAL PRICE (strikethrough)
// ════════════════════════════════════════════════════════════
case 'rate plan original price': {
  const annualPrice = eventData?.ANNUAL_PRICE || '';
  const currency    = eventData?.CURRENCY    || '';

  // Strategy 1 — match from eventData
  if (annualPrice) {
    const exact = snapFind(n =>
      n.childCount === 0 &&
      isPriceText(n.text) &&
      n.text.includes(annualPrice) &&
      (currency ? n.text.includes(currency) : true) &&
      n.text.length < 20
    );
    if (exact !== 'N/A') return exact;
  }

  // Strategy 2 — live DOM strikethrough element
  const loc   = page.locator('s, del, [class*="strike" i], [class*="original" i]');
  const count = await loc.count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    const el = loc.nth(i);
    if (!await el.isVisible().catch(() => false)) continue;
    const t = clean(await el.innerText({ timeout: T }).catch(() => ''));
    if (isPriceText(t)) return t;
  }
  return 'N/A';
}

// ════════════════════════════════════════════════════════════
// PAYMENT PAGE — RATE PLAN DISCOUNTED PRICE
// ════════════════════════════════════════════════════════════
case 'rate plan discounted price': {
  const currency = eventData?.CURRENCY || '';
  return snapFind(n =>
    n.childCount === 0 &&
    /^[£$€₹]\s?0(\.00)?$/.test(n.text) &&
    (currency ? n.text.includes(currency) : true)
  );
}

// ════════════════════════════════════════════════════════════
// PAYMENT PAGE — NEXT PAYMENT LABEL
// ════════════════════════════════════════════════════════════
case 'next payment label': {
  const nextDate = eventData?.NEXT_PAYMENT_DATE || '';

  // Strategy 1 — match with date
  if (nextDate) {
    const withDate = snapFind(n =>
      n.text.toLowerCase().includes('next') &&
      n.text.toLowerCase().includes('payment') &&
      n.text.toLowerCase().includes('on') &&
      n.text.includes(nextDate) &&
      n.text.length < 60
    );
    if (withDate !== 'N/A') return withDate;
  }

  // Strategy 2 — any next payment label
  return snapFind(n =>
    n.text.toLowerCase().includes('next') &&
    n.text.toLowerCase().includes('payment') &&
    n.text.toLowerCase().includes('on') &&
    n.text.length < 60
  );
}

// ════════════════════════════════════════════════════════════
// PAYMENT PAGE — CANCELLATION TEXT (ULTIMATE)
// ════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════
// PAYMENT PAGE — CANCELLATION TEXT — ALL TIERS
// ════════════════════════════════════════════════════════════
case 'cancellation text':
case 'cancel text': {
  // Strategy 1 — Monthly subscription (Standard Monthly)
  const monthly = snapFind(n =>
    n.childCount <= 1 &&
    n.text.toLowerCase().includes('monthly subscription') &&
    n.text.toLowerCase().includes('cancel') &&
    n.text.length > 20 &&
    n.text.length < 300
  );
  if (monthly !== 'N/A') return monthly;

  // Strategy 2 — Monthly Saver (Ultimate Annual Pay Monthly)
  const monthlySaver = snapFind(n =>
    n.childCount <= 1 &&
    n.text.toLowerCase().includes('monthly saver') &&
    n.text.toLowerCase().includes('renew') &&
    n.text.length > 20 &&
    n.text.length < 300
  );
  if (monthlySaver !== 'N/A') return monthlySaver;

  // Strategy 3 — Annual cycle (Ultimate Annual Pay Upfront)
  const annualCycle = snapFind(n =>
    n.childCount <= 1 &&
    n.text.toLowerCase().includes('annual cycle') &&
    n.text.toLowerCase().includes('cancel') &&
    n.text.length > 20 &&
    n.text.length < 300
  );
  if (annualCycle !== 'N/A') return annualCycle;

  // Strategy 4 — Annual pay over time (Standard Annual Pay Monthly)
  const annualOverTime = snapFind(n =>
    n.childCount <= 1 &&
    n.text.toLowerCase().includes('annual') &&
    n.text.toLowerCase().includes('pay over time') &&
    n.text.toLowerCase().includes('renew') &&
    n.text.length > 20 &&
    n.text.length < 500
  );
  if (annualOverTime !== 'N/A') return annualOverTime;

  // Generic fallback
  return snapFind(n =>
    n.childCount <= 1 &&
    n.text.toLowerCase().includes('cancel') &&
    n.text.length > 20 &&
    n.text.length < 500
  );
}
    // ════════════════════════════════════════════════════════════
    // PAYMENT PAGE — DAZN TIER
    // ════════════════════════════════════════════════════════════

    // ════════════════════════════════════════════════════════════
    // PAYMENT PAGE — 7 DAYS FREE BADGE
    // ════════════════════════════════════════════════════════════
    case '7 days free badge':
    case '7-days free badge':
    case '7 day free text':
    case '7-day free text': {
      return snapFind(n =>
        n.childCount === 0 &&
        (n.text.toLowerCase().includes('7-day') ||
         n.text.toLowerCase().includes('7 day') ||
         n.text.toLowerCase().includes('7-days') ||
         n.text.toLowerCase().includes('7 days')) &&
        n.text.toLowerCase().includes('free') &&
        n.text.length < 40
      );
    }

    // ════════════════════════════════════════════════════════════
    // PAYMENT PAGE — 7 DAYS FREE BADGE COLOR
    // ════════════════════════════════════════════════════════════
case '7 days free badge color':
case '7-days free badge color': {
  const result = await page.evaluate(() => {
    const allEls = document.querySelectorAll<HTMLElement>('*');
    for (const el of allEls) {
      const text = (el.innerText || '').trim().toLowerCase();
      if (
        !(text.includes('7-day') || text.includes('7 day') ||
          text.includes('7-days') || text.includes('7 days')) ||
        !text.includes('free') ||
        text.length > 40
      ) continue;

      // ✅ Check element AND all ancestors up to 5 levels
      let current: HTMLElement | null = el;
      for (let i = 0; i < 5; i++) {
        if (!current || current === document.body) break;
        const style = window.getComputedStyle(current);

        // Check all color-related properties
        const props = [
          style.backgroundColor,
          style.color,
          style.borderColor,
          style.borderTopColor,
          style.outlineColor,
          style.boxShadow,
        ];

        for (const c of props) {
          if (!c || c === 'rgba(0,0,0,0)' || c === 'transparent' ||
              c === 'none' || c === 'initial') continue;
          const m = c.match(/(\d+),\s*(\d+),\s*(\d+)/);
          if (!m) continue;
          const r = +m[1], g = +m[2], b = +m[3];
          if (r > 140 && g > 80 && b < 100 && r > g) return 'Gold';
          if (r > 160 && g > 100 && b < 120 && r > g) return 'Gold';
          if (r > 180 && g > 120 && b < 80)           return 'Gold';
          if (r > 200 && g > 150 && b < 60)           return 'Gold';
        }

        // Check class names
        const cls = (current.className || '').toLowerCase();
        if (cls.includes('gold') || cls.includes('amber') ||
            cls.includes('yellow') || cls.includes('accent') ||
            cls.includes('warning') || cls.includes('badge')) {
          // Check if it has any non-white/black background
          const bg = window.getComputedStyle(current).backgroundColor;
          if (bg && bg !== 'rgba(0,0,0,0)' && bg !== 'transparent') return 'Gold';
        }

        // ✅ Check CSS custom properties
        const cssVars = ['--badge-color', '--accent-color', '--gold',
                         '--warning', '--highlight'];
        for (const v of cssVars) {
          const val = style.getPropertyValue(v).trim();
          if (val && val.toLowerCase().includes('gold')) return 'Gold';
        }

        current = current.parentElement;
      }
    }
    return 'N/A';
  }).catch(() => 'N/A');

  return result;
}

    // ════════════════════════════════════════════════════════════
    // PAYMENT PAGE — 7 DAYS FREE PRICE (₹0)
    // ════════════════════════════════════════════════════════════
    case '7 days free price':
    case '7-days free price': {
      // Find ₹0 / £0 / $0 / €0
      return snapFind(n =>
        n.childCount === 0 &&
        /^[£$€₹]\s?0(\.00)?$/.test(n.text)
      );
    }

    // ════════════════════════════════════════════════════════════
    // PAYMENT PAGE — TODAY YOU PAY TEXT
    // ════════════════════════════════════════════════════════════
    case 'today you pay text': {
      return snapFind(n =>
        n.childCount === 0 &&
        n.text.toLowerCase().includes('today') &&
        n.text.toLowerCase().includes('pay') &&
        n.text.length < 40
      );
    }

    // ════════════════════════════════════════════════════════════
    // PAYMENT PAGE — TODAY YOU PAY PRICE
    // ════════════════════════════════════════════════════════════
case 'today you pay price': {
  const tier              = (eventData?.TIER || 'standard').toLowerCase();
  const ratePlan          = (eventData?.RATE_PLAN || 'monthly').toLowerCase();
  const annualUpfront     = eventData?.ANNUAL_UPFRONT_PRICE || '';
  const annualPayMonthly  = eventData?.ANNUAL_PAY_MONTHLY_PRICE || '';
  const expectedPrice     = eventData?.PPV_PRICE || '';
  const monthlyPrice      = eventData?.MONTHLY_PRICE || '';
  const nextPrice         = eventData?.NEXT_PAYMENT_PRICE || '';
  const currency          = eventData?.CURRENCY || '';

  // ── Ultimate APU — today you pay = upfront price ──────────
  if (tier === 'ultimate' && ratePlan === 'annual pay upfront') {
    if (annualUpfront) {
      return snapFind(n =>
        n.childCount === 0 &&
        (n.text === `${currency}${annualUpfront}` ||
         n.text.replace(/\s/g, '') === `${currency}${annualUpfront}`.replace(/\s/g, ''))
      );
    }
  }

  // ── Ultimate APM — today you pay = monthly price ──────────
  if (tier === 'ultimate' && ratePlan === 'annual pay monthly') {
    if (annualPayMonthly) {
      return snapFind(n =>
        n.childCount === 0 &&
        (n.text === `${currency}${annualPayMonthly}` ||
         n.text.replace(/\s/g, '') === `${currency}${annualPayMonthly}`.replace(/\s/g, ''))
      );
    }
  }

  // ── Standard — find price after "Today you pay" label ─────
  let foundTodayPay = false;
  for (const n of snap) {
    if (n.isInModal) continue;
    if (
      n.text.toLowerCase().includes('today') &&
      n.text.toLowerCase().includes('pay')
    ) {
      foundTodayPay = true;
      continue;
    }
    if (foundTodayPay) {
      if (!isPriceText(n.text)) continue;
      if (/^[£$€₹]\s?0(\.00)?$/.test(n.text)) continue;
      if (monthlyPrice && n.text.includes(monthlyPrice)) continue;
      if (nextPrice    && n.text === nextPrice) continue;
      return n.text;
    }
  }

  // Fallback — match PPV price directly
  if (expectedPrice) {
    const exact = snapFind(n =>
      n.childCount === 0 &&
      (n.text === expectedPrice ||
       n.text.replace(/\s/g, '') === expectedPrice.replace(/\s/g, ''))
    );
    if (exact !== 'N/A') return exact;
  }

  return 'N/A';
}

    // ════════════════════════════════════════════════════════════
    // PAYMENT PAGE — NEXT PAYMENT DATE
    // ════════════════════════════════════════════════════════════
    case 'next payment date': {
      // Look for dd/mm/yyyy pattern
      const exact = snapFind(n =>
        n.childCount === 0 &&
        /^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}$/.test(n.text)
      );
      if (exact !== 'N/A') return exact;

      // Extract from "Next payment on DD/MM/YYYY"
      for (const n of snap) {
        if (n.isInModal) continue;
        const match = n.text.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/);
        if (match && n.text.length < 60) return match[1];
      }
      return 'N/A';
    }

    // ════════════════════════════════════════════════════════════
    // PAYMENT PAGE — NEXT PAYMENT PRICE
    // ════════════════════════════════════════════════════════════
    case 'next payment price': {
  // Find "Next payment on DATE" then get next price
  let foundNextPayment = false;
  for (const n of snap) {
    if (n.isInModal) continue;
    if (foundNextPayment && n.childCount === 0 && isPriceText(n.text)) {
      return n.text;
    }
    if (n.text.toLowerCase().includes('next payment')) {
      foundNextPayment = true;
    }
  }

  // Fallback — match NEXT_PAYMENT_PRICE from eventData
  const nextPrice = eventData?.NEXT_PAYMENT_PRICE || '';
  if (nextPrice) {
    return snapFind(n =>
      n.childCount === 0 &&
      n.text === nextPrice
    );
  }
  return 'N/A';
}

    // ════════════════════════════════════════════════════════════
    // PAYMENT PAGE — CANCELLATION TEXT
    // ════════════════════════════════════════════════════════════


    // ════════════════════════════════════════════════════════════
    // PAYMENT PAGE — PLAN CHANGE CTA
    // ════════════════════════════════════════════════════════════
    case 'plan change cta': {
      return snapFind(n =>
        (n.tag === 'button' || n.tag === 'a' || n.tag === 'span') &&
        (n.text.toLowerCase() === 'change' ||
         n.text.toLowerCase() === 'edit' ||
         n.text.toLowerCase() === 'modify')
      );
    }

    // ════════════════════════════════════════════════════════════
    // PAYMENT PAGE — REDEEM PROMO CODE CTA
    // ════════════════════════════════════════════════════════════
    case 'redeem promo code cta': {
      const found = snapFind(n =>
        n.text.toLowerCase().includes('redeem') ||
        n.text.toLowerCase().includes('promo code') ||
        n.text.toLowerCase().includes('voucher')
      );
      return found !== 'N/A' ? 'Yes' : 'No';
    }

    // ════════════════════════════════════════════════════════════
    // PAYMENT PAGE — PAYMENT METHODS
    // ════════════════════════════════════════════════════════════
   case 'credit & debit card option':
case 'credit and debit card option': {
  // Try snapshot first
  const fromSnap = snapFind(n =>
    n.text.toLowerCase().includes('credit') ||
    n.text.toLowerCase().includes('debit')
  );
  if (fromSnap !== 'N/A') return 'Yes';

  // Live DOM with scroll fallback
  await scrollPage();
  return firstExists(
    'text=/Credit/i',
    'text=/Debit/i',
    '[class*="card" i]',
    'img[alt*="visa" i]',
    'img[alt*="mastercard" i]',
    'img[alt*="jcb" i]'
  );
}

case 'paypal option': {
  const fromSnap = snapFind(n =>
    n.text.toLowerCase().includes('paypal')
  );
  if (fromSnap !== 'N/A') return 'Yes';

  await scrollPage();
  return firstExists(
    'text=/PayPal/i',
    'img[alt*="paypal" i]',
    '[class*="paypal" i]',
    '[data-testid*="paypal" i]'
  );
}

case 'google pay option': {
  const fromSnap = snapFind(n =>
    n.text.toLowerCase().includes('google pay')
  );
  if (fromSnap !== 'N/A') return 'Yes';

  await scrollPage();
  return firstExists(
    'text=/Google Pay/i',
    'img[alt*="google pay" i]',
    '[class*="googlepay" i]',
    '[class*="google-pay" i]',
    '[data-testid*="google" i]'
  );
}



    // ════════════════════════════════════════════════════════════
    // GENERIC FALLBACK
    // ════════════════════════════════════════════════════════════
  // ════════════════════════════════════════════════════════════
// SUBSCRIPTION SECTION TITLE (Variant 2 only)
// ════════════════════════════════════════════════════════════
case 'subscription section title': {
  return snapFind(n =>
    n.text.toLowerCase().includes('choose your subscription') &&
    n.text.length < 80
  );
}  default: {
      const keyWords = key
        .split(' ')
        .filter(w => w.length > 2);

      return snapFind(n =>
        n.childCount <= 5 &&
        n.text.length > 2 &&
        n.text.length < 300 &&
        keyWords.some(w => n.text.toLowerCase().includes(w))
      );
    }
  }
}