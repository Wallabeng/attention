import {Component, inject} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {MatButtonModule} from '@angular/material/button';
import {MatCheckboxModule} from '@angular/material/checkbox';
import {MatChipInputEvent, MatChipsModule} from '@angular/material/chips';
import {MAT_DIALOG_DATA, MatDialogModule, MatDialogRef} from '@angular/material/dialog';
import {MatFormFieldModule} from '@angular/material/form-field';
import {MatIconModule} from '@angular/material/icon';
import {MatInputModule} from '@angular/material/input';
import {Item} from '../item.model';
import {ItemsService} from '../items.service';
import {SnoozeRule} from '../snooze-rule.model';
import {SnoozeRulesService} from '../snooze-rules.service';
import {guessGlobFromTitle, matchesAnyGlob} from '../glob.util';

export interface SnoozeGroupDialogData {
  items: Item[];
  item?: Item;
  existingRule?: SnoozeRule;
}

@Component({
  selector: 'app-snooze-group-dialog',
  standalone: true,
  imports: [
    FormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatChipsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ isEditingRule ? (isExpiredRule ? 'Reactivate snooze rule' : 'Edit snooze rule') : 'Snooze items like this' }}</h2>
    <mat-dialog-content>
      <mat-form-field appearance="outline" class="field">
        <mat-label>Title patterns</mat-label>
        <mat-chip-grid #patternGrid aria-label="Title patterns">
          @for (p of patterns; track p) {
            <mat-chip-row (removed)="removePattern(p)">
              {{ p }}
              <button matChipRemove [attr.aria-label]="'Remove ' + p">
                <mat-icon>cancel</mat-icon>
              </button>
            </mat-chip-row>
          }
        </mat-chip-grid>
        <input matInput [matChipInputFor]="patternGrid"
               placeholder="e.g. chore(deps): update * to *"
               (matChipInputTokenEnd)="addPattern($event)"/>
        <mat-hint>* matches anything, ? matches one character — press Enter to add a pattern</mat-hint>
      </mat-form-field>

      <p class="match-summary">
        @if (matches().length === 0) {
          No open items match this pattern.
        } @else {
          Matches {{ matches().length }} open item{{ matches().length === 1 ? '' : 's' }}:
        }
      </p>
      @if (matches().length > 0) {
        <ul class="match-list">
          @for (m of matches().slice(0, 6); track m.id) {
            <li>{{ m.title }}</li>
          }
          @if (matches().length > 6) {
            <li>&hellip; and {{ matches().length - 6 }} more</li>
          }
        </ul>
      }

      <mat-form-field appearance="outline" class="field">
        <mat-label>Snooze until</mat-label>
        <input matInput type="date" [(ngModel)]="untilDate"/>
      </mat-form-field>
      <div class="quick-dates">
        <button mat-stroked-button type="button" (click)="setQuickDate(7)">Next week</button>
        <button mat-stroked-button type="button" (click)="setQuickDate(14)">In 2 weeks</button>
        <button mat-stroked-button type="button" (click)="setQuickDate(30)">In a month</button>
      </div>

      @if (!isEditingRule) {
        <mat-checkbox [(ngModel)]="autoApply">
          Keep applying to new matching items until then
        </mat-checkbox>
      }
      @if (autoApply) {
        <mat-form-field appearance="outline" class="field">
          <mat-label>Rule name</mat-label>
          <input matInput [(ngModel)]="title" placeholder="e.g. Angular v18 migration"/>
        </mat-form-field>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button color="primary"
              [disabled]="patterns.length === 0 || !untilDate || (!isEditingRule && matches().length === 0)"
              (click)="confirm()">
        {{ isEditingRule ? (isExpiredRule ? 'Reactivate' : 'Save') : 'Snooze' }}
        @if (matches().length > 0) {
          {{ matches().length }} item{{ matches().length === 1 ? '' : 's' }}
        }
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    mat-dialog-content {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding-top: 8px !important;
      min-width: 420px;
    }

    .field {
      width: 100%;
    }

    .match-summary {
      margin: 4px 0;
      color: rgba(0, 0, 0, 0.6);
    }

    .match-list {
      margin: 0 0 8px;
      padding-left: 20px;
      font-size: 0.9em;
      color: rgba(0, 0, 0, 0.6);
    }

    .quick-dates {
      display: flex;
      gap: 8px;
      margin: 4px 0 16px;
    }
  `],
})
export class SnoozeGroupDialogComponent {
  data = inject<SnoozeGroupDialogData>(MAT_DIALOG_DATA);
  private dialogRef = inject(MatDialogRef<SnoozeGroupDialogComponent>);
  private items = inject(ItemsService);
  private snoozeRules = inject(SnoozeRulesService);

  isEditingRule = !!this.data.existingRule;
  isExpiredRule = !!this.data.existingRule && this.data.existingRule.until < this.today();
  patterns = this.data.existingRule?.patterns ?? [guessGlobFromTitle(this.data.item!.title)];
  title = this.data.existingRule?.title ?? guessGlobFromTitle(this.data.item!.title);
  untilDate = this.isExpiredRule || !this.data.existingRule ? this.defaultDate(7) : this.data.existingRule.until;
  autoApply = true;

  matches(): Item[] {
    if (this.patterns.length === 0) return [];
    return this.data.items.filter(i => i.state === 'open' && matchesAnyGlob(this.patterns, i.title));
  }

  addPattern(event: MatChipInputEvent): void {
    const value = (event.value || '').trim();
    if (value && !this.patterns.includes(value)) {
      this.patterns = [...this.patterns, value];
    }
    event.chipInput.clear();
  }

  removePattern(pattern: string): void {
    this.patterns = this.patterns.filter(p => p !== pattern);
  }

  setQuickDate(days: number): void {
    this.untilDate = this.defaultDate(days);
  }

  async confirm(): Promise<void> {
    const patterns = this.patterns;
    const until = this.untilDate;
    if (patterns.length === 0 || !until) return;
    await this.items.snoozeMatching(patterns, until);
    const existingRule = this.data.existingRule;
    if (existingRule) {
      await this.snoozeRules.updateRule(existingRule.id, {title: this.title.trim() || patterns[0], patterns, until});
    } else if (this.autoApply) {
      const title = this.title.trim() || patterns[0];
      await this.snoozeRules.addRule(title, patterns, until);
    }
    this.dialogRef.close();
  }

  private defaultDate(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }
}
