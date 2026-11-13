import { can, type Person } from '@o-pharmacy/core';
import { FINAL_STATES } from '@o-pharmacy/ops';
import type { App } from './compose';

/** "General shortage" on the item card (D38): when a sale empties such an item, it goes into the shortage notebook by itself,
 *  once (not while an open shortage line for it exists). Best effort: a failure here never touches the sale. */
export function autoShortage(app: App, actor: Person, itemIds: string[]): string[] {
  if (!can(actor, 'shortage.record', app.hub.branchId)) return [];
  const db = app.hub.db; const added: string[] = []; const open = FINAL_STATES.map(() => '?').join(',');
  for (const id of [...new Set(itemIds)]) {
    try {
      const item = app.items.get(id); if (!item?.card.autoShortage || item.kind === 'service') continue;
      const left = Number(db.prepare('SELECT COALESCE(SUM(m.qty),0) q FROM movements m JOIN batches b ON b.id=m.batch_id WHERE b.item_id=?').get(id)!.q); if (left > 0) continue;
      if (db.prepare(`SELECT 1 FROM request_items ri JOIN requests r ON r.id=ri.request_id WHERE r.kind='shortage' AND ri.item_id=? AND ri.status NOT IN (${open}) LIMIT 1`).get(id, ...FINAL_STATES)) continue;
      app.requests.createShortage(actor, { key: `auto-shortage:${id}:${app.hub.now()}`, notes: 'اتضاف لوحده: الرصيد خلص (نواقص عامة)', items: [{ itemId: id, itemName: item.nameAr, qty: 1 }] }); added.push(id);
    } catch { /* never block a sale */ }
  }
  return added;
}
