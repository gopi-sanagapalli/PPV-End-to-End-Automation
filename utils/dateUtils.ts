export function formatNextPaymentDate(daysOffset: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysOffset);

  // Returns "24/04/2026" to match what DAZN actually shows
  const dd   = String(date.getDate()).padStart(2, '0');
  const mm   = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();

  return `${dd}/${mm}/${yyyy}`;
}