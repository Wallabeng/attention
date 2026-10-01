import {InjectionToken} from '@angular/core';
import {ActionProvider} from './item-action';

export const ACTION_PROVIDERS = new InjectionToken<ActionProvider[]>('ACTION_PROVIDERS');
