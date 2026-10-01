import {Inject, Injectable} from '@angular/core';
import {Item} from '../item.model';
import {SYNC_PROVIDERS} from './sync-providers.token';
import {SyncProvider} from './sync-provider';
import {SourcesService} from '../sources.service';

export interface ProviderResult {
  source: string;
  items: Item[];
}

@Injectable({providedIn: 'root'})
export class SyncCoordinatorService {
  constructor(
    @Inject(SYNC_PROVIDERS) private providers: SyncProvider[],
    private sources: SourcesService,
  ) {
  }

  async sync(): Promise<{ results: ProviderResult[]; errors: string[] }> {
    const results: ProviderResult[] = [];
    const errors: string[] = [];
    for (const provider of this.providers) {
      if (this.sources.isMuted(provider.source)) continue;
      try {
        const items = await provider.sync();
        if (items !== null) {
          results.push({source: provider.source, items});
          this.sources.reportSyncResult(provider.source, true);
        }
      } catch (e) {
        const msg = String(e);
        errors.push(msg);
        this.sources.reportSyncResult(provider.source, false, msg);
      }
    }
    return {results, errors};
  }
}
