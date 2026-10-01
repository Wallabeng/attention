import {Injectable, signal} from '@angular/core';
import {ConfigService} from '../config.service';

/**
 * Per grid-type hidden-column preferences. Applies across every stage — hiding a
 * column for grid `data-processing-errors` hides it whether you're viewing it on
 * stage A or stage B. `tenantGroup` is never hidden (filtered client-side in
 * `MonitoringComponent.visibleColumns()`) and never stored here.
 */
@Injectable({providedIn: 'root'})
export class MonitoringColumnPrefsService {
  private readonly _hidden = signal<Record<string, string[]>>({});
  readonly hidden = this._hidden.asReadonly();

  constructor(private config: ConfigService) {
  }

  async load(): Promise<void> {
    const cfg = await this.config.get();
    this._hidden.set(cfg.monitoring_hidden_columns ?? {});
  }

  hiddenFor(gridKey: string): Set<string> {
    return new Set(this._hidden()[gridKey] ?? []);
  }

  async setHiddenFor(gridKey: string, columns: string[]): Promise<void> {
    const next = {...this._hidden()};
    if (columns.length === 0) {
      delete next[gridKey];
    } else {
      next[gridKey] = [...columns];
    }
    this._hidden.set(next);
    const cfg = await this.config.get();
    await this.config.set({...cfg, monitoring_hidden_columns: next});
  }

  async toggleColumn(gridKey: string, column: string): Promise<void> {
    const current = this.hiddenFor(gridKey);
    if (current.has(column)) {
      current.delete(column);
    } else {
      current.add(column);
    }
    await this.setHiddenFor(gridKey, [...current]);
  }

  async showAll(gridKey: string): Promise<void> {
    await this.setHiddenFor(gridKey, []);
  }

  /** Hides every column in `allColumns` except `tenantGroup` (which is never hideable). */
  async hideAllExceptTenantGroup(gridKey: string, allColumns: string[]): Promise<void> {
    await this.setHiddenFor(gridKey, allColumns.filter(c => c !== 'tenantGroup'));
  }
}
