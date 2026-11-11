import { Hub } from '@o-pharmacy/hub';
import { BatchService, ItemService, MIGRATIONS, PurchasingService, StockService } from '@o-pharmacy/inventory';
import { CustomerService, POS_MIGRATIONS, SaleService } from '@o-pharmacy/pos';
import { OPS_MIGRATIONS } from '@o-pharmacy/ops';
import { ACCOUNTS_MIGRATIONS } from '@o-pharmacy/accounts';
import { HR_MIGRATIONS } from '@o-pharmacy/hr';
import { CONTRACT_MIGRATIONS } from '@o-pharmacy/contracts';
import { REPORT_MIGRATIONS, ReportCentre } from '@o-pharmacy/reports';
import { APP_MIGRATIONS } from './schema';
import { AccessService } from './access';

/** Every module's tables in dependency order. A migration added later runs on the next start (additive, checksum-guarded). Printing and the ETA queue join in Sprint 7.2 with their screens. */
export const ALL_MIGRATIONS = [...MIGRATIONS, ...POS_MIGRATIONS, ...OPS_MIGRATIONS, ...ACCOUNTS_MIGRATIONS, ...HR_MIGRATIONS, ...CONTRACT_MIGRATIONS, ...REPORT_MIGRATIONS, ...APP_MIGRATIONS];

export interface AppOptions { branchId?: string; dbPath?: string; clock?: () => Date; testMode?: boolean }
export type App = ReturnType<typeof openApp>;

/** One Hub per branch with all modules wired on it: the composition root of the program. */
export function openApp(o: AppOptions = {}) {
  const hub = Hub.open(o.branchId ?? 'B1', o.dbPath ?? ':memory:', o.clock ?? (() => new Date()), ALL_MIGRATIONS);
  const access = new AccessService(hub);
  const items = new ItemService(hub); const batches = new BatchService(hub, items); const stock = new StockService(hub, items, batches);
  const purchasing = new PurchasingService(hub, items, batches); const sales = new SaleService(hub, items, batches); const customers = new CustomerService(hub, sales);
  const reports = new ReportCentre(hub);
  return { hub, access, items, batches, stock, purchasing, sales, customers, reports, testMode: !!o.testMode };
}
