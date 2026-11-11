/**
 * Configuration engine (ARD: nothing hardcoded).
 * One schema is the single source: keys, types, defaults, allowed scopes.
 * Values resolve in layers: default < tenant < branch < device. Every change is audited by the caller (see ConfigStore.onChange).
 */
export type Scope = 'tenant' | 'branch' | 'device';
export type ConfigType = 'boolean' | 'integer' | 'string' | 'enum';

export interface ConfigDef {
  type: ConfigType;
  default: boolean | number | string;
  scopes: Scope[];
  description: string;
  min?: number;
  max?: number;
  options?: string[];
}
export type ConfigValue = boolean | number | string;

/** Initial keys. Adding a key = add it here (the only place) + an additive data migration for existing tenants. */
export const CONFIG_SCHEMA = {
  'pharmacy.currency': { type: 'string', default: 'EGP', scopes: ['tenant'], description: 'Currency code' },
  'pharmacy.language': { type: 'enum', default: 'ar', options: ['ar', 'en'], scopes: ['tenant', 'device'], description: 'Interface language' },
  'sale.allowExpiredBatch': { type: 'boolean', default: false, scopes: ['tenant'], description: 'Expired batches are never sold; kept false (D21)' },
  'sale.cashierDiscountMaxPct': { type: 'integer', default: 5, min: 0, max: 100, scopes: ['tenant', 'branch'], description: 'Largest discount a cashier may give without a manager' },
  'sale.allowNegativeStock': { type: 'boolean', default: false, scopes: ['tenant', 'branch'], description: 'Sell with no recorded stock' },
  'security.separationOfDuties': { type: 'boolean', default: true, scopes: ['tenant'], description: 'Maker and approver must differ' },
  'security.hideCostFromPharmacist': { type: 'boolean', default: true, scopes: ['tenant'], description: 'Cost and profit hidden from the Pharmacist role' },
  'items.etaCodeRequired': { type: 'boolean', default: false, scopes: ['tenant'], description: 'Items need an ETA item code before they can be sold (turn on when e-receipt starts)' },
  'stock.expiryWarningDays': { type: 'integer', default: 90, min: 1, max: 730, scopes: ['tenant', 'branch'], description: 'Near-expiry window' },
  'device.printer.paperWidthMm': { type: 'enum', default: '80', options: ['58', '80'], scopes: ['device'], description: 'Receipt paper width' },
  'sync.intervalSeconds': { type: 'integer', default: 30, min: 5, max: 3600, scopes: ['tenant', 'device'], description: 'Hub to Cloud sync interval' },
} as const satisfies Record<string, ConfigDef>;

export type ConfigKey = keyof typeof CONFIG_SCHEMA;
const SCHEMA: Record<string, ConfigDef> = CONFIG_SCHEMA;

export class ConfigError extends Error {
  constructor(public code: 'unknown-key' | 'bad-scope' | 'bad-type' | 'out-of-range' | 'bad-option', message: string) { super(message); }
}

export function validateConfig(key: string, scope: Scope, value: ConfigValue): void {
  const d = SCHEMA[key];
  if (!d) throw new ConfigError('unknown-key', `unknown key ${key}`);
  if (!d.scopes.includes(scope)) throw new ConfigError('bad-scope', `${key} cannot be set at ${scope}`);
  switch (d.type) {
    case 'boolean': if (typeof value !== 'boolean') throw new ConfigError('bad-type', `${key} needs boolean`); break;
    case 'integer':
      if (typeof value !== 'number' || !Number.isInteger(value)) throw new ConfigError('bad-type', `${key} needs integer`);
      if ((d.min !== undefined && value < d.min) || (d.max !== undefined && value > d.max)) throw new ConfigError('out-of-range', `${key} must be ${d.min}..${d.max}`);
      break;
    case 'string': if (typeof value !== 'string' || value.length === 0) throw new ConfigError('bad-type', `${key} needs text`); break;
    case 'enum': if (typeof value !== 'string' || !d.options?.includes(value)) throw new ConfigError('bad-option', `${key} must be one of ${d.options?.join(',')}`); break;
  }
}

export interface ConfigChange { key: string; scope: Scope; scopeId: string; before: ConfigValue | undefined; after: ConfigValue | undefined; by: string }
type Row = { scope: Scope; scopeId: string; key: string; value: ConfigValue };

export class ConfigStore {
  private rows = new Map<string, Row>();
  constructor(private onChange: (c: ConfigChange) => void = () => {}) {}
  private k = (scope: Scope, scopeId: string, key: string) => `${scope}|${scopeId}|${key}`;

  set(key: string, scope: Scope, scopeId: string, value: ConfigValue, by: string): void {
    validateConfig(key, scope, value);
    const id = this.k(scope, scopeId, key);
    const before = this.rows.get(id)?.value;
    this.rows.set(id, { scope, scopeId, key, value });
    this.onChange({ key, scope, scopeId, before, after: value, by });
  }
  /** Remove an override so the next layer applies (the override itself is logged, never silently lost). */
  reset(key: string, scope: Scope, scopeId: string, by: string): void {
    const id = this.k(scope, scopeId, key); const before = this.rows.get(id)?.value;
    if (before === undefined) return;
    this.rows.delete(id);
    this.onChange({ key, scope, scopeId, before, after: undefined, by });
  }
  /** default < tenant < branch < device */
  get<K extends ConfigKey>(key: K, ctx: { tenant: string; branch?: string; device?: string }): ConfigValue {
    const d = SCHEMA[key]; if (!d) throw new ConfigError('unknown-key', key);
    const layers: [Scope, string | undefined][] = [['device', ctx.device], ['branch', ctx.branch], ['tenant', ctx.tenant]];
    for (const [scope, id] of layers) { if (id === undefined) continue; const r = this.rows.get(this.k(scope, id, key)); if (r) return r.value; }
    return d.default;
  }
  /** All keys resolved for a context (used by the Hub to ship a settings snapshot to devices). */
  snapshot(ctx: { tenant: string; branch?: string; device?: string }): Record<string, ConfigValue> {
    return Object.fromEntries(Object.keys(SCHEMA).map(k => [k, this.get(k as ConfigKey, ctx)]));
  }
}

export const configKeys = (): string[] => Object.keys(SCHEMA).sort();
