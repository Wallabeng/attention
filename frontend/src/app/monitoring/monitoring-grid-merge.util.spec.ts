import {mergeGridResults} from './monitoring-grid-merge.util';

describe('mergeGridResults', () => {
  it('merges rows from multiple successful tenant groups and tags each with tenantGroup', () => {
    const merged = mergeGridResults([
      {tenant_group: 'acme', ok: true, data: [{errorCode: 'E1', count: 3}]},
      {tenant_group: 'globex', ok: true, data: [{errorCode: 'E2', count: 1}]},
    ]);
    expect(merged.rows).toEqual([
      {tenantGroup: 'acme', errorCode: 'E1', count: 3, __searchText: 'acme e1 3'},
      {tenantGroup: 'globex', errorCode: 'E2', count: 1, __searchText: 'globex e2 1'},
    ]);
    expect(merged.failed).toEqual([]);
  });

  it('computes the column union across rows with differing keys, tenantGroup first', () => {
    const merged = mergeGridResults([
      {tenant_group: 'acme', ok: true, data: [{errorCode: 'E1'}]},
      {tenant_group: 'globex', ok: true, data: [{errorCode: 'E2', count: 1}]},
    ]);
    expect(merged.columns).toEqual(['tenantGroup', 'errorCode', 'count']);
  });

  it('excludes failed tenant groups from rows and lists them in failed', () => {
    const merged = mergeGridResults([
      {tenant_group: 'acme', ok: true, data: [{errorCode: 'E1'}]},
      {tenant_group: 'initech', ok: false, error: 'HTTP 500'},
    ]);
    expect(merged.rows.length).toBe(1);
    expect(merged.failed).toEqual([{tenant_group: 'initech', error: 'HTTP 500'}]);
  });

  it('handles a tenant group whose response has multiple rows', () => {
    const merged = mergeGridResults([
      {tenant_group: 'acme', ok: true, data: [{errorCode: 'E1'}, {errorCode: 'E2'}]},
    ]);
    expect(merged.rows.length).toBe(2);
  });

  it('returns an empty result for no input', () => {
    const merged = mergeGridResults([]);
    expect(merged.columns).toEqual(['tenantGroup']);
    expect(merged.rows).toEqual([]);
    expect(merged.failed).toEqual([]);
  });

  it('adds a lowercased __searchText field per row for fast filtering, excluded from columns', () => {
    const merged = mergeGridResults([
      {tenant_group: 'Acme', ok: true, data: [{errorCode: 'E1', count: 3}]},
    ]);
    expect(merged.rows[0]['__searchText']).toBe('acme e1 3');
    expect(merged.columns).not.toContain('__searchText');
  });
});

describe('mergeGridResults incremental merge (`into` parameter)', () => {
  it('appends onto an existing MergedGrid instead of starting fresh', () => {
    const first = mergeGridResults([{tenant_group: 'acme', ok: true, data: [{errorCode: 'E1'}]}]);
    const second = mergeGridResults(
      [{tenant_group: 'globex', ok: true, data: [{errorCode: 'E2', count: 1}]}],
      first,
    );

    expect(second.rows).toEqual([
      {tenantGroup: 'acme', errorCode: 'E1', __searchText: 'acme e1'},
      {tenantGroup: 'globex', errorCode: 'E2', count: 1, __searchText: 'globex e2 1'},
    ]);
    expect(second.columns).toEqual(['tenantGroup', 'errorCode', 'count']);
  });

  it('accumulates failed entries across incremental calls without dropping earlier ones', () => {
    const first = mergeGridResults([{tenant_group: 'acme', ok: true, data: [{errorCode: 'E1'}]}]);
    const second = mergeGridResults([{tenant_group: 'initech', ok: false, error: 'HTTP 500'}], first);

    expect(second.failed).toEqual([{tenant_group: 'initech', error: 'HTTP 500'}]);
    expect(second.rows.length).toBe(1);
  });

  it('defaults to an empty grid when no `into` is given (existing single-shot behavior unchanged)', () => {
    const merged = mergeGridResults([{tenant_group: 'acme', ok: true, data: [{errorCode: 'E1'}]}]);
    expect(merged.columns).toEqual(['tenantGroup', 'errorCode']);
    expect(merged.rows).toEqual([{tenantGroup: 'acme', errorCode: 'E1', __searchText: 'acme e1'}]);
  });
});
