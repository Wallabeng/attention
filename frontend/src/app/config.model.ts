import {SnoozeRule} from './snooze-rule.model';
import {MonitoringStage} from './monitoring/monitoring-stage.model';

export interface Config {
  github_token: string | null;
  github_repos: string | null;
  gerrit_url: string | null;
  gerrit_username: string | null;
  gerrit_http_password: string | null;
  datadog_token: string | null;
  datadog_site: string | null;
  datadog_filter_query: string | null;
  gitlab_url: string | null;
  gitlab_token: string | null;
  gitlab_mr_labels: string | null;
  jenkins_url: string | null;
  jenkins_username: string | null;
  jenkins_api_token: string | null;
  jenkins_jobs: string | null;
  jenkins_folders: string | null;
  jenkins_excluded_paths: string | null;
  jenkins_long_running_minutes: string | null;
  jira_url: string | null;
  jira_token: string | null;
  jira_jql_filter: string | null;
  gerrit_repos_root: string | null;
  gerrit_keywords: string | null;
  sonarqube_url: string | null;
  sonarqube_token: string | null;
  sonarqube_assigned_only: string | null;
  muted_sources: string[];
  snooze_rules: SnoozeRule[];
  monitoring_stages: MonitoringStage[];
  monitoring_hidden_columns: Record<string, string[]>;
  docker_compose_path: string | null;
  pull_start_command: string | null;
  docker_favorite_services: string[];
}
