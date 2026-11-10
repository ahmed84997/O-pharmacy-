import { open, DB, RANK } from './db.js';

type Mv = { id: string; branch: string; store: string; item: string; qty: number; kind: string; ref: string | null; origin: string };
type Ev = { id: string; kind: string; transfer: string; from_branch: string; to_branch: string; item: string; qty: number; origin: string };

export class Cloud {
  db: DB = open();
  push(b: { movements: Mv[]; events: Ev[] }) {
    return this.db.transaction(() => {
      const im = this.db.prepare('INSERT OR IGNORE INTO movements(id,branch,store,item,qty,kind,ref,origin,synced) VALUES(?,?,?,?,?,?,?,?,1)');
      const ie = this.db.prepare('INSERT OR IGNORE INTO events(id,kind,transfer,from_branch,to_branch,item,qty,origin,synced,cseq) VALUES(?,?,?,?,?,?,?,?,1,(SELECT COALESCE(MAX(cseq),0)+1 FROM events))');
      for (const m of b.movements) im.run(m.id, m.branch, m.store, m.item, m.qty, m.kind, m.ref, m.origin);
      for (const e of b.events) ie.run(e.id, e.kind, e.transfer, e.from_branch, e.to_branch, e.item, e.qty, e.origin);
      return { movements: b.movements.map(m => m.id), events: b.events.map(e => e.id) };
    })();
  }
  pull(branch: string, cursor: number) {
    return this.db.prepare('SELECT * FROM events WHERE cseq > ? AND (from_branch = ? OR to_branch = ?) ORDER BY cseq').all(cursor, branch, branch) as (Ev & { cseq: number })[];
  }
  balance(branch: string, item: string): number {
    return (this.db.prepare("SELECT COALESCE(SUM(qty),0) q FROM movements WHERE branch=? AND store='MAIN' AND item=?").get(branch, item) as { q: number }).q;
  }
  totalAllStores(item: string): number {
    return (this.db.prepare('SELECT COALESCE(SUM(qty),0) q FROM movements WHERE item=?').get(item) as { q: number }).q;
  }
  movementCount(): number {
    return (this.db.prepare('SELECT COUNT(*) c FROM movements').get() as { c: number }).c;
  }
  transitSums(): Record<string, number> {
    const rows = this.db.prepare("SELECT store, SUM(qty) q FROM movements WHERE store LIKE 'TRANSIT:%' GROUP BY store").all() as { store: string; q: number }[];
    return Object.fromEntries(rows.map(r => [r.store, r.q]));
  }
  transferStatus(tid: string): string | null {
    const rows = this.db.prepare('SELECT kind FROM events WHERE transfer=?').all(tid) as { kind: string }[];
    return rows.length ? rows.map(r => r.kind).sort((a, b) => RANK[b] - RANK[a])[0] : null;
  }
}
