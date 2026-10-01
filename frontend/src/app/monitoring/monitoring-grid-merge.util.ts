import {TenantGridResult} from './tenant-grid-result.model';

export interface MergedGrid {
  columns: string[];
  rows: Record<string, unknown>[];
  failed: { tenant_group: string; error: string }[];
}

const EMPTY_GRID: MergedGrid = {columns: ['tenantGroup'], rows: [], failed: []};

export function mergeGridResults(results: TenantGridResult[], into: MergedGrid = EMPTY_GRID): MergedGrid {
  const rows = [...into.rows];
  const failed = [...into.failed];
  const columnSet = new Set(into.columns.filter(c => c !== 'tenantGroup'));

  for (const result of results) {
    if (!result.ok) {
      failed.push({tenant_group: result.tenant_group, error: result.error ?? 'unknown error'});
      continue;
    }
    for (const record of result.data ?? []) {
      if (record && typeof record === 'object') {
        const row: Record<string, unknown> = {tenantGroup: result.tenant_group};
        for (const [key, value] of Object.entries(record as Record<string, unknown>)) {
          row[key] = value;
          columnSet.add(key);
        }
        row['__searchText'] = Object.values(row).map(v => String(v)).join(' ').toLowerCase();
        rows.push(row);
      }
    }
  }

  return {
    columns: ['tenantGroup', ...Array.from(columnSet)],
    rows,
    failed,
  };
}
