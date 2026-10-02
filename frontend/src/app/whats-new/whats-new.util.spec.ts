import {Feature, groupByVersion, unseenFeatures} from './whats-new.util';

const f = (id: string, version?: string): Feature => ({id, title: id, description: '', version});

describe('whats-new util', () => {
  const log = [f('a', '1.0.0'), f('b', '1.0.0'), f('c', '1.1.0'), f('d')];

  describe('unseenFeatures', () => {
    it('returns everything on a fresh install', () => {
      expect(unseenFeatures(log, null)).toEqual(log);
    });

    it('returns only entries after the marker, across skipped releases', () => {
      expect(unseenFeatures(log, 'a').map(x => x.id)).toEqual(['b', 'c', 'd']);
    });

    it('returns nothing when the marker is the latest entry', () => {
      expect(unseenFeatures(log, 'd')).toEqual([]);
    });

    it('returns everything when the marker is not in the log', () => {
      expect(unseenFeatures(log, 'gone')).toEqual(log);
    });

    it('returns nothing for an empty log', () => {
      expect(unseenFeatures([], null)).toEqual([]);
    });
  });

  describe('groupByVersion', () => {
    it('groups newest version first, with unreleased entries on top', () => {
      const groups = groupByVersion(log);
      expect(groups.map(g => g.version)).toEqual([null, '1.1.0', '1.0.0']);
      expect(groups[2].features.map(x => x.id)).toEqual(['b', 'a']);
    });
  });
});
