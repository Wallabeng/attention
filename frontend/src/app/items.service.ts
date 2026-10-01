import {computed, effect, Injectable, signal} from '@angular/core';
import {interval} from 'rxjs';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {Item, ItemState} from './item.model';
import {SyncCoordinatorService} from './syncs/sync-coordinator.service';
import {ShellService} from './shell.service';
import {SnoozeRulesService} from './snooze-rules.service';
import {SourcesService} from './sources.service';
import {matchesAnyGlob} from './glob.util';

export type {ItemState};
export type {Item};

function newItem(title: string, notes?: string, due_date?: string): Omit<Item, 'id' | 'created_at' | 'updated_at'> {
  return {
    title,
    notes: notes ?? null,
    source: 'manual',
    state: 'open',
    due_date: due_date ?? null,
    properties: null,
    url: null,
  };
}

function uuid(): string {
  return crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

@Injectable({providedIn: 'root'})
export class ItemsService {
  private readonly _items = signal<Item[]>([]);
  readonly items = this._items.asReadonly();
  nextSyncIn = signal(60);

  private readonly _syncing = signal(false);
  readonly syncing = this._syncing.asReadonly();

  constructor(
    private coordinator: SyncCoordinatorService,
    private shell: ShellService,
    private snoozeRules: SnoozeRulesService,
    private sources: SourcesService,
  ) {
    interval(1_000).pipe(takeUntilDestroyed()).subscribe(() => {
      if (this._syncing()) return;
      const next = this.nextSyncIn() - 1;
      if (next <= 0) {
        this.nextSyncIn.set(0);
        this.autoSync().finally(() => {
          this.nextSyncIn.set(60);
        });
      } else {
        this.nextSyncIn.set(next);
      }
    });

    // The window title / dock badge / tray tooltip should only reflect open items
    // from sources the user hasn't muted — recompute and push to Tauri whenever
    // either the item list or the muted-sources set changes.
    const openBadgeCount = computed(() =>
      this._items().filter(i => i.state === 'open' && !this.sources.isMuted(i.source)).length,
    );
    effect(() => this.shell.setBadgeCount(openBadgeCount()));
  }

  async load(): Promise<void> {
    const loaded = await this.shell.getItems();
    const woken = await this.wakeExpiredSnoozes(loaded);
    this._items.set(await this.applySnoozeRules(woken));
  }

  async create(title: string, notes?: string, due_date?: string): Promise<void> {
    const ts = now();
    const item: Item = {id: uuid(), created_at: ts, updated_at: ts, ...newItem(title, notes, due_date)};
    const items = await this.shell.createItem(item);
    this._items.set(items);
  }

  async updateState(id: string, state: ItemState): Promise<void> {
    const current = this._items().find(i => i.id === id);
    if (!current) return;
    const updated: Item = {...current, state, updated_at: now()};
    const items = await this.shell.updateItem(updated);
    this._items.set(items);
  }

  async snooze(id: string, days: number): Promise<void> {
    const current = this._items().find(i => i.id === id);
    if (!current) return;
    const d = new Date();
    d.setDate(d.getDate() + days);
    const dueDate = d.toISOString().slice(0, 10);
    const updated: Item = {...current, state: 'snoozed', due_date: dueDate, updated_at: now()};
    const items = await this.shell.updateItem(updated);
    this._items.set(items);
  }

  /** Snoozes every open item whose title matches any of the glob patterns. Returns the number of items snoozed. */
  async snoozeMatching(patterns: string[], untilDate: string): Promise<number> {
    const matches = this._items().filter(i => i.state === 'open' && matchesAnyGlob(patterns, i.title));
    let items = this._items();
    for (const match of matches) {
      items = await this.shell.updateItem({...match, state: 'snoozed', due_date: untilDate, updated_at: now()});
    }
    this._items.set(items);
    return matches.length;
  }

  /** Sets every snoozed item whose title matches any of the glob patterns back to open. Returns the number of items woken. */
  async unsnoozeMatching(patterns: string[]): Promise<number> {
    const matches = this._items().filter(i => i.state === 'snoozed' && matchesAnyGlob(patterns, i.title));
    let items = this._items();
    for (const match of matches) {
      items = await this.shell.updateItem({...match, state: 'open', updated_at: now()});
    }
    this._items.set(items);
    return matches.length;
  }

  async delete(id: string): Promise<void> {
    const items = await this.shell.deleteItem(id);
    this._items.set(items);
  }

  openUrl(url: string): void {
    this.shell.openUrl(url);
  }

  async sync(): Promise<string[]> {
    try {
      this._syncing.set(true);
      const {results, errors} = await this.coordinator.sync();
      let items: Item[] | null = null;
      const currentItems = this._items();
      for (const {source, items: fresh} of results) {
        const freshIds = new Set(fresh.map(i => i.id));
        for (const current of currentItems.filter(i => i.source === source && !freshIds.has(i.id))) {
          items = await this.shell.deleteItem(current.id);
        }
        for (const freshItem of fresh) {
          const existing = currentItems.find(i => i.id === freshItem.id);
          if (!existing) {
            items = await this.shell.createItem(freshItem);
          } else if (existing.state !== 'done') {
            const updated: Item = {
              ...existing,
              title: freshItem.title,
              notes: freshItem.notes,
              updated_at: freshItem.updated_at,
              properties: freshItem.properties,
              url: freshItem.url,
            };
            items = await this.shell.updateItem(updated);
          }
        }
      }
      const woken = await this.wakeExpiredSnoozes(items ?? []);
      this._items.set(await this.applySnoozeRules(woken));
      return errors;
    } catch (e) {
      return [JSON.stringify(e)];
    } finally {
      this._syncing.set(false);
    }
  }

  private async wakeExpiredSnoozes(items: Item[]): Promise<Item[]> {
    const todayStr = today();
    for (const item of items) {
      if (item.state === 'snoozed' && (!item.due_date || item.due_date.slice(0, 10) <= todayStr)) {
        items = await this.shell.updateItem({...item, state: 'open', updated_at: now()});
      }
    }
    return items;
  }

  /** Snoozes any open item matching an active snooze rule, so newly-synced items (e.g. a fresh Renovate MR) fall in line automatically. */
  private async applySnoozeRules(items: Item[]): Promise<Item[]> {
    const rules = this.snoozeRules.activeRules();
    if (rules.length === 0) return items;
    for (const item of items) {
      if (item.state !== 'open') continue;
      const rule = rules.find(r => matchesAnyGlob(r.patterns, item.title));
      if (rule) {
        items = await this.shell.updateItem({...item, state: 'snoozed', due_date: rule.until, updated_at: now()});
      }
    }
    return items;
  }

  private async autoSync(): Promise<void> {
    const prevOpenIds = new Set(this._items().filter(i => i.state === 'open').map(i => i.id));
    await this.sync();
    const newOpen = this._items().filter(i => i.state === 'open' && !prevOpenIds.has(i.id));
    if (newOpen.length > 0) {
      const body = newOpen.length === 1 ? newOpen[0].title : `${newOpen.length} new items need your attention`;
      await this.shell.notify('Attention', body).catch(() => {
      });
    }
  }
}
