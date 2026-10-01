import {Config} from '../config.model';
import {ConfigService} from '../config.service';
import {MonitoringColumnPrefsService} from './monitoring-column-prefs.service';

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    github_token: null,
    github_repos: null,
    gerrit_url: null,
    gerrit_username: null,
    gerrit_http_password: null,
    datadog_token: null,
    datadog_site: null,
    datadog_filter_query: null,
    gitlab_url: null,
    gitlab_token: null,
    gitlab_mr_labels: null,
    jenkins_url: null,
    jenkins_username: null,
    jenkins_api_token: null,
    jenkins_jobs: null,
    jenkins_folders: null,
    jenkins_excluded_paths: null,
    jira_url: null,
    jira_token: null,
    jira_jql_filter: null,
    gerrit_repos_root: null,
    gerrit_keywords: null,
    sonarqube_url: null,
    sonarqube_token: null,
    sonarqube_assigned_only: null,
    muted_sources: [],
    snooze_rules: [],
    monitoring_stages: [],
    monitoring_hidden_columns: {},
    docker_compose_path: null,
    pull_start_command: null,
    docker_favorite_services: [],
    ...overrides,
  };
}

function createService(initial: Record<string, string[]> = {}): {
  service: MonitoringColumnPrefsService;
  config: { get: jasmine.Spy; set: jasmine.Spy };
  stored(): Record<string, string[]>;
} {
  let current = makeConfig({monitoring_hidden_columns: {...initial}});
  const config = {
    get: jasmine.createSpy('get').and.callFake(() => Promise.resolve(current)),
    set: jasmine.createSpy('set').and.callFake((next: Config) => {
      current = next;
      return Promise.resolve();
    }),
  };
  const service = new MonitoringColumnPrefsService(config as unknown as ConfigService);
  return {service, config, stored: () => current.monitoring_hidden_columns};
}

describe('MonitoringColumnPrefsService', () => {
  it('load() hydrates the signal from ConfigService.monitoring_hidden_columns', async () => {
    const {service} = createService({'grid-a': ['col1']});
    await service.load();
    expect(service.hiddenFor('grid-a')).toEqual(new Set(['col1']));
  });

  it('load() defaults to empty when the config has no monitoring_hidden_columns field', async () => {
    const {service, config} = createService();
    // Simulate a legacy config with the field absent entirely.
    config.get.and.callFake(() => Promise.resolve({...makeConfig(), monitoring_hidden_columns: undefined as unknown as Record<string, string[]>}));
    await service.load();
    expect(service.hiddenFor('grid-a')).toEqual(new Set());
  });

  it('hiddenFor() returns an empty Set for a grid key with no stored prefs', async () => {
    const {service} = createService();
    await service.load();
    expect(service.hiddenFor('unknown-grid')).toEqual(new Set());
  });

  it('setHiddenFor() persists the new column list under the given grid key', async () => {
    const {service, stored} = createService();
    await service.load();
    await service.setHiddenFor('grid-a', ['col1', 'col2']);
    expect(service.hiddenFor('grid-a')).toEqual(new Set(['col1', 'col2']));
    expect(stored()).toEqual({'grid-a': ['col1', 'col2']});
  });

  it('setHiddenFor([]) removes the grid key from the persisted map (no empty-array entries left behind)', async () => {
    const {service, stored} = createService({'grid-a': ['col1']});
    await service.load();
    await service.setHiddenFor('grid-a', []);
    expect(stored()).toEqual({});
  });

  it('toggleColumn() adds a column not currently hidden, then removes it on the second call', async () => {
    const {service, stored} = createService();
    await service.load();
    await service.toggleColumn('grid-a', 'col1');
    expect(service.hiddenFor('grid-a')).toEqual(new Set(['col1']));
    await service.toggleColumn('grid-a', 'col1');
    expect(service.hiddenFor('grid-a')).toEqual(new Set());
    expect(stored()).toEqual({}); // and cleaned up, not left as {'grid-a': []}
  });

  it('showAll() clears the current grid key\'s hidden set without touching other grid keys', async () => {
    const {service, stored} = createService({'grid-a': ['col1'], 'grid-b': ['col2']});
    await service.load();
    await service.showAll('grid-a');
    expect(stored()).toEqual({'grid-b': ['col2']});
  });

  it('hideAllExceptTenantGroup() persists every column except tenantGroup', async () => {
    const {service, stored} = createService();
    await service.load();
    await service.hideAllExceptTenantGroup('grid-a', ['tenantGroup', 'col1', 'col2']);
    expect(stored()['grid-a']).toEqual(['col1', 'col2']);
    expect(service.hiddenFor('grid-a').has('tenantGroup')).toBeFalse();
  });

  it('set operations preserve unrelated grid keys already in the persisted map', async () => {
    const {service, stored} = createService({'grid-a': ['col1']});
    await service.load();
    await service.setHiddenFor('grid-b', ['col2']);
    expect(stored()).toEqual({'grid-a': ['col1'], 'grid-b': ['col2']});
  });
});
