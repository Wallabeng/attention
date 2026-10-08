import {Injectable} from '@angular/core';
import {ConfigService} from '../config.service';
import {Item} from '../item.model';
import {SettingsSection, SyncProvider} from './sync-provider';
import {ShellService} from '../shell.service';

interface GitlabProject {
  path_with_namespace: string;
}

interface GitlabMergeRequest {
  id: number;
  title: string;
  web_url: string;
  author: { id: number; name: string };
  references: { full: string };
  created_at: string;
  updated_at: string;
  detailed_merge_status: string;
}

const OUTGOING = 'Outgoing';
// detailed_merge_status values on my own MR that need me to act (merge it, or fix what blocks it).
const OUTGOING_ACTION_STATUSES = [
  'mergeable',
  'broken_status',
  'ci_must_pass',
  'need_rebase',
  'discussions_not_resolved',
  'requested_changes',
];

@Injectable()
export class GitlabSyncService extends SyncProvider {
  override readonly source = 'gitlab';

  constructor(private configService: ConfigService, private shell: ShellService) {
    super();
  }

  override getSettingsFields(): SettingsSection {
    return {
      title: 'GitLab',
      fields: [
        {
          configKey: 'gitlab_url',
          label: 'GitLab URL',
          type: 'url',
          placeholder: 'https://gitlab.com',
        },
        {
          configKey: 'gitlab_token',
          label: 'Personal Access Token',
          type: 'password',
          hint: 'Requires read_api scope',
        },
        {
          configKey: 'gitlab_mr_labels',
          label: 'MR Labels',
          type: 'text',
          hint: 'Comma-separated labels. Shows all open MRs with any of these labels (MRs where you are a reviewer are always shown).',
          placeholder: 'needs-review, my-team',
        },
      ],
    };
  }

  override getPropertyOrder(): string[] {
    return ['Project', 'Author', 'Status', 'Role'];
  }

  override needsLessAttention(item: Item): boolean {
    const props = item.properties;
    if (props?.['Role'] !== OUTGOING) return false;
    return !OUTGOING_ACTION_STATUSES.includes(props['Status']);
  }

  override async sync(): Promise<Item[] | null> {
    const config = await this.configService.get();
    if (!config.gitlab_url || !config.gitlab_token) return null;

    const labels = config.gitlab_mr_labels
      ? config.gitlab_mr_labels.split(',').map(l => l.trim()).filter(Boolean)
      : [];

    const base = config.gitlab_url.replace(/\/$/, '');
    const headers: [string, string][] = [['PRIVATE-TOKEN', config.gitlab_token!]];

    // GitLab's labels param uses AND logic, so fetch per-label and deduplicate for OR behaviour.
    // MRs where I'm a reviewer, and my own MRs, are always included, regardless of labels.
    const me: { id: number } = JSON.parse(
      await this.shell.httpRequest(`${base}/api/v4/user`, 'GET', headers, null),
    );
    const queries = [
      `scope=all&author_id=${me.id}`,
      `scope=all&reviewer_id=${me.id}`,
      ...labels.map(l => `scope=all&labels=${encodeURIComponent(l)}`),
    ];
    const seenMrIds = new Set<number>();
    const items: Item[] = [];
    for (const query of queries) {
      const mrsRaw = await this.shell.httpRequest(
        `${base}/api/v4/merge_requests?state=opened&${query}&per_page=1000`,
        'GET',
        headers,
        null,
      );
      const mrs: GitlabMergeRequest[] = JSON.parse(mrsRaw);
      for (const mr of mrs) {
        if (seenMrIds.has(mr.id)) continue;
        seenMrIds.add(mr.id);
        items.push(this.mapMergeRequest(mr, mr.author.id === me.id));
      }
    }

    return items;
  }

  private mapMergeRequest(mr: GitlabMergeRequest, outgoing: boolean): Item {
    return {
      id: `gitlab-mr-${mr.id}`,
      title: mr.title,
      notes: null,
      source: 'gitlab',
      state: 'open' as const,
      created_at: mr.created_at,
      updated_at: mr.updated_at,
      due_date: null,
      properties: {
        Project: mr.references.full.split('!')[0],
        Author: mr.author.name,
        Status: mr.detailed_merge_status,
        ...(outgoing ? {Role: OUTGOING} : {}),
      },
      url: mr.web_url,
    };
  }
}
