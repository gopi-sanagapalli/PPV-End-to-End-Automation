export function formatNextPaymentDate(offset: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offset);

  return date.toLocaleDateString('en-AU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  });
}