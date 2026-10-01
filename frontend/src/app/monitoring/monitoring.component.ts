import {CdkVirtualScrollViewport, ScrollingModule, VIRTUAL_SCROLL_STRATEGY} from '@angular/cdk/scrolling';
import {DatePipe} from '@angular/common';
import {Component, computed, Inject, OnDestroy, OnInit, signal, ViewChild} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {MatButtonModule} from '@angular/material/button';
import {MatCheckboxModule} from '@angular/material/checkbox';
import {MatChipsModule} from '@angular/material/chips';
import {MatDialog, MatDialogModule} from '@angular/material/dialog';
import {MatDividerModule} from '@angular/material/divider';
import {MatFormFieldModule} from '@angular/material/form-field';
import {MatIconModule} from '@angular/material/icon';
import {MatInputModule} from '@angular/material/input';
import {MatMenuModule} from '@angular/material/menu';
import {MatProgressSpinnerModule} from '@angular/material/progress-spinner';
import {MatSelectModule} from '@angular/material/select';
import {MatSortModule, Sort} from '@angular/material/sort';
import {MatTableModule} from '@angular/material/table';
import {MatTooltipModule} from '@angular/material/tooltip';
import {Subscription} from 'rxjs';
import {ConfirmDialogComponent} from '../confirm-dialog.component';
import {ShellService} from '../shell.service';
import {FixedSizeTableVirtualScrollStrategy} from './fixed-size-table-virtual-scroll-strategy';
import {GRID_DEFINITIONS, GridDefinition} from './grid-definitions';
import {GridProgressEvent} from './grid-progress-event.model';
import {MonitoringAuthService} from './monitoring-auth.service';
import {MonitoringColumnPrefsService} from './monitoring-column-prefs.service';
import {MonitoringDataService} from './monitoring-data.service';
import {mergeGridResults} from './monitoring-grid-merge.util';
import {compareGridValues} from './monitoring-sort.util';
import {MonitoringStage} from './monitoring-stage.model';
import {MonitoringStageDialogComponent, MonitoringStageDialogData} from './monitoring-stage-dialog.component';
import {MonitoringStagesService} from './monitoring-stages.service';
import {TenantGridResult} from './tenant-grid-result.model';

/** Must match the `.grid-table` row height in `monitoring.component.scss`. */
const GRID_ROW_HEIGHT_PX = 48;

@Component({
  selector: 'app-monitoring',
  standalone: true,
  imports: [
    DatePipe,
    FormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatChipsModule,
    MatDialogModule,
    MatDividerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    ScrollingModule,
    MatSelectModule,
    MatSortModule,
    MatTableModule,
    MatTooltipModule,
  ],
  // Provides our own `VirtualScrollStrategy` to the `cdk-virtual-scroll-viewport` in this
  // component's template (see `fixed-size-table-virtual-scroll-strategy.ts` for why the built-in
  // one doesn't work with `mat-table`). Deliberately NOT a `[itemSize]` attribute on the viewport
  // element — that would activate CDK's own `CdkFixedSizeVirtualScroll` directive, whose provider
  // sits at the same element and would take priority over this one, reintroducing the
  // `*cdkVirtualFor`-only built-in strategy we're replacing.
  providers: [
    {provide: VIRTUAL_SCROLL_STRATEGY, useFactory: () => new FixedSizeTableVirtualScrollStrategy(GRID_ROW_HEIGHT_PX)},
  ],
  templateUrl: './monitoring.component.html',
  styleUrl: './monitoring.component.scss',
})
export class MonitoringComponent implements OnInit, OnDestroy {
  readonly gridDefinitions = GRID_DEFINITIONS;

  /**
   * A `@ViewChild` *setter* rather than a plain field read in `ngAfterViewInit`: the viewport only
   * enters the DOM once the template switches out of the login-prompt/spinner branches into the
   * one holding `cdk-virtual-scroll-viewport` (see the template), which happens well after
   * `ngAfterViewInit` already ran (at that point rows().length is still 0). A plain field read in
   * `ngAfterViewInit` captured `undefined` at that moment and never revisited it — since
   * `ngAfterViewInit` only runs once — so `rangeSubscription` was never established and
   * `visibleRange` stayed stuck at `{start: 0, end: 0}` for the component's whole lifetime, even
   * though `updateDataLength()` kept growing the viewport's total content size (shrinking the
   * scrollbar thumb) as rows streamed in. Angular calls a `@ViewChild` setter every time the query
   * result changes, so this (re)wires the subscription whenever the viewport actually appears.
   */
  @ViewChild(CdkVirtualScrollViewport)
  private set viewport(viewport: CdkVirtualScrollViewport | undefined) {
    this.wireViewport(viewport);
  }

  private rangeSubscription: Subscription | null = null;
  private scrollbarResizeObserver: ResizeObserver | null = null;

  /**
   * Width of the body viewport's own scrollbar (0 when overlay-style or not currently shown).
   * The header lives in its own non-scrolling `<table>` next to the scrolling body (see the
   * template comment on why they're split), so on platforms where the scrollbar reserves layout
   * width (Windows, most Linux desktop themes — unlike macOS's default overlay scrollbars), the
   * body table's available column width is narrower than the header's by exactly this amount.
   * Applied as `padding-right` on the header table (see template) to keep both tables' `fixed`
   * column layout in sync regardless of platform scrollbar style.
   */
  protected scrollbarWidth = signal(0);

  selectedStageName = signal<string | null>(null);
  selectedGridKey = signal<string>(GRID_DEFINITIONS[0].key);
  loading = signal(false);
  error = signal<string | null>(null);
  filterText = signal('');
  debouncedFilterText = signal('');
  lastRefreshed = signal<Date | null>(null);

  columns = signal<string[]>([]);
  /**
   * Columns actually rendered — `columns()` minus whatever the user hid for the current grid type.
   * `tenantGroup` is always kept: it's the pivot for the whole table and the one clickable link, so
   * hiding it is never useful. Applies across every stage (a per-grid-type preference, not per-stage).
   */
  visibleColumns = computed<string[]>(() => {
    const hidden = this.prefs.hiddenFor(this.selectedGridKey());
    return this.columns().filter(c => c === 'tenantGroup' || !hidden.has(c));
  });
  /** Columns eligible for hiding in the picker — every discovered column except `tenantGroup`. */
  hideableColumns = computed<string[]>(() => this.columns().filter(c => c !== 'tenantGroup'));
  rows = signal<Record<string, unknown>[]>([]);
  failed = signal<{ tenant_group: string; error: string }[]>([]);
  requestId = signal<string | null>(null);
  progress = signal<{ done: number; total: number } | null>(null);
  tenantGroupFilter = signal<string | null>(null);

  /** Rows narrowed by the text filter only — the base for both `filteredRows()` and `tenantGroupCounts()`. */
  private textFilteredRows = computed(() => {
    const text = this.debouncedFilterText().toLowerCase().trim();
    if (!text) return this.rows();
    return this.rows().filter(row => String(row['__searchText'] ?? '').includes(text));
  });

  filteredRows = computed(() => {
    const group = this.tenantGroupFilter();
    const base = this.textFilteredRows();
    if (!group) return base;
    return base.filter(row => row['tenantGroup'] === group);
  });

  /**
   * `{tenantGroup, count}` derived from `textFilteredRows()` — i.e. the counts reflect the current
   * text filter but NOT the tenant-group chip filter itself, so selecting a chip doesn't collapse
   * every other chip to zero (otherwise you couldn't switch groups without clearing first).
   * Sorted alphabetically for a stable chip order across refreshes.
   */
  tenantGroupCounts = computed<{ tenantGroup: string; count: number }[]>(() => {
    const counts = new Map<string, number>();
    for (const row of this.textFilteredRows()) {
      const group = String(row['tenantGroup'] ?? '');
      counts.set(group, (counts.get(group) ?? 0) + 1);
    }
    return Array.from(counts, ([tenantGroup, count]) => ({tenantGroup, count}))
      .sort((a, b) => a.tenantGroup.localeCompare(b.tenantGroup));
  });

  /** The visible (plus small buffer) index window into `filteredRows()`, as reported by `FixedSizeTableVirtualScrollStrategy`. */
  private visibleRange = signal<{ start: number; end: number }>({start: 0, end: 0});

  /**
   * The slice of `filteredRows()` actually handed to `mat-table`'s `dataSource` — only the
   * CDK-virtualized visible window, never the full filtered/sorted set. This is the crux of
   * Task 5: it's what keeps the number of real `<tr>` DOM nodes bounded to roughly what's on
   * screen, regardless of whether there are 100 or 100,000 total rows.
   *
   * Deliberately a plain method rather than a `computed()`: it needs to tell `scrollStrategy`
   * about the current row count as a side effect before slicing (so the viewport's total content
   * size / rendered range are based on the right length), and `computed()` is required to be
   * pure. The template re-evaluates it on every change-detection pass like any other template
   * expression, which is exactly when that side effect needs to happen anyway.
   */
  windowedRows(): Record<string, unknown>[] {
    const rows = this.filteredRows();
    this.scrollStrategy?.updateDataLength(rows.length);
    const {start, end} = this.visibleRange();
    return rows.slice(start, end);
  }

  selectedStage = computed<MonitoringStage | undefined>(() =>
    this.stages.stages().find(s => s.name === this.selectedStageName()));

  selectedGrid = computed<GridDefinition | undefined>(() =>
    this.gridDefinitions.find(g => g.key === this.selectedGridKey()));

  needsLogin = computed(() => {
    const stage = this.selectedStage();
    return !!stage && !this.auth.isConfirmed(stage.name);
  });

  /** Monotonically increasing token guarding against a slower, superseded `refresh()` call overwriting newer results. */
  private requestSeq = 0;

  private static readonly FILTER_DEBOUNCE_MS = 250;
  private filterDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  private static readonly GRID_FLUSH_INTERVAL_MS = 300;
  private cancelPendingGridFlush: (() => void) | null = null;

  private unlistenProgress: (() => void) | null = null;

  constructor(
    protected stages: MonitoringStagesService,
    protected auth: MonitoringAuthService,
    private data: MonitoringDataService,
    private dialog: MatDialog,
    private shell: ShellService,
    protected prefs: MonitoringColumnPrefsService,
    // Optional (rather than a plain `inject()` field initializer or constructor-injected
    // required param) so `monitoring.component.spec.ts`'s existing `new MonitoringComponent(...)`
    // unit tests — which construct the component directly, outside Angular's DI/injection
    // context, and predate this token — keep compiling and passing unmodified.
    @Inject(VIRTUAL_SCROLL_STRATEGY) private scrollStrategy?: FixedSizeTableVirtualScrollStrategy,
  ) {
  }

  async ngOnInit(): Promise<void> {
    await Promise.all([this.stages.load(), this.prefs.load()]);
    const first = this.stages.stages()[0];
    if (first) this.selectedStageName.set(first.name);
  }

  isColumnVisible(column: string): boolean {
    if (column === 'tenantGroup') return true;
    return !this.prefs.hiddenFor(this.selectedGridKey()).has(column);
  }

  toggleColumnVisibility(column: string): void {
    if (column === 'tenantGroup') return; // guard: the picker filters it out, but a race elsewhere shouldn't be able to hide it either
    void this.prefs.toggleColumn(this.selectedGridKey(), column);
  }

  showAllColumns(): void {
    void this.prefs.showAll(this.selectedGridKey());
  }

  hideAllColumnsExceptTenantGroup(): void {
    void this.prefs.hideAllExceptTenantGroup(this.selectedGridKey(), this.columns());
  }

  /** Re-subscribes to the current viewport's rendered-range stream and scrollbar-width measurement whenever it changes (including appearing for the first time after the initial spinner/login branches). */
  private wireViewport(viewport: CdkVirtualScrollViewport | undefined): void {
    this.rangeSubscription?.unsubscribe();
    this.scrollbarResizeObserver?.disconnect();
    this.rangeSubscription = null;
    this.scrollbarResizeObserver = null;
    if (!viewport) return;

    // Deferred to a microtask — mirrors how CDK's own viewport wraps its `scrolledIndexChange`
    // emission in `Promise.resolve().then()` internally. `setRenderedRange` (called from
    // `windowedRows()`, itself invoked synchronously while Angular evaluates the `[dataSource]`
    // template binding) publishes to this stream synchronously; writing straight to a signal from
    // inside that same call stack trips Angular's "no signal writes during a reactive
    // computation" guard (NG0600), since `mat-table`'s own signal-based `dataSource` handling is
    // still on the stack at that point.
    this.rangeSubscription = viewport.renderedRangeStream.subscribe(range => {
      queueMicrotask(() => this.visibleRange.set({start: range.start, end: range.end}));
    });

    // Re-measure whenever the viewport's box changes size, since a scrollbar can appear or
    // disappear as rows are added/removed/filtered (content overflow toggling the scrollbar on
    // platforms that reserve layout space for it), not just on window resize.
    const viewportEl = viewport.getElementRef().nativeElement;
    this.scrollbarResizeObserver = new ResizeObserver(() => this.measureScrollbarWidth(viewportEl));
    this.scrollbarResizeObserver.observe(viewportEl);
    this.measureScrollbarWidth(viewportEl);
  }

  private measureScrollbarWidth(viewportEl: HTMLElement): void {
    this.scrollbarWidth.set(viewportEl.offsetWidth - viewportEl.clientWidth);
  }

  ngOnDestroy(): void {
    this.teardownProgressListener();
    if (this.filterDebounceTimer !== null) {
      clearTimeout(this.filterDebounceTimer);
    }
    this.cancelPendingGridFlush?.();
    this.rangeSubscription?.unsubscribe();
    this.scrollbarResizeObserver?.disconnect();
  }

  private teardownProgressListener(): void {
    this.unlistenProgress?.();
    this.unlistenProgress = null;
  }

  /** Clears all displayed-grid state so a stage/grid switch never shows the previous selection's data under a new label. */
  private clearGridState(): void {
    // Bump the request token unconditionally — even when the caller goes on to skip refresh()
    // (e.g. the new selection needsLogin()) — so any still in-flight refresh() for the previous
    // selection is superseded and its result gets discarded instead of repopulating these signals.
    this.requestSeq++;
    this.teardownProgressListener();
    this.requestId.set(null);
    this.progress.set(null);
    this.columns.set([]);
    this.rows.set([]);
    this.failed.set([]);
    this.error.set(null);
    this.lastRefreshed.set(null);
    this.tenantGroupFilter.set(null);
  }

  toggleTenantGroupFilter(tenantGroup: string): void {
    this.tenantGroupFilter.update(current => current === tenantGroup ? null : tenantGroup);
  }

  onStageChange(): void {
    this.clearGridState();
    if (!this.needsLogin()) {
      this.refresh();
    }
  }

  onGridChange(): void {
    this.clearGridState();
    if (!this.needsLogin()) {
      this.refresh();
    }
  }

  async login(): Promise<void> {
    const stage = this.selectedStage();
    if (!stage) return;
    try {
      await this.auth.login(stage.name, stage.sso_login_url);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    }
  }

  async confirmLogin(): Promise<void> {
    const stage = this.selectedStage();
    if (!stage) return;
    try {
      await this.auth.confirm(stage.name);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
      return;
    }
    await this.refresh();
  }

  async refresh(forceRefresh = false): Promise<void> {
    const stage = this.selectedStage();
    const grid = this.selectedGrid();
    if (!stage || !grid || this.needsLogin()) return;

    const seq = ++this.requestSeq;
    const requestId = crypto.randomUUID();
    this.requestId.set(requestId);
    this.progress.set(null);
    this.loading.set(true);
    this.error.set(null);
    this.columns.set([]);
    this.rows.set([]);
    this.failed.set([]);

    let pendingResults: TenantGridResult[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    let lastFlushAt = 0;

    const flush = (): void => {
      flushTimer = null;
      if (seq !== this.requestSeq || pendingResults.length === 0) return;
      const toMerge = pendingResults;
      pendingResults = [];
      lastFlushAt = Date.now();
      const merged = mergeGridResults(toMerge, {
        columns: this.columns(),
        rows: this.rows(),
        failed: this.failed(),
      });
      this.columns.set(merged.columns);
      this.rows.set(merged.rows);
      this.failed.set(merged.failed);
    };

    const scheduleFlush = (): void => {
      if (flushTimer !== null) return;
      const delay = Math.max(0, MonitoringComponent.GRID_FLUSH_INTERVAL_MS - (Date.now() - lastFlushAt));
      flushTimer = setTimeout(flush, delay);
    };

    const cancelPendingFlush = (): void => {
      if (flushTimer !== null) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      pendingResults = [];
    };
    this.cancelPendingGridFlush = cancelPendingFlush;

    this.teardownProgressListener();
    const unlisten = await this.shell.listen<GridProgressEvent>('monitoring://grid-progress', event => {
      if (seq !== this.requestSeq || event.payload.request_id !== requestId) return;
      this.progress.set({done: event.payload.done, total: event.payload.total});
      pendingResults.push(event.payload.result);
      if (flushTimer === null && Date.now() - lastFlushAt >= MonitoringComponent.GRID_FLUSH_INTERVAL_MS) {
        flush();
      } else {
        scheduleFlush();
      }
    });
    if (seq !== this.requestSeq) {
      // A newer refresh() call superseded this one while `listen()` was resolving — release
      // the listener we just registered instead of storing it, so it never leaks and never
      // gets torn down/overwritten out of turn by whichever call is now current.
      unlisten();
    } else {
      this.unlistenProgress = unlisten;
    }

    try {
      const result = await this.data.fetchGrid(stage, grid.path, forceRefresh, requestId);
      if (seq !== this.requestSeq) return; // a newer refresh() call superseded this one
      if (result.sessionExpired) {
        this.auth.clear(stage.name);
        this.columns.set([]);
        this.rows.set([]);
        this.failed.set([]);
        return;
      }
      this.columns.set(result.columns);
      this.rows.set(result.rows);
      this.failed.set(result.failed);
      this.lastRefreshed.set(new Date());
    } catch (e) {
      if (seq !== this.requestSeq) return;
      this.error.set(e instanceof Error ? e.message : String(e));
      this.columns.set([]);
      this.rows.set([]);
      this.failed.set([]);
    } finally {
      cancelPendingFlush();
      if (this.cancelPendingGridFlush === cancelPendingFlush) {
        this.cancelPendingGridFlush = null;
      }
      if (seq === this.requestSeq) {
        this.loading.set(false);
        this.progress.set(null);
        this.teardownProgressListener();
      }
    }
  }

  /**
   * The tenant-select URL the sync's hidden webview navigates to for the first step of a fetch
   * (see `fetch_grid_data` in `commands.rs`). Rendered as an anchor `href` on the tenantGroup
   * column in the grid so a click opens the same tenant-scoped page in the user's default browser.
   */
  tenantGroupUrl(tenantGroup: string): string {
    const stage = this.selectedStage();
    if (!stage) return '';
    const encoded = encodeURIComponent(tenantGroup);
    const host = stage.tenant_base_url_template.replace('{tenantGroup}', encoded);
    return `${host}/crossng-datahub/open/tenantgrp/${encoded}`;
  }

  openTenantGroup(tenantGroup: string): void {
    const url = this.tenantGroupUrl(tenantGroup);
    if (url) this.shell.openUrl(url);
  }

  async cancel(): Promise<void> {
    const requestId = this.requestId();
    if (!requestId) return;
    try {
      await this.shell.cancelGridFetch(requestId);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    }
  }

  onFilterTextChange(value: string): void {
    this.filterText.set(value);
    if (this.filterDebounceTimer !== null) {
      clearTimeout(this.filterDebounceTimer);
    }
    this.filterDebounceTimer = setTimeout(() => {
      this.filterDebounceTimer = null;
      this.debouncedFilterText.set(value);
    }, MonitoringComponent.FILTER_DEBOUNCE_MS);
  }

  sortRows(sort: Sort): void {
    const rows = [...this.rows()];
    if (!sort.active || sort.direction === '') {
      this.rows.set(rows);
      return;
    }
    const dir = sort.direction === 'asc' ? 1 : -1;
    rows.sort((a, b) => compareGridValues(a[sort.active], b[sort.active]) * dir);
    this.rows.set(rows);
  }

  openAddStage(): void {
    this.dialog.open<MonitoringStageDialogComponent, MonitoringStageDialogData, MonitoringStage>(
      MonitoringStageDialogComponent, {data: {}, minWidth: '480px'},
    ).afterClosed().subscribe(async stage => {
      if (!stage) return;
      try {
        await this.stages.addStage(stage);
        // mat-select's (selectionChange) only fires on user-driven clicks, never on this programmatic
        // reassignment, so onStageChange() won't run for us — replicate what it does here instead.
        this.selectedStageName.set(stage.name);
        this.clearGridState();
        if (!this.needsLogin()) {
          this.refresh();
        }
      } catch (e) {
        this.error.set(e instanceof Error ? e.message : String(e));
      }
    });
  }

  openEditStage(stage: MonitoringStage): void {
    this.dialog.open<MonitoringStageDialogComponent, MonitoringStageDialogData, MonitoringStage>(
      MonitoringStageDialogComponent, {data: {stage}, minWidth: '480px'},
    ).afterClosed().subscribe(async updated => {
      if (!updated) return;
      try {
        await this.stages.updateStage(stage.name, updated);
      } catch (e) {
        this.error.set(e instanceof Error ? e.message : String(e));
      }
    });
  }

  removeStage(stage: MonitoringStage): void {
    this.dialog.open(ConfirmDialogComponent, {
      data: {title: 'Remove stage', message: `Remove stage "${stage.name}"?`},
    }).afterClosed().subscribe(async (confirmed: boolean) => {
      if (!confirmed) return;
      try {
        await this.stages.removeStage(stage.name);
      } catch (e) {
        this.error.set(e instanceof Error ? e.message : String(e));
        return;
      }
      if (this.selectedStageName() === stage.name) {
        // mat-select's (selectionChange) only fires on user-driven clicks, never on this programmatic
        // reassignment, so onStageChange() won't run for us — replicate what it does here instead.
        this.selectedStageName.set(this.stages.stages()[0]?.name ?? null);
        this.clearGridState();
        if (!this.needsLogin()) {
          this.refresh();
        }
      }
    });
  }
}
