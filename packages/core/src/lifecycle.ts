/** No-Delete: records are cancelled / voided / archived with who, when and why; never destroyed. Restore keeps the history. */
export type Lifecycle = 'active' | 'void' | 'archived';
export interface LifecycleEvent { to: Lifecycle; by: string; at: string; reason: string }
export interface Lifecycled { status: Lifecycle; history: LifecycleEvent[] }

export class LifecycleError extends Error { constructor(public code: 'reason-required' | 'already' | 'forbidden', m: string) { super(m); } }

export function transition<T extends Lifecycled>(rec: T, to: Lifecycle, by: string, reason: string, at: Date = new Date()): T {
  if (!reason.trim()) throw new LifecycleError('reason-required', 'a reason is required');
  if (rec.status === to) throw new LifecycleError('already', `already ${to}`);
  return { ...rec, status: to, history: [...rec.history, { to, by, at: at.toISOString(), reason: reason.trim() }] };
}
export const newLifecycled = (): Lifecycled => ({ status: 'active', history: [] });
