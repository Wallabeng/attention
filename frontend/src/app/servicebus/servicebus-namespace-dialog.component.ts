import {Component, computed, inject, signal} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {MatButtonModule} from '@angular/material/button';
import {MatButtonToggleModule} from '@angular/material/button-toggle';
import {MatCheckboxModule} from '@angular/material/checkbox';
import {MAT_DIALOG_DATA, MatDialogModule, MatDialogRef} from '@angular/material/dialog';
import {MatFormFieldModule} from '@angular/material/form-field';
import {MatIconModule} from '@angular/material/icon';
import {MatInputModule} from '@angular/material/input';
import {MatProgressSpinnerModule} from '@angular/material/progress-spinner';
import {ShellService} from '../shell.service';
import {listQueues, listSubscriptions, listTopics, ServiceBusEntityRef} from './servicebus-api.util';
import {ServiceBusNamespace} from './servicebus-namespace.model';

type EntityKind = 'queues' | 'topics';

/**
 * Edits one namespace's Azure coordinates and picks its entities. Closes with the updated
 * namespace. Changing a coordinate discards the picker state and selection, as they belong to
 * the old namespace. Entities load lazily to keep Azure calls minimal: nothing is fetched until a kind is chosen, then one
 * list call for that kind, and a topic's subscriptions only when that topic is expanded.
 */
@Component({
  selector: 'app-servicebus-namespace-dialog',
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatButtonToggleModule, MatCheckboxModule, MatDialogModule, MatFormFieldModule, MatIconModule, MatInputModule, MatProgressSpinnerModule],
  template: `
    <h2 mat-dialog-title>Namespace — {{ ns.name || 'new' }}</h2>
    <mat-dialog-content>
      <mat-form-field appearance="outline" class="field">
        <mat-label>Subscription ID</mat-label>
        <input matInput [(ngModel)]="ns.subscription_id" (ngModelChange)="coordinatesChanged()"/>
      </mat-form-field>
      <mat-form-field appearance="outline" class="field">
        <mat-label>Resource group</mat-label>
        <input matInput [(ngModel)]="ns.resource_group" (ngModelChange)="coordinatesChanged()"/>
      </mat-form-field>
      <mat-form-field appearance="outline" class="field">
        <mat-label>Namespace</mat-label>
        <input matInput [(ngModel)]="ns.namespace" (ngModelChange)="coordinatesChanged()" placeholder="my-namespace"/>
      </mat-form-field>
      <h3>Entities</h3>
      <mat-button-toggle-group [value]="kind()" [disabled]="!ready()" (change)="selectKind($event.value)" aria-label="Entity type">
        <mat-button-toggle value="queues">Queues</mat-button-toggle>
        <mat-button-toggle value="topics">Topics</mat-button-toggle>
      </mat-button-toggle-group>
      @if (!ready()) {
        <p class="hint">Fill in the three fields above to browse entities.</p>
      } @else if (!kind()) {
        <p class="hint">Choose queues or topics to load them.</p>
      } @else if (loading()) {
        <mat-spinner diameter="32"></mat-spinner>
      } @else if (error()) {
        <p class="error">{{ error() }}</p>
      } @else {
        <mat-form-field appearance="outline" subscriptSizing="dynamic" class="filter">
          <mat-label>Filter</mat-label>
          <input matInput [ngModel]="filter()" (ngModelChange)="filter.set($event)"/>
        </mat-form-field>
        @for (entity of visible(); track entity.path) {
          <div class="entity">
            @if (kind() === 'topics') {
              <button mat-icon-button type="button" (click)="toggleExpanded(entity.label)"
                      [attr.aria-label]="'Show subscriptions of ' + entity.label">
                <mat-icon>{{ expanded().has(entity.label) ? 'expand_more' : 'chevron_right' }}</mat-icon>
              </button>
            }
            <mat-checkbox [checked]="selected().has(entity.path)" (change)="toggle(entity.path, $event.checked)">
              {{ entity.label }}
            </mat-checkbox>
          </div>
          @if (kind() === 'topics' && expanded().has(entity.label)) {
            @if (subscriptionsLoading().has(entity.label)) {
              <mat-spinner class="indent" diameter="20"></mat-spinner>
            } @else if (subscriptionErrors()[entity.label]) {
              <p class="error indent">{{ subscriptionErrors()[entity.label] }}</p>
            } @else {
              @for (sub of subscriptions()[entity.label] ?? []; track sub.path) {
                <div class="entity indent">
                  <mat-checkbox [checked]="selected().has(sub.path)" (change)="toggle(sub.path, $event.checked)">
                    {{ sub.label.split(' / ')[1] }}
                  </mat-checkbox>
                </div>
              } @empty {
                <p class="hint indent">No subscriptions.</p>
              }
            }
          }
        } @empty {
          <p class="hint">No {{ kind() }} found.</p>
        }
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button color="primary" (click)="confirm()">Save ({{ selected().size }} entities)</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .field { width: 100%; }
    h3 { margin: 8px 0 4px; }
    .filter { width: 100%; margin: 12px 0 8px; }
    .entity { display: flex; align-items: center; }
    .indent { margin-left: 48px; }
    .hint { opacity: 0.7; }
    .error { color: #b3261e; }
    mat-button-toggle-group { margin-top: 4px; }
  `],
})
export class ServiceBusNamespaceDialogComponent {
  data = inject<{ ns: ServiceBusNamespace }>(MAT_DIALOG_DATA);
  private dialogRef = inject(MatDialogRef<ServiceBusNamespaceDialogComponent, ServiceBusNamespace>);
  /** Working copy; only handed back on Save. */
  ns: ServiceBusNamespace = {...this.data.ns};
  private shell = inject(ShellService);
  private token: string | null = null;

  kind = signal<EntityKind | null>(null);
  loading = signal(false);
  error = signal<string | null>(null);
  filter = signal('');
  /** Lists already fetched, so switching back and forth doesn't refetch. */
  private loaded: Partial<Record<EntityKind, ServiceBusEntityRef[]>> = {};
  entities = signal<ServiceBusEntityRef[]>([]);
  expanded = signal(new Set<string>());
  subscriptions = signal<Record<string, ServiceBusEntityRef[]>>({});
  subscriptionsLoading = signal(new Set<string>());
  subscriptionErrors = signal<Record<string, string>>({});
  selected = signal(new Set<string>(this.ns.entities));

  visible = computed(() => {
    const needle = this.filter().trim().toLowerCase();
    return needle ? this.entities().filter(e => e.label.toLowerCase().includes(needle)) : this.entities();
  });

  private http = (url: string, method: string, headers: [string, string][], body: string | null) =>
    this.shell.httpRequest(url, method, headers, body);

  ready = signal(this.isReady());

  private isReady(): boolean {
    return !!(this.ns.subscription_id.trim() && this.ns.resource_group.trim() && this.ns.namespace.trim());
  }

  coordinatesChanged(): void {
    this.token = null;
    this.loaded = {};
    this.kind.set(null);
    this.entities.set([]);
    this.error.set(null);
    this.expanded.set(new Set());
    this.subscriptions.set({});
    this.subscriptionErrors.set({});
    this.selected.set(new Set());
    this.ready.set(this.isReady());
  }

  private async getToken(): Promise<string> {
    return this.token ??= await this.shell.azureAccessToken();
  }

  async selectKind(kind: EntityKind): Promise<void> {
    this.kind.set(kind);
    this.error.set(null);
    this.filter.set('');
    const cached = this.loaded[kind];
    if (cached) {
      this.entities.set(cached);
      return;
    }
    this.entities.set([]);
    this.loading.set(true);
    try {
      const token = await this.getToken();
      const list = kind === 'queues'
        ? await listQueues(this.http, token, this.ns)
        : await listTopics(this.http, token, this.ns);
      this.loaded[kind] = list;
      if (this.kind() === kind) this.entities.set(list);
    } catch (e) {
      if (this.kind() === kind) this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      if (this.kind() === kind) this.loading.set(false);
    }
  }

  async toggleExpanded(topic: string): Promise<void> {
    const next = new Set(this.expanded());
    if (next.delete(topic)) {
      this.expanded.set(next);
      return;
    }
    next.add(topic);
    this.expanded.set(next);
    if (this.subscriptions()[topic]) return;
    this.subscriptionErrors.update(({[topic]: _, ...rest}) => rest);
    this.subscriptionsLoading.update(s => new Set(s).add(topic));
    try {
      const subs = await listSubscriptions(this.http, await this.getToken(), this.data.ns, topic);
      this.subscriptions.update(all => ({...all, [topic]: subs}));
    } catch (e) {
      this.subscriptionErrors.update(all => ({...all, [topic]: e instanceof Error ? e.message : String(e)}));
      // Collapse so the next click retries.
      this.expanded.update(s => {
        const copy = new Set(s);
        copy.delete(topic);
        return copy;
      });
    } finally {
      this.subscriptionsLoading.update(s => {
        const copy = new Set(s);
        copy.delete(topic);
        return copy;
      });
    }
  }

  toggle(path: string, checked: boolean): void {
    const next = new Set(this.selected());
    if (checked) next.add(path); else next.delete(path);
    this.selected.set(next);
  }

  confirm(): void {
    this.dialogRef.close({
      ...this.ns,
      subscription_id: this.ns.subscription_id.trim(),
      resource_group: this.ns.resource_group.trim(),
      namespace: this.ns.namespace.trim(),
      entities: [...this.selected()].sort(),
    });
  }
}
