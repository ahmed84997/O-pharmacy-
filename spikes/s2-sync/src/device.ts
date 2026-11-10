import type { Hub, Result } from './hub.js';
import { prng } from './net.js';

// A till/phone on the branch LAN. If the Hub is unreachable the operation waits in a local queue
// with its idempotency key and is replayed later; the Hub ignores repeats.
type Op = { key: string; run: (h: Hub) => Result };
export class Device {
  queue: Op[] = [];
  lanUp = true;
  lanDup = 0;
  results = new Map<string, Result>();
  constructor(public name: string, private hub: Hub, private rnd: () => number = prng(1)) {}
  submit(op: Op) { this.queue.push(op); this.flush(); }
  flush() {
    while (this.queue.length && this.lanUp) {
      const op = this.queue[0];
      const r = op.run(this.hub);
      if (this.rnd() < this.lanDup) op.run(this.hub); // duplicate delivery on the LAN
      this.results.set(op.key, r);
      this.queue.shift();
    }
  }
}
