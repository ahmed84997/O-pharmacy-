import type { Hub, OutboxRow, RemoteEvent } from './hub';

/** What the Hub needs from the Cloud. The HTTP implementation is below; tests use fault-injecting fakes. */
export interface Transport {
  /** Returns the ids the Cloud has stored (duplicates included). Throwing means "unknown": the Hub keeps everything and retries. */
  push(events: { id: string; type: string; branchId: string; payload: unknown; createdAt: string }[]): Promise<string[]>;
  pull(cursor: number, limit: number): Promise<{ events: RemoteEvent[]; cursor: number }>;
}

export interface SyncResult { ok: boolean; pushed: number; pulled: number; error?: string }

/**
 * One sync round. Push first (oldest first, in batches), then pull. Rules:
 * - an event leaves the outbox only after the Cloud acknowledged its id (a lost ack just causes a harmless re-send);
 * - a failure stops the round, bumps attempts, and leaves everything in place; local work never waits for the network;
 * - pulled events and the new cursor are stored together, so a crash cannot skip events.
 */
export async function syncOnce(hub: Hub, t: Transport, o: { batch?: number; maxRounds?: number } = {}): Promise<SyncResult> {
  const batch = o.batch ?? 100, maxRounds = o.maxRounds ?? 1000; let pushed = 0, pulled = 0;
  try {
    for (let i = 0; i < maxRounds; i++) {
      const rows: OutboxRow[] = hub.outboxPending(batch); if (!rows.length) break;
      try {
        const acked = await t.push(rows.map(r => ({ id: r.id, type: r.type, branchId: r.branchId, payload: r.payload, createdAt: r.createdAt })));
        const mine = new Set(rows.map(r => r.id)); const ok = acked.filter(id => mine.has(id));
        hub.outboxAck(ok); pushed += ok.length;
        if (ok.length < rows.length) { hub.outboxFailed(rows.filter(r => !ok.includes(r.id)).map(r => r.id)); return { ok: false, pushed, pulled, error: 'partial acknowledgement' }; }
      } catch (e) { hub.outboxFailed(rows.map(r => r.id)); throw e; }
    }
    for (let i = 0; i < maxRounds; i++) {
      const cur = hub.remoteCursor(); const r = await t.pull(cur, batch);
      pulled += hub.applyRemote(r.events, r.cursor);
      if (r.events.length < batch || r.cursor <= cur) break;
    }
    hub.markSyncSuccess();
    return { ok: true, pushed, pulled };
  } catch (e) { return { ok: false, pushed, pulled, error: e instanceof Error ? e.message : String(e) }; }
}

/** Wait before the next attempt after n consecutive failures: exponential, capped, with jitter so many Hubs do not retry together. */
export function backoffMs(failures: number, base = 2000, max = 300_000, rnd: () => number = Math.random): number {
  const exp = Math.min(max, base * 2 ** Math.max(0, failures - 1));
  return Math.round(exp / 2 + (exp / 2) * rnd());
}

export function httpTransport(baseUrl: string, token: string, f: typeof fetch = fetch): Transport {
  const call = async (path: string, init: RequestInit) => {
    const r = await f(baseUrl.replace(/\/$/, '') + path, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } });
    if (!r.ok) throw new Error(`cloud answered ${r.status}`);
    return r.json() as Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  return {
    push: async events => (await call('/v1/ingest', { method: 'POST', body: JSON.stringify({ events }) })).acked as string[],
    pull: async (cursor, limit) => { const r = await call(`/v1/pull?cursor=${cursor}&limit=${limit}`, { method: 'GET' }); return { events: r.events as RemoteEvent[], cursor: Number(r.cursor) }; },
  };
}
