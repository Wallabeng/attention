import {ServiceBusNamespace} from './servicebus-namespace.model';

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
  /** Azure portal blade for the entity. */
  portalUrl: string;
}

export interface ServiceBusEntityRef {
  /** ARM sub-path, e.g. `topics/events/subscriptions/billing`. */
  path: string;
  type: ServiceBusEntityRow['type'];
  label: string;
}

type Http = (url: string, method: string, headers: [string, string][], body: string | null) => Promise<string>;

const ARM = 'https://management.azure.com';
const API_VERSION = '2021-11-01';

interface ArmEntity {
  name: string;
  properties?: {
    countDetails?: {
      activeMessageCount?: number;
      deadLetterMessageCount?: number;
      scheduledMessageCount?: number;
      transferMessageCount?: number;
      transferDeadLetterMessageCount?: number;
    };
  };
}

interface ArmList {
  value: ArmEntity[];
  nextLink?: string;
}

function namespaceBase(ns: ServiceBusNamespace): string {
  return `${ARM}/subscriptions/${encodeURIComponent(ns.subscription_id)}`
    + `/resourceGroups/${encodeURIComponent(ns.resource_group)}`
    + `/providers/Microsoft.ServiceBus/namespaces/${encodeURIComponent(ns.namespace)}`;
}

/** Portal deep link to an entity (path as in `ServiceBusNamespace.entities`). */
export function portalUrl(ns: ServiceBusNamespace, path: string): string {
  const resourceId = namespaceBase(ns).slice(ARM.length) + '/' + path.split('/').map(encodeURIComponent).join('/');
  return `https://portal.azure.com/#resource${resourceId}/overview`;
}

async function armGet<T>(http: Http, token: string, url: string): Promise<T> {
  return JSON.parse(await http(url, 'GET', [['Authorization', `Bearer ${token}`]], null)) as T;
}

async function armList(http: Http, token: string, url: string): Promise<ArmEntity[]> {
  const entities: ArmEntity[] = [];
  let next: string | undefined = `${url}?api-version=${API_VERSION}`;
  while (next) {
    const page: ArmList = await armGet<ArmList>(http, token, next);
    entities.push(...page.value);
    next = page.nextLink;
  }
  return entities;
}

/** Describes an entity path as a table row type and label. */
export function describeEntityPath(path: string): Pick<ServiceBusEntityRef, 'type' | 'label'> {
  const parts = path.split('/');
  if (parts[0] === 'queues') return {type: 'queue', label: parts[1]};
  if (parts.length === 2) return {type: 'topic', label: parts[1]};
  return {type: 'subscription', label: `${parts[1]} / ${parts[3]}`};
}

function toRefs(entities: ArmEntity[], prefix: string): ServiceBusEntityRef[] {
  return entities.map(e => {
    const path = `${prefix}${e.name}`;
    return {path, ...describeEntityPath(path)};
  });
}

/** Queues of a namespace, for the picker (one list call). */
export async function listQueues(http: Http, token: string, ns: ServiceBusNamespace): Promise<ServiceBusEntityRef[]> {
  return toRefs(await armList(http, token, `${namespaceBase(ns)}/queues`), 'queues/');
}

/** Topics of a namespace, for the picker (one list call; subscriptions are loaded per topic). */
export async function listTopics(http: Http, token: string, ns: ServiceBusNamespace): Promise<ServiceBusEntityRef[]> {
  return toRefs(await armList(http, token, `${namespaceBase(ns)}/topics`), 'topics/');
}

/** Subscriptions of one topic, for the picker. */
export async function listSubscriptions(
  http: Http, token: string, ns: ServiceBusNamespace, topic: string,
): Promise<ServiceBusEntityRef[]> {
  const entities = await armList(http, token, `${namespaceBase(ns)}/topics/${encodeURIComponent(topic)}/subscriptions`);
  return toRefs(entities, `topics/${topic}/subscriptions/`);
}

/** Rows for the namespace's selected entities; one entity failing doesn't hide the others. */
export async function fetchNamespaceRows(
  http: Http, token: string, ns: ServiceBusNamespace,
): Promise<{ rows: ServiceBusEntityRow[]; errors: string[] }> {
  const base = namespaceBase(ns);
  const results = await Promise.allSettled(ns.entities.map(async path => {
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    const entity = await armGet<ArmEntity>(http, token, `${base}/${encoded}?api-version=${API_VERSION}`);
    const c = entity.properties?.countDetails ?? {};
    const active = c.activeMessageCount ?? 0;
    const deadLetter = c.deadLetterMessageCount ?? 0;
    const scheduled = c.scheduledMessageCount ?? 0;
    const transfer = (c.transferMessageCount ?? 0) + (c.transferDeadLetterMessageCount ?? 0);
    const {type, label} = describeEntityPath(path);
    const row: ServiceBusEntityRow = {
      namespace: ns.name, type, name: label, active, deadLetter, scheduled, transfer,
      total: active + deadLetter + scheduled + transfer, portalUrl: portalUrl(ns, path),
    };
    return row;
  }));
  const rows: ServiceBusEntityRow[] = [];
  const errors: string[] = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') rows.push(r.value);
    else errors.push(`${ns.name} / ${ns.entities[i]}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
  });
  return {rows, errors};
}
