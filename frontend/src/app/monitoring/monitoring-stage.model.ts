export interface MonitoringStage {
  name: string;
  token_base_url: string;
  tenant_list_base_url: string;
  tenant_base_url_template: string;
  sso_login_url: string;
  basic_auth_username: string;
  basic_auth_password: string;
}
