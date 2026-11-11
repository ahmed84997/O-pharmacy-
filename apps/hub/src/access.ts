import { createHash, randomBytes } from 'node:crypto';
import { can, hashSecret, permissionsOf, uuidv7, verifySecret, validateGrant, type Person, type RoleCode } from '@o-pharmacy/core';
import type { Hub } from '@o-pharmacy/hub';

export type AccessErrorCode = 'forbidden' | 'invalid' | 'not-found' | 'state' | 'duplicate' | 'bad-credentials' | 'locked' | 'inactive' | 'device-pending' | 'device-revoked' | 'device-unknown' | 'unauthenticated';
export class AccessError extends Error { constructor(public code: AccessErrorCode, m: string) { super(m); } }
export interface AccessRules { maxFailed: number; lockoutMinutes: number; sessionHours: number; minSecretLength: number }
export const DEFAULT_ACCESS_RULES: AccessRules = { maxFailed: 5, lockoutMinutes: 15, sessionHours: 12, minSecretLength: 6 };
const ROLES: RoleCode[] = ['O', 'A', 'M', 'P', 'C', 'S', 'E', 'X', 'D'];
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const keyOf = (u: string) => u.trim().toLowerCase();
const USER = /^[a-z0-9._-]{3,32}$/;

export interface PersonView { id: string; username: string; displayName: string; roles: RoleCode[]; grants: string[]; denies: string[]; allBranches: boolean; active: boolean; locked: boolean; mustChangeSecret: boolean; createdAt: string }
export interface DeviceView { id: string; name: string; kind: string; status: 'pending' | 'approved' | 'revoked'; createdAt: string; lastSeenAt: string | null }

/** People (logins and roles), devices and sessions, persisted in the Hub. Passwords are scrypt hashes (core); session tokens and device secrets are stored as SHA-256 only. */
export class AccessService {
  constructor(private hub: Hub, private rules: AccessRules = DEFAULT_ACCESS_RULES) {}
  private get db() { return this.hub.db; }
  private need(a: Person, perm: string): void { if (!can(a, perm, this.hub.branchId)) throw new AccessError('forbidden', `missing permission ${perm}`); }
  private event(personId: string, action: string, data: unknown, by: string): void { this.db.prepare('INSERT INTO people_events(id,person_id,action,data,by,at) VALUES(?,?,?,?,?,?)').run(uuidv7(), personId, action, JSON.stringify(data), by, this.hub.now()); }
  private row(id: string) { const r = this.db.prepare('SELECT * FROM people WHERE id=?').get(id); if (!r) throw new AccessError('not-found', 'person'); return r; }
  private view = (r: Record<string, unknown>): PersonView => ({ id: String(r.id), username: String(r.username), displayName: String(r.display_name), roles: JSON.parse(String(r.roles_json)), grants: JSON.parse(String(r.grants_json)), denies: JSON.parse(String(r.denies_json)), allBranches: r.all_branches === 1, active: r.active === 1, locked: !!r.locked_until && String(r.locked_until) > this.hub.now(), mustChangeSecret: r.must_change_secret === 1, createdAt: String(r.created_at) });
  /** The Person the permission engine works with. */
  personOf(id: string): Person { const v = this.view(this.row(id)); return { id: v.id, roles: v.roles, grants: v.grants, denies: v.denies, branchIds: v.allBranches ? 'all' : [this.hub.branchId] }; }
  permissions(id: string): string[] { return [...permissionsOf(this.personOf(id))].sort(); }
  setting(k: string): string | null { const r = this.db.prepare('SELECT v FROM app_settings WHERE k=?').get(k); return r ? String(r.v) : null; }
  setSetting(k: string, v: string, by: string): void { this.db.prepare('INSERT INTO app_settings(k,v,updated_by,updated_at) VALUES(?,?,?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_by=excluded.updated_by, updated_at=excluded.updated_at').run(k, v, by, this.hub.now()); }
  isSetUp(): boolean { return !!this.db.prepare('SELECT 1 FROM people LIMIT 1').get(); }

  private checkSecret(s: string): void { if (typeof s !== 'string' || s.length < this.rules.minSecretLength) throw new AccessError('invalid', `the password needs at least ${this.rules.minSecretLength} characters`); }
  private checkRoles(roles: unknown): RoleCode[] { if (!Array.isArray(roles) || roles.length === 0 || roles.some(r => !ROLES.includes(r as RoleCode))) throw new AccessError('invalid', 'choose at least one valid role'); return [...new Set(roles as RoleCode[])]; }
  private checkKeys(keys: unknown): string[] { if (keys === undefined) return []; if (!Array.isArray(keys) || keys.some(k => typeof k !== 'string' || !validateGrant(k))) throw new AccessError('invalid', 'unknown permission key'); return [...new Set(keys as string[])]; }
  private insertPerson(by: string, p: { username: string; displayName: string; secret: string; roles: RoleCode[]; grants?: string[]; denies?: string[]; allBranches?: boolean; mustChange?: boolean }): PersonView {
    const username = keyOf(p.username); if (!USER.test(username)) throw new AccessError('invalid', 'username: 3-32 latin letters, digits, dot, dash or underscore'); if (!p.displayName?.trim()) throw new AccessError('invalid', 'the name is required'); this.checkSecret(p.secret);
    if (this.db.prepare('SELECT 1 FROM people WHERE username_key=?').get(username)) throw new AccessError('duplicate', 'username taken');
    const id = uuidv7(); this.db.prepare('INSERT INTO people(id,username,username_key,display_name,secret_hash,roles_json,grants_json,denies_json,all_branches,must_change_secret,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, username, username, p.displayName.trim(), hashSecret(p.secret), JSON.stringify(p.roles), JSON.stringify(p.grants ?? []), JSON.stringify(p.denies ?? []), p.allBranches ? 1 : 0, p.mustChange ? 1 : 0, by, this.hub.now());
    this.event(id, 'created', { roles: p.roles, grants: p.grants ?? [], denies: p.denies ?? [] }, by); this.hub.audit(by, 'person.created', 'person', id, { username, roles: p.roles }); return this.view(this.row(id));
  }

  // ---------- first run ----------
  /** First run only: creates the owner (all branches), names the pharmacy and approves the device used for setup. */
  setup(deviceId: string, i: { pharmacyName: string; displayName: string; username: string; secret: string }): PersonView {
    if (!i.pharmacyName?.trim()) throw new AccessError('invalid', 'the pharmacy name is required');
    return this.db.tx(() => { if (this.isSetUp()) throw new AccessError('state', 'already set up'); const d = this.deviceRow(deviceId);
      const p = this.insertPerson('setup', { username: i.username, displayName: i.displayName, secret: i.secret, roles: ['O'], allBranches: true });
      this.setSetting('pharmacy.name', i.pharmacyName.trim(), p.id); if (d.status === 'pending') this.moveDevice(deviceId, 'approved', 'first device, used for setup', p.id); return p; });
  }

  // ---------- people ----------
  list(a: Person): PersonView[] { this.need(a, 'user.view'); return this.db.prepare('SELECT * FROM people ORDER BY active DESC, display_name').all().map(this.view); }
  create(a: Person, i: { username: string; displayName: string; secret: string; roles: RoleCode[]; grants?: string[]; denies?: string[] }): PersonView {
    this.need(a, 'user.create'); const roles = this.checkRoles(i.roles); this.guardRoles(a, roles); const grants = this.checkKeys(i.grants), denies = this.checkKeys(i.denies); if (grants.length || denies.length) this.need(a, 'role.assign');
    return this.db.tx(() => this.insertPerson(a.id, { ...i, roles, grants, denies, allBranches: roles.includes('O'), mustChange: true }));
  }
  /** Roles need role.assign; only an owner gives or takes the owner role. */
  private guardRoles(a: Person, roles: RoleCode[], before: RoleCode[] = []): void {
    const changed = roles.length !== before.length || roles.some(r => !before.includes(r)); if (!changed) return; this.need(a, 'role.assign');
    if ((roles.includes('O') || before.includes('O')) && !a.roles.includes('O')) throw new AccessError('forbidden', 'only an owner gives or removes the owner role');
  }
  update(a: Person, id: string, p: { displayName?: string; roles?: RoleCode[]; grants?: string[]; denies?: string[] }): PersonView {
    this.need(a, 'user.update'); return this.db.tx(() => { const cur = this.view(this.row(id)); const roles = p.roles ? this.checkRoles(p.roles) : cur.roles; this.guardRoles(a, roles, cur.roles);
      const grants = p.grants ? this.checkKeys(p.grants) : cur.grants, denies = p.denies ? this.checkKeys(p.denies) : cur.denies; if (JSON.stringify(grants) !== JSON.stringify(cur.grants) || JSON.stringify(denies) !== JSON.stringify(cur.denies)) this.need(a, 'role.assign');
      if (cur.roles.includes('O') && !roles.includes('O')) this.keepAnOwner(id); if (p.displayName !== undefined && !p.displayName.trim()) throw new AccessError('invalid', 'the name is required');
      this.db.prepare('UPDATE people SET display_name=?, roles_json=?, grants_json=?, denies_json=?, all_branches=? WHERE id=?').run(p.displayName?.trim() ?? cur.displayName, JSON.stringify(roles), JSON.stringify(grants), JSON.stringify(denies), roles.includes('O') ? 1 : 0, id);
      this.event(id, 'updated', { roles, grants, denies }, a.id); this.hub.audit(a.id, 'person.updated', 'person', id, { roles, grants, denies }); return this.view(this.row(id)); });
  }
  private keepAnOwner(exceptId: string): void { const n = this.db.prepare("SELECT COUNT(*) n FROM people WHERE active=1 AND id<>? AND roles_json LIKE '%\"O\"%'").get(exceptId)!.n; if (Number(n) === 0) throw new AccessError('state', 'the pharmacy must keep at least one active owner'); }
  resetSecret(a: Person, id: string, secret: string): void { this.need(a, 'user.update'); this.checkSecret(secret); this.db.tx(() => { const cur = this.view(this.row(id)); if (cur.roles.includes('O') && !a.roles.includes('O')) throw new AccessError('forbidden', 'only an owner resets an owner password'); this.db.prepare('UPDATE people SET secret_hash=?, must_change_secret=1, failed_attempts=0, locked_until=NULL WHERE id=?').run(hashSecret(secret), id); this.endSessions(id, 'password reset'); this.event(id, 'secret_reset', null, a.id); this.hub.audit(a.id, 'person.secret_reset', 'person', id, {}); }); }
  changeOwnSecret(id: string, current: string, next: string): void { this.checkSecret(next); this.db.tx(() => { const r = this.row(id); if (!verifySecret(current, String(r.secret_hash))) throw new AccessError('bad-credentials', 'the current password is wrong'); if (current === next) throw new AccessError('invalid', 'choose a different password'); this.db.prepare('UPDATE people SET secret_hash=?, must_change_secret=0 WHERE id=?').run(hashSecret(next), id); this.event(id, 'secret_changed', null, id); this.hub.audit(id, 'person.secret_changed', 'person', id, {}); }); }
  setActive(a: Person, id: string, active: boolean, reason: string): PersonView {
    this.need(a, 'user.deactivate'); if (!reason?.trim()) throw new AccessError('invalid', 'a reason is required'); if (id === a.id && !active) throw new AccessError('state', 'you cannot deactivate yourself');
    return this.db.tx(() => { const cur = this.view(this.row(id)); if (cur.active === active) throw new AccessError('state', active ? 'already active' : 'already inactive'); if (cur.roles.includes('O') && !a.roles.includes('O')) throw new AccessError('forbidden', 'only an owner changes an owner'); if (!active && cur.roles.includes('O')) this.keepAnOwner(id);
      this.db.prepare('UPDATE people SET active=? WHERE id=?').run(active ? 1 : 0, id); if (!active) this.endSessions(id, 'deactivated'); this.event(id, active ? 'activated' : 'deactivated', { reason }, a.id); this.hub.audit(a.id, active ? 'person.activated' : 'person.deactivated', 'person', id, { reason }); return this.view(this.row(id)); });
  }
  history(a: Person, id: string) { this.need(a, 'user.view'); return this.db.prepare('SELECT * FROM people_events WHERE person_id=? ORDER BY seq').all(id).map(r => ({ action: String(r.action), data: r.data ? JSON.parse(String(r.data)) : null, by: String(r.by), at: String(r.at) })); }

  // ---------- devices ----------
  private deviceRow(id: string) { const r = this.db.prepare('SELECT * FROM devices WHERE id=?').get(id); if (!r) throw new AccessError('device-unknown', 'unknown device'); return r; }
  private dview = (r: Record<string, unknown>): DeviceView => ({ id: String(r.id), name: String(r.name), kind: String(r.kind), status: r.status as DeviceView['status'], createdAt: String(r.created_at), lastSeenAt: (r.last_seen_at as string) ?? null });
  private moveDevice(id: string, to: 'approved' | 'revoked', reason: string | null, by: string): void { this.db.prepare('UPDATE devices SET status=? WHERE id=?').run(to, id); this.db.prepare('INSERT INTO device_events(id,device_id,to_status,reason,by,at) VALUES(?,?,?,?,?,?)').run(uuidv7(), id, to, reason, by, this.hub.now()); this.hub.audit(by, `device.${to}`, 'device', id, { reason }); }
  /** A new device registers itself and waits for approval. The secret is shown once and kept by the device. */
  registerDevice(i: { name: string; kind: string; userAgent?: string }): { id: string; secret: string; status: string } {
    if (!i.name?.trim()) throw new AccessError('invalid', 'the device name is required'); if (!['desktop', 'browser', 'pos', 'phone', 'tablet'].includes(i.kind)) throw new AccessError('invalid', 'bad device kind');
    const id = uuidv7(), secret = randomBytes(32).toString('base64url'); this.db.tx(() => { this.db.prepare('INSERT INTO devices(id,secret_hash,name,kind,user_agent,created_at) VALUES(?,?,?,?,?,?)').run(id, sha(secret), i.name.trim().slice(0, 60), i.kind, (i.userAgent ?? '').slice(0, 200), this.hub.now()); this.db.prepare('INSERT INTO device_events(id,device_id,to_status,reason,by,at) VALUES(?,?,?,?,?,?)').run(uuidv7(), id, 'pending', null, 'device', this.hub.now()); });
    return { id, secret, status: 'pending' };
  }
  /** The gate: who is this device? Unknown or wrong secret is refused. */
  device(id: string, secret: string): DeviceView { const r = this.db.prepare('SELECT * FROM devices WHERE id=?').get(id); if (!r || r.secret_hash !== sha(secret)) throw new AccessError('device-unknown', 'unknown device'); this.db.prepare('UPDATE devices SET last_seen_at=? WHERE id=?').run(this.hub.now(), id); return this.dview(r); }
  devices(a: Person): DeviceView[] { this.need(a, 'device.approve'); return this.db.prepare("SELECT * FROM devices ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, created_at DESC").all().map(this.dview); }
  approveDevice(a: Person, id: string): void { this.need(a, 'device.approve'); this.db.tx(() => { const d = this.deviceRow(id); if (d.status !== 'pending') throw new AccessError('state', `device is ${String(d.status)}`); this.moveDevice(id, 'approved', null, a.id); }); }
  revokeDevice(a: Person, id: string, reason: string): void { this.need(a, 'device.revoke'); if (!reason?.trim()) throw new AccessError('invalid', 'a reason is required'); this.db.tx(() => { const d = this.deviceRow(id); if (d.status === 'revoked') throw new AccessError('state', 'already revoked'); this.moveDevice(id, 'revoked', reason, a.id); this.db.prepare("UPDATE sessions SET ended_at=?, end_reason='device revoked' WHERE device_id=? AND ended_at IS NULL").run(this.hub.now(), id); }); }

  // ---------- sessions ----------
  login(deviceId: string, username: string, secret: string): { token: string; personId: string; mustChangeSecret: boolean } {
    const d = this.deviceRow(deviceId); if (d.status === 'pending') throw new AccessError('device-pending', 'this device waits for approval'); if (d.status === 'revoked') throw new AccessError('device-revoked', 'this device was revoked');
    const now = this.hub.now(); const r = this.db.prepare('SELECT * FROM people WHERE username_key=?').get(keyOf(String(username ?? '')));
    if (!r) { hashSecret(String(secret ?? 'x')); throw new AccessError('bad-credentials', 'wrong username or password'); }
    if (r.active !== 1) throw new AccessError('inactive', 'this account is deactivated'); if (r.locked_until && String(r.locked_until) > now) throw new AccessError('locked', 'too many wrong attempts: try again later');
    if (!verifySecret(String(secret ?? ''), String(r.secret_hash))) { const n = Number(r.failed_attempts) + 1; const lock = n >= this.rules.maxFailed ? new Date(Date.parse(now) + this.rules.lockoutMinutes * 60000).toISOString() : null; this.db.prepare('UPDATE people SET failed_attempts=?, locked_until=? WHERE id=?').run(lock ? 0 : n, lock, r.id); if (lock) this.event(String(r.id), 'locked', null, 'system'); throw new AccessError(lock ? 'locked' : 'bad-credentials', lock ? 'too many wrong attempts: try again later' : 'wrong username or password'); }
    const token = randomBytes(32).toString('base64url'); this.db.tx(() => { this.db.prepare('UPDATE people SET failed_attempts=0, locked_until=NULL WHERE id=?').run(r.id); this.db.prepare('INSERT INTO sessions(id,token_hash,person_id,device_id,created_at,expires_at) VALUES(?,?,?,?,?,?)').run(uuidv7(), sha(token), r.id, deviceId, now, new Date(Date.parse(now) + this.rules.sessionHours * 3600000).toISOString()); this.hub.audit(String(r.id), 'session.started', 'device', deviceId, {}); });
    return { token, personId: String(r.id), mustChangeSecret: r.must_change_secret === 1 };
  }
  /** Every request: a live session, on the same approved device, for an active person. */
  session(token: string, deviceId: string): Person {
    const s = this.db.prepare('SELECT * FROM sessions WHERE token_hash=?').get(sha(token)); if (!s || s.ended_at || String(s.expires_at) <= this.hub.now() || s.device_id !== deviceId) throw new AccessError('unauthenticated', 'please log in');
    const d = this.deviceRow(deviceId); if (d.status !== 'approved') throw new AccessError('unauthenticated', 'please log in'); const p = this.row(String(s.person_id)); if (p.active !== 1) throw new AccessError('unauthenticated', 'please log in'); return this.personOf(String(p.id));
  }
  logout(token: string): void { this.db.prepare("UPDATE sessions SET ended_at=?, end_reason='logout' WHERE token_hash=? AND ended_at IS NULL").run(this.hub.now(), sha(token)); }
  private endSessions(personId: string, why: string): void { this.db.prepare('UPDATE sessions SET ended_at=?, end_reason=? WHERE person_id=? AND ended_at IS NULL').run(this.hub.now(), why, personId); }
  view1(id: string): PersonView { return this.view(this.row(id)); }
}
