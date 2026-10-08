import {Injectable} from '@angular/core';
import {ConfigService} from '../config.service';
import {Item} from '../item.model';
import {SettingsSection, SyncProvider} from './sync-provider';
import {ShellService} from '../shell.service';

interface GerritChange {
  _number: number;
  project: string;
  subject: string;
  created: string;
  updated: string;
  labels?: Record<string, { all?: { value: number }[] }>;
}

function gerritLabelProperties(labels: GerritChange['labels']): Record<string, string> | null {
  if (!labels) return null;
  const props: Record<string, string> = {};
  for (const [name, info] of Object.entries(labels)) {
    const votes = info.all?.filter(v => v.value).map(v => v.value) ?? [];
    if (votes.length === 0) continue;
    const min = Math.min(...votes);
    const value = min < 0 ? min : Math.max(...votes);
    if (value !== 0) {
      props[name] = value > 0 ? `+${value}` : String(value);
    }
  }
  return Object.keys(props).length > 0 ? props : null;
}

const OUTGOING = 'Outgoing';
// Non-label properties, so their values are never mistaken for label votes.
const LABEL_KEYS_EXCLUDED = ['Project', 'Keyword', 'Role'];

@Injectable()
export class GerritSyncService extends SyncProvider {
  override readonly source = 'gerrit';

  constructor(private configService: ConfigService, private shell: ShellService) {
    super();
  }

  override getSettingsFields(): SettingsSection {
    return {
      title: 'Gerrit',
      fields: [
        {
          configKey: 'gerrit_url',
          label: 'Gerrit URL',
          type: 'url',
          placeholder: 'https://gerrit.example.com',
          hint: 'Base URL of your Gerrit instance.',
        },
        {
          configKey: 'gerrit_username',
          label: 'Gerrit Username',
          type: 'text',
        },
        {
          configKey: 'gerrit_http_password',
          label: 'Gerrit HTTP Password',
          type: 'password',
          hint: 'From Gerrit User Settings → HTTP Credentials.',
        },
        {
          configKey: 'gerrit_repos_root',
          label: 'Local repos root',
          type: 'text',
          placeholder: '~/src',
          hint: 'Parent directory containing local Gerrit repo clones. Used by AI Review action.',
        },
        {
          configKey: 'gerrit_keywords',
          label: 'Keyword monitor',
          type: 'textarea',
          placeholder: 'my-team\nsecurity-fix',
          hint: 'One keyword per line. Open changes whose commit message contains any keyword are surfaced, even if you are not a reviewer.',
        },
      ],
    };
  }

  override getPropertyOrder(): string[] {
    return ['Verified', 'Code-Review', 'Project', 'Keyword', 'Role'];
  }

  override needsLessAttention(item: Item): boolean {
    const props = item.properties;
    if (!props) return false;
    if (props['Role'] === OUTGOING) {
      // Own change: only needs me when a label is negative (fix it) or it is fully approved (submit it).
      const anyNegative = Object.entries(props).some(([k, v]) => LABEL_KEYS_EXCLUDED.indexOf(k) < 0 && v.startsWith('-'));
      const approved = props['Verified']?.startsWith('+') && props['Code-Review']?.startsWith('+');
      return !(anyNegative || approved);
    }
    return ['Verified', 'Code-Review'].some(label => props[label]?.startsWith('-'));
  }

  async sync(): Promise<Item[] | null> {
    const config = await this.configService.get();
    if (!config.gerrit_url || !config.gerrit_username || !config.gerrit_http_password) return null;

    const credentials = btoa(`${config.gerrit_username}:${config.gerrit_http_password}`);
    const base = config.gerrit_url.replace(/\/$/, '');

    const reviewerChanges = await this.fetchChanges(
      `${base}/a/changes/?q=reviewer:self+status:open+-owner:self+-label:Code-Review=2+-age:14d&n=50&o=LABELS`,
      credentials,
    );

    const outgoingChanges = await this.fetchChanges(
      `${base}/a/changes/?q=owner:self+status:open&n=50&o=LABELS`,
      credentials,
    );

    const reviewerIds = new Set([...reviewerChanges, ...outgoingChanges].map(c => c._number));
    const reviewerItems = [
      ...reviewerChanges.map(c => this.mapChange(c, base, null)),
      ...outgoingChanges.map(c => this.mapChange(c, base, null, true)),
    ];

    const keywords = config.gerrit_keywords
      ? config.gerrit_keywords.split('\n').map(k => k.trim()).filter(Boolean)
      : [];

    if (keywords.length === 0) return reviewerItems;

    // Fetch keyword matches; track which keywords matched each change number.
    const kwMatchMap = new Map<number, { change: GerritChange; matchedKeywords: string[] }>();
    for (const kw of keywords) {
      const kwChanges = await this.fetchChanges(
        `${base}/a/changes/?q=status:open+(cc:self+OR+reviewer:self)+message:${encodeURIComponent(kw)}&n=50&o=LABELS`,
        credentials,
      );
      for (const change of kwChanges) {
        if (!kwMatchMap.has(change._number)) {
          kwMatchMap.set(change._number, {change, matchedKeywords: []});
        }
        kwMatchMap.get(change._number)!.matchedKeywords.push(kw);
      }
    }

    // Only surface keyword-matched changes not already shown via the reviewer query.
    const keywordItems = [...kwMatchMap.values()]
      .filter(({change}) => !reviewerIds.has(change._number))
      .map(({change, matchedKeywords}) =>
        this.mapChange(change, base, matchedKeywords.join(', ')),
      );

    return [...reviewerItems, ...keywordItems];
  }

  private async fetchChanges(url: string, credentials: string): Promise<GerritChange[]> {
    const raw = await this.shell.httpRequest(
      url,
      'GET',
      [
        ['Authorization', `Basic ${credentials}`],
        ['User-Agent', 'attention-app/0.1'],
      ],
      null,
    );
    const json = raw.replace(/^\)\]\}'\n/, '');
    return JSON.parse(json);
  }

  private mapChange(change: GerritChange, base: string, keyword: string | null, outgoing = false): Item {
    return {
      id: `gerrit-${change._number}`,
      title: change.subject,
      notes: null,
      source: 'gerrit',
      state: 'open' as const,
      created_at: change.created,
      updated_at: change.updated,
      due_date: null,
      properties: {
        Project: change.project,
        ...gerritLabelProperties(change.labels),
        ...(keyword ? {Keyword: keyword} : {}),
        ...(outgoing ? {Role: OUTGOING} : {}),
      },
      url: `${base}/c/${change._number}`,
    };
  }
}
