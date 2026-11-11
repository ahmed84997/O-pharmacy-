import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { uuidv7, verifyLicence, type LicenceStatus, type Person } from '@o-pharmacy/core';
import type { App } from './compose';
import { AccessError } from './access';

export interface SystemOptions { dataDir?: string; backupDir?: string; keepBackups?: number; requireLicence?: boolean; licencePublicKey?: string | null; port?: number; host?: string }

/** The Hub's housekeeping: daily database backups (kept, rotated), the licence (activation and status) and what the About screen shows. */
export class SystemService {
  private timer: NodeJS.Timeout | null = null;
  constructor(private app: App, private o: SystemOptions = {}) {}
  get backupDir(): string | null { return this.o.backupDir ?? (this.o.dataDir ? join(this.o.dataDir, 'backups') : null); }
  /** A consistent copy of the whole database while it is in use (SQLite VACUUM INTO), named by date and time. */
  backup(reason: 'daily' | 'manual' | 'before-update', by = 'system'): { file: string; bytes: number } {
    const dir = this.backupDir; if (!dir) throw new AccessError('state', 'backups need a data folder'); mkdirSync(dir, { recursive: true });
    const stamp = this.app.hub.now().replace(/[-:]/g, '').replace('T', '-').slice(0, 15); const file = join(dir, `o-pharmacy-${stamp}-${reason}.db`);
    if (existsSync(file)) return { file, bytes: statSync(file).size };
    this.app.hub.db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`); this.app.access.setSetting('backup.last', this.app.hub.now(), by); this.app.hub.audit(by, 'system.backup', 'backup', file.split(/[\\/]/).pop()!, { reason });
    this.rotate(); return { file, bytes: statSync(file).size };
  }
  /** Daily copies beyond the newest N are removed (they are copies, the live database is never touched); manual and before-update copies are kept. */
  private rotate(): void { const dir = this.backupDir!; const keep = this.o.keepBackups ?? 14; const daily = readdirSync(dir).filter(f => /-daily\.db$/.test(f)).sort().reverse(); for (const f of daily.slice(keep)) { try { unlinkSync(join(dir, f)); } catch { /* in use: next time */ } } }
  backups(): { name: string; bytes: number; at: string }[] { const dir = this.backupDir; if (!dir || !existsSync(dir)) return []; return readdirSync(dir).filter(f => f.endsWith('.db')).map(f => { const s = statSync(join(dir, f)); return { name: f, bytes: s.size, at: s.mtime.toISOString() }; }).sort((a, b) => b.name.localeCompare(a.name)); }
  /** Checks every hour; makes the daily copy when the last one is older than 20 hours. */
  startSchedule(): void { const tick = () => { try { const last = this.app.access.setting('backup.last'); if (!last || Date.parse(this.app.hub.now()) - Date.parse(last) > 20 * 3600_000) this.backup('daily'); } catch (e) { console.error('backup failed', e); } }; setTimeout(tick, 60_000); this.timer = setInterval(tick, 3600_000); this.timer.unref(); }
  stop(): void { if (this.timer) clearInterval(this.timer); }

  // ---------- licence ----------
  /** The pharmacy's identity for licences, made once. */
  tenantId(): string { let t = this.app.access.setting('pharmacy.id'); if (!t) { t = uuidv7(); this.app.access.setSetting('pharmacy.id', t, 'system'); } return t; }
  licence(): LicenceStatus & { configured: boolean; required: boolean } {
    const required = !!this.o.requireLicence; const pub = this.o.licencePublicKey; const token = this.app.access.setting('licence.token');
    if (!pub) return { state: required ? 'invalid' : 'valid', configured: false, required };
    if (!token) return { state: required ? 'invalid' : 'valid', configured: true, required, reason: undefined };
    return { ...verifyLicence(token, pub, { tenantId: this.tenantId(), now: new Date(this.app.hub.now()) }), configured: true, required };
  }
  activate(actor: Person, token: string): LicenceStatus {
    if (!actor.roles.includes('O') && !actor.roles.includes('A')) throw new AccessError('forbidden', 'only the owner or the admin activates the licence');
    const pub = this.o.licencePublicKey; if (!pub) throw new AccessError('state', 'this build has no licence key'); const st = verifyLicence(String(token ?? '').trim(), pub, { tenantId: this.tenantId(), now: new Date(this.app.hub.now()) });
    if (st.state === 'invalid') throw new AccessError('invalid', `licence refused: ${st.reason ?? 'invalid'}`);
    this.app.access.setSetting('licence.token', String(token).trim(), actor.id); this.app.hub.audit(actor.id, 'licence.activated', 'licence', this.tenantId(), { edition: st.payload?.edition, expiresAt: st.payload?.expiresAt }); return st;
  }
  /** With a required licence, an expired one (past grace) or none makes the Hub read-only: data stays readable and exportable, nothing new is written. A pharmacy is never locked out of its data. */
  readOnly(): boolean { const l = this.licence(); return l.required && (l.state === 'read-only' || l.state === 'invalid'); }
  addresses(): string[] { if (this.o.host !== '0.0.0.0') return []; const out: string[] = []; for (const list of Object.values(networkInterfaces())) for (const n of list ?? []) if (n.family === 'IPv4' && !n.internal) out.push(`http://${n.address}:${this.o.port ?? 4870}`); return out; }
}

/** The licence public key: from O_LICENCE_PUBLIC_KEY, else licence-public.pem next to the Hub (written by the build from the signing secret). */
export function licenceKey(): string | null {
  if (process.env.O_LICENCE_PUBLIC_KEY) return process.env.O_LICENCE_PUBLIC_KEY;
  try { const here = dirname(fileURLToPath(import.meta.url)); const f = join(here, 'licence-public.pem'); return existsSync(f) ? readFileSync(f, 'utf8') : null; } catch { return null; }
}
