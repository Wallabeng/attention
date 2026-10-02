import {Component, inject} from '@angular/core';
import {MatButtonModule} from '@angular/material/button';
import {MAT_DIALOG_DATA, MatDialogModule} from '@angular/material/dialog';
import {FeatureGroup} from './whats-new.util';

@Component({
  selector: 'app-whats-new-dialog',
  standalone: true,
  imports: [MatButtonModule, MatDialogModule],
  styles: `
    h3 { margin: 16px 0 4px; }
    h3:first-child { margin-top: 0; }
    ul { margin: 0; padding-left: 20px; }
    li { margin: 6px 0; }
    .description { display: block; opacity: 0.75; }
  `,
  template: `
    <h2 mat-dialog-title>What's new</h2>
    <mat-dialog-content>
      @for (group of data.groups; track group.version) {
        <h3>{{ group.version ? 'Version ' + group.version : 'Upcoming' }}</h3>
        <ul>
          @for (f of group.features; track f.id) {
            <li>
              <strong>{{ f.title }}</strong>
              <span class="description">{{ f.description }}</span>
            </li>
          }
        </ul>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-flat-button color="primary" mat-dialog-close>Got it</button>
    </mat-dialog-actions>
  `,
})
export class WhatsNewDialogComponent {
  data = inject<{groups: FeatureGroup[]}>(MAT_DIALOG_DATA);
}
