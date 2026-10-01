export function compareGridValues(a: unknown, b: unknown): number {
  const an = toComparableNumber(a);
  const bn = toComparableNumber(b);
  if (an !== null && bn !== null) {
    return an - bn;
  }
  return String(a ?? '').localeCompare(String(b ?? ''), undefined, {numeric: true});
}

function toComparableNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}
