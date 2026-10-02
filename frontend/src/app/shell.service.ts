import {Injectable} from '@angular/core';
import {invoke} from '@tauri-apps/api/core';
import {Config} from './config.model';
import {DockerServiceStatus} from './docker/docker-service-status.model';
import {Item} from './item.model';
import {TenantGridResult} from './monitoring/tenant-grid-result.model';
import {CMD} from './tauri-commands';

@Injectable({providedIn: 'root'})
export class ShellService {
  getItems(): Promise<Item[]> {
    return invoke<Item[]>(CMD.getItems);
  }

  createItem(item: Item): Promise<Item[]> {
    return invoke<Item[]>(CMD.createItem, {item});
  }

  updateItem(item: Item): Promise<Item[]> {
    return invoke<Item[]>(CMD.updateItem, {item});
  }

  deleteItem(id: string): Promise<Item[]> {
    return invoke<Item[]>(CMD.deleteItem, {id});
  }

  openUrl(url: string): void {
    invoke(CMD.openUrl, {url}).catch(() => {});
  }

  notify(title: string, body: string): Promise<void> {
    return invoke(CMD.notify, {title, body});
  }

  getConfig(): Promise<Config> {
    return invoke<Config>(CMD.getConfig);
  }

  setConfig(config: Config): Promise<void> {
    return invoke<void>(CMD.setConfig, {config});
  }

  getLastSeenFeature(): Promise<string | null> {
    return invoke<string | null>(CMD.getLastSeenFeature);
  }

  setLastSeenFeature(id: string): Promise<void> {
    return invoke<void>(CMD.setLastSeenFeature, {id});
  }

  setBadgeCount(count: number): void {
    invoke(CMD.setBadgeCount, {count}).catch(() => {});
  }

  httpRequest(url: string, method: string, headers: [string, string][], body: string | null): Promise<string> {
    return invoke<string>(CMD.httpRequest, {url, method, headers, body});
  }

  runInTerminal(command: string, workingDir: string): Promise<void> {
    return invoke<void>(CMD.runInTerminal, {command, workingDir});
  }

  openStageLogin(stageName: string, ssoLoginUrl: string): Promise<void> {
    return invoke<void>(CMD.openStageLogin, {stageName, ssoLoginUrl});
  }

  confirmStageLogin(stageName: string): Promise<void> {
    return invoke<void>(CMD.confirmStageLogin, {stageName});
  }

  fetchGridData(
    stageName: string,
    tenantHostTemplate: string,
    gridPath: string,
    tenantGroups: string[],
    requestId: string,
  ): Promise<TenantGridResult[]> {
    return invoke<TenantGridResult[]>(CMD.fetchGridData, {
      stageName, tenantHostTemplate, gridPath, tenantGroups, requestId,
    });
  }

  cancelGridFetch(requestId: string): Promise<void> {
    return invoke<void>(CMD.cancelGridFetch, {requestId});
  }

  dockerListServices(composePath: string): Promise<string[]> {
    return invoke<string[]>(CMD.dockerListServices, {composePath});
  }

  dockerServiceStatus(composePath: string): Promise<DockerServiceStatus[]> {
    return invoke<DockerServiceStatus[]>(CMD.dockerServiceStatus, {composePath});
  }

  dockerServiceAction(composePath: string, service: string, action: string, operationId: string): Promise<void> {
    return invoke<void>(CMD.dockerServiceAction, {composePath, service, action, operationId});
  }

  dockerPullStart(
    composePath: string,
    service: string,
    commandTemplate: string | null,
    operationId: string,
  ): Promise<void> {
    return invoke<void>(CMD.dockerPullStart, {composePath, service, commandTemplate, operationId});
  }

  dockerServiceLogsStart(composePath: string, service: string, operationId: string): Promise<void> {
    return invoke<void>(CMD.dockerServiceLogsStart, {composePath, service, operationId});
  }

  dockerServiceLogsStop(operationId: string): Promise<void> {
    return invoke<void>(CMD.dockerServiceLogsStop, {operationId});
  }

  /** Thin dynamic-import wrapper around @tauri-apps/api/event, mirroring the existing
   *  dynamic-import pattern used for autostart/notifications. Returns a no-op unlisten
   *  function when running outside Tauri (e.g. `ng serve` in a plain browser). */
  async listen<T>(event: string, handler: (event: { payload: T }) => void): Promise<() => void> {
    try {
      const {listen} = await import('@tauri-apps/api/event');
      return await listen<T>(event, handler);
    } catch {
      return () => {};
    }
  }

  async requestNotificationPermission(): Promise<void> {
    try {
      const {isPermissionGranted, requestPermission} = await import('@tauri-apps/plugin-notification');
      if (!await isPermissionGranted()) {
        await requestPermission();
      }
    } catch {
      // no-op when running outside Tauri (e.g. ng serve in browser)
    }
  }

  async isAutostartEnabled(): Promise<boolean> {
    try {
      const {isEnabled} = await import('@tauri-apps/plugin-autostart');
      return await isEnabled();
    } catch {
      return false; // running outside Tauri (e.g. ng serve in browser)
    }
  }

  async setAutostart(enabled: boolean): Promise<void> {
    try {
      const {enable, disable} = await import('@tauri-apps/plugin-autostart');
      if (enabled) {
        await enable();
      } else {
        await disable();
      }
    } catch {
      // no-op when running outside Tauri
    }
  }
}
