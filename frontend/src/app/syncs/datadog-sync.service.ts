import {Injectable} from '@angular/core';
import {ConfigService} from '../config.service';
import {Item} from '../item.model';
import {SettingsSection, SyncProvider} from './sync-provider';
import {ShellService} from '../shell.service';

interface DatadogMonitor {
  id: number;
  name: string;
  status: string;
  overall_state_modified: number;
}

interface DatadogSearchResponse {
  monitors: DatadogMonitor[];
}

@Injectable()
export class DatadogSyncService extends SyncProvider {
  override readonly source = 'datadog';

  constructor(private configService: ConfigService, private shell: ShellService) {
    super();
  }

  override getSettingsFields(): SettingsSection {
    return {
      title: 'Datadog',
      fields: [
        {
          configKey: 'datadog_token',
          label: 'Datadog Personal Access Token',
          type: 'password',
        },
        {
          configKey: 'datadog_site',
          label: 'Datadog Site',
          type: 'url',
          placeholder: 'https://api.datadoghq.com',
        },
        {
          configKey: 'datadog_filter_query',
          label: 'Filter Query',
          type: 'text',
          hint: 'Datadog monitor search query. Combined with status:(Alert OR Warn). Leave blank to show all alerting monitors.',
        },
      ],
    };
  }

  override getPropertyOrder(): string[] {
    return ['Status'];
  }

  override needsMoreAttention(): boolean {
    return true;
  }

  override async sync(): Promise<Item[] | null> {
    const config = await this.configService.get();
    if (!config.datadog_token || !config.datadog_site) return null;

    const site = config.datadog_site.replace(/\/$/, '');
    const stateFilter = 'status:(Alert OR Warn)';
    const query = config.datadog_filter_query
      ? `${stateFilter} ${config.datadog_filter_query}`
      : stateFilter;

    const url = `${site}/api/v1/monitor/search?query=${encodeURIComponent(query)}&per_page=1000`;

    const raw = await this.shell.httpRequest(
      url,
      'GET',
      [
        ['Authorization', `Bearer ${config.datadog_token}`],
        ['Content-Type', 'application/json'],
      ],
      null,
    );

    const response: DatadogSearchResponse = JSON.parse(raw);

    return response.monitors.map(monitor => ({
      id: `datadog-${monitor.id}`,
      title: monitor.name,
      notes: null,
      source: 'datadog',
      state: 'open' as const,
      created_at: new Date(monitor.overall_state_modified * 1000).toISOString(),
      updated_at: new Date(monitor.overall_state_modified * 1000).toISOString(),
      due_date: null,
      properties: {Status: monitor.status},
      url: `${site}/monitors/${monitor.id}`,
    }));
  }
}
