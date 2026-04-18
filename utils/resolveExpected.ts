export function resolveExpected(
  rule: any,
  eventData: Record<string, string>
): string {
  const raw = rule.Expected;

  // If no expected value treat as existence check
  if (raw === undefined || raw === null || raw === '') {
    return '';
  }

  const template = String(raw);

  return template.replace(/\{\{(.*?)\}\}/g, (match, key) => {
    const k = key.trim();

    // Try exact, UPPER, lower
    const value =
      eventData[k] ??
      eventData[k.toUpperCase()] ??
      eventData[k.toLowerCase()];

    if (value === undefined) {
      console.warn(`⚠️  resolveExpected: no value for {{${k}}} — leaving as-is`);
      return match; // return original placeholder, don't throw
    }

    return String(value);
  });
}