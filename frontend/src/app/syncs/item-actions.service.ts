import {Inject, Injectable} from '@angular/core';
import {Item} from '../item.model';
import {ACTION_PROVIDERS} from './action-providers.token';
import {ActionProvider, ItemAction} from './item-action';

export type {ItemAction};

@Injectable({providedIn: 'root'})
export class ItemActionsService {
  constructor(@Inject(ACTION_PROVIDERS) private providers: ActionProvider[]) {
  }

  /** Source-specific actions available for the given item. */
  getActions(item: Item): ItemAction[] {
    return this.providers
      .filter(p => p.source === item.source)
      .flatMap(p => p.getActions(item));
  }
}
