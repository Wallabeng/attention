import {Injectable} from '@angular/core';
import {ConfigService} from '../config.service';
import {Item} from '../item.model';
import {SettingsSection, SyncProvider} from './sync-provider';
import {ShellService} from '../shell.service';

interface SonarqubeFavorite {
  key: string;
  name: string;
}

interface SonarqubeFavoritesResponse {
  favorites: SonarqubeFavorite[];
}

interface SonarqubeQualityGateCondition {
  status: string;
  metricKey: string;
  comparator: string;
  errorThreshold: string;
  actualValue: string;
}

interface SonarqubeQualityGateStatus {
  status: string;
  conditions: SonarqubeQualityGateCondition[];
}

interface SonarqubeQualityGateResponse {
  projectStatus: SonarqubeQualityGateStatus;
}

interface SonarqubeComponent {
  analysisDate?: string;
}

interface SonarqubeComponentResponse {
  component: SonarqubeComponent;
}

interface SonarqubeIssue {
  key: string;
  message: string;
  severity: string;
  type: string;
  project: string;
  creationDate: string;
  updateDate: string;
}

interface SonarqubeIssuesResponse {
  issues: SonarqubeIssue[];
}

interface SonarqubeHotspot {
  key: string;
  message: string;
  vulnerabilityProbability: string;
  creationDate: string;
  updateDate: string;
}

interface SonarqubeHotspotsResponse {
  hotspots: SonarqubeHotspot[];
}

const QUALITY_GATE_PREFIX = 'sonarqube-qg-';

@Injectable()
export class SonarqubeSyncService extends SyncProvider {
  override readonly source = 'sonarqube';

  constructor(private configService: ConfigService, private shell: ShellService) {
    super();
  }

  override getSettingsFields(): SettingsSection {
    return {
      title: 'SonarQube',
      fields: [
        {
          configKey: 'sonarqube_url',
          label: 'SonarQube URL',
          type: 'url',
          placeholder: 'https://sonarqube.example.com',
          hint: 'Base URL of your self-hosted SonarQube instance.',
        },
        {
          configKey: 'sonarqube_token',
          label: 'SonarQube Token',
          type: 'password',
          hint: 'User token from SonarQube → My Account → Security.',
        },
        {
          configKey: 'sonarqube_assigned_only',
          label: 'Only issues assigned to me',
          type: 'checkbox',
          hint: 'When off, issues from favorited projects are synced regardless of assignee.',
        },
      ],
    };
  }

  override getPropertyOrder(): string[] {
    return ['Project', 'Severity', 'Type', 'Vulnerability Probability'];
  }

  override needsMoreAttention(item: Item): boolean {
    return item.id.startsWith(QUALITY_GATE_PREFIX);
  }

  async sync(): Promise<Item[] | null> {
    const config = await this.configService.get();
    if (!config.sonarqube_url || !config.sonarqube_token) {
      return null;
    }

    const base = config.sonarqube_url.replace(/\/$/, '');
    const authHeader = this.authHeader(config.sonarqube_token);

    const favorites = await this.fetchFavorites(base, authHeader);

    const items: Item[] = [];
    for (const project of favorites) {
      const qgItem = await this.fetchQualityGateItem(base, authHeader, project);
      if (qgItem) items.push(qgItem);
    }
    const assignedOnly = config.sonarqube_assigned_only !== 'false';
    items.push(...await this.fetchIssueItems(base, authHeader, favorites, assignedOnly));
    for (const project of favorites) {
      items.push(...await this.fetchHotspotItems(base, authHeader, project));
    }
    return items;
  }

  private async fetchQualityGateItem(
    base: string,
    authHeader: [string, string],
    project: SonarqubeFavorite,
  ): Promise<Item | null> {
    try {
      const gateUrl = `${base}/api/qualitygates/project_status?projectKey=${encodeURIComponent(project.key)}`;
      const gateRaw = await this.shell.httpRequest(gateUrl, 'GET', [authHeader], null);
      const gateResponse: SonarqubeQualityGateResponse = JSON.parse(gateRaw);
      if (gateResponse.projectStatus.status !== 'ERROR') {
        return null;
      }

      const componentUrl = `${base}/api/components/show?component=${encodeURIComponent(project.key)}`;
      const componentRaw = await this.shell.httpRequest(componentUrl, 'GET', [authHeader], null);
      const componentResponse: SonarqubeComponentResponse = JSON.parse(componentRaw);
      const analysisDate = componentResponse.component.analysisDate ?? new Date().toISOString();

      return {
        id: `${QUALITY_GATE_PREFIX}${project.key}`,
        title: `Quality Gate failed: ${project.name}`,
        notes: null,
        source: 'sonarqube',
        state: 'open',
        created_at: analysisDate,
        updated_at: analysisDate,
        due_date: null,
        properties: null,
        url: `${base}/dashboard?id=${encodeURIComponent(project.key)}`,
      };
    } catch (e) {
      console.error('sonarqube quality gate', project.key, e);
      return null;
    }
  }

  private async fetchIssueItems(
    base: string,
    authHeader: [string, string],
    favorites: SonarqubeFavorite[],
    assignedOnly: boolean,
  ): Promise<Item[]> {
    if (favorites.length === 0) return [];
    try {
      const componentKeys = favorites.map(f => f.key).join(',');
      const assigneeFilter = assignedOnly ? '&assignees=__me__' : '';
      const url = `${base}/api/issues/search?resolved=false&componentKeys=${encodeURIComponent(componentKeys)}${assigneeFilter}`;
      const raw = await this.shell.httpRequest(url, 'GET', [authHeader], null);
      const response: SonarqubeIssuesResponse = JSON.parse(raw);
      return (response.issues ?? []).map(issue => ({
        id: `sonarqube-issue-${issue.key}`,
        title: issue.message,
        notes: null,
        source: 'sonarqube',
        state: 'open' as const,
        created_at: issue.creationDate,
        updated_at: issue.updateDate,
        due_date: null,
        properties: {Severity: issue.severity, Type: issue.type, Project: issue.project},
        url: `${base}/project/issues?id=${encodeURIComponent(issue.project)}&issues=${encodeURIComponent(issue.key)}&open=${encodeURIComponent(issue.key)}`,
      }));
    } catch (e) {
      console.error('sonarqube issues', e);
      return [];
    }
  }

  private async fetchHotspotItems(
    base: string,
    authHeader: [string, string],
    project: SonarqubeFavorite,
  ): Promise<Item[]> {
    try {
      const url = `${base}/api/hotspots/search?projectKey=${encodeURIComponent(project.key)}&status=TO_REVIEW`;
      const raw = await this.shell.httpRequest(url, 'GET', [authHeader], null);
      const response: SonarqubeHotspotsResponse = JSON.parse(raw);
      return (response.hotspots ?? []).map(hotspot => ({
        id: `sonarqube-hotspot-${hotspot.key}`,
        title: `Hotspot: ${hotspot.message}`,
        notes: null,
        source: 'sonarqube',
        state: 'open' as const,
        created_at: hotspot.creationDate,
        updated_at: hotspot.updateDate,
        due_date: null,
        properties: {'Vulnerability Probability': hotspot.vulnerabilityProbability, Project: project.key},
        url: `${base}/security_hotspots?id=${encodeURIComponent(project.key)}&hotspots=${encodeURIComponent(hotspot.key)}`,
      }));
    } catch (e) {
      console.error('sonarqube hotspots', project.key, e);
      return [];
    }
  }

  private authHeader(token: string): [string, string] {
    return ['Authorization', `Basic ${btoa(`${token}:`)}`];
  }

  private async fetchFavorites(base: string, authHeader: [string, string]): Promise<SonarqubeFavorite[]> {
    try {
      const raw = await this.shell.httpRequest(`${base}/api/favorites/search`, 'GET', [authHeader], null);
      const response: SonarqubeFavoritesResponse = JSON.parse(raw);
      return response.favorites ?? [];
    } catch (e) {
      console.error('sonarqube favorites', e);
      return [];
    }
  }
}
