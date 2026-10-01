import {matchesAnyGlob, matchesGlob} from './glob.util';

describe('matchesGlob', () => {
  it('matches a literal pattern', () => {
    expect(matchesGlob('foo', 'foo')).toBe(true);
    expect(matchesGlob('foo', 'bar')).toBe(false);
  });

  it('treats * as a wildcard', () => {
    expect(matchesGlob('chore(deps): update * to *', 'chore(deps): update foo to 1.2.3')).toBe(true);
  });
});

describe('matchesAnyGlob', () => {
  it('matches if any pattern matches', () => {
    expect(matchesAnyGlob(['foo', 'bar'], 'bar')).toBe(true);
    expect(matchesAnyGlob(['foo', 'bar'], 'baz')).toBe(false);
  });

  it('returns false for an empty pattern list', () => {
    expect(matchesAnyGlob([], 'anything')).toBe(false);
  });
});
