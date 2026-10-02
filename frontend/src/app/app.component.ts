import {Component, OnInit, signal} from '@angular/core';
import {MatBadgeModule} from '@angular/material/badge';
import {MatButtonModule} from '@angular/material/button';
import {MatDialog} from '@angular/material/dialog';
import {MatIconModule} from '@angular/material/icon';
import {MatSnackBar, MatSnackBarModule} from '@angular/material/snack-bar';
import {MatToolbarModule} from '@angular/material/toolbar';
import {ItemsService} from './items.service';
import {DockerComponent} from './docker/docker.component';
import {InboxComponent} from './inbox/inbox.component';
import {MonitoringComponent} from './monitoring/monitoring.component';
import {SettingsDialogComponent} from './settings/settings-dialog.component';
import {ShellService} from './shell.service';
import {SourcesService} from './sources.service';
import {SnoozeRulesService} from './snooze-rules.service';
import {SourcesSidebarComponent} from './sources-sidebar/sources-sidebar.component';
import {WhatsNewService} from './whats-new/whats-new.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    DockerComponent,
    InboxComponent,
    MatBadgeModule,
    MatButtonModule,
    MatIconModule,
    MatSnackBarModule,
    MatToolbarModule,
    MonitoringComponent,
    SourcesSidebarComponent,
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent implements OnInit {
  sidebarOpen = signal(true);
  activeView = signal<'inbox' | 'monitoring' | 'docker'>('inbox');

  constructor(
    protected items: ItemsService,
    protected sources: SourcesService,
    private snoozeRules: SnoozeRulesService,
    private shell: ShellService,
    private dialog: MatDialog,
    private snackBar: MatSnackBar,
    private whatsNew: WhatsNewService,
  ) {
  }

  async ngOnInit(): Promise<void> {
    await this.snoozeRules.load();
    await this.items.load();
    this.sources.load();
    this.shell.requestNotificationPermission();
    await this.whatsNew.showIfNew().catch(() => {});
  }

  toggleSidebar(): void {
    this.sidebarOpen.update(v => !v);
  }

  openSettings(): void {
    this.dialog.open(SettingsDialogComponent, {minWidth: '560px'});
  }

  async sync(): Promise<void> {
    if (this.items.syncing()) return;
    const errors = await this.items.sync();
    if (errors.length > 0) {
      this.snackBar.open(errors.join(' | '), 'Dismiss', {duration: 5000});
    }
  }
}
