import {AfterViewChecked, Component, computed, ElementRef, OnDestroy, OnInit, signal, viewChild} from '@angular/core';
import {MatButtonModule} from '@angular/material/button';
import {MatIconModule} from '@angular/material/icon';
import {MatProgressSpinnerModule} from '@angular/material/progress-spinner';
import {MatSnackBar, MatSnackBarModule} from '@angular/material/snack-bar';
import {MatTooltipModule} from '@angular/material/tooltip';
import {ConfigService} from '../config.service';
import {ShellService} from '../shell.service';
import {DockerOutputEvent} from './docker-output-event.model';

interface ConsoleLine {
  stream: 'stdout' | 'stderr';
  line: string;
}

/** Caps memory/DOM cost of a single very chatty operation (e.g. a large image pull). */
const MAX_CONSOLE_LINES = 2000;

type DockerAction = 'stop' | 'restart' | 'pull_start';

const ACTIONS: DockerAction[] = ['stop', 'restart', 'pull_start'];

interface DockerServiceRow {
  service: string;
  state: string;
  health: string | null;
}

/**
 * Docker-semantics "how up is this" order. States not listed here (any other
 * docker-reported container state) sort after all of these, alphabetically.
 */
const STATE_ORDER: readonly string[] = [
  'running',
  'partial',
  'exited',
  'restarting',
  'paused',
  'not created',
  'unknown',
];

function stateRank(state: string): number {
  const index = STATE_ORDER.indexOf(state);
  return index === -1 ? STATE_ORDER.length : index;
}

function compareRows(a: DockerServiceRow, b: DockerServiceRow): number {
  const rankDiff = stateRank(a.state) - stateRank(b.state);
  if (rankDiff !== 0) return rankDiff;
  if (stateRank(a.state) === STATE_ORDER.length && a.state !== b.state) {
    return a.state.localeCompare(b.state);
  }
  return a.service.localeCompare(b.service);
}

@Component({
  selector: 'app-docker',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatSnackBarModule, MatTooltipModule],
  templateUrl: './docker.component.html',
  styleUrl: './docker.component.scss',
})
export class DockerComponent implements OnInit, AfterViewChecked, OnDestroy {
  private static readonly STATUS_POLL_INTERVAL_MS = 5000;

  composePath = signal<string | null>(null);
  services = signal<DockerServiceRow[]>([]);
  loading = signal(false);
  error = signal<string | null>(null);
  /** `${service}:${action}` keys for actions currently in flight. */
  runningActions = signal<Set<string>>(new Set());
  favorites = signal<Set<string>>(new Set());

  /** Bottom console drawer state — one drawer for the whole tab, tracking whichever action's
   *  output was most recently started. Starting a new action while another is still running
   *  switches the drawer over to it (the older one keeps running to completion in the
   *  background and still reports its own snackbar); this app has no per-service parallelism
   *  worth showing side by side, so a single shared drawer keeps the UI simple. Also doubles as
   *  the live "Logs" viewer (`consoleMode: 'logs'`) — same drawer, same operation-id-filtered
   *  `docker://output` listener, just fed by a long-running `docker compose logs -f` instead of
   *  a one-shot action. */
  consoleExpanded = signal(false);
  consoleTitle = signal<string | null>(null);
  consoleLines = signal<ConsoleLine[]>([]);
  consoleActive = signal(false);
  consoleMode = signal<'action' | 'logs' | null>(null);
  /** Service whose logs are currently streaming, so the row's Logs button can show it's active. */
  viewingLogsFor = signal<string | null>(null);
  private readonly consoleBody = viewChild<ElementRef<HTMLDivElement>>('consoleBody');
  private consoleOperationId = signal<string | null>(null);
  private unlistenConsole: (() => void) | null = null;
  /** Sticks to the bottom as new lines arrive unless the user scrolls up to read earlier output. */
  private consoleAutoScroll = true;
  private consoleScrollPending = false;

  readonly sortedServices = computed(() => {
    const favorites = this.favorites();
    const rows = [...this.services()];
    rows.sort(compareRows);
    const favored = rows.filter(row => favorites.has(row.service));
    const rest = rows.filter(row => !favorites.has(row.service));
    return [...favored, ...rest];
  });

  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private statusInFlight = false;
  /** Last observed {state, health} per service, used to detect changes worth a desktop notification. */
  private previousStatus = new Map<string, {state: string; health: string | null}>();

  constructor(
    private config: ConfigService,
    private shell: ShellService,
    private snackBar: MatSnackBar,
  ) {
  }

  async ngOnInit(): Promise<void> {
    await this.loadServices();
    this.pollTimer = setInterval(() => this.refreshStatus(), DockerComponent.STATUS_POLL_INTERVAL_MS);
    this.unlistenConsole = await this.shell.listen<DockerOutputEvent>('docker://output', event => {
      if (event.payload.operation_id !== this.consoleOperationId()) return;
      this.consoleLines.update(lines => {
        const next = [...lines, {stream: event.payload.stream, line: event.payload.line}];
        return next.length > MAX_CONSOLE_LINES ? next.slice(next.length - MAX_CONSOLE_LINES) : next;
      });
      if (this.consoleAutoScroll) this.consoleScrollPending = true;
    });
  }

  ngAfterViewChecked(): void {
    if (!this.consoleScrollPending) return;
    const el = this.consoleBody()?.nativeElement;
    if (el) el.scrollTop = el.scrollHeight;
    this.consoleScrollPending = false;
  }

  ngOnDestroy(): void {
    if (this.pollTimer !== null) clearInterval(this.pollTimer);
    this.unlistenConsole?.();
    // Not awaited — ngOnDestroy can't be async — but this still fires the kill request for a
    // logs stream left running when the tab is switched away from (the component is torn down).
    this.stopActiveLogsIfAny();
  }

  onConsoleScroll(): void {
    const el = this.consoleBody()?.nativeElement;
    if (!el) return;
    this.consoleAutoScroll = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  }

  async loadServices(): Promise<void> {
    const cfg = await this.config.get();
    const path = cfg.docker_compose_path?.trim() || null;
    this.composePath.set(path);
    this.favorites.set(new Set(cfg.docker_favorite_services ?? []));
    if (!path) {
      this.services.set([]);
      this.error.set(null);
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    try {
      const names = await this.shell.dockerListServices(path);
      this.services.set(names.map(service => ({service, state: 'unknown', health: null})));
      await this.refreshStatus(false);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
      this.services.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  async refreshStatus(notifyChanges = true): Promise<void> {
    const path = this.composePath();
    if (!path || this.statusInFlight) return;
    this.statusInFlight = true;
    try {
      const statuses = await this.shell.dockerServiceStatus(path);
      const byService = new Map(statuses.map(s => [s.service, s]));
      this.services.update(rows => rows.map(row => {
        const state = byService.get(row.service)?.state ?? 'not created';
        const health = byService.get(row.service)?.health ?? null;
        if (notifyChanges) this.notifyIfChanged(row.service, state, health);
        this.previousStatus.set(row.service, {state, health});
        return {...row, state, health};
      }));
      this.error.set(null);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.statusInFlight = false;
    }
  }

  private notifyIfChanged(service: string, state: string, health: string | null): void {
    const previous = this.previousStatus.get(service);
    if (!previous || (previous.state === state && previous.health === health)) return;
    const changes: string[] = [];
    if (previous.state !== state) changes.push(`state: ${previous.state} → ${state}`);
    if (previous.health !== health) changes.push(`health: ${previous.health ?? 'none'} → ${health ?? 'none'}`);
    this.shell.notify('Docker', `${service} — ${changes.join(', ')}`).catch(() => {
    });
  }

  isFavorite(service: string): boolean {
    return this.favorites().has(service);
  }

  async toggleFavorite(service: string): Promise<void> {
    const current = new Set(this.favorites());
    if (current.has(service)) {
      current.delete(service);
    } else {
      current.add(service);
    }
    this.favorites.set(current);
    const cfg = await this.config.get();
    await this.config.set({...cfg, docker_favorite_services: [...current]});
  }

  isRunning(service: string, action: DockerAction): boolean {
    return this.runningActions().has(`${service}:${action}`);
  }

  isAnyActionRunning(service: string): boolean {
    const running = this.runningActions();
    return ACTIONS.some(action => running.has(`${service}:${action}`));
  }

  async runAction(service: string, action: DockerAction): Promise<void> {
    const path = this.composePath();
    if (!path) return;
    const key = `${service}:${action}`;
    const label = action === 'pull_start' ? 'pull & start' : action;
    this.runningActions.update(set => new Set(set).add(key));

    // Taking over the shared drawer from a live logs stream must also kill that stream's
    // backend process — otherwise it keeps running (and emitting now-unwatched events) forever.
    await this.stopActiveLogsIfAny();

    const operationId = crypto.randomUUID();
    this.consoleOperationId.set(operationId);
    this.consoleMode.set('action');
    this.consoleLines.set([]);
    this.consoleTitle.set(`${service} — ${label}`);
    this.consoleActive.set(true);
    this.consoleExpanded.set(true);
    this.consoleAutoScroll = true;

    try {
      if (action === 'pull_start') {
        const cfg = await this.config.get();
        await this.shell.dockerPullStart(path, service, cfg.pull_start_command, operationId);
      } else {
        await this.shell.dockerServiceAction(path, service, action, operationId);
      }
      this.snackBar.open(`${service}: ${label} succeeded`, 'Dismiss', {duration: 3000});
      await this.refreshStatus();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.snackBar.open(`${service}: ${label} failed — ${message}`, 'Dismiss', {duration: 5000});
    } finally {
      this.runningActions.update(set => {
        const next = new Set(set);
        next.delete(key);
        return next;
      });
      // Only this operation's own completion should clear the "running" indicator — a newer
      // action may have already taken over the drawer while this one was still finishing up.
      if (this.consoleOperationId() === operationId) this.consoleActive.set(false);
    }
  }

  isViewingLogs(service: string): boolean {
    return this.consoleMode() === 'logs' && this.viewingLogsFor() === service;
  }

  /** Logs button handler — toggles off if already viewing this service's logs, otherwise starts
   *  (or switches the drawer to) following this service. */
  async viewLogs(service: string): Promise<void> {
    const path = this.composePath();
    if (!path) return;
    if (this.isViewingLogs(service)) {
      await this.stopLogs();
      return;
    }
    await this.stopActiveLogsIfAny();

    const operationId = crypto.randomUUID();
    this.consoleOperationId.set(operationId);
    this.consoleMode.set('logs');
    this.viewingLogsFor.set(service);
    this.consoleLines.set([]);
    this.consoleTitle.set(`${service} — logs`);
    this.consoleActive.set(true);
    this.consoleExpanded.set(true);
    this.consoleAutoScroll = true;

    try {
      await this.shell.dockerServiceLogsStart(path, service, operationId);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.snackBar.open(`${service}: failed to open logs — ${message}`, 'Dismiss', {duration: 5000});
      if (this.consoleOperationId() === operationId) {
        this.consoleActive.set(false);
        this.consoleMode.set(null);
        this.viewingLogsFor.set(null);
      }
    }
  }

  /** Stops the currently-following logs stream, if any, and closes the drawer. */
  async stopLogs(): Promise<void> {
    await this.stopActiveLogsIfAny();
    this.consoleActive.set(false);
    this.consoleMode.set(null);
    this.viewingLogsFor.set(null);
    this.consoleTitle.set(null);
    this.consoleOperationId.set(null);
  }

  /** Kills the backend logs process for the current operation, if the drawer is in logs mode.
   *  Does not touch drawer/console signals — every caller resets whichever of those it needs
   *  right after (`stopLogs` closes the drawer; `runAction`/`viewLogs` repurpose it instead). */
  private async stopActiveLogsIfAny(): Promise<void> {
    if (this.consoleMode() !== 'logs') return;
    const operationId = this.consoleOperationId();
    if (!operationId) return;
    await this.shell.dockerServiceLogsStop(operationId).catch(() => {
    });
  }

  toggleConsole(): void {
    const expanding = !this.consoleExpanded();
    this.consoleExpanded.set(expanding);
    if (expanding) {
      this.consoleAutoScroll = true;
      this.consoleScrollPending = true;
    }
  }

  clearConsole(): void {
    this.consoleLines.set([]);
  }
}
