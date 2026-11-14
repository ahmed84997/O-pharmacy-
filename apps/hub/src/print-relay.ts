import { randomUUID } from 'node:crypto';
import type { PrintTransport } from '@o-pharmacy/print';

/**
 * Printing on the device that asked (D39). A cashier PC runs the desktop app, which keeps one long request open to the Hub
 * (`GET /api/agent/next`). A print for a "device" printer is handed to that request; the app prints on its own Windows printer
 * and answers with the result (`POST /api/agent/result`). The cashier PC needs no open port: it always calls the Hub.
 */
export interface RelayJob { id: string; kind: 'receipt' | 'label'; bytes: string }
export const RELAY_OFFLINE = 'الجهاز ده مش فاتح من برنامج O Pharmacy، فمش هيقدر يطبع على طابعته. افتحه من البرنامج أو اختار طابعة تانية.';
export const RELAY_TIMEOUT = 'الطابعة اللي على الجهاز مردّتش. اتأكد إنها شغالة وفيها ورق.';

export class PrintRelay {
  private queue = new Map<string, RelayJob[]>();
  private waiting = new Map<string, (j: RelayJob | null) => void>();
  private pending = new Map<string, { device: string; done: (error: string | null) => void }>();
  private seen = new Map<string, number>();
  constructor(private o: { resultMs?: number; onlineMs?: number } = {}) {}

  /** The device's app has asked for work recently (or is asking right now). */
  online(device: string): boolean { return this.waiting.has(device) || Date.now() - (this.seen.get(device) ?? 0) < (this.o.onlineMs ?? 45_000); }

  /** The device's app waits here for the next job (null when nothing came in `waitMs`). A newer wait from the same device replaces an older one. */
  next(device: string, waitMs: number): Promise<RelayJob | null> {
    this.seen.set(device, Date.now());
    const q = this.queue.get(device); if (q?.length) return Promise.resolve(q.shift()!);
    this.waiting.get(device)?.(null);
    return new Promise(resolve => {
      const done = (j: RelayJob | null) => { clearTimeout(t); if (this.waiting.get(device) === done) this.waiting.delete(device); this.seen.set(device, Date.now()); resolve(j); };
      const t = setTimeout(() => done(null), waitMs);
      this.waiting.set(device, done);
    });
  }

  /** Hand bytes to the device and wait for its answer. */
  send(device: string, kind: RelayJob['kind'], bytes: Buffer): Promise<void> {
    if (!this.online(device)) return Promise.reject(new Error(RELAY_OFFLINE));
    const job: RelayJob = { id: randomUUID(), kind, bytes: bytes.toString('base64') };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(job.id); const q = this.queue.get(device); if (q) this.queue.set(device, q.filter(x => x.id !== job.id)); reject(new Error(RELAY_TIMEOUT)); }, this.o.resultMs ?? 20_000);
      this.pending.set(job.id, { device, done: e => { clearTimeout(timer); this.pending.delete(job.id); if (e) reject(new Error(e)); else resolve(); } });
      const w = this.waiting.get(device); if (w) w(job); else this.queue.set(device, [...(this.queue.get(device) ?? []), job]);
    });
  }

  /** The device's answer for one job. Only the device the job went to can answer it. */
  result(device: string, id: string, ok: boolean, error?: string): boolean {
    const p = this.pending.get(id); if (!p || p.device !== device) return false;
    p.done(ok ? null : (String(error ?? '').trim().slice(0, 300) || 'الطباعة فشلت على الجهاز')); return true;
  }
}

/** A "device" printer seen from the print service: bytes go to the PC that asked for the print. */
export class RelayTransport implements PrintTransport {
  constructor(readonly name: string, private relay: PrintRelay, private device: string | undefined, private kind: RelayJob['kind']) {}
  send(b: Buffer): Promise<void> { return this.device ? this.relay.send(this.device, this.kind, b) : Promise.reject(new Error(RELAY_OFFLINE)); }
}
