import {Component, computed, Inject, signal} from '@angular/core';
import {firstValueFrom} from 'rxjs';
import {FormsModule} from '@angular/forms';
import {MatButtonModule} from '@angular/material/button';
import {MatCheckboxModule} from '@angular/material/checkbox';
import {MatChipsModule} from '@angular/material/chips';
import {MatDividerModule} from '@angular/material/divider';
import {MatFormFieldModule} from '@angular/material/form-field';
import {MatIconModule} from '@angular/material/icon';
import {MatInputModule} from '@angular/material/input';
import {MatDialog, MatDialogModule} from '@angular/material/dialog';
import {MatListModule} from '@angular/material/list';
import {MatMenuModule} from '@angular/material/menu';
import {MatSelectModule} from '@angular/material/select';
import {MatSnackBar, MatSnackBarModule} from '@angular/material/snack-bar';
import {MatTooltipModule} from '@angular/material/tooltip';
import {Item, ItemsService} from '../items.service';
import {SourcesService} from '../sources.service';
import {SnoozeRulesService} from '../snooze-rules.service';
import {SnoozeRule} from '../snooze-rule.model';
import {matchesAnyGlob} from '../glob.util';
import {ItemActionsService} from '../syncs/item-actions.service';
import {ItemAction} from '../syncs/item-action';
import {ConfirmDialogComponent} from '../confirm-dialog.component';
import {SnoozeGroupDialogComponent} from './snooze-group-dialog.component';
import {SYNC_PROVIDERS} from '../syncs/sync-providers.token';
import {SyncProvider} from '../syncs/sync-provider';

@Component({
  selector: 'app-inbox',
  standalone: true,
  imports: [
    FormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatChipsModule,
    MatDividerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatListModule,
    MatMenuModule,
    MatSelectModule,
    MatDialogModule,
    MatSnackBarModule,
    MatTooltipModule,
  ],
  templateUrl: './inbox.component.html',
  styleUrl: './inbox.component.scss',
})
export class InboxComponent {
  newTitle = signal('');
  filter = signal<'open' | 'done' | 'snoozed' | 'all'>('open');
  sort = signal<'created_desc' | 'created_asc' | 'source'>('created_asc');
  ruleFilter = signal<string | null>(null);
  pendingSnoozeItem = signal<Item | null>(null);
  runningAction = signal<string | null>(null);

  open = computed(() => this.items.items().filter(i => i.state === 'open' && !this.sources.isMuted(i.source)));
  done = computed(() => this.items.items().filter(i => i.state === 'done' && !this.sources.isMuted(i.source)));
  snoozed = computed(() => this.items.items().filter(i => i.state === 'snoozed' && !this.sources.isMuted(i.source)));
  visible = computed(() => {
    const f = this.filter();
    const notMuted = (i: Item) => !this.sources.isMuted(i.source);
    let list: Item[];
    if (f === 'all') list = this.items.items().filter(notMuted);
    else if (f === 'done') list = this.done();
    else if (f === 'snoozed') list = this.snoozed();
    else list = this.open();
    const ruleId = this.ruleFilter();
    if (ruleId) {
      const rule = this.snoozeRules.rules().find(r => r.id === ruleId);
      if (rule) list = list.filter(i => matchesAnyGlob(rule.patterns, i.title));
    }
    return this.sortItems(list);
  });

  constructor(
    public items: ItemsService,
    protected snoozeRules: SnoozeRulesService,
    private sources: SourcesService,
    private actions: ItemActionsService,
    private dialog: MatDialog,
    private snackBar: MatSnackBar,
    @Inject(SYNC_PROVIDERS) private providers: SyncProvider[],
  ) {
  }

  private sortItems(items: Item[]): Item[] {
    const s = this.sort();
    const copy = [...items];
    const byMoreAttention = (a: Item, b: Item) => Number(this.needsMoreAttention(b)) - Number(this.needsMoreAttention(a));
    const byLessAttention = (a: Item, b: Item) => Number(this.needsLessAttention(a)) - Number(this.needsLessAttention(b));
    const byAttention = (a: Item, b: Item) => byMoreAttention(a, b) || byLessAttention(a, b);
    if (s === 'created_asc') return copy.sort((a, b) => byAttention(a, b) || new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    if (s === 'source') return copy.sort((a, b) => byAttention(a, b) || a.source.localeCompare(b.source) || new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return copy.sort((a, b) => byAttention(a, b) || new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }

  needsLessAttention(item: Item): boolean {
    return this.providers.find(provider => provider.source === item.source)?.needsLessAttention?.(item) ?? false;
  }

  needsMoreAttention(item: Item): boolean {
    return this.providers.find(provider => provider.source === item.source)?.needsMoreAttention?.(item) ?? false;
  }

  actionsFor(item: Item): ItemAction[] {
    return this.actions.getActions(item);
  }

  private actionKey(item: Item, action: ItemAction): string {
    return `${item.id}:${action.id}`;
  }

  isActionRunning(item: Item, action: ItemAction): boolean {
    return this.runningAction() === this.actionKey(item, action);
  }

  async runAction(item: Item, action: ItemAction): Promise<void> {
    if (this.runningAction()) return;

    if (action.destructive) {
      const confirmed = await firstValueFrom(
        this.dialog.open(ConfirmDialogComponent, {
          data: {
            title: action.label,
            message: `${action.label}: "${item.title}"?`,
            confirmLabel: action.label,
          },
        }).afterClosed(),
      );
      if (!confirmed) return;
    }

    this.runningAction.set(this.actionKey(item, action));
    try {
      await action.run(item);
      this.snackBar.open(`${action.label} done`, undefined, {duration: 3000});
    } catch (e) {
      this.snackBar.open(`${action.label} failed: ${e instanceof Error ? e.message : String(e)}`, 'Dismiss');
    } finally {
      this.runningAction.set(null);
    }
  }

  async addItem(): Promise<void> {
    const title = this.newTitle().trim();
    if (!title) return;
    await this.items.create(title);
    this.newTitle.set('');
  }

  async markDone(item: Item): Promise<void> {
    await this.items.updateState(item.id, item.state === 'done' ? 'open' : 'done');
  }

  async unsnooze(item: Item): Promise<void> {
    await this.items.updateState(item.id, 'open');
  }

  async snoozeFromMenu(days: number): Promise<void> {
    const item = this.pendingSnoozeItem();
    if (!item) return;
    await this.items.snooze(item.id, days);
    this.pendingSnoozeItem.set(null);
  }

  openSnoozeGroupDialog(): void {
    const item = this.pendingSnoozeItem();
    if (!item) return;
    this.dialog.open(SnoozeGroupDialogComponent, {
      width: '480px',
      data: {item, items: this.items.items()},
    });
  }

  openEditRuleDialog(rule: SnoozeRule): void {
    this.dialog.open(SnoozeGroupDialogComponent, {
      width: '480px',
      data: {existingRule: rule, items: this.items.items()},
    });
  }

  async remove(item: Item): Promise<void> {
    await this.items.delete(item.id);
  }

  openUrl(item: Item): void {
    if (item.url) {
      this.items.openUrl(item.url);
    }
  }

  setFilter(f: 'open' | 'done' | 'snoozed' | 'all'): void {
    this.filter.set(f);
  }

  toggleRuleFilter(ruleId: string): void {
    this.ruleFilter.set(this.ruleFilter() === ruleId ? null : ruleId);
  }

  ruleMatchCount(rule: SnoozeRule): number {
    return this.items.items().filter(i => i.state === 'snoozed' && matchesAnyGlob(rule.patterns, i.title)).length;
  }

  isRuleExpired(rule: SnoozeRule): boolean {
    return rule.until < new Date().toISOString().slice(0, 10);
  }

  async removeRule(rule: SnoozeRule): Promise<void> {
    await this.items.unsnoozeMatching(rule.patterns);
    await this.snoozeRules.removeRule(rule.id);
    if (this.ruleFilter() === rule.id) this.ruleFilter.set(null);
  }

  objectKeys(obj: Record<string, string>): string[] {
    return Object.keys(obj);
  }

  propertyKeysForDisplay(item: Item): string[] {
    if (!item.properties) return [];
    const keys = Object.keys(item.properties);
    const order = this.providers.find(provider => provider.source === item.source)?.getPropertyOrder?.() ?? [];
    const known = order.filter(key => key in item.properties!);
    const knownSet = new Set(known);
    const unknown = keys.filter(key => !knownSet.has(key));
    return [...known, ...unknown];
  }

  isUpdated(item: Item): boolean {
    return !!item.updated_at && item.updated_at !== item.created_at;
  }

  isOverdue(dateStr: string): boolean {
    return !!dateStr && dateStr.slice(0, 10) < new Date().toISOString().slice(0, 10);
  }

  formatDate(dateStr: string): string {
    return new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
    });
  }

  formatRelativeTime(isoString: string): string {
    const diff = Date.now() - new Date(isoString).getTime();
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    const weeks = Math.floor(days / 7);
    if (weeks < 5) return `${weeks}w ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months}mo ago`;
    return `${Math.floor(days / 365)}y ago`;
  }

  formatAbsoluteDateTime(isoString: string): string {
    return new Date(isoString).toLocaleString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  }
}
