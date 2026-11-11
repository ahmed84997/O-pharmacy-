import { describe, expect, it } from 'vitest';
import { CATALOGUE, DeviceRegistry, PERMISSION_KEYS, Person, UserDirectory, approvalAllowed, can, hashSecret, permissionsOf, roleTemplate, verifySecret } from './index';

const person = (roles: Person['roles'], extra: Partial<Person> = {}): Person => ({ id: 'p', roles, branchIds: ['b1'], ...extra });

describe('catalogue', () => {
  it('has unique keys, grouped rows expanded, and no delete permission anywhere', () => {
    expect(new Set(PERMISSION_KEYS).size).toBe(PERMISSION_KEYS.length);
    expect(PERMISSION_KEYS.filter(k => /\.(delete|remove|destroy)$/.test(k) && k !== 'sale.line.delete')).toEqual([]);
    for (const k of ['user.create', 'user.update', 'user.deactivate', 'deductions.manage', 'incentives.manage', 'advances.manage', 'sale.view_own', 'sale.view_all', 'compliance.eta.retry', 'device.approve']) expect(PERMISSION_KEYS, k).toContain(k);
    expect(PERMISSION_KEYS.length).toBeGreaterThan(130);
  });
  it('matrix rule 1-2: cost and finance hidden from Pharmacist, Cashier, Employee; salaries only Owner and Branch Admin', () => {
    for (const r of ['P', 'C', 'E'] as const) { const d = roleTemplate(r).default; for (const k of ['stock.cost.view', 'report.view_financial', 'ledger.view', 'salary.view']) expect(d, `${r} ${k}`).not.toContain(k); }
    expect(CATALOGUE.find(p => p.key === 'salary.view')!.defaultRoles.join('')).toBe('OA');
    expect(roleTemplate('X').default).not.toContain('salary.view');
  });
  it('delivery agent only gets his own work', () => {
    const d = roleTemplate('D').default; expect(d).toContain('home_delivery.deliver');
    for (const k of ['sale.create', 'stock.view', 'item.view', 'report.view']) expect(d).not.toContain(k);
  });
  it('every optional (off by default) grant is a real key and not also default for that role', () => {
    for (const p of CATALOGUE) for (const r of p.optionalRoles) expect(p.defaultRoles.includes(r), `${p.key} ${r}`).toBe(false);
  });
});

describe('can()', () => {
  it('union of roles (D23)', () => {
    const solo = person(['A', 'M', 'P', 'C']); expect(can(solo, 'sale.create')).toBe(true); expect(can(solo, 'role.assign')).toBe(true);
    expect(can(person(['C']), 'sale.create')).toBe(true); expect(can(person(['C']), 'sale.void')).toBe(false);
  });
  it('per-person grant and deny', () => {
    const p = person(['P'], { grants: ['stock.cost.view'], denies: ['sale.create'] });
    expect(can(p, 'stock.cost.view')).toBe(true); expect(can(p, 'sale.create')).toBe(false);
    expect(permissionsOf(person(['P'], { grants: ['not.a.key'] })).has('not.a.key')).toBe(false);
  });
  it('branch scope: own branch only, Owner everywhere', () => {
    const m = person(['M']); expect(can(m, 'sale.void', 'b1')).toBe(true); expect(can(m, 'sale.void', 'b2')).toBe(false);
    expect(can(person(['O'], { branchIds: [] }), 'sale.void', 'b9')).toBe(true);
    expect(can(person(['M'], { branchIds: 'all' }), 'sale.void', 'b9')).toBe(true);
  });
  it('unknown key throws (typos never silently deny or allow)', () => { expect(() => can(person(['O']), 'sale.vodi')).toThrow(); });
});

describe('separation of duties', () => {
  it('blocks self-approval, relaxes for a one-person pharmacy with a flag', () => {
    expect(approvalAllowed('u1', 'u1', { separationOfDuties: true, activeApprovers: 3 })).toEqual({ ok: false, flagged: false });
    expect(approvalAllowed('u1', 'u1', { separationOfDuties: true, activeApprovers: 1 })).toEqual({ ok: true, flagged: true });
    expect(approvalAllowed('u1', 'u2', { separationOfDuties: true, activeApprovers: 3 })).toEqual({ ok: true, flagged: false });
    expect(approvalAllowed('u1', 'u1', { separationOfDuties: false, activeApprovers: 3 }).ok).toBe(true);
  });
});

describe('identity', () => {
  it('scrypt hash verifies and never stores the secret', () => {
    const h = hashSecret('secret-1'); expect(h).not.toContain('secret-1'); expect(verifySecret('secret-1', h)).toBe(true); expect(verifySecret('secret-2', h)).toBe(false); expect(verifySecret('x', 'garbage')).toBe(false);
    expect(hashSecret('secret-1')).not.toBe(h);
  });
  it('login, lockout after repeated failures, unlock by time, deactivate keeps the record', () => {
    const d = new UserDirectory({ maxFailed: 3, lockoutMs: 60_000 }); const u = d.create('ahmed', 'pass-123'); const t0 = 1_000_000;
    expect(d.login('ahmed', 'pass-123', t0)).toMatchObject({ ok: true, userId: u.id });
    for (let i = 0; i < 3; i++) expect(d.login('ahmed', 'bad', t0)).toEqual({ ok: false, reason: 'bad-credentials' });
    expect(d.login('ahmed', 'pass-123', t0 + 1000)).toEqual({ ok: false, reason: 'locked' });
    expect(d.login('ahmed', 'pass-123', t0 + 61_000).ok).toBe(true);
    expect(d.login('nobody', 'x', t0)).toEqual({ ok: false, reason: 'bad-credentials' });
    d.deactivate(u.id, 'admin'); expect(d.login('ahmed', 'pass-123', t0 + 70_000)).toEqual({ ok: false, reason: 'inactive' }); expect(d.get(u.id)).toBeDefined();
  });
  it('rejects weak input and duplicate usernames', () => { const d = new UserDirectory(); expect(() => d.create('', 'abcdef')).toThrow(); expect(() => d.create('a', '123')).toThrow(); d.create('a', 'abcdef'); expect(() => d.create('a', 'abcdef')).toThrow(); });
});

describe('devices', () => {
  it('pending until approved; revoke is final; branch bound', () => {
    const r = new DeviceRegistry(); const d = r.register('Counter 1', 'pos', 'b1', 'admin');
    expect(r.isAllowed(d.id, 'b1')).toBe(false);
    r.approve(d.id, 'admin'); expect(r.isAllowed(d.id, 'b1')).toBe(true); expect(r.isAllowed(d.id, 'b2')).toBe(false);
    r.revoke(d.id, 'admin'); expect(r.isAllowed(d.id, 'b1')).toBe(false);
    expect(() => r.approve(d.id, 'admin')).toThrow(); expect(d.log.map(l => l.to)).toEqual(['pending', 'approved', 'revoked']);
    expect(r.list()).toHaveLength(1);
  });
});
