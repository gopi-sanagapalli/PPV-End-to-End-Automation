export function formatNextPaymentDate(daysOffset: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysOffset);

  const dd   = String(date.getDate()).padStart(2, '0');
  const mm   = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();

  return `${dd}/${mm}/${yyyy}`;
}

// ✅ New helper — adds exactly 1 calendar month
export function formatNextPaymentDateMonthly(): string {
  const date = new Date();
  date.setMonth(date.getMonth() + 1);

  const dd   = String(date.getDate()).padStart(2, '0');
  const mm   = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();

  return `${dd}/${mm}/${yyyy}`;
}

// ✅ New helper — adds exactly 1 calendar year
export function formatNextPaymentDateYearly(): string {
  const date = new Date();
  date.setFullYear(date.getFullYear() + 1);

  const dd   = String(date.getDate()).padStart(2, '0');
  const mm   = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();

  return `${dd}/${mm}/${yyyy}`;
}

// ── US format MM.DD.YYYY ──────────────────────────────────────

// US monthly — 1 month from today in MM.DD.YYYY
export function formatNextPaymentDateMonthlyUS(): string {
  const date = new Date();
  date.setMonth(date.getMonth() + 1);

  const dd   = String(date.getDate()).padStart(2, '0');
  const mm   = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();

  return `${mm}/${dd}/${yyyy}`;
}

// US yearly — 1 year from today in MM.DD.YYYY
export function formatNextPaymentDateYearlyUS(): string {
  const date = new Date();
  date.setFullYear(date.getFullYear() + 1);

  const dd   = String(date.getDate()).padStart(2, '0');
  const mm   = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();

  return `${mm}/${dd}/${yyyy}`;
}

// US offset — N days from today in MM.DD.YYYY
export function formatNextPaymentDateUS(daysOffset: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysOffset);

  const dd   = String(date.getDate()).padStart(2, '0');
  const mm   = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();

  return `${mm}/${dd}/${yyyy}`;
}

// ── Flex Future Date — "In 7 days • 4 June 2026" ────────────
export function formatFlexFutureDate(daysOffset: number = 7): string {
  const date = new Date();
  date.setDate(date.getDate() + daysOffset);

  const day   = date.getDate(); // no padding
  const month = date.toLocaleString('en-GB', { month: 'long' });
  const year  = date.getFullYear();

  return `In ${daysOffset} days • ${day} ${month} ${year}`;
}

// ✅ Renewal date helper — 1 year minus 1 day from today in DD/MM/YYYY
export function formatRenewalDate(): string {
  const date = new Date();
  date.setFullYear(date.getFullYear() + 1);
  date.setDate(date.getDate() - 1);

  const dd   = String(date.getDate()).padStart(2, '0');
  const mm   = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();

  return `${dd}/${mm}/${yyyy}`;
}

// ✅ US renewal date helper — 1 year minus 1 day from today in MM/DD/YYYY
export function formatRenewalDateUS(): string {
  const date = new Date();
  date.setFullYear(date.getFullYear() + 1);
  date.setDate(date.getDate() - 1);

  const dd   = String(date.getDate()).padStart(2, '0');
  const mm   = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();

  return `${mm}/${dd}/${yyyy}`;
}