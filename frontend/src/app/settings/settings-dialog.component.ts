import {Component, inject, OnInit, signal} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {MatButtonModule} from '@angular/material/button';
import {MatDialogModule, MatDialogRef} from '@angular/material/dialog';
import {MatFormFieldModule} from '@angular/material/form-field';
import {MatIconModule} from '@angular/material/icon';
import {MatInputModule} from '@angular/material/input';
import {MatCheckboxModule} from '@angular/material/checkbox';
import {MatSlideToggleModule} from '@angular/material/slide-toggle';
import {MatSnackBar, MatSnackBarModule} from '@angular/material/snack-bar';
import {ConfigService} from '../config.service';
import {ShellService} from '../shell.service';
import {SYNC_PROVIDERS} from '../syncs/sync-providers.token';
import {SettingsSection} from '../syncs/sync-provider';

@Component({
  selector: 'app-settings-dialog',
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatCheckboxModule, MatDialogModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSlideToggleModule, MatSnackBarModule],
  template: `
    <h2 mat-dialog-title>Settings</h2>
    <mat-dialog-content>
      @for (section of sections; track section.title) {
        <h3 class="section-label">{{ section.title }}</h3>
        @for (field of section.fields; track field.configKey) {
          @if (field.type === 'checkbox') {
            <mat-checkbox
              class="field checkbox-field"
              [checked]="values[field.configKey] !== 'false'"
              (change)="values[field.configKey] = $event.checked ? 'true' : 'false'">
              {{ field.label }}
            </mat-checkbox>
            @if (field.hint) {
              <mat-hint class="checkbox-hint">{{ field.hint }}</mat-hint>
            }
          } @else {
            <mat-form-field appearance="outline" class="field">
              <mat-label>{{ field.label }}</mat-label>
              @if (field.type === 'textarea') {
                <textarea matInput rows="4"
                          [(ngModel)]="values[field.configKey]"
                          [placeholder]="field.placeholder ?? ''"></textarea>
              } @else {
                <input matInput
                       [type]="field.type === 'password' ? (showField(field.configKey) ? 'text' : 'password') : field.type"
                       [(ngModel)]="values[field.configKey]"
                       [placeholder]="field.placeholder ?? ''"/>
                @if (field.type === 'password') {
                  <button mat-icon-button matSuffix (click)="toggleShow(field.configKey)" type="button">
                    <mat-icon>{{ showField(field.configKey) ? 'visibility_off' : 'visibility' }}</mat-icon>
                  </button>
                }
              }
              @if (field.hint) {
                <mat-hint>{{ field.hint }}</mat-hint>
              }
            </mat-form-field>
          }
        }
      }
      <h3 class="section-label">Docker</h3>
      <mat-form-field appearance="outline" class="field">
        <mat-label>docker-compose.yaml path</mat-label>
        <input matInput [(ngModel)]="dockerComposePath" placeholder="/path/to/docker-compose.yaml"/>
        <mat-hint>Services defined here appear in the Docker tab.</mat-hint>
      </mat-form-field>
      <mat-form-field appearance="outline" class="field">
        <mat-label>Pull &amp; Start command</mat-label>
        <textarea matInput rows="2" [(ngModel)]="pullStartCommand"
                  placeholder="docker compose pull {{'{'}}service{{'}'}} && docker compose up -d {{'{'}}service{{'}'}}"></textarea>
        <mat-hint>
          Optional. Runs instead of the default pull+start when a service's "Pull &amp; Start" button
          is clicked. Use {{'{'}}service{{'}'}} (and optionally {{'{'}}compose_path{{'}'}}) as placeholders; runs through a shell.
        </mat-hint>
      </mat-form-field>
      <h3 class="section-label">Application</h3>
      <mat-slide-toggle
        [checked]="autostart()"
        (change)="onAutostartChange($event.checked)">
        Launch on login
      </mat-slide-toggle>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button color="primary" (click)="save()">Save</button>
    </mat-dialog-actions>
  `,
  styles: [`
    mat-dialog-content {
      padding-top: 8px !important;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .section-label {
      margin: 30px 0 4px;
    }

    .checkbox-field {
      margin: 8px 0;
    }

    .checkbox-hint {
      display: block;
      font-size: 12px;
      color: rgba(0, 0, 0, 0.6);
      margin: -4px 0 8px;
    }
  `],
})
export class SettingsDialogComponent implements OnInit {
  sections: SettingsSection[] = [];
  values: Record<string, string> = {};
  autostart = signal(false);
  dockerComposePath = '';
  pullStartCommand = '';

  private visibility = new Map<string, ReturnType<typeof signal<boolean>>>();
  private config = inject(ConfigService);
  private shell = inject(ShellService);
  private dialogRef = inject(MatDialogRef<SettingsDialogComponent>);
  private providers = inject(SYNC_PROVIDERS);
  private snackBar = inject(MatSnackBar);

  async ngOnInit(): Promise<void> {
    this.sections = this.providers
      .filter(p => typeof p.getSettingsFields === 'function')
      .map(p => p.getSettingsFields!());

    for (const section of this.sections) {
      for (const field of section.fields) {
        if (field.type === 'password') {
          this.visibility.set(field.configKey, signal(false));
        }
      }
    }

    const cfg = await this.config.get();
    for (const section of this.sections) {
      for (const field of section.fields) {
        this.values[field.configKey] = (cfg as unknown as Record<string, string | null>)[field.configKey] ?? '';
      }
    }
    this.dockerComposePath = cfg.docker_compose_path ?? '';
    this.pullStartCommand = cfg.pull_start_command ?? '';

    this.autostart.set(await this.shell.isAutostartEnabled());
  }

  async onAutostartChange(enabled: boolean): Promise<void> {
    // Applied immediately: the OS plugin is the source of truth, not Config JSON.
    await this.shell.setAutostart(enabled);
    this.autostart.set(enabled);
  }

  showField(key: string): boolean {
    return this.visibility.get(key)?.() ?? false;
  }

  toggleShow(key: string): void {
    const sig = this.visibility.get(key);
    if (sig) sig.set(!sig());
  }

  async save(): Promise<void> {
    const current = await this.config.get();
    const update = {...current};
    for (const section of this.sections) {
      for (const field of section.fields) {
        (update as unknown as Record<string, string | null>)[field.configKey] = this.values[field.configKey]?.trim() || null;
      }
    }
    update.docker_compose_path = this.dockerComposePath.trim() || null;
    update.pull_start_command = this.pullStartCommand.trim() || null;
    try {
      await this.config.set(update);
    } catch (e) {
      this.snackBar.open(`Could not save settings: ${e instanceof Error ? e.message : String(e)}`, 'Dismiss');
      return;
    }
    this.dialogRef.close(true);
  }
}
