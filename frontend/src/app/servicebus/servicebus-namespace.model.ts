export interface ServiceBusNamespace {
  /** Display name in the table. */
  name: string;
  subscription_id: string;
  resource_group: string;
  /** Service Bus namespace resource name (not the full host name). */
  namespace: string;
  /** ARM sub-paths: `queues/{q}`, `topics/{t}` or `topics/{t}/subscriptions/{s}`. */
  entities: string[];
}
