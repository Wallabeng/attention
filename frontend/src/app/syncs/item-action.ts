import {Item} from '../item.model';

export interface ItemAction {
  /** Stable id, unique within a source. */
  id: string;
  /** Menu label, e.g. "Mark as done". */
  label: string;
  /** Material icon name, e.g. "done_all". */
  icon: string;
  /** When true, the UI confirms before running. */
  destructive?: boolean;

  /** Perform the action against the source. Throws on failure. */
  run(item: Item): Promise<void>;
}

export abstract class ActionProvider {
  abstract readonly source: string;

  /** Actions available for the given item (may depend on item.properties). */
  abstract getActions(item: Item): ItemAction[];
}
