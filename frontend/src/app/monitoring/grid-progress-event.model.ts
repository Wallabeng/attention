import {TenantGridResult} from './tenant-grid-result.model';

export interface GridProgressEvent {
  request_id: string;
  done: number;
  total: number;
  result: TenantGridResult;
}
