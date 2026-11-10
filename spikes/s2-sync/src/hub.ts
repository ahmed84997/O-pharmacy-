import { randomUUID } from 'node:crypto';
import { open, DB, RANK } from './db.js';
import type { Cloud } from './cloud.js';
import type { Net } from './net.js';

export type Result = { ok: boolean; reason?: string };

export class Hub {
  db: DB;
  constructor(public branch: string, path = ':memory:') { this.db = open(path); }

  // Run fn once per idempotency key; a repeat returns the stored result (device retries, duplicate delivery).
  private once<T>(key: string, fn: () => T): T {
    return this.db.transaction(() => {
      const r = this.db.prepare('SELECT result FROM idem WHERE key=?').get(key) as { result: string } | undefined;
      if (r) return JSON.parse(r.result) as T;
      const res = fn();
      this.db.prepare('INSERT INTO idem(key,result) VALUES(?,?)').run(key, JSON.stringify(res));
      return res;
    })();
  }
  private move(kind: string, item: string, qty: number, store: string, ref: string) {
    this.db.prepare('INSERT INTO movements(id,branch,store,item,qty,kind,ref,origin) VALUES(?,?,?,?,?,?,?,?)')
      .run(randomUUID(), this.branch, store, item, qty, kind, ref, this.branch);
  }
  private event(kind: string, tid: string, from: string, to: string, item: string, qty: number) {
    this.db.prepare('INSERT INTO events(id,kind,transfer,from_branch,to_branch,item,qty,origin) VALUES(?,?,?,?,?,?,?,?)')
      .run(randomUUID(), kind, tid, from, to, item, qty, this.branch);
  }

  balance(item: string): number {
    return (this.db.prepare("SELECT COALESCE(SUM(qty),0) q FROM movements WHERE branch=? AND store='MAIN' AND item=?").get(this.branch, item) as { q: number }).q;
  }
  movementCount(): number {
    return (this.db.prepare('SELECT COUNT(*) c FROM movements').get() as { c: number }).c;
  }
  status(tid: string): string | null {
    const rows = this.db.prepare('SELECT kind FROM events WHERE transfer=?').all(tid) as { kind: string }[];
    return rows.length ? rows.map(r => r.kind).sort((a, b) => RANK[b] - RANK[a])[0] : null;
  }

  // ---- local operations (the Hub is the single writer for its branch) ----
  purchase(key: string, item: string, qty: number): Result {
    return this.once(key, () => { this.move('purchase', item, qty, 'MAIN', key); return { ok: true }; });
  }
  sell(key: string, item: string, qty: number, crashAfterWrite = false): Result {
    return this.once(key, () => {
      if (this.balance(item) < qty) return { ok: false, reason: 'insufficient' };
      this.move('sale', item, -qty, 'MAIN', key);
      if (crashAfterWrite) throw new Error('simulated crash');
      return { ok: true };
    });
  }
  // ---- transfer workflow (requested -> accepted -> dispatched -> received); branches talk only through the cloud ----
  requestTransfer(tid: string, fromBranch: string, item: string, qty: number): Result {
    return this.once('req:' + tid, () => { this.event('requested', tid, fromBranch, this.branch, item, qty); return { ok: true }; });
  }
  pendingToDispatch(): string[] {
    return (this.db.prepare("SELECT transfer FROM events WHERE kind='requested' AND from_branch=?").all(this.branch) as { transfer: string }[])
      .map(r => r.transfer).filter(t => this.status(t) === 'requested');
  }
  acceptAndDispatch(tid: string): Result {
    return this.once('disp:' + tid, () => {
      const e = this.db.prepare("SELECT * FROM events WHERE kind='requested' AND transfer=?").get(tid) as any;
      if (!e || e.from_branch !== this.branch) return { ok: false, reason: 'not mine' };
      if (this.balance(e.item) < e.qty) return { ok: false, reason: 'insufficient' };
      this.event('accepted', tid, e.from_branch, e.to_branch, e.item, e.qty);
      this.move('transfer_out', e.item, -e.qty, 'MAIN', tid);
      this.move('transfer_transit_in', e.item, e.qty, 'TRANSIT:' + tid, tid);
      this.event('dispatched', tid, e.from_branch, e.to_branch, e.item, e.qty);
      return { ok: true };
    });
  }
  pendingToReceive(): string[] {
    return (this.db.prepare("SELECT transfer FROM events WHERE kind='dispatched' AND to_branch=?").all(this.branch) as { transfer: string }[])
      .map(r => r.transfer).filter(t => this.status(t) === 'dispatched');
  }
  receive(tid: string): Result {
    return this.once('recv:' + tid, () => {
      const e = this.db.prepare("SELECT * FROM events WHERE kind='dispatched' AND transfer=?").get(tid) as any;
      if (!e || e.to_branch !== this.branch) return { ok: false, reason: 'not dispatched' };
      this.move('transfer_transit_out', e.item, -e.qty, 'TRANSIT:' + tid, tid);
      this.move('transfer_in', e.item, e.qty, 'MAIN', tid);
      this.event('received', tid, e.from_branch, e.to_branch, e.item, e.qty);
      return { ok: true };
    });
  }

  // ---- sync: push unsynced rows (idempotent upsert in the cloud), then pull events about me ----
  async sync(cloud: Cloud, net: Net): Promise<void> {
    const movements = this.db.prepare('SELECT id,branch,store,item,qty,kind,ref,origin FROM movements WHERE synced=0 LIMIT 40').all() as any[];
    const events = this.db.prepare('SELECT id,kind,transfer,from_branch,to_branch,item,qty,origin FROM events WHERE synced=0 AND origin=? LIMIT 40').all(this.branch) as any[];
    if (movements.length || events.length) {
      const ack = await net.call(() => cloud.push({ movements, events }));
      this.db.transaction(() => {
        for (const id of ack.movements) this.db.prepare('UPDATE movements SET synced=1 WHERE id=?').run(id);
        for (const id of ack.events) this.db.prepare('UPDATE events SET synced=1 WHERE id=?').run(id);
      })();
    }
    const cur = Number((this.db.prepare("SELECT v FROM meta WHERE k='cursor'").get() as any)?.v ?? 0);
    const rows = await net.call(() => cloud.pull(this.branch, cur));
    this.db.transaction(() => {
      const ie = this.db.prepare('INSERT OR IGNORE INTO events(id,kind,transfer,from_branch,to_branch,item,qty,origin,synced,cseq) VALUES(?,?,?,?,?,?,?,?,1,?)');
      for (const r of rows) ie.run(r.id, r.kind, r.transfer, r.from_branch, r.to_branch, r.item, r.qty, r.origin, r.cseq);
      if (rows.length) this.db.prepare("INSERT INTO meta(k,v) VALUES('cursor',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(String(rows[rows.length - 1].cseq));
    })();
  }
  unsynced(): number {
    return (this.db.prepare('SELECT (SELECT COUNT(*) FROM movements WHERE synced=0)+(SELECT COUNT(*) FROM events WHERE synced=0 AND origin=?) c').get(this.branch) as { c: number }).c;
  }
}
