import {signal, WritableSignal} from '@angular/core';
import {Subject} from 'rxjs';
import {MonitoringAuthService} from './monitoring-auth.service';
import {MonitoringColumnPrefsService} from './monitoring-column-prefs.service';
import {MonitoringComponent} from './monitoring.component';
import {MonitoringDataService} from './monitoring-data.service';
import {MonitoringStage} from './monitoring-stage.model';
import {MonitoringStagesService} from './monitoring-stages.service';

function makeStage(overrides: Partial<MonitoringStage> = {}): MonitoringStage {
  return {
    name: 'stage1',
    token_base_url: 'https://token.example.com',
    tenant_list_base_url: 'https://tenants.example.com',
    tenant_base_url_template: 'https://{tenantGroup}.example.com',
    sso_login_url: 'https://sso.example.com',
    basic_auth_username: 'user',
    basic_auth_password: 'pass',
    ...overrides,
  };
}

/**
 * A minimal in-memory stand-in for `MonitoringColumnPrefsService` — the real service reads/writes
 * via `ConfigService`, which unit tests here don't set up (they construct the component directly
 * outside Angular DI). Behaviour mirrors the real one: `hiddenFor` returns a fresh Set copy,
 * `toggleColumn`/`setHiddenFor` mutate the in-memory map. Extra `getStore()` accessor lets the new
 * visible-columns tests set up hidden state without going through `load()`.
 */
function makeFakePrefs(): MonitoringColumnPrefsService & { setStore(store: Record<string, string[]>): void } {
  // A real signal underneath so `hiddenFor()` reads it and `visibleColumns()`'s `computed()` picks
  // up mutations — the real service uses the same pattern (signal-backed `_hidden`).
  const store = signal<Record<string, string[]>>({});
  const write = (next: Record<string, string[]>) => store.set(next);
  const fake = {
    load: () => Promise.resolve(),
    hiddenFor: (gridKey: string) => new Set(store()[gridKey] ?? []),
    setHiddenFor: (gridKey: string, columns: string[]) => {
      const next = {...store()};
      if (columns.length === 0) delete next[gridKey]; else next[gridKey] = [...columns];
      write(next);
      return Promise.resolve();
    },
    toggleColumn: (gridKey: string, column: string) => {
      const set = new Set(store()[gridKey] ?? []);
      if (set.has(column)) set.delete(column); else set.add(column);
      const next = {...store()};
      const arr = [...set];
      if (arr.length === 0) delete next[gridKey]; else next[gridKey] = arr;
      write(next);
      return Promise.resolve();
    },
    showAll: (gridKey: string) => {
      const next = {...store()};
      delete next[gridKey];
      write(next);
      return Promise.resolve();
    },
    hideAllExceptTenantGroup: (gridKey: string, allColumns: string[]) => {
      const next = {...store(), [gridKey]: allColumns.filter(c => c !== 'tenantGroup')};
      write(next);
      return Promise.resolve();
    },
    setStore: (initial: Record<string, string[]>) => write(initial),
  };
  return fake as unknown as MonitoringColumnPrefsService & { setStore(store: Record<string, string[]>): void };
}

describe('MonitoringComponent progress/cancel wiring', () => {
  let progressHandler: (event: { payload: unknown }) => void;
  let shell: { listen: jasmine.Spy; cancelGridFetch: jasmine.Spy };
  let stagesService: { stages: () => MonitoringStage[]; load: jasmine.Spy };
  let authService: { isConfirmed: jasmine.Spy; login: jasmine.Spy; confirm: jasmine.Spy; clear: jasmine.Spy };
  let dataService: { fetchGrid: jasmine.Spy };
  let component: MonitoringComponent;
  let stage: MonitoringStage;

  beforeEach(() => {
    stage = makeStage();
    shell = {
      listen: jasmine.createSpy('listen').and.callFake((_event: string, handler: (e: { payload: unknown }) => void) => {
        progressHandler = handler;
        return Promise.resolve(() => {});
      }),
      cancelGridFetch: jasmine.createSpy('cancelGridFetch').and.resolveTo(undefined),
    };
    stagesService = {
      stages: () => [stage],
      load: jasmine.createSpy('load').and.resolveTo(undefined),
    };
    authService = {
      isConfirmed: jasmine.createSpy('isConfirmed').and.returnValue(true),
      login: jasmine.createSpy('login'),
      confirm: jasmine.createSpy('confirm'),
      clear: jasmine.createSpy('clear'),
    };
    dataService = {
      fetchGrid: jasmine.createSpy('fetchGrid')
        .and.resolveTo({columns: ['tenantGroup'], rows: [], failed: [], sessionExpired: false}),
    };
    component = new MonitoringComponent(
      stagesService as unknown as MonitoringStagesService,
      authService as unknown as MonitoringAuthService,
      dataService as unknown as MonitoringDataService,
      {} as any,
      shell as any,
      makeFakePrefs(),
    );
    component.selectedStageName.set(stage.name);
  });

  it('merges an incoming grid-progress event into rows/columns and updates progress', async () => {
    const refreshPromise = component.refresh();

    progressHandler({
      payload: {
        request_id: component.requestId(),
        done: 1,
        total: 2,
        result: {tenant_group: 'acme', ok: true, data: [{errorCode: 'E1'}]},
      },
    });

    expect(component.progress()).toEqual({done: 1, total: 2});
    expect(component.rows()).toEqual([{tenantGroup: 'acme', errorCode: 'E1', __searchText: 'acme e1'}]);
    expect(component.columns()).toEqual(['tenantGroup', 'errorCode']);

    await refreshPromise;
  });

  it('ignores a progress event whose request_id does not match the in-flight request', async () => {
    const refreshPromise = component.refresh();

    progressHandler({
      payload: {
        request_id: 'stale-request-id',
        done: 1,
        total: 2,
        result: {tenant_group: 'acme', ok: true, data: [{errorCode: 'E1'}]},
      },
    });

    expect(component.rows()).toEqual([]);
    expect(component.progress()).toBeNull();

    await refreshPromise;
  });

  it('cancel() calls ShellService.cancelGridFetch with the in-flight request id', async () => {
    const refreshPromise = component.refresh();
    const requestId = component.requestId();
    expect(requestId).toBeTruthy();

    await component.cancel();

    expect(shell.cancelGridFetch).toHaveBeenCalledWith(requestId);

    await refreshPromise;
  });

  it('cancel() is a no-op when no fetch is in flight', async () => {
    await component.cancel();
    expect(shell.cancelGridFetch).not.toHaveBeenCalled();
  });

  it('an older, superseded refresh() call does not tear down a newer call\'s progress listener or clobber it while resolving', async () => {
    // Regression test for two related bugs in refresh()'s listener lifecycle:
    //  - Critical: the `finally` block used to call teardownProgressListener() unconditionally,
    //    so an older call's finally (running late) could tear down a newer call's live listener.
    //  - Important: the `this.unlistenProgress = await this.shell.listen(...)` assignment used to
    //    be unconditional too, so an older call resolving its listen() late could clobber a newer
    //    call's already-stored listener reference.
    // Both calls' `fetchGrid` are kept on independently-controlled pending promises so this test
    // can freeze each refresh() call right after it registers its listener (one microtask past the
    // `await this.shell.listen(...)` in each) and never let either one run ahead into its own
    // `finally` by accident — the only way `unlistenSpies[1]` gets called before we explicitly
    // resolve call B's own fetch is if call A's stale completion incorrectly reaches into it.
    const unlistenSpies: jasmine.Spy[] = [];
    shell.listen = jasmine.createSpy('listen').and.callFake((_event: string, handler: (e: { payload: unknown }) => void) => {
      if (unlistenSpies.length === 0) progressHandler = handler;
      const spy = jasmine.createSpy(`unlisten${unlistenSpies.length}`);
      unlistenSpies.push(spy);
      return Promise.resolve(spy);
    });

    let resolveFirstFetch!: (value: unknown) => void;
    let resolveSecondFetch!: (value: unknown) => void;
    dataService.fetchGrid.and.returnValues(
      new Promise(resolve => { resolveFirstFetch = resolve; }),
      new Promise(resolve => { resolveSecondFetch = resolve; }),
    );

    const firstRefresh = component.refresh();
    // One microtask tick resolves call A's `await this.shell.listen(...)`, registering its
    // listener and advancing it to its own (still-pending) `await this.data.fetchGrid(...)`.
    await Promise.resolve();

    const secondRefresh = component.refresh();
    // Same single tick for call B: registers its listener, then blocks on its own pending fetch.
    await Promise.resolve();

    expect(unlistenSpies.length).toBe(2);

    resolveFirstFetch({columns: [], rows: [], failed: [], sessionExpired: false});
    await firstRefresh;

    expect(unlistenSpies[1]).not.toHaveBeenCalled(); // call B's listener must survive call A's late completion

    resolveSecondFetch({columns: ['tenantGroup'], rows: [], failed: [], sessionExpired: false});
    await secondRefresh;

    expect(unlistenSpies[1]).toHaveBeenCalled(); // call B does clean up its own listener once it completes
  });

  it('does not duplicate rows when refresh() is called again while the table already has data (manual Refresh)', async () => {
    dataService.fetchGrid.and.resolveTo({
      columns: ['tenantGroup', 'errorCode'],
      rows: [{tenantGroup: 'acme', errorCode: 'E1'}],
      failed: [],
      sessionExpired: false,
    });
    await component.refresh(); // first fetch populates the table

    const secondRefresh = component.refresh(true); // simulates clicking Refresh again

    progressHandler({
      payload: {
        request_id: component.requestId(),
        done: 1,
        total: 1,
        result: {tenant_group: 'acme', ok: true, data: [{errorCode: 'E1'}]},
      },
    });

    expect(component.rows()).toEqual([{tenantGroup: 'acme', errorCode: 'E1', __searchText: 'acme e1'}]); // not duplicated

    await secondRefresh;
  });
});

describe('MonitoringComponent filter debounce', () => {
  let component: MonitoringComponent;

  beforeEach(() => {
    jasmine.clock().install();
    component = new MonitoringComponent(
      {stages: () => [], load: jasmine.createSpy('load').and.resolveTo(undefined)} as unknown as MonitoringStagesService,
      {} as unknown as MonitoringAuthService,
      {} as unknown as MonitoringDataService,
      {} as any,
      {} as any,
      makeFakePrefs(),
    );
  });

  afterEach(() => {
    jasmine.clock().uninstall();
  });

  it('does not update debouncedFilterText immediately on input', () => {
    component.onFilterTextChange('acme');
    expect(component.filterText()).toBe('acme');
    expect(component.debouncedFilterText()).toBe('');
  });

  it('updates debouncedFilterText only after the debounce window elapses', () => {
    component.onFilterTextChange('acme');
    jasmine.clock().tick(249);
    expect(component.debouncedFilterText()).toBe('');
    jasmine.clock().tick(1);
    expect(component.debouncedFilterText()).toBe('acme');
  });

  it('restarts the debounce window on each keystroke, applying only the final value', () => {
    component.onFilterTextChange('a');
    jasmine.clock().tick(200);
    component.onFilterTextChange('ac');
    jasmine.clock().tick(200);
    expect(component.debouncedFilterText()).toBe('');
    jasmine.clock().tick(50);
    expect(component.debouncedFilterText()).toBe('ac');
  });

  it('filteredRows() uses the precomputed __searchText field, not the debounced raw values', () => {
    (component.rows as WritableSignal<Record<string, unknown>[]>).set([
      {tenantGroup: 'acme', errorCode: 'E1', __searchText: 'acme e1'},
      {tenantGroup: 'globex', errorCode: 'E2', __searchText: 'globex e2'},
    ]);
    component.onFilterTextChange('globex');
    jasmine.clock().tick(250);
    expect(component.filteredRows()).toEqual([
      {tenantGroup: 'globex', errorCode: 'E2', __searchText: 'globex e2'},
    ]);
  });
});

describe('MonitoringComponent grid-progress merge throttling', () => {
  let progressHandler: (event: { payload: unknown }) => void;
  let shell: { listen: jasmine.Spy; cancelGridFetch: jasmine.Spy };
  let stagesService: { stages: () => MonitoringStage[]; load: jasmine.Spy };
  let authService: { isConfirmed: jasmine.Spy; login: jasmine.Spy; confirm: jasmine.Spy; clear: jasmine.Spy };
  let dataService: { fetchGrid: jasmine.Spy };
  let component: MonitoringComponent;
  let stage: MonitoringStage;
  let resolveFetch!: (value: unknown) => void;

  beforeEach(() => {
    jasmine.clock().install();
    stage = makeStage();
    shell = {
      listen: jasmine.createSpy('listen').and.callFake((_event: string, handler: (e: { payload: unknown }) => void) => {
        progressHandler = handler;
        return Promise.resolve(() => {});
      }),
      cancelGridFetch: jasmine.createSpy('cancelGridFetch').and.resolveTo(undefined),
    };
    stagesService = {stages: () => [stage], load: jasmine.createSpy('load').and.resolveTo(undefined)};
    authService = {
      isConfirmed: jasmine.createSpy('isConfirmed').and.returnValue(true),
      login: jasmine.createSpy('login'),
      confirm: jasmine.createSpy('confirm'),
      clear: jasmine.createSpy('clear'),
    };
    dataService = {
      fetchGrid: jasmine.createSpy('fetchGrid').and.callFake(() => new Promise(resolve => { resolveFetch = resolve; })),
    };
    component = new MonitoringComponent(
      stagesService as unknown as MonitoringStagesService,
      authService as unknown as MonitoringAuthService,
      dataService as unknown as MonitoringDataService,
      {} as any,
      shell as any,
      makeFakePrefs(),
    );
    component.selectedStageName.set(stage.name);
  });

  afterEach(() => {
    jasmine.clock().uninstall();
  });

  function emit(tenantGroup: string, done: number, total: number): void {
    progressHandler({
      payload: {
        request_id: component.requestId(),
        done,
        total,
        result: {tenant_group: tenantGroup, ok: true, data: [{errorCode: `E-${tenantGroup}`}]},
      },
    });
  }

  it('merges the first event of a batch immediately (leading edge)', async () => {
    const refreshPromise = component.refresh();
    emit('acme', 1, 3);
    expect(component.rows()).toEqual([{tenantGroup: 'acme', errorCode: 'E-acme', __searchText: 'acme e-acme'}]);

    await Promise.resolve();
    resolveFetch({columns: [], rows: [], failed: [], sessionExpired: false});
    await refreshPromise;
  });

  it('coalesces rapid subsequent events into a single throttled flush instead of merging each one', async () => {
    const refreshPromise = component.refresh();
    emit('acme', 1, 3); // leading edge: flushes immediately
    emit('globex', 2, 3); // within the throttle window: buffered
    emit('initech', 3, 3); // also buffered

    expect(component.rows()).toEqual([{tenantGroup: 'acme', errorCode: 'E-acme', __searchText: 'acme e-acme'}]);

    jasmine.clock().tick(300); // let the trailing flush fire

    expect(component.rows()).toEqual([
      {tenantGroup: 'acme', errorCode: 'E-acme', __searchText: 'acme e-acme'},
      {tenantGroup: 'globex', errorCode: 'E-globex', __searchText: 'globex e-globex'},
      {tenantGroup: 'initech', errorCode: 'E-initech', __searchText: 'initech e-initech'},
    ]);

    await Promise.resolve();
    resolveFetch({columns: [], rows: [], failed: [], sessionExpired: false});
    await refreshPromise;
  });

  it('updates the progress counter immediately even while row-merging is throttled', async () => {
    const refreshPromise = component.refresh();
    emit('acme', 1, 3);
    emit('globex', 2, 3);

    expect(component.progress()).toEqual({done: 2, total: 3});

    await Promise.resolve();
    resolveFetch({columns: [], rows: [], failed: [], sessionExpired: false});
    await refreshPromise;
  });

  it('discards a pending buffered flush once the authoritative final result arrives, so rows are not duplicated', async () => {
    const refreshPromise = component.refresh();
    emit('acme', 1, 2); // leading edge: flushes immediately
    emit('globex', 2, 2); // buffered, scheduled to flush in 300ms

    await Promise.resolve();
    resolveFetch({
      columns: ['tenantGroup', 'errorCode'],
      rows: [
        {tenantGroup: 'acme', errorCode: 'E-acme'},
        {tenantGroup: 'globex', errorCode: 'E-globex'},
      ],
      failed: [],
      sessionExpired: false,
    });
    await refreshPromise;

    jasmine.clock().tick(300); // if the stale buffered flush weren't cancelled, this would duplicate 'globex'

    expect(component.rows()).toEqual([
      {tenantGroup: 'acme', errorCode: 'E-acme'},
      {tenantGroup: 'globex', errorCode: 'E-globex'},
    ]);
  });
});

describe('MonitoringComponent tenant-group filter chips', () => {
  let component: MonitoringComponent;

  beforeEach(() => {
    component = new MonitoringComponent(
      {stages: () => [], load: jasmine.createSpy('load').and.resolveTo(undefined)} as unknown as MonitoringStagesService,
      {} as unknown as MonitoringAuthService,
      {} as unknown as MonitoringDataService,
      {} as any,
      {} as any,
      makeFakePrefs(),
    );
    (component.rows as WritableSignal<Record<string, unknown>[]>).set([
      {tenantGroup: 'acme', errorCode: 'E1', __searchText: 'acme e1'},
      {tenantGroup: 'acme', errorCode: 'E2', __searchText: 'acme e2'},
      {tenantGroup: 'globex', errorCode: 'E3', __searchText: 'globex e3'},
    ]);
  });

  it('tenantGroupCounts() aggregates rows per tenantGroup and sorts alphabetically', () => {
    expect(component.tenantGroupCounts()).toEqual([
      {tenantGroup: 'acme', count: 2},
      {tenantGroup: 'globex', count: 1},
    ]);
  });

  it('filteredRows() narrows to the selected tenantGroup when set', () => {
    component.tenantGroupFilter.set('globex');
    expect(component.filteredRows()).toEqual([
      {tenantGroup: 'globex', errorCode: 'E3', __searchText: 'globex e3'},
    ]);
  });

  it('toggleTenantGroupFilter() sets the filter, and toggling the same group clears it', () => {
    component.toggleTenantGroupFilter('acme');
    expect(component.tenantGroupFilter()).toBe('acme');
    component.toggleTenantGroupFilter('acme');
    expect(component.tenantGroupFilter()).toBeNull();
  });

  it('tenantGroupCounts() reflects text filter but is unaffected by the tenant-group filter itself', () => {
    component.tenantGroupFilter.set('acme');
    // Counts must still show every group, otherwise a user couldn't switch chips without clearing first.
    expect(component.tenantGroupCounts()).toEqual([
      {tenantGroup: 'acme', count: 2},
      {tenantGroup: 'globex', count: 1},
    ]);
  });
});

describe('MonitoringComponent viewport wiring', () => {
  let component: MonitoringComponent;

  beforeEach(() => {
    component = new MonitoringComponent(
      {stages: () => [], load: jasmine.createSpy('load').and.resolveTo(undefined)} as unknown as MonitoringStagesService,
      {} as unknown as MonitoringAuthService,
      {} as unknown as MonitoringDataService,
      {} as any,
      {} as any,
      makeFakePrefs(),
    );
  });

  function makeFakeViewport(): { renderedRangeStream: Subject<{ start: number; end: number }> } {
    return {
      renderedRangeStream: new Subject<{ start: number; end: number }>(),
      getElementRef: () => ({nativeElement: document.createElement('div')}),
    } as unknown as { renderedRangeStream: Subject<{ start: number; end: number }> };
  }

  it('renders rows once the viewport appears after being initially absent (e.g. behind the spinner/login branch)', async () => {
    (component.rows as WritableSignal<Record<string, unknown>[]>).set([
      {tenantGroup: 'acme'},
      {tenantGroup: 'globex'},
    ]);

    // Matches the real sequence: `ngAfterViewInit`/the query resolves once with `undefined`,
    // since `cdk-virtual-scroll-viewport` is only added to the DOM once rows arrive.
    (component as unknown as { viewport: unknown }).viewport = undefined;
    expect(component.windowedRows()).toEqual([]);

    const fakeViewport = makeFakeViewport();
    (component as unknown as { viewport: unknown }).viewport = fakeViewport;
    fakeViewport.renderedRangeStream.next({start: 0, end: 2});
    await Promise.resolve(); // visibleRange is updated via queueMicrotask

    expect(component.windowedRows()).toEqual([
      {tenantGroup: 'acme'},
      {tenantGroup: 'globex'},
    ]);
  });

  it('unsubscribes from the previous viewport when a new one replaces it', async () => {
    const firstViewport = makeFakeViewport();
    (component as unknown as { viewport: unknown }).viewport = firstViewport;

    const secondViewport = makeFakeViewport();
    (component as unknown as { viewport: unknown }).viewport = secondViewport;

    expect(firstViewport.renderedRangeStream.observed).toBeFalse();
    expect(secondViewport.renderedRangeStream.observed).toBeTrue();
  });
});

describe('MonitoringComponent column visibility', () => {
  let component: MonitoringComponent;
  let prefs: ReturnType<typeof makeFakePrefs>;

  beforeEach(() => {
    prefs = makeFakePrefs();
    component = new MonitoringComponent(
      {stages: () => [], load: jasmine.createSpy('load').and.resolveTo(undefined)} as unknown as MonitoringStagesService,
      {} as unknown as MonitoringAuthService,
      {} as unknown as MonitoringDataService,
      {} as any,
      {} as any,
      prefs,
    );
    (component.columns as WritableSignal<string[]>).set(['tenantGroup', 'errorCode', 'message']);
  });

  it('visibleColumns() returns all columns when nothing is hidden', () => {
    expect(component.visibleColumns()).toEqual(['tenantGroup', 'errorCode', 'message']);
  });

  it('visibleColumns() filters out columns hidden for the current grid key', () => {
    prefs.setStore({[component.selectedGridKey()]: ['errorCode']});
    expect(component.visibleColumns()).toEqual(['tenantGroup', 'message']);
  });

  it('visibleColumns() ignores hidden entries scoped to a different grid key', () => {
    prefs.setStore({'some-other-grid': ['errorCode', 'message']});
    expect(component.visibleColumns()).toEqual(['tenantGroup', 'errorCode', 'message']);
  });

  it('visibleColumns() never hides tenantGroup even if a stale/malformed entry lists it', () => {
    // Belt-and-braces guard: the picker filters `tenantGroup` out of `hideableColumns()`, but a
    // hand-edited config or a stale preference from an earlier build shouldn't be able to strand
    // the user with an unusable grid.
    prefs.setStore({[component.selectedGridKey()]: ['tenantGroup', 'errorCode']});
    expect(component.visibleColumns()).toEqual(['tenantGroup', 'message']);
  });

  it('hideableColumns() excludes tenantGroup', () => {
    expect(component.hideableColumns()).toEqual(['errorCode', 'message']);
  });

  it('toggleColumnVisibility() toggles the column in the prefs store', async () => {
    component.toggleColumnVisibility('errorCode');
    await Promise.resolve();
    expect(component.visibleColumns()).toEqual(['tenantGroup', 'message']);
    component.toggleColumnVisibility('errorCode');
    await Promise.resolve();
    expect(component.visibleColumns()).toEqual(['tenantGroup', 'errorCode', 'message']);
  });

  it('toggleColumnVisibility() refuses to hide tenantGroup', async () => {
    component.toggleColumnVisibility('tenantGroup');
    await Promise.resolve();
    expect(component.visibleColumns()).toContain('tenantGroup');
  });

  it('showAllColumns() clears the current grid key\'s hidden set', async () => {
    prefs.setStore({[component.selectedGridKey()]: ['errorCode', 'message']});
    component.showAllColumns();
    await Promise.resolve();
    expect(component.visibleColumns()).toEqual(['tenantGroup', 'errorCode', 'message']);
  });

  it('hideAllColumnsExceptTenantGroup() leaves only tenantGroup visible', async () => {
    component.hideAllColumnsExceptTenantGroup();
    await Promise.resolve();
    expect(component.visibleColumns()).toEqual(['tenantGroup']);
  });

  it('hidden state is shared across stages (per grid-type, not per stage)', () => {
    // Hidden columns are keyed by grid key alone, so switching stages must not un-hide anything.
    prefs.setStore({[component.selectedGridKey()]: ['errorCode']});
    expect(component.visibleColumns()).toEqual(['tenantGroup', 'message']);
    // The component's visibleColumns() reads selectedGridKey but never selectedStageName —
    // simulate a stage switch by mutating stage name only, and confirm the hidden set still applies.
    component.selectedStageName.set('other-stage');
    expect(component.visibleColumns()).toEqual(['tenantGroup', 'message']);
  });
});
