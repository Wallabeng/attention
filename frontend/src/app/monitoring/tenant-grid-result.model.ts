export interface TenantGridResult {
  tenant_group: string;
  ok: boolean;
  data?: unknown[];
  error?: string;
  url_mismatch?: boolean;
}
