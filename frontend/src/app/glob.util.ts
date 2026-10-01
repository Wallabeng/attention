export function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const withWildcards = escaped.replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${withWildcards}$`, 'i');
}

export function matchesGlob(pattern: string, text: string): boolean {
  try {
    return globToRegExp(pattern).test(text);
  } catch {
    return false;
  }
}

/** True if `text` matches any of the given glob patterns. */
export function matchesAnyGlob(patterns: string[], text: string): boolean {
  return patterns.some(pattern => matchesGlob(pattern, text));
}

/** Replaces version-like digit runs (e.g. "18.2.3") with a wildcard, as a starting point for grouping Renovate-style titles. */
export function guessGlobFromTitle(title: string): string {
  return title.replace(/\d+(\.\d+)*/g, '*');
}
