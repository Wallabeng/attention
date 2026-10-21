import {describeEntityPath, fetchNamespaceRows, listQueues, listSubscriptions, listTopics} from './servicebus-api.util';
import {ServiceBusNamespace} from './servicebus-namespace.model';

const NS: ServiceBusNamespace = {
  name: 'prod', subscription_id: 'sub1', resource_group: 'rg1', namespace: 'my-ns', entities: [],
};
const BASE = 'https://management.azure.com/subscriptions/sub1/resourceGroups/rg1/providers/Microsoft.ServiceBus/namespaces/my-ns';

function counts(active: number, dead: number) {
  return JSON.stringify({
    name: 'x', properties: {countDetails: {
      activeMessageCount: active, deadLetterMessageCount: dead, scheduledMessageCount: 0,
      transferMessageCount: 0, transferDeadLetterMessageCount: 0,
    }},
  });
}

describe('servicebus-api.util', () => {
  it('describes entity paths', () => {
    expect(describeEntityPath('queues/q1')).toEqual({type: 'queue', label: 'q1'});
    expect(describeEntityPath('topics/t1')).toEqual({type: 'topic', label: 't1'});
    expect(describeEntityPath('topics/t1/subscriptions/s1')).toEqual({type: 'subscription', label: 't1 / s1'});
  });

  it('fetches only the selected entities, with a bearer token', async () => {
    const urls: string[] = [];
    const http = async (url: string, _m: string, headers: [string, string][]) => {
      urls.push(url);
      expect(headers).toEqual([['Authorization', 'Bearer tok']]);
      return counts(4, 1);
    };
    const {rows, errors} = await fetchNamespaceRows(http, 'tok', {...NS, entities: ['queues/q1', 'topics/t1/subscriptions/s1']});
    expect(urls).toEqual([
      `${BASE}/queues/q1?api-version=2021-11-01`,
      `${BASE}/topics/t1/subscriptions/s1?api-version=2021-11-01`,
    ]);
    expect(errors).toEqual([]);
    expect(rows.map(r => [r.namespace, r.type, r.name, r.active, r.deadLetter, r.total]))
      .toEqual([['prod', 'queue', 'q1', 4, 1, 5], ['prod', 'subscription', 't1 / s1', 4, 1, 5]]);
  });

  it('reports a failing entity without hiding the others', async () => {
    const http = async (url: string) => {
      if (url.includes('/queues/gone')) throw new Error('404');
      return counts(1, 0);
    };
    const {rows, errors} = await fetchNamespaceRows(http, 'tok', {...NS, entities: ['queues/gone', 'queues/ok']});
    expect(rows.map(r => r.name)).toEqual(['ok']);
    expect(errors).toEqual(['prod / queues/gone: 404']);
  });

  it('lists queues, following nextLink', async () => {
    const urls: string[] = [];
    const http = async (url: string) => {
      urls.push(url);
      if (url === `${BASE}/queues?api-version=2021-11-01`) {
        return JSON.stringify({value: [{name: 'q1'}], nextLink: 'https://next/queues'});
      }
      if (url === 'https://next/queues') return JSON.stringify({value: [{name: 'q2'}]});
      throw new Error(url);
    };
    const queues = await listQueues(http, 'tok', NS);
    expect(queues.map(e => e.path)).toEqual(['queues/q1', 'queues/q2']);
    expect(urls.length).toBe(2);
  });

  it('lists topics and one topic\'s subscriptions with a call each', async () => {
    const urls: string[] = [];
    const http = async (url: string) => {
      urls.push(url);
      if (url.includes('/topics/t1/subscriptions?')) return JSON.stringify({value: [{name: 's1'}]});
      if (url.includes('/topics?')) return JSON.stringify({value: [{name: 't1'}, {name: 't2'}]});
      throw new Error(url);
    };
    expect((await listTopics(http, 'tok', NS)).map(e => e.path)).toEqual(['topics/t1', 'topics/t2']);
    expect((await listSubscriptions(http, 'tok', NS, 't1')).map(e => e.path)).toEqual(['topics/t1/subscriptions/s1']);
    expect(urls.length).toBe(2);
  });
});
