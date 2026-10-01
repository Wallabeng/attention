import {Injectable} from '@angular/core';
import {ConfigService} from '../config.service';
import {Item} from '../item.model';
import {SettingsSection, SyncProvider} from './sync-provider';
import {ShellService} from '../shell.service';

interface JenkinsBuild {
  result: string | null;
  duration: number;
  url: string;
  number: number;
  building: boolean;
  timestamp: number;
}

function jobPathToApiSegments(jobPath: string): string {
  return jobPath.split('/').map(s => `job/${s}`).join('/');
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

const LONG_RUNNING_PREFIX = 'jenkins-running-';

@Injectable()
export class JenkinsSyncService extends SyncProvider {
  override readonly source = 'jenkins';

  constructor(private configService: ConfigService, private shell: ShellService) {
    super();
  }

  override getSettingsFields(): SettingsSection {
    return {
      title: 'Jenkins',
      fields: [
        {
          configKey: 'jenkins_url',
          label: 'Jenkins URL',
          type: 'url',
          placeholder: 'https://jenkins.example.com',
          hint: 'Base URL of your Jenkins instance.',
        },
        {
          configKey: 'jenkins_username',
          label: 'Jenkins Username',
          type: 'text',
        },
        {
          configKey: 'jenkins_api_token',
          label: 'Jenkins API Token',
          type: 'password',
          hint: 'From Jenkins → Your Profile → Security.',
        },
        {
          configKey: 'jenkins_jobs',
          label: 'Jobs to Watch',
          type: 'textarea',
          placeholder: 'my-app\nbackend/deploy\nfolder/subfolder/job',
          hint: 'One job path per line. Use folder/job for nested paths.',
        },
        {
          configKey: 'jenkins_folders',
          label: 'Folders to Watch',
          type: 'textarea',
          placeholder: 'my-team\nplatform/backend',
          hint: 'One folder path per line. All jobs inside (recursively) will be synced.',
        },
        {
          configKey: 'jenkins_excluded_paths',
          label: 'Excluded Paths',
          type: 'textarea',
          placeholder: '_verifier\nCNG_devops',
          hint: 'One substring per line. Any folder or job whose path contains it will be skipped.',
        },
        {
          configKey: 'jenkins_long_running_minutes',
          label: 'Long-Running Build Threshold (minutes)',
          type: 'text',
          placeholder: '60',
          hint: 'A currently-running build shows in the inbox with increased attention once it runs longer than this.',
        },
      ],
    };
  }

  override getPropertyOrder(): string[] {
    return ['Duration'];
  }

  override needsMoreAttention(item: Item): boolean {
    return item.id.startsWith(LONG_RUNNING_PREFIX);
  }

  async sync(): Promise<Item[] | null> {
    const config = await this.configService.get();
    if (!config.jenkins_url || !config.jenkins_username || !config.jenkins_api_token) {
      return null;
    }
    if (!config.jenkins_jobs && !config.jenkins_folders) {
      return null;
    }

    const base = config.jenkins_url.replace(/\/$/, '');
    const credentials = btoa(`${config.jenkins_username}:${config.jenkins_api_token}`);

    const explicitPaths = config.jenkins_jobs
      ? config.jenkins_jobs.split('\n').map(s => s.trim()).filter(s => s.length > 0)
      : [];

    const folderPaths = config.jenkins_folders
      ? config.jenkins_folders.split('\n').map(s => s.trim()).filter(s => s.length > 0)
      : [];

    const excludes = config.jenkins_excluded_paths
      ? config.jenkins_excluded_paths.split('\n').map(s => s.trim()).filter(s => s.length > 0)
      : [];

    const longRunningMinutes = Number(config.jenkins_long_running_minutes);
    const longRunningMs = longRunningMinutes > 0 ? longRunningMinutes * 60_000 : null;

    const discovered: string[] = [];
    for (const folder of folderPaths) {
      const leaves = await this.expandFolder(base, credentials, folder, excludes);
      discovered.push(...leaves);
    }

    const allPaths = [...new Set([...explicitPaths, ...discovered])];

    const items: Item[] = [];
    for (const jobPath of allPaths) {
      try {
        const apiPath = jobPathToApiSegments(jobPath);
        const url = `${base}/${apiPath}/lastBuild/api/json?tree=result,duration,url,number,building,timestamp`;
        const raw = await this.shell.httpRequest(
          url,
          'GET',
          [['Authorization', `Basic ${credentials}`]],
          null,
        );
        const build: JenkinsBuild = JSON.parse(raw);
        const jobName = jobPath.split('/').pop()!;
        const startedAt = new Date(build.timestamp).toISOString();

        if (build.building) {
          const elapsedMs = Date.now() - build.timestamp;
          if (longRunningMs === null || elapsedMs < longRunningMs) {
            continue;
          }
          items.push({
            id: `${LONG_RUNNING_PREFIX}${jobPath}`,
            title: jobName,
            notes: null,
            source: 'jenkins',
            state: 'open',
            created_at: startedAt,
            updated_at: startedAt,
            due_date: null,
            properties: {Duration: formatDuration(elapsedMs)},
            url: build.url,
          });
          continue;
        }

        if (build.result !== 'FAILURE' && build.result !== 'UNSTABLE') {
          continue;
        }
        const finishedAt = new Date(build.timestamp + build.duration).toISOString();
        items.push({
          id: `jenkins-${jobPath}`,
          title: jobName,
          notes: null,
          source: 'jenkins',
          state: 'open',
          created_at: startedAt,
          updated_at: finishedAt,
          due_date: null,
          properties: build.duration > 0 ? {Duration: formatDuration(build.duration)} : null,
          url: build.url,
        });
      } catch (e) {
        console.error(jobPath, e);
      }
    }
    return items;
  }

  private async expandFolder(base: string, credentials: string, rootFolder: string, excludes: string[] = []): Promise<string[]> {
    const queue: string[] = [rootFolder];
    const visited = new Set<string>();
    const leaves: string[] = [];

    const isExcluded = (path: string) => excludes.some(e => path.includes(e));

    while (queue.length > 0) {
      const path = queue.shift()!;
      if (visited.has(path)) continue;
      visited.add(path);

      try {
        const apiPath = jobPathToApiSegments(path);
        const url = `${base}/${apiPath}/api/json`;
        const raw = await this.shell.httpRequest(url, 'GET', [['Authorization', `Basic ${credentials}`]], null);
        const data: { jobs: Array<{ name: string; _class: string }> } = JSON.parse(raw);
        for (const job of data.jobs ?? []) {
          const childPath = `${path}/${job.name}`;
          if (isExcluded(childPath)) continue;
          if (job._class?.includes('Folder')) {
            queue.push(childPath);
          } else {
            leaves.push(childPath);
          }
        }
      } catch {
      }
    }

    return leaves;
  }
}
