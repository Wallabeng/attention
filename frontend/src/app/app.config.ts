import {ApplicationConfig, provideZoneChangeDetection} from '@angular/core';
import {provideAnimationsAsync} from '@angular/platform-browser/animations/async';
import {provideRouter} from '@angular/router';

import {routes} from './app.routes';
import {SYNC_PROVIDERS} from './syncs/sync-providers.token';
import {ACTION_PROVIDERS} from './syncs/action-providers.token';
import {GithubSyncService} from './syncs/github-sync.service';
import {GerritSyncService} from './syncs/gerrit-sync.service';
import {DatadogSyncService} from './syncs/datadog-sync.service';
import {GitlabSyncService} from './syncs/gitlab-sync.service';
import {GerritActionsService} from './syncs/gerrit-actions.service';
import {JenkinsSyncService} from './syncs/jenkins-sync.service';
import {JiraSyncService} from './syncs/jira-sync.service';
import {SonarqubeSyncService} from './syncs/sonarqube-sync.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({eventCoalescing: true}),
    provideRouter(routes),
    provideAnimationsAsync(),
    {provide: SYNC_PROVIDERS, useClass: GithubSyncService, multi: true},
    {provide: SYNC_PROVIDERS, useClass: GerritSyncService, multi: true},
    {provide: SYNC_PROVIDERS, useClass: DatadogSyncService, multi: true},
    {provide: SYNC_PROVIDERS, useClass: GitlabSyncService, multi: true},
    {provide: SYNC_PROVIDERS, useClass: JenkinsSyncService, multi: true},
    {provide: SYNC_PROVIDERS, useClass: JiraSyncService, multi: true},
    {provide: SYNC_PROVIDERS, useClass: SonarqubeSyncService, multi: true},
    {provide: ACTION_PROVIDERS, useClass: GerritActionsService, multi: true},
  ]
};
