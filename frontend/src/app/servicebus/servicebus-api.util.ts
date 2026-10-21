import {ServiceBusNamespace} from './servicebus-namespace.model';

export interface ParsedConnectionString {
  host: string;
  keyName: string;
  key: string;
}

export interface ServiceBusEntityRow {
  namespace: string;
  type: 'queue' | 'topic' | 'subscription';
  /** `queue`, `topic` or `topic / subscription`. */
  name: string;
  active: number;
  deadLetter: number;
  scheduled: number;
  transfer: number;
  total: number;
}

const API_VERSION = '2017-04';
const PAGE_SIZE = 100;

/** Splits on the first `=` only — SharedAccessKey values are base64 and end in `=`. */
export function parseConnectionString(connectionString: string): ParsedConnectionString {
  const parts = new Map<string, string>();
  for (const segment of connectionString.split(';')) {
    const index = segment.indexOf('=');
    if (index > 0) parts.set(segment.slice(0, index).trim().toLowerCase(), segment.slice(index + 1).trim());
  }
  const endpoint = parts.get('endpoint');
  const keyName = parts.get('sharedaccesskeyname');
  const key = parts.get('sharedaccesskey');
  if (!endpoint || !keyName || !key) {
    throw new Error('Connection string needs Endpoint, SharedAccessKeyName and SharedAccessKey');
  }
  const host = endpoint.replace(/^sb:\/\//i, '').replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  return {host, keyName, key};
}

function toBase64(bytes: ArrayBuffer): string {
  let binary = '';
  for (const b of new Uint8Array(bytes)) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** SAS token for the namespace, valid for one hour. Needs a key with the `Manage` claim. */
export async function buildSasToken(conn: ParsedConnectionString, nowMs = Date.now()): Promise<string> {
  const resource = encodeURIComponent(`https://${conn.host}/`);
  const expiry = Math.floor(nowMs / 1000) + 3600;
  const data = new TextEncoder().encode(`${resource}\n${expiry}`);
  const cryptoKey = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(conn.key), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  const signature = encodeURIComponent(toBase64(await crypto.subtle.sign('HMAC', cryptoKey, data)));
  return `SharedAccessSignature sr=${resource}&sig=${signature}&se=${expiry}&skn=${encodeURIComponent(conn.keyName)}`;
}

interface FeedEntry {
  title: string;
  counts: { active: number; deadLetter: number; scheduled: number; transfer: number; total: number };
}

function childText(parent: Element, localName: string): string | null {
  for (const el of Array.from(parent.getElementsByTagName('*'))) {
    if (el.localName === localName) return el.textContent;
  }
  return null;
}

function num(parent: Element, localName: string): number {
  return Number(childText(parent, localName) ?? 0) || 0;
}

export function parseFeed(xml: string): FeedEntry[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) throw new Error('Unparseable Service Bus response');
  return Array.from(doc.getElementsByTagName('entry')).map(entry => {
    const title = entry.getElementsByTagName('title')[0]?.textContent ?? '';
    const active = num(entry, 'ActiveMessageCount');
    const deadLetter = num(entry, 'DeadLetterMessageCount');
    const scheduled = num(entry, 'ScheduledMessageCount');
    const transfer = num(entry, 'TransferMessageCount') + num(entry, 'TransferDeadLetterMessageCount');
    return {title, counts: {active, deadLetter, scheduled, transfer, total: active + deadLetter + scheduled + transfer}};
  });
}

type Http = (url: string, method: string, headers: [string, string][], body: string | null) => Promise<string>;

async function fetchAll(http: Http, host: string, token: string, path: string): Promise<FeedEntry[]> {
  const entries: FeedEntry[] = [];
  for (let skip = 0; ; skip += PAGE_SIZE) {
    const url = `https://${host}/${path}?api-version=${API_VERSION}&$skip=${skip}&$top=${PAGE_SIZE}`;
    const page = parseFeed(await http(url, 'GET', [['Authorization', token]], null));
    entries.push(...page);
    if (page.length < PAGE_SIZE) return entries;
  }
}

/** Every queue, topic and subscription of one namespace with their message counts. */
export async function fetchNamespaceRows(
  http: Http, namespace: ServiceBusNamespace,
): Promise<ServiceBusEntityRow[]> {
  const conn = parseConnectionString(namespace.connection_string);
  const token = await buildSasToken(conn);
  const rows: ServiceBusEntityRow[] = [];
  const row = (type: ServiceBusEntityRow['type'], name: string, c: FeedEntry['counts']): ServiceBusEntityRow =>
    ({namespace: namespace.name, type, name, ...c});

  for (const q of await fetchAll(http, conn.host, token, '$Resources/Queues')) {
    rows.push(row('queue', q.title, q.counts));
  }
  const topics = await fetchAll(http, conn.host, token, '$Resources/Topics');
  const subscriptions = await Promise.all(topics.map(async t =>
    ({topic: t.title, subs: await fetchAll(http, conn.host, token, `${encodeURIComponent(t.title)}/subscriptions`)})));
  for (const t of topics) {
    rows.push(row('topic', t.title, t.counts));
    for (const sub of subscriptions.find(s => s.topic === t.title)!.subs) {
      rows.push(row('subscription', `${t.title} / ${sub.title}`, sub.counts));
    }
  }
  return rows;
}
