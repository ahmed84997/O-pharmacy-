/**
 * Permission catalogue and role templates, from docs/specs/permission-matrix.md (v0.1) - one key per action.
 * Role codes: O Owner, A Branch Admin, M Branch Manager, P Pharmacist, C Cashier, S Storekeeper, E Employee, X Accountant, D Delivery.
 * Row: key(s) | on by default | available but off (granted per person). Grouped keys "a/b" expand to prefix.a, prefix.b.
 * There is no delete permission anywhere (No-Delete, D13).
 */
export type RoleCode = 'O' | 'A' | 'M' | 'P' | 'C' | 'S' | 'E' | 'X' | 'D';
export const ROLE_NAMES: Record<RoleCode, string> = { O: 'Owner', A: 'Branch Admin', M: 'Branch Manager', P: 'Pharmacist', C: 'Cashier', S: 'Storekeeper', E: 'Employee', X: 'Accountant', D: 'Delivery agent' };

const ROWS = `
user.view|OAM|
user.create/update/deactivate|OA|M
role.assign|OA|
role.manage|O|A
device.register/approve/revoke|OA|M
session.view/revoke|OAM|
settings.security|OA|
settings.business_rules|OA|M
settings.branch|OAM|
branch.create/switch|O|
audit.view|OAM|X
audit.export|OA|X
deleted_items.view|OAM|X
deleted_items.restore|OA|M
licence.view|OA|
item.view|OAMPCSEX|
item.create/update|OAMPS|
item.price.set|OAM|P
item.barcode_alias.manage|OAMPS|
item.suspend/archive|OAM|P
item.import/merge|OA|M
supplier.view|OAMPSX|
supplier.create/update|OAM|SX
customer.view|OAMPCEX|D
customer.create/update|OAMPC|E
customer.credit_limit.set|OAM|X
customer.merge|OA|M
contract.view|OAMPCX|
contract.manage|OAM|X
stock.view|OAMPCSEX|
stock.cost.view|OAMX|
stock.batch.view|OAMPSX|CE
stock.adjust|OAMS|
stock.adjust.approve|OAM|
stock.cost_adjust|OA|MX
store.transfer.internal|OAMS|
stocktake.count|OAMPS|E
stocktake.approve/apply|OAM|
expiry.alerts.view|OAMPSE|
other_branches.quantities.view|OAMPCSE|
shortage.record/view|OAMPCSE|
shortage.convert_to_po|OAMP|
purchase_order.create/update|OAMP|S
purchase_order.cancel|OAM|
purchase_invoice.create|OAMPS|
purchase_invoice.void|OAM|X
purchase_return.create|OAMPS|
supplier_price.view/compare|OAMPX|S
receiving.verify|OAMS|
sale.create|OAMPC|E
sale.credit.create|OAMP|C
sale.hold/resume|OAMPC|E
sale.discount|OAMP|C
sale.discount.override|OAM|P
sale.price_override|OA|M
sale.line.delete|OAMPC|E
sale.void|OAM|P
sale.return/swap|OAMP|C
sale.view_own/view_all|OAMPX|C
cashier_session.open/close|OAMPC|
drawer.close.review|OAMX|
home_delivery.create/assign|OAMPC|
home_delivery.deliver|D|
insurance_claim.submit/reconcile|OAMX|P
cash.in_out|OAMX|C
bank_cheque.manage|OAX|M
ledger.view|OAX|
ledger.post/period.close|OA|X
period.reopen|OA|
statements.view|OAX|
capital.profit_distribution|O|
payroll.view/run|OA|X
salary.view|OA|
customer_request.create/update|OAMPCE|
customer_request.cancel|OAMP|
notification.view/send|OAMPCSED|
staff_tasks.manage|OAM|
staff_tasks.my|OAMPCSEXD|
attendance.record_own|OAMPCSEXD|
attendance.approve|OAM|
leave.approve|OAM|
deductions/incentives/advances.manage|OA|M
performance.view_own|OAMPCSEXD|
performance.view_team|OAM|
ai.assistant.use|OAMP|E
conversation.view/reply|OAMP|CE
transfer.request|OAMPS|E
transfer.accept/dispatch|OAMS|E
transfer.receive|OAMS|E
transfer.cost_mode.set|O|X
central_purchase.manage|O|X
consolidated_reports.view|O|X
central_warehouse.manage|OS|
report.view|OAMPSX|
report.view_financial|OAMX|
report.export|OAMX|
dashboard.executive|OA|X
dashboard.operational|OAMPSE|
compliance.eta.view/retry/late_submit|OAMX|
compliance.eda.view/report|OAMP|S
controlled_drug.register.manage|OAMP|
recall.manage|OAMPS|
integrations.manage|OA|
`.trim().split('\n');

function expand(spec: string): string[] {
  const i = spec.indexOf('/'); if (i < 0) return [spec];
  // "user.create/update/deactivate" -> user.create, user.update, user.deactivate; "customer_request.create/update" likewise
  const head = spec.slice(0, i); const dot = head.lastIndexOf('.');
  const prefix = dot >= 0 ? head.slice(0, dot + 1) : '';
  // "deductions/incentives/advances.manage": prefix after the slash group
  if (!spec.includes('.', i)) return [head, ...spec.slice(i + 1).split('/')].map((k, n) => (n === 0 ? k : prefix + k));
  const tail = spec.slice(spec.lastIndexOf('.')); // ".manage"
  return spec.split('/').map(p => (p.includes('.') ? p : p + tail));
}

export interface PermDef { key: string; defaultRoles: RoleCode[]; optionalRoles: RoleCode[] }
export const CATALOGUE: PermDef[] = ROWS.flatMap(row => {
  const [spec, on = '', off = ''] = row.split('|');
  return expand(spec!).map(key => ({ key, defaultRoles: on.split('') as RoleCode[], optionalRoles: off.split('') as RoleCode[] }));
});
export const PERMISSION_KEYS: readonly string[] = CATALOGUE.map(p => p.key);
const KEYSET = new Set(PERMISSION_KEYS);

export function roleTemplate(role: RoleCode): { default: string[]; optional: string[] } {
  return { default: CATALOGUE.filter(p => p.defaultRoles.includes(role)).map(p => p.key), optional: CATALOGUE.filter(p => p.optionalRoles.includes(role)).map(p => p.key) };
}

/** A person: several roles (union, D23), per-person grants and denials, and the branches they work in (Owner = all). */
export interface Person { id: string; roles: RoleCode[]; grants?: string[]; denies?: string[]; branchIds: string[] | 'all' }

export function permissionsOf(p: Person): Set<string> {
  const s = new Set<string>();
  for (const r of p.roles) for (const k of roleTemplate(r).default) s.add(k);
  for (const k of p.grants ?? []) if (KEYSET.has(k)) s.add(k);
  for (const k of p.denies ?? []) s.delete(k);
  return s;
}

/** The one question every screen and API asks. Branch scope: Owner or 'all' = every branch, otherwise only listed branches (D15). */
export function can(p: Person, key: string, branchId?: string): boolean {
  if (!KEYSET.has(key)) throw new Error(`unknown permission ${key}`);
  if (!permissionsOf(p).has(key)) return false;
  if (branchId === undefined || p.branchIds === 'all' || p.roles.includes('O')) return true;
  return p.branchIds.includes(branchId);
}

/** Grants are limited to keys a template offers or already has (an Admin cannot invent rights outside the catalogue). */
export function validateGrant(key: string): boolean { return KEYSET.has(key); }

/** Separation of duties (matrix rule 4): maker cannot approve own action, unless this is a one-person pharmacy (then flagged). */
export function approvalAllowed(maker: string, approver: string, opts: { separationOfDuties: boolean; activeApprovers: number }): { ok: boolean; flagged: boolean } {
  if (!opts.separationOfDuties || maker !== approver) return { ok: true, flagged: false };
  return opts.activeApprovers <= 1 ? { ok: true, flagged: true } : { ok: false, flagged: false };
}
