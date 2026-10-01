import {Injectable, signal} from '@angular/core';
import {ConfigService} from '../config.service';
import {MonitoringStage} from './monitoring-stage.model';

@Injectable({providedIn: 'root'})
export class MonitoringStagesService {
  private readonly _stages = signal<MonitoringStage[]>([]);
  readonly stages = this._stages.asReadonly();

  constructor(private config: ConfigService) {
  }

  async load(): Promise<void> {
    const cfg = await this.config.get();
    this._stages.set(cfg.monitoring_stages ?? []);
  }

  async addStage(stage: MonitoringStage): Promise<void> {
    const stages = [...this._stages(), stage];
    this._stages.set(stages);
    const cfg = await this.config.get();
    await this.config.set({...cfg, monitoring_stages: stages});
  }

  async updateStage(name: string, updates: MonitoringStage): Promise<void> {
    const stages = this._stages().map(s => s.name === name ? updates : s);
    this._stages.set(stages);
    const cfg = await this.config.get();
    await this.config.set({...cfg, monitoring_stages: stages});
  }

  async removeStage(name: string): Promise<void> {
    const stages = this._stages().filter(s => s.name !== name);
    this._stages.set(stages);
    const cfg = await this.config.get();
    await this.config.set({...cfg, monitoring_stages: stages});
  }
}
