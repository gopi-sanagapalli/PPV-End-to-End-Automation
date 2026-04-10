export function resolveExpected(rule: any, eventData: any): string {
  let expected = rule.Expected;

  if (typeof expected !== 'string') return expected;

  return expected.replace(/{{(.*?)}}/g, (_, key) => {
    const value = eventData[key.trim()];

    if (value === undefined) {
      console.warn(`⚠️ Missing value for: ${key}`);
      return '';
    }

    return String(value);
  });
}