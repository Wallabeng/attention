import {Component, computed, inject, OnInit, signal} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {MatButtonModule} from '@angular/material/button';
import {MatCheckboxModule} from '@angular/material/checkbox';
import {MAT_DIALOG_DATA, MatDialogModule, MatDialogRef} from '@angular/material/dialog';
import {MatFormFieldModule} from '@angular/material/form-field';
import {MatInputModule} from '@angular/material/input';
import {MatProgressSpinnerModule} from '@angular/material/progress-spinner';
import {ShellService} from '../shell.service';
import {listNamespaceEntities, ServiceBusEntityRef} from './servicebus-api.util';
import {ServiceBusNamespace} from './servicebus-namespace.model';

@Component({
  selector: 'app-servicebus-entity-picker-dialog',
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatCheckboxModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatProgressSpinnerModule],
  template: `
    <h2 mat-dialog-title>Select entities — {{ data.ns.name }}</h2>
    <mat-dialog-content>
      @if (loading()) {
        <mat-spinner diameter="32"></mat-spinner>
      } @else if (error()) {
        <p class="error">{{ error() }}</p>
      } @else {
        <mat-form-field appearance="outline" subscriptSizing="dynamic" class="filter">
          <mat-label>Filter</mat-label>
          <input matInput [ngModel]="filter()" (ngModelChange)="filter.set($event)"/>
        </mat-form-field>
        @for (entity of visible(); track entity.path) {
          <div class="entity" [class.indent]="entity.type === 'subscription'">
            <mat-checkbox [checked]="selected().has(entity.path)" (change)="toggle(entity.path, $event.checked)">
              {{ entity.label }} <span class="type">{{ entity.type }}</span>
            </mat-checkbox>
          </div>
        }
        @if (visible().length === 0) {
          <p>No entities found.</p>
        }
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button color="primary" [disabled]="loading() || !!error()" (click)="confirm()">
        Select ({{ selected().size }})
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .filter { width: 100%; margin-bottom: 8px; }
    .entity { display: block; }
    .indent { margin-left: 24px; }
    .type { opacity: 0.6; font-size: 12px; margin-left: 6px; }
    .error { color: #b3261e; }
  `],
})
export class ServiceBusEntityPickerDialogComponent implements OnInit {
  data = inject<{ ns: ServiceBusNamespace }>(MAT_DIALOG_DATA);
  private dialogRef = inject(MatDialogRef<ServiceBusEntityPickerDialogComponent, string[]>);
  private shell = inject(ShellService);

  loading = signal(true);
  error = signal<string | null>(null);
  filter = signal('');
  entities = signal<ServiceBusEntityRef[]>([]);
  selected = signal(new Set<string>(this.data.ns.entities));

  visible = computed(() => {
    const needle = this.filter().trim().toLowerCase();
    return needle ? this.entities().filter(e => e.path.toLowerCase().includes(needle)) : this.entities();
  });

  async ngOnInit(): Promise<void> {
    try {
      const token = await this.shell.azureAccessToken();
      this.entities.set(await listNamespaceEntities(
        (url, method, headers, body) => this.shell.httpRequest(url, method, headers, body), token, this.data.ns));
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.loading.set(false);
    }
  }

  toggle(path: string, checked: boolean): void {
    const next = new Set(this.selected());
    if (checked) next.add(path); else next.delete(path);
    this.selected.set(next);
  }

  confirm(): void {
    // Keep the listing's order; entities that no longer exist stay out of the selection.
    this.dialogRef.close(this.entities().map(e => e.path).filter(p => this.selected().has(p)));
  }
}
