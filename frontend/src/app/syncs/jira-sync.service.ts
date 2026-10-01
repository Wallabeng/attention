import {Injectable} from '@angular/core';
import {ConfigService} from '../config.service';
import {Item} from '../item.model';
import {SettingsSection, SyncProvider} from './sync-provider';
import {ShellService} from '../shell.service';

interface JiraIssueFields {
  summary: string;
  status: { name: string };
  priority: { name: string } | null;
  issuetype: { name: string };
  created: string;
  updated: string;
}

interface JiraIssue {
  id: string;
  key: string;
  fields: JiraIssueFields;
}

interface JiraSearchResponse {
  issues: JiraIssue[];
}

@Injectable()
export class JiraSyncService extends SyncProvider {
  override readonly source = 'jira';

  constructor(private configService: ConfigService, private shell: ShellService) {
    super();
  }

  override getSettingsFields(): SettingsSection {
    return {
      title: 'Jira',
      fields: [
        {
          configKey: 'jira_url',
          label: 'Jira URL',
          type: 'url',
          placeholder: 'https://jira.example.com',
        },
        {
          configKey: 'jira_token',
          label: 'Personal Access Token',
          type: 'password',
          hint: 'Generate in Jira → Profile → Personal Access Tokens',
        },
        {
          configKey: 'jira_jql_filter',
          label: 'Extra JQL filter (optional)',
          type: 'text',
          hint: 'Appended with AND to the base query. Example: project = MYPROJ',
          placeholder: 'project = MYPROJ',
        },
      ],
    };
  }

  override getPropertyOrder(): string[] {
    return ['Type', 'Status', 'Priority'];
  }

  override async sync(): Promise<Item[] | null> {
    const config = await this.configService.get();
    if (!config.jira_url || !config.jira_token) return null;

    const base = config.jira_url.replace(/\/$/, '');

    let jql = 'assignee = currentUser() AND statusCategory != Done';
    if (config.jira_jql_filter?.trim()) {
      jql += ` AND ${config.jira_jql_filter.trim()}`;
    }

    const url = `${base}/rest/api/2/search?jql=${encodeURIComponent(jql)}&fields=summary,status,priority,issuetype,created,updated&maxResults=1000`;

    const raw = await this.shell.httpRequest(
      url,
      'GET',
      [['Authorization', `Bearer ${config.jira_token}`]],
      null,
    );

    const response: JiraSearchResponse = JSON.parse(raw);

    return response.issues.map(issue => ({
      id: `jira-${issue.key}`,
      title: `[${issue.key}] ${issue.fields.summary}`,
      notes: null,
      source: 'jira',
      state: 'open' as const,
      created_at: issue.fields.created,
      updated_at: issue.fields.updated,
      due_date: null,
      properties: {
        Type: issue.fields.issuetype.name,
        Status: issue.fields.status.name,
        ...(issue.fields.priority ? {Priority: issue.fields.priority.name} : {}),
      },
      url: `${base}/browse/${issue.key}`,
    }));
  }
}
