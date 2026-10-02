import {Injectable} from '@angular/core';
import {MatDialog} from '@angular/material/dialog';
import {firstValueFrom} from 'rxjs';
import {ShellService} from '../shell.service';
import featureLog from '../../../../features.json';
import {Feature, groupByVersion, unseenFeatures} from './whats-new.util';
import {WhatsNewDialogComponent} from './whats-new-dialog.component';

@Injectable({providedIn: 'root'})
export class WhatsNewService {
  private readonly features: Feature[] = featureLog;

  constructor(private shell: ShellService, private dialog: MatDialog) {
  }

  /**
   * Shows every feature newer than the user's marker. The marker only advances
   * once the dialog is closed, so a crash while it is open shows it again.
   */
  async showIfNew(): Promise<void> {
    const latest = this.features[this.features.length - 1];
    if (!latest) return;

    const unseen = unseenFeatures(this.features, await this.shell.getLastSeenFeature());
    if (unseen.length === 0) return;

    const ref = this.dialog.open(WhatsNewDialogComponent, {
      minWidth: '480px',
      maxHeight: '80vh',
      data: {groups: groupByVersion(unseen)},
    });
    await firstValueFrom(ref.afterClosed(), {defaultValue: undefined});
    await this.shell.setLastSeenFeature(latest.id);
  }
}
