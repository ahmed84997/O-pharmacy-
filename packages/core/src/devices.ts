import { uuidv7 } from './ids';

/** Device registry: a new device is pending until someone with device.approve approves it; revoke is final (a new registration is needed). Never deleted. */
export type DeviceStatus = 'pending' | 'approved' | 'revoked';
export interface Device { id: string; name: string; kind: 'pos' | 'hub' | 'phone' | 'tablet'; branchId: string; status: DeviceStatus; log: { to: DeviceStatus; by: string; at: string }[] }
export class DeviceError extends Error { constructor(public code: 'not-found' | 'bad-state', m: string) { super(m); } }

export class DeviceRegistry {
  private devices = new Map<string, Device>();
  register(name: string, kind: Device['kind'], branchId: string, by: string, at = new Date()): Device {
    const d: Device = { id: uuidv7(), name, kind, branchId, status: 'pending', log: [{ to: 'pending', by, at: at.toISOString() }] };
    this.devices.set(d.id, d); return d;
  }
  private move(id: string, from: DeviceStatus[], to: DeviceStatus, by: string, at: Date): Device {
    const d = this.devices.get(id); if (!d) throw new DeviceError('not-found', id);
    if (!from.includes(d.status)) throw new DeviceError('bad-state', `${d.status} -> ${to}`);
    d.status = to; d.log.push({ to, by, at: at.toISOString() }); return d;
  }
  approve(id: string, by: string, at = new Date()) { return this.move(id, ['pending'], 'approved', by, at); }
  revoke(id: string, by: string, at = new Date()) { return this.move(id, ['pending', 'approved'], 'revoked', by, at); }
  /** The gate every request passes: only approved devices of that branch may act. */
  isAllowed(id: string, branchId: string): boolean { const d = this.devices.get(id); return !!d && d.status === 'approved' && d.branchId === branchId; }
  list(): Device[] { return [...this.devices.values()]; }
}
