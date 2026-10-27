import {DatePipe} from '@angular/common';
import {Component, inject, OnInit, signal} from '@angular/core';
import {MatButtonModule} from '@angular/material/button';
import {MAT_DIALOG_DATA, MatDialogModule} from '@angular/material/dialog';
import {MatIconModule} from '@angular/material/icon';
import {MatProgressSpinnerModule} from '@angular/material/progress-spinner';
import {MatButtonToggleModule} from '@angular/material/button-toggle';
import {ShellService} from '../shell.service';
import {PeekedMessage, ServiceBusEntityRow} from './servicebus-api.util';

const PEEK_COUNT = 20;

@Component({
  selector: 'app-servicebus-peek-dialog',
  standalone: true,
  imports: [DatePipe, MatButtonModule, MatButtonToggleModule, MatDialogModule, MatIconModule, MatProgressSpinnerModule],
  template: `
    <h2 mat-dialog-title>Peek: {{ row.namespace }} / {{ row.name }}</h2>
    <mat-dialog-content class="peek-content">
      <div class="peek-toolbar">
        <mat-button-toggle-group [value]="deadLetter()" (change)="setDeadLetter($event.value)" hideSingleSelectionIndicator>
          <mat-button-toggle [value]="false">Active ({{ row.active }})</mat-button-toggle>
          <mat-button-toggle [value]="true">Dead-letter ({{ row.deadLetter }})</mat-button-toggle>
        </mat-button-toggle-group>
        <span class="hint">First {{ peekCount }} messages, read-only — nothing is locked or consumed.</span>
        <button mat-icon-button (click)="load()" [disabled]="loading()" aria-label="Reload peek">
          <mat-icon>refresh</mat-icon>
        </button>
      </div>
      @if (loading()) {
        <mat-spinner diameter="28"></mat-spinner>
      } @else if (error()) {
        <p class="peek-error">{{ error() }}</p>
      } @else if (messages().length === 0) {
        <p class="hint">No messages.</p>
      }
      @for (m of messages(); track m.sequence_number) {
        <details class="peek-message">
          <summary>
            <span class="seq">#{{ m.sequence_number }}</span>
            <span>{{ m.subject || m.message_id || '(no subject)' }}</span>
            <span class="hint">{{ m.enqueued_time_ms | date: 'medium' }}</span>
          </summary>
          @if (m.dead_letter_reason) {
            <p class="dl-reason"><strong>{{ m.dead_letter_reason }}</strong>
              @if (m.dead_letter_error_description) { — {{ m.dead_letter_error_description }} }
            </p>
          }
          <dl>
            @for (f of fields(m); track f[0]) {
              <dt>{{ f[0] }}</dt>
              <dd>{{ f[1] }}</dd>
            }
          </dl>
          <pre class="body">{{ pretty(m) }}</pre>
        </details>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Close</button>
    </mat-dialog-actions>
  `,
  styles: `
    .peek-content { min-width: 640px; }
    .peek-toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
    .hint { font-size: 12px; opacity: 0.7; }
    .peek-error { color: #b3261e; white-space: pre-wrap; }
    .peek-message { border: 1px solid rgba(128, 128, 128, 0.3); border-radius: 4px; padding: 6px 10px; margin-bottom: 6px; }
    summary { cursor: pointer; display: flex; gap: 12px; align-items: baseline; }
    .seq { font-family: monospace; opacity: 0.7; }
    .dl-reason { color: #b3261e; margin: 8px 0 0; }
    dl { display: grid; grid-template-columns: max-content 1fr; gap: 2px 12px; font-size: 12px; margin: 8px 0; }
    dt { opacity: 0.7; }
    dd { margin: 0; word-break: break-all; }
    .body { max-height: 240px; overflow: auto; background: rgba(128, 128, 128, 0.12); padding: 8px; border-radius: 4px; white-space: pre-wrap; word-break: break-all; font-size: 12px; margin: 0; }
  `,
})
export class ServiceBusPeekDialogComponent implements OnInit {
  readonly row = inject<ServiceBusEntityRow>(MAT_DIALOG_DATA);
  private shell = inject(ShellService);
  readonly peekCount = PEEK_COUNT;

  deadLetter = signal(this.row.deadLetter > 0);
  loading = signal(false);
  error = signal('');
  messages = signal<PeekedMessage[]>([]);
  /** Guards against a slower earlier peek overwriting a newer one after toggling. */
  private seq = 0;

  ngOnInit(): Promise<void> {
    return this.load();
  }

  setDeadLetter(value: boolean): Promise<void> {
    this.deadLetter.set(value);
    return this.load();
  }

  async load(): Promise<void> {
    const seq = ++this.seq;
    this.loading.set(true);
    this.error.set('');
    try {
      const messages = await this.shell.servicebusPeek(this.row.namespaceName, this.row.entityPath, this.deadLetter(), PEEK_COUNT);
      if (seq !== this.seq) return;
      this.messages.set(messages);
    } catch (e) {
      if (seq !== this.seq) return;
      this.messages.set([]);
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      if (seq === this.seq) this.loading.set(false);
    }
  }

  fields(m: PeekedMessage): [string, string][] {
    const base: [string, string | number | null][] = [
      ['Message ID', m.message_id], ['Correlation ID', m.correlation_id], ['Session ID', m.session_id],
      ['Content type', m.content_type], ['Delivery count', m.delivery_count],
    ];
    return [
      ...base.filter((f): f is [string, string | number] => f[1] !== null && f[1] !== '').map(([k, v]): [string, string] => [k, String(v)]),
      ...m.properties,
    ];
  }

  /** Pretty-prints JSON bodies; anything else is shown verbatim. */
  pretty(m: PeekedMessage): string {
    try {
      return JSON.stringify(JSON.parse(m.body), null, 2);
    } catch {
      return m.body;
    }
  }
}
