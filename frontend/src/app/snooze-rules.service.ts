import {Injectable, signal} from '@angular/core';
import {ConfigService} from './config.service';
import {SnoozeRule} from './snooze-rule.model';

function uuid(): string {
  return crypto.randomUUID();
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

@Injectable({providedIn: 'root'})
export class SnoozeRulesService {
  private readonly _rules = signal<SnoozeRule[]>([]);
  readonly rules = this._rules.asReadonly();

  constructor(private config: ConfigService) {
  }

  async load(): Promise<void> {
    const cfg = await this.config.get();
    this._rules.set(cfg.snooze_rules ?? []);
  }

  /** Rules still in effect (until date not passed) — used to auto-snooze newly-open items. Expired rules are kept in `rules` (not deleted) so they can be reactivated with a new due date. */
  activeRules(): SnoozeRule[] {
    return this._rules().filter(r => r.until >= today());
  }

  async addRule(title: string, patterns: string[], until: string): Promise<void> {
    const rule: SnoozeRule = {id: uuid(), title, patterns, until, created_at: new Date().toISOString()};
    const rules = [...this._rules(), rule];
    this._rules.set(rules);
    const cfg = await this.config.get();
    await this.config.set({...cfg, snooze_rules: rules});
  }

  async updateRule(id: string, updates: Partial<Pick<SnoozeRule, 'title' | 'patterns' | 'until'>>): Promise<void> {
    const rules = this._rules().map(r => r.id === id ? {...r, ...updates} : r);
    this._rules.set(rules);
    const cfg = await this.config.get();
    await this.config.set({...cfg, snooze_rules: rules});
  }

  async removeRule(id: string): Promise<void> {
    const rules = this._rules().filter(r => r.id !== id);
    this._rules.set(rules);
    const cfg = await this.config.get();
    await this.config.set({...cfg, snooze_rules: rules});
  }
}
