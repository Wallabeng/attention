import {computed, Inject, Injectable, signal} from '@angular/core';
import {ConfigService} from './config.service';
import {SyncProvider} from './syncs/sync-provider';
import {SYNC_PROVIDERS} from './syncs/sync-providers.token';

export interface SyncResult {
  success: boolean;
  error?: string;
}

@Injectable({providedIn: 'root'})
export class SourcesService {
  readonly allSources: string[];
  private readonly displayNames: Map<string, string>;

  private _mutedSources = signal<Set<string>>(new Set());
  readonly mutedSources = this._mutedSources.asReadonly();
  readonly anyMuted = computed(() => this._mutedSources().size > 0);

  private _syncResults = signal<Map<string, SyncResult>>(new Map());
  readonly syncResults = this._syncResults.asReadonly();

  constructor(
    @Inject(SYNC_PROVIDERS) providers: SyncProvider[],
    private config: ConfigService,
  ) {
    this.allSources = providers.map(p => p.source);
    this.displayNames = new Map(
      providers.map(p => [p.source, p.getSettingsFields?.()?.title ?? p.source]),
    );
  }

  async load(): Promise<void> {
    const cfg = await this.config.get();
    this._mutedSources.set(new Set(cfg.muted_sources ?? []));
  }

  isMuted(source: string): boolean {
    return this._mutedSources().has(source);
  }

  displayName(source: string): string {
    return this.displayNames.get(source) ?? source;
  }

  async toggleMute(source: string): Promise<void> {
    const current = new Set(this._mutedSources());
    if (current.has(source)) {
      current.delete(source);
    } else {
      current.add(source);
    }
    this._mutedSources.set(current);
    const cfg = await this.config.get();
    await this.config.set({...cfg, muted_sources: [...current]});
  }

  reportSyncResult(source: string, success: boolean, error?: string): void {
    const current = new Map(this._syncResults());
    current.set(source, {success, error});
    this._syncResults.set(current);
  }
}
