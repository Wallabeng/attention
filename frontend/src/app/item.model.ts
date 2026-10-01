export type ItemState = 'open' | 'done' | 'snoozed';

export interface Item {
  id: string;
  title: string;
  notes: string | null;
  source: string;
  state: ItemState;
  created_at: string;
  updated_at: string;
  due_date: string | null;
  properties: Record<string, string> | null;
  url: string | null;
}
