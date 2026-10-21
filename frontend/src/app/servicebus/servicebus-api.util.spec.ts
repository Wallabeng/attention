import {buildSasToken, fetchNamespaceRows, parseConnectionString, parseFeed} from './servicebus-api.util';

const CONN = 'Endpoint=sb://my-ns.servicebus.windows.net/;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=abc+def=';

function feed(entries: { title: string; active: number; dead: number }[]): string {
  return `<feed xmlns="http://www.w3.org/2005/Atom">${entries.map(e => `<entry><title>${e.title}</title><content>
    <QueueDescription xmlns:d2p1="http://schemas.microsoft.com/netservices/2011/06/servicebus"><d2p1:CountDetails>
    <d2p1:ActiveMessageCount>${e.active}</d2p1:ActiveMessageCount><d2p1:DeadLetterMessageCount>${e.dead}</d2p1:DeadLetterMessageCount>
    <d2p1:ScheduledMessageCount>0</d2p1:ScheduledMessageCount><d2p1:TransferMessageCount>0</d2p1:TransferMessageCount>
    <d2p1:TransferDeadLetterMessageCount>0</d2p1:TransferDeadLetterMessageCount></d2p1:CountDetails></QueueDescription>
    </content></entry>`).join('')}</feed>`;
}

describe('servicebus-api.util', () => {
  it('parses a connection string, keeping = inside the key', () => {
    expect(parseConnectionString(CONN)).toEqual({
      host: 'my-ns.servicebus.windows.net', keyName: 'RootManageSharedAccessKey', key: 'abc+def=',
    });
  });

  it('rejects an incomplete connection string', () => {
    expect(() => parseConnectionString('Endpoint=sb://x/')).toThrow();
  });

  it('builds a SAS token', async () => {
    const token = await buildSasToken(parseConnectionString(CONN), 0);
    expect(token).toMatch(/^SharedAccessSignature sr=https%3A%2F%2Fmy-ns\.servicebus\.windows\.net%2F&sig=.+&se=3600&skn=RootManageSharedAccessKey$/);
  });

  it('parses message counts from a feed', () => {
    const [entry] = parseFeed(feed([{title: 'orders', active: 3, dead: 2}]));
    expect(entry.title).toBe('orders');
    expect(entry.counts).toEqual({active: 3, deadLetter: 2, scheduled: 0, transfer: 0, total: 5});
  });

  it('collects queues, topics and subscriptions', async () => {
    const http = async (url: string) => {
      if (url.includes('$Resources/Queues')) return feed([{title: 'q1', active: 1, dead: 0}]);
      if (url.includes('$Resources/Topics')) return feed([{title: 't1', active: 0, dead: 0}]);
      if (url.includes('/t1/subscriptions')) return feed([{title: 's1', active: 4, dead: 1}]);
      throw new Error(url);
    };
    const rows = await fetchNamespaceRows(http, {name: 'prod', connection_string: CONN});
    expect(rows.map(r => [r.type, r.name, r.total])).toEqual([
      ['queue', 'q1', 1], ['topic', 't1', 0], ['subscription', 't1 / s1', 5],
    ]);
    expect(rows.every(r => r.namespace === 'prod')).toBeTrue();
  });
});
