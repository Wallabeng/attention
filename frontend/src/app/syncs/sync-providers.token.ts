import { InjectionToken } from '@angular/core';
import { SyncProvider } from './sync-provider';

export const SYNC_PROVIDERS = new InjectionToken<SyncProvider[]>('SYNC_PROVIDERS');
