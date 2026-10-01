import {Injectable, signal} from '@angular/core';
import {ShellService} from '../shell.service';

@Injectable({providedIn: 'root'})
export class MonitoringAuthService {
  private readonly _confirmedStages = signal<Set<string>>(new Set());
  readonly confirmedStages = this._confirmedStages.asReadonly();

  constructor(private shell: ShellService) {
  }

  isConfirmed(stageName: string): boolean {
    return this._confirmedStages().has(stageName);
  }

  async login(stageName: string, ssoLoginUrl: string): Promise<void> {
    await this.shell.openStageLogin(stageName, ssoLoginUrl);
  }

  async confirm(stageName: string): Promise<void> {
    await this.shell.confirmStageLogin(stageName);
    const next = new Set(this._confirmedStages());
    next.add(stageName);
    this._confirmedStages.set(next);
  }

  /** Called when a fetch detects an expired session, so the UI re-prompts login instead of showing stale data. */
  clear(stageName: string): void {
    const next = new Set(this._confirmedStages());
    next.delete(stageName);
    this._confirmedStages.set(next);
  }
}
