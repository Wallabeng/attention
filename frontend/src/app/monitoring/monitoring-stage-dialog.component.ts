import {Component, Inject} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {MatButtonModule} from '@angular/material/button';
import {MAT_DIALOG_DATA, MatDialogModule, MatDialogRef} from '@angular/material/dialog';
import {MatFormFieldModule} from '@angular/material/form-field';
import {MatInputModule} from '@angular/material/input';
import {MonitoringStage} from './monitoring-stage.model';

export interface MonitoringStageDialogData {
  stage?: MonitoringStage;
}

@Component({
  selector: 'app-monitoring-stage-dialog',
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatInputModule],
  template: `
    <h2 mat-dialog-title>{{ data.stage ? 'Edit stage' : 'Add stage' }}</h2>
    <mat-dialog-content class="form">
      <mat-form-field appearance="outline">
        <mat-label>Name</mat-label>
        <input matInput [(ngModel)]="stage.name" [disabled]="!!data.stage" placeholder="dev"/>
      </mat-form-field>
      <mat-form-field appearance="outline">
        <mat-label>Token base URL</mat-label>
        <input matInput [(ngModel)]="stage.token_base_url" placeholder="https://cas.dev.example.com"/>
      </mat-form-field>
      <mat-form-field appearance="outline">
        <mat-label>Tenant-group-list base URL</mat-label>
        <input matInput [(ngModel)]="stage.tenant_list_base_url" placeholder="https://sysmgmt.dev.example.com"/>
      </mat-form-field>
      <mat-form-field appearance="outline">
        <mat-label>Tenant-group base URL template</mat-label>
        <input matInput [(ngModel)]="stage.tenant_base_url_template" placeholder="https://{tenantGroup}.dev.example.com"/>
        <mat-hint>Must contain the literal placeholder {{ '{tenantGroup}' }}</mat-hint>
      </mat-form-field>
      <mat-form-field appearance="outline">
        <mat-label>SSO login URL</mat-label>
        <input matInput [(ngModel)]="stage.sso_login_url" placeholder="https://login.dev.example.com"/>
      </mat-form-field>
      <mat-form-field appearance="outline">
        <mat-label>Basic auth username</mat-label>
        <input matInput [(ngModel)]="stage.basic_auth_username"/>
      </mat-form-field>
      <mat-form-field appearance="outline">
        <mat-label>Basic auth password</mat-label>
        <input matInput type="password" [(ngModel)]="stage.basic_auth_password"/>
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button color="primary" (click)="save()" [disabled]="!stage.name">Save</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .form {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding-top: 8px;
    }
  `],
})
export class MonitoringStageDialogComponent {
  stage: MonitoringStage;

  constructor(
    private dialogRef: MatDialogRef<MonitoringStageDialogComponent, MonitoringStage>,
    @Inject(MAT_DIALOG_DATA) public data: MonitoringStageDialogData,
  ) {
    this.stage = data.stage ? {...data.stage} : {
      name: '',
      token_base_url: '',
      tenant_list_base_url: '',
      tenant_base_url_template: '',
      sso_login_url: '',
      basic_auth_username: '',
      basic_auth_password: '',
    };
  }

  save(): void {
    this.dialogRef.close(this.stage);
  }
}
