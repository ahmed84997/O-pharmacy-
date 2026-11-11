import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { uuidv7 } from './ids';

/** Secret hashing (password or cashier PIN) with scrypt; format: scrypt$N$salt$hash. */
export function hashSecret(secret: string, salt: Buffer = randomBytes(16)): string {
  const N = 16384; const h = scryptSync(secret, salt, 32, { N });
  return `scrypt$${N}$${salt.toString('hex')}$${h.toString('hex')}`;
}
export function verifySecret(secret: string, stored: string): boolean {
  const [alg, n, salt, hash] = stored.split('$'); if (alg !== 'scrypt' || !n || !salt || !hash) return false;
  const h = scryptSync(secret, Buffer.from(salt, 'hex'), 32, { N: +n }); const want = Buffer.from(hash, 'hex');
  return h.length === want.length && timingSafeEqual(h, want);
}

export interface User { id: string; username: string; secretHash: string; active: boolean; failedAttempts: number; lockedUntil: number | null; deactivatedBy?: string }
export type LoginResult = { ok: true } | { ok: false; reason: 'bad-credentials' | 'locked' | 'inactive' };

export class UserDirectory {
  private users = new Map<string, User>();
  constructor(private opts: { maxFailed: number; lockoutMs: number } = { maxFailed: 5, lockoutMs: 15 * 60_000 }) {}
  create(username: string, secret: string): User {
    if (!username.trim() || secret.length < 6) throw new Error('username and a secret of 6+ characters are required');
    if ([...this.users.values()].some(u => u.username === username)) throw new Error('username taken');
    const u: User = { id: uuidv7(), username, secretHash: hashSecret(secret), active: true, failedAttempts: 0, lockedUntil: null };
    this.users.set(u.id, u); return u;
  }
  /** No-Delete: users are deactivated, never removed; history stays attributed. */
  deactivate(id: string, by: string): void { const u = this.users.get(id); if (u) { u.active = false; u.deactivatedBy = by; } }
  get(id: string): User | undefined { return this.users.get(id); }
  login(username: string, secret: string, now: number = Date.now()): LoginResult & { userId?: string } {
    const u = [...this.users.values()].find(x => x.username === username);
    if (!u) { hashSecret(secret); return { ok: false, reason: 'bad-credentials' }; } // keep timing similar
    if (!u.active) return { ok: false, reason: 'inactive' };
    if (u.lockedUntil && now < u.lockedUntil) return { ok: false, reason: 'locked' };
    if (verifySecret(secret, u.secretHash)) { u.failedAttempts = 0; u.lockedUntil = null; return { ok: true, userId: u.id }; }
    u.failedAttempts += 1;
    if (u.failedAttempts >= this.opts.maxFailed) { u.lockedUntil = now + this.opts.lockoutMs; u.failedAttempts = 0; }
    return { ok: false, reason: 'bad-credentials' };
  }
}
