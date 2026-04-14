export function resolveExpected(rule: any, eventData: any): string {
  let expected = rule.Expected;

  if (!expected) return '';

  return expected.replace(/\{\{(.*?)\}\}/g, (_, key) => {
    const k = key.trim().toUpperCase();
    let value = eventData[k];

    if (
      k.includes('PRICE') &&
      value &&
      /^\d+(\.\d+)?$/.test(String(value))
    ) {
      const currency = eventData.CURRENCY || '';

      // 🔥 return BOTH formats for flexible compare
      return `${currency}${value}`;
    }

    return value !== undefined ? String(value) : `MISSING_${k}`;
  });
}