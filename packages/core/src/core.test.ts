import { describe, expect, it } from 'vitest';
import { AuditLog, CONFIG_SCHEMA, ConfigError, ConfigStore, configKeys, isUuid, newLifecycled, transition, uuidv7, validateConfig } from './index';

describe('ids', () => {
  it('uuidv7 is valid, unique and time-ordered', () => {
    const a = uuidv7(1_000_000), b = uuidv7(1_000_001), c = uuidv7(1_000_001);
    expect(isUuid(a)).toBe(true); expect(a < b).toBe(true); expect(b).not.toBe(c);
    expect(a[14]).toBe('7');
  });
});

describe('config engine', () => {
  const ctx = { tenant: 't1', branch: 'b1', device: 'd1' };
  it('schema is the single key source and every entry is well formed', () => {
    expect(configKeys()).toEqual(Object.keys(CONFIG_SCHEMA).sort());
    for (const [k, d] of Object.entries(CONFIG_SCHEMA)) { expect(d.scopes.length, k).toBeGreaterThan(0); expect(() => validateConfig(k, d.scopes[0]!, d.default), k).not.toThrow(); }
  });
  it('layers resolve device > branch > tenant > default', () => {
    const s = new ConfigStore();
    expect(s.get('stock.expiryWarningDays', ctx)).toBe(90);
    s.set('stock.expiryWarningDays', 'tenant', 't1', 120, 'u1'); expect(s.get('stock.expiryWarningDays', ctx)).toBe(120);
    s.set('stock.expiryWarningDays', 'branch', 'b1', 60, 'u1'); expect(s.get('stock.expiryWarningDays', ctx)).toBe(60);
    expect(s.get('stock.expiryWarningDays', { tenant: 't1', branch: 'b2' })).toBe(120);
    s.reset('stock.expiryWarningDays', 'branch', 'b1', 'u1'); expect(s.get('stock.expiryWarningDays', ctx)).toBe(120);
  });
  it('rejects unknown keys, wrong scope, wrong type, range and options', () => {
    const s = new ConfigStore(); const code = (f: () => void) => { try { f(); } catch (e) { return (e as ConfigError).code; } return 'none'; };
    expect(code(() => s.set('nope', 'tenant', 't1', 1, 'u'))).toBe('unknown-key');
    expect(code(() => s.set('pharmacy.currency', 'branch', 'b1', 'USD', 'u'))).toBe('bad-scope');
    expect(code(() => s.set('sale.allowNegativeStock', 'tenant', 't1', 'yes' as never, 'u'))).toBe('bad-type');
    expect(code(() => s.set('sale.cashierDiscountMaxPct', 'tenant', 't1', 101, 'u'))).toBe('out-of-range');
    expect(code(() => s.set('sale.cashierDiscountMaxPct', 'tenant', 't1', 2.5, 'u'))).toBe('bad-type');
    expect(code(() => s.set('device.printer.paperWidthMm', 'device', 'd1', '70', 'u'))).toBe('bad-option');
  });
  it('every change is reported with before and after', () => {
    const seen: unknown[] = []; const s = new ConfigStore(c => seen.push(c));
    s.set('sync.intervalSeconds', 'tenant', 't1', 60, 'u1'); s.set('sync.intervalSeconds', 'tenant', 't1', 90, 'u2'); s.reset('sync.intervalSeconds', 'tenant', 't1', 'u3');
    expect(seen).toMatchObject([{ before: undefined, after: 60 }, { before: 60, after: 90, by: 'u2' }, { before: 90, after: undefined }]);
  });
  it('snapshot contains all keys', () => { expect(Object.keys(new ConfigStore().snapshot(ctx)).sort()).toEqual(configKeys()); });
});

describe('audit log', () => {
  const mk = () => { const l = new AuditLog(); for (let i = 0; i < 5; i++) l.append({ actor: 'u1', action: 'sale.void', entity: 'invoice', entityId: `i${i}`, data: { n: i, z: 1, a: 2 } }); return l; };
  it('chains and verifies', () => { const l = mk(); expect(l.entries.map(e => e.seq)).toEqual([1, 2, 3, 4, 5]); expect(AuditLog.verify(l.entries)).toBeNull(); });
  it('detects edit, removal and reorder', () => {
    const e = mk().entries.map(x => ({ ...x }));
    const edited = e.map(x => ({ ...x })); edited[2]!.actor = 'evil'; expect(AuditLog.verify(edited)).toBe(3);
    const removed = e.filter((_, i) => i !== 1); expect(AuditLog.verify(removed)).toBe(3);
    const swapped = [...e]; [swapped[1], swapped[2]] = [swapped[2]!, swapped[1]!]; expect(AuditLog.verify(swapped)).not.toBeNull();
  });
  it('has no update or delete API', () => { const l = mk() as unknown as Record<string, unknown>; for (const m of ['update', 'delete', 'remove', 'clear']) expect(l[m]).toBeUndefined(); });
});

describe('no-delete lifecycle', () => {
  it('void and restore keep full history and need a reason', () => {
    let r: ReturnType<typeof newLifecycled> = newLifecycled();
    expect(() => transition(r, 'void', 'u1', '  ')).toThrow();
    r = transition(r, 'void', 'u1', 'wrong item'); r = transition(r, 'active', 'u2', 'mistake');
    expect(r.status).toBe('active'); expect(r.history.map(h => h.to)).toEqual(['void', 'active']);
    expect(() => transition(r, 'active', 'u1', 'x')).toThrow();
  });
});

import { StateMachine, StateMachineError } from './index';
describe('shared state machine', () => {
  const m = new StateMachine({ a: ['b', 'c'], b: ['a'], c: [] } as const);
  it('allows only declared transitions; terminal states have no way out; undeclared targets are refused at construction', () => {
    expect(m.can('a', 'b')).toBe(true); expect(m.can('a', 'a')).toBe(false); expect(m.can('c', 'a')).toBe(false); expect(m.isTerminal('c')).toBe(true); expect(m.isTerminal('a')).toBe(false); expect(m.states()).toEqual(['a', 'b', 'c']); expect(m.next('b')).toEqual(['a']);
    expect(() => m.assert('c', 'a')).toThrow(StateMachineError); expect(() => m.assert('a', 'b')).not.toThrow(); expect(() => new StateMachine({ a: ['z'] } as never)).toThrow(/not declared/);
  });
});
