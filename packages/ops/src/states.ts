import { StateMachine } from '@o-pharmacy/core';

/** The lifecycle of a request item (taken from the proven YK machine): the original 9 states, `stocked` (shortages: the stock arrived, nobody to inform), `out_for_delivery` (home delivery) and `unavailable` / `closed_unavailable` (the supplier cannot provide it). There is no `ordered -> pending_purchase` edge. */
export const ITEM_STATES = ['pending_purchase', 'ordered', 'unavailable', 'awaiting_verification', 'ready_to_notify', 'reserved', 'notified', 'out_for_delivery', 'delivered', 'cancelled', 'not_collected', 'closed_unavailable', 'stocked'] as const;
export type ItemState = (typeof ITEM_STATES)[number];
export const ITEM_MACHINE = new StateMachine<ItemState>({
  pending_purchase: ['ordered', 'unavailable', 'cancelled'],
  ordered: ['awaiting_verification', 'unavailable', 'cancelled'],
  unavailable: ['pending_purchase', 'closed_unavailable', 'cancelled'],
  awaiting_verification: ['ordered', 'ready_to_notify', 'stocked', 'pending_purchase', 'cancelled'],
  ready_to_notify: ['awaiting_verification', 'reserved', 'notified', 'cancelled'],
  reserved: ['ready_to_notify', 'notified', 'cancelled'],
  notified: ['delivered', 'out_for_delivery', 'not_collected', 'reserved', 'cancelled'],
  out_for_delivery: ['delivered', 'not_collected', 'notified', 'cancelled'],
  delivered: ['notified'], cancelled: [], not_collected: ['notified'], stocked: [], closed_unavailable: ['unavailable'],
});
/** Final for the business: nothing more will happen, even though a reviewed correction edge may lead out of some of them. */
export const FINAL_STATES: readonly ItemState[] = ['delivered', 'cancelled', 'not_collected', 'stocked', 'closed_unavailable'];
export const isFinal = (s: ItemState): boolean => FINAL_STATES.includes(s);
/** Edges that undo something or reopen a final state: a reason is always required. */
export const isBackward = (from: ItemState, to: ItemState): boolean => (['delivered', 'not_collected', 'closed_unavailable'] as ItemState[]).includes(from) || (from === 'awaiting_verification' && (to === 'ordered' || to === 'pending_purchase')) || (from === 'ready_to_notify' && to === 'awaiting_verification') || (from === 'reserved' && to === 'ready_to_notify') || (from === 'out_for_delivery' && to === 'notified') || (from === 'unavailable' && to === 'pending_purchase') || (from === 'notified' && to === 'reserved');

export type DerivedStatus = 'open' | 'partially_fulfilled' | 'completed' | 'closed' | 'mixed_closed';
/** The header status of a request is never stored: it is worked out from its items. */
export function deriveStatus(states: ItemState[]): DerivedStatus {
  const live = states.filter(s => s !== 'cancelled'); const done = live.filter(s => s === 'delivered' || s === 'stocked').length; const dead = live.filter(s => s === 'not_collected' || s === 'closed_unavailable').length; const active = live.filter(s => !isFinal(s)).length;
  if (!states.length) return 'open'; if (active > 0) return done > 0 ? 'partially_fulfilled' : 'open'; if (!live.length) return 'closed'; if (done > 0 && dead > 0) return 'mixed_closed'; return done > 0 ? 'completed' : 'closed';
}
