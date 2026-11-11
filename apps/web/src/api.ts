/* The only door to the Hub. The device keeps its id and secret (given once at registration); the session token lives for this window only. */
const DEV_KEY = 'o.device';
const TOKEN_KEY = 'o.token';
const store = { get(k: string, s: Storage) { try { return s.getItem(k); } catch { return null; } }, set(k: string, v: string | null, s: Storage) { try { if (v === null) s.removeItem(k); else s.setItem(k, v); } catch { /* storage blocked: stays in memory */ } } };
let memDevice: string | null = null; let memToken: string | null = null;
export const device = { get: () => memDevice ?? store.get(DEV_KEY, localStorage), set: (v: string | null) => { memDevice = v; store.set(DEV_KEY, v, localStorage); } };
export const token = { get: () => memToken ?? store.get(TOKEN_KEY, sessionStorage), set: (v: string | null) => { memToken = v; store.set(TOKEN_KEY, v, sessionStorage); } };

export class ApiError extends Error { constructor(public code: string, m: string, public status: number) { super(m); } }
export async function api<T = unknown>(path: string, o: { method?: string; body?: unknown } = {}): Promise<T> {
  const h: Record<string, string> = {}; const d = device.get(); const t = token.get(); if (d) h['x-device'] = d; if (t) h.authorization = `Bearer ${t}`; if (o.body !== undefined) h['content-type'] = 'application/json';
  let r: Response; try { r = await fetch(path, { method: o.method ?? (o.body !== undefined ? 'POST' : 'GET'), headers: h, body: o.body !== undefined ? JSON.stringify(o.body) : undefined }); } catch { throw new ApiError('offline', 'offline', 0); }
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new ApiError(j.error ?? 'server', j.message ?? r.statusText, r.status); return j as T;
}

/** What the screens show for each refusal (Egyptian Arabic, short). */
const MSG: Record<string, string> = {
  offline: 'مش قادر أوصل للـ Hub. اتأكد إن البرنامج شغال على جهاز الصيدلية.', 'bad-credentials': 'اسم المستخدم أو كلمة السر غلط.', locked: 'الحساب اتقفل مؤقتًا بعد محاولات غلط كتير. جرّب كمان ربع ساعة.',
  inactive: 'الحساب ده متوقف. كلّم المدير.', 'device-pending': 'الجهاز ده مستني موافقة المدير.', 'device-revoked': 'الجهاز ده اتلغى. سجّله تاني.', 'device-unknown': 'الجهاز مش متسجل.', unauthenticated: 'سجّل دخول تاني.',
  forbidden: 'مش مسموح لك بالعملية دي.', 'not-found': 'مش موجود.', duplicate: 'موجود قبل كده.', server: 'حصل خطأ غير متوقع. جرّب تاني.',
};
const DETAIL: [RegExp, string][] = [
  [/note is required when the count differs/, 'العدّ مختلف عن المتوقع: اكتب ملاحظة وانت بتقفل.'], [/reprint needs a reason/, 'النسخة التانية محتاجة سبب.'], [/a note is required/, 'اكتب ملاحظة.'], [/already has an open session|already has an ope/, 'فيه جلسة مفتوحة على الجهاز ده أو باسمك.'], [/cannot review their own/, 'مينفعش تراجع جلستك بنفسك.'], [/held bill/, 'فيه فواتير معلّقة: كمّلها أو الغيها قبل التقفيل.'], [/more than was sold|cannot return more/, 'مينفعش ترجّع أكتر من اللي اتباع.'], [/day cannot close yet/, 'اليوم لسه مينفعش يتقفل.'], [/already closed/, 'اتقفل قبل كده.'],
  [/username taken/, 'اسم المستخدم ده مستخدم قبل كده.'], [/username:/, 'اسم المستخدم: من 3 لـ 32 حرف إنجليزي أو رقم (والنقطة والشرطة مسموحين).'], [/password needs at least (\d+)/, 'كلمة السر لازم تبقى $1 حروف على الأقل.'],
  [/current password is wrong/, 'كلمة السر الحالية غلط.'], [/different password/, 'اختار كلمة سر مختلفة عن القديمة.'], [/at least one active owner/, 'لازم يفضل مالك واحد نشط على الأقل.'], [/only an owner/, 'الحركة دي للمالك بس.'],
  [/cannot deactivate yourself/, 'مينفعش توقف حسابك بنفسك.'], [/cannot revoke the device you are using/, 'مينفعش تلغي الجهاز اللي شغال عليه.'], [/reason is required/, 'اكتب السبب.'], [/name is required/, 'اكتب الاسم.'],
  [/choose at least one valid role/, 'اختار دور واحد على الأقل.'], [/already set up/, 'البرنامج متجهز قبل كده.'], [/already items/, 'فيه أصناف بالفعل: البيانات التجريبية بتتحمّل على قاعدة فاضية بس.'], [/too many devices/, 'فيه أجهزة كتير مستنية موافقة.'],
];
export function arabic(e: unknown): string { if (e instanceof ApiError) { for (const [re, m] of DETAIL) { const x = e.message.match(re); if (x) return m.replace('$1', x[1] ?? ''); } return MSG[e.code] ?? e.message; } return MSG.server!; }
