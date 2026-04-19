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