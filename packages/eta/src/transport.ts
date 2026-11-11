export interface EtaSubmitResult { submissionUuid: string; accepted: { uuid: string; longId: string; receiptNumber: string }[]; rejected: { uuid: string; receiptNumber: string; error: { message: string; target?: string; propertyPath?: string } }[] }
/** A refusal of the whole submission (HTTP status and ETA's error code), or a network failure (status 0). */
export class EtaHttpError extends Error { constructor(public status: number, public code: string, message: string, public retryAfterSec?: number) { super(message); } }
export interface EtaTransport { submit(receipts: Record<string, unknown>[]): Promise<EtaSubmitResult> }

/** Scripted ETA for tests: accepts everything unless told otherwise. */
export class FakeEtaTransport implements EtaTransport {
  batches: Record<string, unknown>[][] = []; failWith?: EtaHttpError; rejectNumbers = new Set<string>();
  async submit(receipts: Record<string, unknown>[]): Promise<EtaSubmitResult> {
    if (this.failWith) throw this.failWith; this.batches.push(receipts); const out: EtaSubmitResult = { submissionUuid: `SUB${this.batches.length}`, accepted: [], rejected: [] };
    for (const r of receipts) { const h = r.header as { uuid: string; receiptNumber: string }; if (this.rejectNumbers.has(h.receiptNumber)) out.rejected.push({ uuid: h.uuid, receiptNumber: h.receiptNumber, error: { message: 'invalid item code', target: h.uuid, propertyPath: 'itemData[0].itemCode' } }); else out.accepted.push({ uuid: h.uuid, longId: `LONG-${h.uuid.slice(0, 8)}`, receiptNumber: h.receiptNumber }); }
    return out;
  }
}
/** POST /api/v1/receiptsubmissions (https://sdk.invoicing.eta.gov.eg/ereceiptapi/02-submit-receipt/). Sign-in and the standard headers come from `headers()` and the issuer signature from `sign()`: both depend on the pharmacy's ETA registration and are NOT exercised yet (no pre-production credentials). */
export class HttpEtaTransport implements EtaTransport {
  constructor(private baseUrl: string, private headers: () => Promise<Record<string, string>>, private sign?: (receipts: Record<string, unknown>[]) => Promise<{ signatureType: 'I' | 'S'; value: string }[]>, private fetchImpl: typeof fetch = fetch) {}
  async submit(receipts: Record<string, unknown>[]): Promise<EtaSubmitResult> {
    let res: Response; try { res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, '')}/api/v1/receiptsubmissions`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await this.headers()) }, body: JSON.stringify({ receipts, ...(this.sign ? { signatures: await this.sign(receipts) } : {}) }) }); } catch (e) { throw new EtaHttpError(0, 'Network', (e as Error).message); }
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    if (res.status === 202) return { submissionUuid: String(body.submissionUUID ?? ''), accepted: ((body.acceptedDocuments as { uuid: string; longId: string; receiptNumber: string }[]) ?? []).map(a => ({ uuid: a.uuid, longId: a.longId, receiptNumber: a.receiptNumber })), rejected: ((body.rejectedDocuments as { uuid: string; receiptNumber: string; error: { message: string; target?: string; propertyPath?: string } }[]) ?? []).map(r => ({ uuid: r.uuid, receiptNumber: r.receiptNumber, error: r.error })) };
    const err = (body.error ?? body) as { code?: string; message?: string }; throw new EtaHttpError(res.status, String(err.code ?? res.status), String(err.message ?? res.statusText), res.headers.get('Retry-After') ? Number(res.headers.get('Retry-After')) : undefined);
  }
}
