export interface Feature {
  id: string;
  title: string;
  description: string;
  /** Stamped by `scripts/release.mjs`; absent for features not released yet. */
  version?: string;
}

export interface FeatureGroup {
  /** `null` for features that have not been stamped with a release yet. */
  version: string | null;
  features: Feature[];
}

/**
 * Features the user has not seen yet. The log is append-only, so array position
 * (not id or date) defines order. With no marker, or one that is no longer in
 * the log, everything is unseen.
 */
export function unseenFeatures(all: Feature[], lastSeenId: string | null): Feature[] {
  const idx = lastSeenId === null ? -1 : all.findIndex(f => f.id === lastSeenId);
  return all.slice(idx + 1);
}

/** Groups by version, newest first, keeping log order within a group. */
export function groupByVersion(features: Feature[]): FeatureGroup[] {
  const groups: FeatureGroup[] = [];
  for (const f of features) {
    const version = f.version ?? null;
    const last = groups[groups.length - 1];
    if (last && last.version === version) {
      last.features.push(f);
    } else {
      groups.push({version, features: [f]});
    }
  }
  return groups.reverse().map(g => ({...g, features: [...g.features].reverse()}));
}
