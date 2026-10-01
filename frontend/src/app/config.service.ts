import {Injectable} from '@angular/core';
import {Config} from './config.model';
import {ShellService} from './shell.service';

export type {Config};

@Injectable({providedIn: 'root'})
export class ConfigService {
  constructor(private shell: ShellService) {}

  get(): Promise<Config> {
    return this.shell.getConfig();
  }

  async set(config: Config): Promise<void> {
    await this.shell.setConfig(config);
  }
}
