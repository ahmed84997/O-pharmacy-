// Fault-injecting link between a Hub and the Cloud. Deterministic via a seeded PRNG.
export function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Net {
  up = true;
  dropAck = 0; // probability the request is applied but the answer is lost
  dup = 0;     // probability the request is delivered twice
  constructor(private rnd: () => number = Math.random) {}
  async call<T>(fn: () => T): Promise<T> {
    if (!this.up) throw new Error('offline');
    const r = fn();
    if (this.rnd() < this.dup) fn();
    if (this.rnd() < this.dropAck) throw new Error('ack lost');
    return r;
  }
}
