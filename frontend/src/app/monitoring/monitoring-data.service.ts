import {Injectable} from '@angular/core';
import {ShellService} from '../shell.service';
import {MonitoringStage} from './monitoring-stage.model';
import {MergedGrid, mergeGridResults} from './monitoring-grid-merge.util';

interface TenantGroupRecord {
  tenantGroup?: { matchCode?: string };
}

@Injectable({providedIn: 'root'})
export class MonitoringDataService {
  private tokens = new Map<string, string>();
  private tenantGroups = new Map<string, string[]>();

  constructor(private shell: ShellService) {
  }

  private async fetchToken(stage: MonitoringStage): Promise<string> {
    const credentials = btoa(`${stage.basic_auth_username}:${stage.basic_auth_password}`);
    const url = `${stage.token_base_url}/cas/oidc/oidcAccessToken?grant_type=client_credentials&scope=openid`;
    const raw = await this.shell.httpRequest(url, 'GET', [['Authorization', `Basic ${credentials}`]], null);
    const parsed = JSON.parse(raw) as { access_token: string };
    this.tokens.set(stage.name, parsed.access_token);
    return parsed.access_token;
  }

  private async getToken(stage: MonitoringStage): Promise<string> {
    const cached = this.tokens.get(stage.name);
    return cached ?? this.fetchToken(stage);
  }

  private async fetchTenantGroupsWithToken(stage: MonitoringStage, token: string): Promise<string[]> {
    const url = `${stage.tenant_list_base_url}/crossng-systemmanagement/api/sysconfig/v1/tenants`;
    const raw = await this.shell.httpRequest(url, 'GET', [['Authorization', `Bearer ${token}`]], null);
    const records = JSON.parse(raw) as TenantGroupRecord[];
    return [...new Set(records
      .map(r => r.tenantGroup?.matchCode)
      .filter((matchCode): matchCode is string => !!matchCode))].sort();
  }

  async getTenantGroups(stage: MonitoringStage, forceRefresh = false): Promise<string[]> {
    if (!forceRefresh) {
      const cached = this.tenantGroups.get(stage.name);
      if (cached) return cached;
    }
    let groups: string[];
    try {
      groups = await this.fetchTenantGroupsWithToken(stage, await this.getToken(stage));
    } catch {
      // The cached token may have expired (401) — refetch once and retry.
      try {
        groups = await this.fetchTenantGroupsWithToken(stage, await this.fetchToken(stage));
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        throw new Error(`Failed to fetch tenant groups for stage "${stage.name}": ${message}`);
      }
    }
    this.tenantGroups.set(stage.name, groups);
    return groups;
  }

  async fetchGrid(
    stage: MonitoringStage,
    gridPath: string,
    forceRefresh = false,
    requestId: string = crypto.randomUUID(),
  ): Promise<MergedGrid & { sessionExpired: boolean }> {
    const tenantGroups = await this.getTenantGroups(stage, forceRefresh);
    const results = await this.shell.fetchGridData(
      stage.name,
      stage.tenant_base_url_template,
      gridPath,
      tenantGroups,
      requestId,
    );
    const merged = mergeGridResults(results);
    const sessionExpired = results.some(r => r.url_mismatch === true);
    return {...merged, sessionExpired};
  }
}
