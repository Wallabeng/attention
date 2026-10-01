import {Item} from '../item.model';

export interface SettingsField {
  configKey: string;
  label: string;
  type: 'text' | 'password' | 'url' | 'textarea' | 'checkbox';
  hint?: string;
  placeholder?: string;
}

export interface SettingsSection {
  title: string;
  fields: SettingsField[];
}

export abstract class SyncProvider {
  abstract readonly source: string;

  /** Fetch and map items from the external source. Returns null when unconfigured (no mutations). */
  abstract sync(): Promise<Item[] | null>;

  getSettingsFields?(): SettingsSection;
  getPropertyOrder?(): string[];

  /** True if this item currently needs less attention (e.g. waiting on someone else). Deprioritized in the inbox: sorted last, shown with a muted marker. */
  needsLessAttention?(item: Item): boolean;

  /** True if this item currently needs more attention (e.g. a triggered alert). Prioritized in the inbox: sorted first, shown with a warning marker. */
  needsMoreAttention?(item: Item): boolean;
}
