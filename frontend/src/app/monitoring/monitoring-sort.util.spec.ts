import {compareGridValues} from './monitoring-sort.util';

describe('compareGridValues', () => {
  it('compares two numbers numerically, not lexicographically', () => {
    expect(compareGridValues(2, 10)).toBeLessThan(0);
    expect(compareGridValues(10, 2)).toBeGreaterThan(0);
    expect(compareGridValues(5, 5)).toBe(0);
  });

  it('compares numeric strings numerically', () => {
    expect(compareGridValues('2', '10')).toBeLessThan(0);
    expect(compareGridValues('10', '2')).toBeGreaterThan(0);
  });

  it('falls back to locale-aware string comparison for non-numeric text', () => {
    expect(compareGridValues('apple', 'banana')).toBeLessThan(0);
    expect(compareGridValues('banana', 'apple')).toBeGreaterThan(0);
  });

  it('treats a mix of numeric and non-numeric values as non-numeric (string fallback)', () => {
    expect(compareGridValues('5', 'abc')).toBe('5'.localeCompare('abc', undefined, {numeric: true}));
  });

  it('treats null/undefined as an empty string', () => {
    expect(compareGridValues(null, 'a')).toBe(''.localeCompare('a', undefined, {numeric: true}));
    expect(compareGridValues(undefined, undefined)).toBe(0);
  });

  it('treats an empty string as non-numeric, not zero', () => {
    expect(compareGridValues('', '5')).toBe(''.localeCompare('5', undefined, {numeric: true}));
  });
});
