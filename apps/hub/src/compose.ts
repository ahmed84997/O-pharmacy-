import { Hub } from '@o-pharmacy/hub';
import { BatchService, ImportService, ItemService, MIGRATIONS, PurchasingService, StockService, StocktakeService } from '@o-pharmacy/inventory';
import { ClosingService, CustomerService, POS_MIGRATIONS, ReturnService, SaleService } from '@o-pharmacy/pos';
import { PRINT_MIGRATIONS } from '@o-pharmacy/print';
import { OPS_MIGRATIONS } from '@o-pharmacy/ops';
import { ACCOUNTS_MIGRATIONS } from '@o-pharmacy/accounts';
import { HR_MIGRATIONS } from '@o-pharmacy/hr';
import { CONTRACT_MIGRATIONS } from '@o-pharmacy/contracts';
import { REPORT_MIGRATIONS, ReportCentre } from '@o-pharmacy/reports';
import { APP_MIGRATIONS } from './schema';
import { AccessService } from './access';

/** Every module's tables in dependency order. A migration added later runs on the next start (additive, checksum-guarded). The ETA queue joins when the pharmacy's ETA registration data arrives (owner-actions 12). */
export const ALL_MIGRATIONS = [...MIGRATIONS, ...POS_MIGRATIONS, ...PRINT_MIGRATIONS, ...OPS_MIGRATIONS, ...ACCOUNTS_MIGRATIONS, ...HR_MIGRATIONS, ...CONTRACT_MIGRATIONS, ...REPORT_MIGRATIONS, ...APP_MIGRATIONS];

export interface AppOptions { branchId?: string; dbPath?: string; clock?: () => Date; testMode?: boolean }
export type App = ReturnType<typeof openApp>;

/** One Hub per branch with all modules wired on it: the composition root of the program. */
export function openApp(o: AppOptions = {}) {
  const hub = Hub.open(o.branchId ?? 'B1', o.dbPath ?? ':memory:', o.clock ?? (() => new Date()), ALL_MIGRATIONS);
  const access = new AccessService(hub);
  const items = new ItemService(hub); const batches = new BatchService(hub, items); const stock = new StockService(hub, items, batches);
  const purchasing = new PurchasingService(hub, items, batches); const stocktake = new StocktakeService(hub); const imports = new ImportService(hub, items, batches, stock, purchasing); const sales = new SaleService(hub, items, batches); const customers = new CustomerService(hub, sales); const returns = new ReturnService(hub, items, sales); const closing = new ClosingService(hub, sales);
  const reports = new ReportCentre(hub);
  return { hub, access, items, batches, stock, purchasing, stocktake, imports, sales, customers, returns, closing, reports, testMode: !!o.testMode };
}
