import {MonitoringDataService} from './monitoring-data.service';
import {MonitoringStage} from './monitoring-stage.model';
import {TenantGridResult} from './tenant-grid-result.model';

function makeStage(overrides: Partial<MonitoringStage> = {}): MonitoringStage {
  return {
    name: 'stage1',
    token_base_url: 'https://token.example.com',
    tenant_list_base_url: 'https://tenants.example.com',
    tenant_base_url_template: 'https://{tenant}.example.com',
    sso_login_url: 'https://sso.example.com',
    basic_auth_username: 'user',
    basic_auth_password: 'pass',
    ...overrides,
  };
}

function createService(mockShell: { httpRequest: jasmine.Spy; fetchGridData: jasmine.Spy }): MonitoringDataService {
  return new MonitoringDataService(mockShell as any);
}

describe('MonitoringDataService.getTenantGroups', () => {
  it('returns the cached list on a second call without re-fetching', async () => {
    const httpRequest = jasmine.createSpy('httpRequest').and.callFake((url: string) => {
      if (url.includes('oidcAccessToken')) {
        return Promise.resolve(JSON.stringify({access_token: 'tok'}));
      }
      return Promise.resolve(JSON.stringify([{tenantGroup: {matchCode: 'g1'}}]));
    });
    const fetchGridData = jasmine.createSpy('fetchGridData');
    const service = createService({httpRequest, fetchGridData});
    const stage = makeStage();

    const first = await service.getTenantGroups(stage);
    expect(first).toEqual(['g1']);
    const callsAfterFirst = httpRequest.calls.count();
    expect(callsAfterFirst).toBeGreaterThan(0);

    const second = await service.getTenantGroups(stage);
    expect(second).toEqual(['g1']);
    expect(httpRequest.calls.count()).toBe(callsAfterFirst);
  });

  it('retries exactly once when the first tenant-list fetch fails, and succeeds if the retry succeeds', async () => {
    let tenantListCalls = 0;
    const httpRequest = jasmine.createSpy('httpRequest').and.callFake((url: string) => {
      if (url.includes('oidcAccessToken')) {
        return Promise.resolve(JSON.stringify({access_token: 'tok'}));
      }
      tenantListCalls++;
      if (tenantListCalls === 1) {
        return Promise.reject(new Error('HTTP 401'));
      }
      return Promise.resolve(JSON.stringify([{tenantGroup: {matchCode: 'g1'}}]));
    });
    const fetchGridData = jasmine.createSpy('fetchGridData');
    const service = createService({httpRequest, fetchGridData});
    const stage = makeStage();

    const groups = await service.getTenantGroups(stage);

    expect(groups).toEqual(['g1']);
    expect(tenantListCalls).toBe(2);
    const tokenCalls = httpRequest.calls.allArgs().filter(args => (args[0] as string).includes('oidcAccessToken')).length;
    expect(tokenCalls).toBe(2);
  });

  it('throws an error containing the stage name when both the initial fetch and the retry fail', async () => {
    const httpRequest = jasmine.createSpy('httpRequest').and.callFake((url: string) => {
      if (url.includes('oidcAccessToken')) {
        return Promise.resolve(JSON.stringify({access_token: 'tok'}));
      }
      return Promise.reject(new Error('HTTP 500'));
    });
    const fetchGridData = jasmine.createSpy('fetchGridData');
    const service = createService({httpRequest, fetchGridData});
    const stage = makeStage({name: 'prod-eu'});

    try {
      await service.getTenantGroups(stage);
      fail('expected getTenantGroups to throw');
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      expect(message).toContain('prod-eu');
      expect(message).toContain('HTTP 500');
    }
  });
});

describe('MonitoringDataService.fetchGrid sessionExpired', () => {
  function setUpFetchGrid(results: TenantGridResult[]): {
    service: MonitoringDataService;
    fetchGridData: jasmine.Spy;
  } {
    const httpRequest = jasmine.createSpy('httpRequest');
    const fetchGridData = jasmine.createSpy('fetchGridData').and.resolveTo(results);
    const service = createService({httpRequest, fetchGridData});
    spyOn(service, 'getTenantGroups').and.resolveTo(['g1', 'g2']);
    return {service, fetchGridData};
  }

  it('is true when any result carries url_mismatch: true', async () => {
    const {service} = setUpFetchGrid([
      {tenant_group: 'g1', ok: true, data: [{errorCode: 'E1'}]},
      {tenant_group: 'g2', ok: false, error: 'redirected away from expected URL (session likely expired)', url_mismatch: true},
    ]);
    const stage = makeStage();

    const result = await service.fetchGrid(stage, 'some/grid');

    expect(result.sessionExpired).toBe(true);
  });

  it('is false when no result carries url_mismatch: true, even if every result failed', async () => {
    const {service} = setUpFetchGrid([
      {tenant_group: 'g1', ok: false, error: 'HTTP 500'},
      {tenant_group: 'g2', ok: false, error: 'Timeout'},
    ]);
    const stage = makeStage();

    const result = await service.fetchGrid(stage, 'some/grid');

    expect(result.sessionExpired).toBe(false);
  });

  it('is false for an all-success batch', async () => {
    const {service} = setUpFetchGrid([
      {tenant_group: 'g1', ok: true, data: []},
      {tenant_group: 'g2', ok: true, data: []},
    ]);
    const stage = makeStage();

    const result = await service.fetchGrid(stage, 'some/grid');

    expect(result.sessionExpired).toBe(false);
  });

  it('passes an explicit requestId through to ShellService.fetchGridData when provided', async () => {
    const {service, fetchGridData} = setUpFetchGrid([]);
    const stage = makeStage();

    await service.fetchGrid(stage, 'some/grid', false, 'fixed-request-id');

    expect(fetchGridData).toHaveBeenCalledWith(
      stage.name, stage.tenant_base_url_template, 'some/grid', ['g1', 'g2'], 'fixed-request-id',
    );
  });
});
