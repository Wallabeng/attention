import {Injectable} from '@angular/core';
import {ConfigService} from '../config.service';
import {Item} from '../item.model';
import {SettingsSection, SyncProvider} from './sync-provider';
import {ShellService} from '../shell.service';

interface GhPullRequest {
  id: number;
  title: string;
  html_url: string;
  user: { login: string };
  draft: boolean;
  created_at: string;
  updated_at: string;
}

@Injectable()
export class GithubSyncService extends SyncProvider {
  override readonly source = 'github';

  constructor(private configService: ConfigService, private shell: ShellService) {
    super();
  }

  override getSettingsFields(): SettingsSection {
    return {
      title: 'GitHub',
      fields: [
        {
          configKey: 'github_token',
          label: 'GitHub Personal Access Token',
          type: 'password',
          hint: 'Needs repo scope (public_repo is enough for public repos). Create at github.com/settings/tokens.',
        },
        {
          configKey: 'github_repos',
          label: 'Repos to Watch',
          type: 'textarea',
          placeholder: 'owner/repo\nanother-owner/another-repo',
          hint: 'One owner/repo per line. Every open pull request in each repo is synced.',
        },
      ],
    };
  }

  override getPropertyOrder(): string[] {
    return ['Repo', 'Author', 'Status'];
  }

  async sync(): Promise<Item[] | null> {
    const config = await this.configService.get();
    if (!config.github_token || !config.github_repos) return null;

    const repos = config.github_repos.split('\n').map(r => r.trim()).filter(Boolean);
    if (repos.length === 0) return null;

    const headers: [string, string][] = [
      ['Authorization', `Bearer ${config.github_token}`],
      ['User-Agent', 'attention-app/0.1'],
      ['Accept', 'application/vnd.github+json'],
      ['X-GitHub-Api-Version', '2022-11-28'],
    ];

    const items: Item[] = [];
    for (const repo of repos) {
      const raw = await this.shell.httpRequest(
        `https://api.github.com/repos/${repo}/pulls?state=open&per_page=1000`,
        'GET',
        headers,
        null,
      );
      const pulls: GhPullRequest[] = JSON.parse(raw);
      for (const pr of pulls) {
        items.push({
          id: `github-${pr.id}`,
          title: pr.title,
          notes: null,
          source: 'github',
          state: 'open' as const,
          created_at: pr.created_at,
          updated_at: pr.updated_at,
          due_date: null,
          properties: {
            Repo: repo,
            Author: pr.user.login,
            Status: pr.draft ? 'Draft' : 'Open',
          },
          url: pr.html_url,
        });
      }
    }

    return items;
  }
}
