import {Component, inject, OnInit, signal} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {MatButtonModule} from '@angular/material/button';
import {MatDialog, MatDialogModule, MatDialogRef} from '@angular/material/dialog';
import {MatFormFieldModule} from '@angular/material/form-field';
import {MatIconModule} from '@angular/material/icon';
import {MatInputModule} from '@angular/material/input';
import {MatCheckboxModule} from '@angular/material/checkbox';
import {MatSlideToggleModule} from '@angular/material/slide-toggle';
import {MatSnackBar, MatSnackBarModule} from '@angular/material/snack-bar';
import {ConfigService} from '../config.service';
import {ServiceBusNamespaceDialogComponent} from '../servicebus/servicebus-namespace-dialog.component';
import {ServiceBusNamespace} from '../servicebus/servicebus-namespace.model';
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
      <h3 class="section-label">Service Bus</h3>
      @for (ns of servicebusNamespaces; track $index) {
        <div class="namespace-row">
          <mat-form-field appearance="outline" class="namespace-name">
            <mat-label>Name</mat-label>
            <input matInput [(ngModel)]="ns.name" placeholder="prod"/>
          </mat-form-field>
          <button mat-stroked-button type="button" class="namespace-select" (click)="configureNamespace(ns)">
            {{ ns.namespace ? ns.entities.length + ' entities' : 'Configure…' }}
          </button>
          <button mat-icon-button type="button" (click)="removeNamespace($index)" aria-label="Remove namespace">
            <mat-icon>delete</mat-icon>
          </button>
        </div>
      }
      <div>
        <button mat-button type="button" (click)="addNamespace()"><mat-icon>add</mat-icon> Add namespace</button>
      </div>
      <mat-hint class="checkbox-hint">Uses your <code>az login</code> session; the Reader role on the namespace is enough. Configure each namespace to pick the entities shown in the Service Bus tab.</mat-hint>
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
    .field {
      margin-bottom: 25px;
    }
    mat-dialog-content {
      padding-top: 8px !important;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .section-label {
      margin: 30px 0 4px;
    }

    .namespace-row {
      display: flex;
      align-items: flex-start;
      gap: 8px;
    }

    .namespace-name {
      flex: 1;
    }

    .namespace-select {
      margin-top: 8px;
      white-space: nowrap;
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
  servicebusNamespaces: ServiceBusNamespace[] = [];

  private visibility = new Map<string, ReturnType<typeof signal<boolean>>>();
  private config = inject(ConfigService);
  private shell = inject(ShellService);
  private dialogRef = inject(MatDialogRef<SettingsDialogComponent>);
  private providers = inject(SYNC_PROVIDERS);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);

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
    this.servicebusNamespaces = (cfg.servicebus_namespaces ?? []).map(ns => ({...ns, entities: [...ns.entities]}));

    this.autostart.set(await this.shell.isAutostartEnabled());
  }

  async onAutostartChange(enabled: boolean): Promise<void> {
    // Applied immediately: the OS plugin is the source of truth, not Config JSON.
    await this.shell.setAutostart(enabled);
    this.autostart.set(enabled);
  }

  addNamespace(): void {
    this.servicebusNamespaces.push({name: '', subscription_id: '', resource_group: '', namespace: '', entities: []});
  }

  configureNamespace(ns: ServiceBusNamespace): void {
    this.dialog
      .open<ServiceBusNamespaceDialogComponent, { ns: ServiceBusNamespace }, ServiceBusNamespace>(
        ServiceBusNamespaceDialogComponent, {data: {ns}, width: '520px'})
      .afterClosed()
      .subscribe(updated => {
        if (updated) Object.assign(ns, updated);
      });
  }

  removeNamespace(index: number): void {
    this.servicebusNamespaces.splice(index, 1);
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
    update.servicebus_namespaces = this.servicebusNamespaces
      .map(ns => ({
        ...ns,
        name: ns.name.trim(),
        subscription_id: ns.subscription_id.trim(),
        resource_group: ns.resource_group.trim(),
        namespace: ns.namespace.trim(),
      }))
      .filter(ns => ns.name && ns.subscription_id && ns.resource_group && ns.namespace);
    try {
      await this.config.set(update);
    } catch (e) {
      this.snackBar.open(`Could not save settings: ${e instanceof Error ? e.message : String(e)}`, 'Dismiss');
      return;
    }
    this.dialogRef.close(true);
  }
}
