import {ListRange} from '@angular/cdk/collections';
import {CdkVirtualScrollViewport, VirtualScrollStrategy} from '@angular/cdk/scrolling';
import {Subject} from 'rxjs';

/**
 * Minimal `VirtualScrollStrategy` that lets a `mat-table` be windowed by a
 * `cdk-virtual-scroll-viewport` even though `CdkTable` (which `mat-table` is built on) has no
 * built-in integration with CDK virtual scrolling — its `*matRowDef`/`*matHeaderRowDef` row
 * rendering runs independently of any ancestor viewport, so simply nesting a `<table mat-table>`
 * inside a `<cdk-virtual-scroll-viewport>` renders every row into the DOM regardless of scroll
 * position (verified manually: injecting 5000 synthetic rows produced 5000 real `<tr>` elements).
 * The built-in `FixedSizeVirtualScrollStrategy` doesn't help either — it expects to `attach()` to
 * a `CdkVirtualForOf` (`*cdkVirtualFor`), which `mat-table` doesn't use for its rows.
 *
 * Instead, this strategy drives the viewport's own public `setTotalContentSize` /
 * `setRenderedRange` / `setRenderedContentOffset` APIs directly — the same ones
 * `FixedSizeVirtualScrollStrategy` uses internally — without ever attaching a `CdkVirtualForOf`.
 * `MonitoringComponent` supplies the current (filtered/sorted) row count via `updateDataLength()`
 * and reads the live visible window back off the viewport's own `renderedRangeStream` (which
 * `setRenderedRange` publishes to), slicing its row array to just that range before handing it to
 * `mat-table`'s `dataSource` — that slice is the entire point: it keeps the number of real `<tr>`
 * DOM nodes bounded to roughly what's visible, regardless of how many total rows there are.
 */
export class FixedSizeTableVirtualScrollStrategy implements VirtualScrollStrategy {
  /** Extra rows rendered above/below the visible window so a fast scroll doesn't flash blank rows. */
  private static readonly BUFFER_ITEMS = 4;

  private readonly _scrolledIndexChange = new Subject<number>();
  readonly scrolledIndexChange = this._scrolledIndexChange.asObservable();

  private viewport: CdkVirtualScrollViewport | null = null;
  private dataLength = 0;

  constructor(private readonly itemSize: number) {
  }

  /** Called by the component whenever the (filtered/sorted) row count changes. */
  updateDataLength(dataLength: number): void {
    this.dataLength = dataLength;
    this.onDataLengthChanged();
  }

  attach(viewport: CdkVirtualScrollViewport): void {
    this.viewport = viewport;
    this.onDataLengthChanged();
  }

  detach(): void {
    this._scrolledIndexChange.complete();
    this.viewport = null;
  }

  onContentScrolled(): void {
    this.updateRenderedRange();
  }

  onDataLengthChanged(): void {
    if (!this.viewport) return;
    this.viewport.setTotalContentSize(this.dataLength * this.itemSize);
    this.updateRenderedRange();
  }

  onContentRendered(): void {
    // no-op: nothing further needs to happen once the DOM has caught up with a range change.
  }

  onRenderedOffsetChanged(): void {
    // no-op: this strategy only ever calls `setRenderedContentOffset` with the default 'to-start'
    // anchor, so it never needs to react to CDK rewriting a 'to-end' offset.
  }

  scrollToIndex(index: number, behavior: ScrollBehavior): void {
    this.viewport?.scrollToOffset(index * this.itemSize, behavior);
  }

  private updateRenderedRange(): void {
    const viewport = this.viewport;
    if (!viewport || this.itemSize <= 0) return;

    // `viewport.getViewportSize()` is CDK's own cached measurement, refreshed only by its
    // internal `checkViewportSize()` (window resize, or once early during `ngOnInit`). Since
    // `MonitoringComponent`'s host is toggled via `[hidden]` rather than being
    // created/destroyed, that early measurement can happen while the tab is still hidden
    // (`clientHeight` 0), and nothing resize-related ever fires to refresh it afterwards.
    // Measuring the live element height directly here sidesteps that staleness entirely.
    const viewportSize = viewport.elementRef.nativeElement.clientHeight;
    const maxVisibleItems = Math.ceil(viewportSize / this.itemSize);

    let scrollOffset = viewport.measureScrollOffset();
    let firstVisible = scrollOffset / this.itemSize;

    // Clamp when the data shrank (e.g. a filter narrowed the row set) while scrolled past its new
    // end — otherwise the rendered range would sit entirely past `dataLength` and show nothing.
    const maxFirstVisible = Math.max(0, this.dataLength - maxVisibleItems);
    if (firstVisible > maxFirstVisible) {
      firstVisible = maxFirstVisible;
      scrollOffset = firstVisible * this.itemSize;
      viewport.scrollToOffset(scrollOffset);
    }

    const start = Math.max(0, Math.floor(firstVisible) - FixedSizeTableVirtualScrollStrategy.BUFFER_ITEMS);
    const end = Math.min(
      this.dataLength,
      Math.ceil(firstVisible) + maxVisibleItems + FixedSizeTableVirtualScrollStrategy.BUFFER_ITEMS,
    );
    const range: ListRange = {start, end};

    viewport.setRenderedRange(range);
    viewport.setRenderedContentOffset(this.itemSize * start);
    this._scrolledIndexChange.next(Math.floor(firstVisible));
  }
}
