import {InboxComponent} from './inbox.component';
import {Item} from '../item.model';

type TestProvider = { source: string; getPropertyOrder?: () => string[]; needsLessAttention?: (item: Item) => boolean };

function createComponent(providers: TestProvider[] = []): InboxComponent {
  return new InboxComponent(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    providers as any,
  );
}

function makeItem(overrides: Partial<Item> = {}): Item {
  return {
    id: '1',
    title: 'x',
    notes: null,
    source: 'gerrit',
    state: 'open',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    due_date: null,
    properties: null,
    url: null,
    ...overrides,
  };
}

describe('InboxComponent property key ordering', () => {

  it('orders known keys by provider order and appends unknown keys in insertion order', () => {
    const component = createComponent([{source: 'github', getPropertyOrder: () => ['Type', 'Reason', 'Repo']}]);
    const item: Item = {
      id: '1',
      title: 'x',
      notes: null,
      source: 'github',
      state: 'open',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      due_date: null,
      properties: {
        Repo: 'org/repo',
        ExtraB: '2',
        Type: 'PullRequest',
        ExtraA: '1',
        Reason: 'review_requested',
      },
      url: null,
    };

    expect(component.propertyKeysForDisplay(item)).toEqual(['Type', 'Reason', 'Repo', 'ExtraB', 'ExtraA']);
  });

  it('falls back to insertion order when provider has no order', () => {
    const component = createComponent();
    const item: Item = {
      id: '2',
      title: 'y',
      notes: null,
      source: 'manual',
      state: 'open',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      due_date: null,
      properties: {B: '2', A: '1'},
      url: null,
    };

    expect(component.propertyKeysForDisplay(item)).toEqual(['B', 'A']);
  });
});

describe('InboxComponent isUpdated', () => {
  it('is false when updated_at equals created_at', () => {
    const component = createComponent();
    expect(component.isUpdated(makeItem())).toBe(false);
  });

  it('is true when updated_at differs from created_at', () => {
    const component = createComponent();
    const item = makeItem({updated_at: '2026-01-02T00:00:00.000Z'});
    expect(component.isUpdated(item)).toBe(true);
  });
});

describe('InboxComponent needsLessAttention', () => {
  it('delegates to the matching provider', () => {
    const component = createComponent([
      {source: 'gerrit', needsLessAttention: (item) => item.properties?.['Code-Review'] === '-1'},
    ]);
    const flagged = makeItem({properties: {'Code-Review': '-1'}});
    const clear = makeItem({id: '2', properties: {'Code-Review': '+2'}});

    expect(component.needsLessAttention(flagged)).toBe(true);
    expect(component.needsLessAttention(clear)).toBe(false);
  });

  it('defaults to false when no provider matches or the provider has no hook', () => {
    const component = createComponent([{source: 'gerrit'}]);
    expect(component.needsLessAttention(makeItem({source: 'unknown'}))).toBe(false);
    expect(component.needsLessAttention(makeItem())).toBe(false);
  });

  it('sorts less-attention items last, keeping the chosen sort as a tiebreak', () => {
    const component = createComponent([
      {source: 'gerrit', needsLessAttention: (item) => item.properties?.['Code-Review'] === '-1'},
    ]);
    component.sort.set('created_desc');
    const older = makeItem({id: 'older', created_at: '2026-01-01T00:00:00.000Z'});
    const flaggedNewer = makeItem({id: 'flagged', created_at: '2026-01-02T00:00:00.000Z', properties: {'Code-Review': '-1'}});
    const newer = makeItem({id: 'newer', created_at: '2026-01-03T00:00:00.000Z'});

    const sorted = (component as any).sortItems([older, flaggedNewer, newer]);

    expect(sorted.map((i: Item) => i.id)).toEqual(['newer', 'older', 'flagged']);
  });
});
