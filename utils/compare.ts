export function compare(
  actual: any,
  expected: any,
  type?: string
): boolean {

  const normalize = (val: any) =>
    String(val ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

  const a = normalize(actual);
  const e = normalize(expected);

  const compareType = (type || 'equals').toLowerCase();

  switch (compareType) {

    case 'equals':
      return a === e;

    case 'contains':
      return a.includes(e);

    case 'startswith':
      return a.startsWith(e);

    case 'exists':
      return a !== '' && a !== 'n/a' && a !== 'null' && a !== 'undefined';

    default:
      return false; // 🔥 REMOVE noisy logs
  }
}