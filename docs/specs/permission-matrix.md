# Permission Matrix - v0.1 PROPOSAL

10 Nov 2026. Phase 0, Sprint 0.1. Implements decision D23 (role templates, several roles per person, permissions adjustable per person). Status: **proposal for owner review**; nothing here is a locked catalogue. The YK catalogue (locked at 93 for YK) is the starting point, not a limit: O-Pharmacy has its own catalogue, which the owner approves at the end of Phase 0.

## 1. How to read it
- **Scope:** Owner = all branches. Every other role = its own branch only (D15). Customer (app/website) and platform roles (Super Admin, Support) are in section 5.
- **●** on by default in the role template. **○** available, off by default (granted per person). **blank** not available to that role template (an Admin can still grant it to a person).
- **Union rule:** a person's rights = union of the roles he holds. A small pharmacy owner who is Admin + Manager + Pharmacist + Cashier simply has all four.
- **Roles:** Own Owner - BrA Branch Admin - BrM Branch Manager - Pha Pharmacist - Csh Cashier - Stk Storekeeper - Emp Employee - Acc Accountant - Dlv Delivery agent.
- Permission names are working names (`module.action`); final keys are set in Phase 2.

## 2. Matrix
### Foundation (users, security, settings)
| Permission | Own | BrA | BrM | Pha | Csh | Stk | Emp | Acc | Dlv |
|---|---|---|---|---|---|---|---|---|---|
| user.view | ● | ● | ● | | | | | | |
| user.create / update / deactivate | ● | ● | ○ | | | | | | |
| role.assign (templates and per-person grants) | ● | ● | | | | | | | |
| role.manage (edit templates) | ● | ○ | | | | | | | |
| device.register / approve / revoke (incl. POS activation) | ● | ● | ○ | | | | | | |
| session.view / revoke any | ● | ● | ● | | | | | | |
| settings.security | ● | ● | | | | | | | |
| settings.business_rules (config engine) | ● | ● | ○ | | | | | | |
| settings.branch (hours, stores, printers) | ● | ● | ● | | | | | | |
| branch.create / switch | ● | | | | | | | | |
| audit.view | ● | ● | ● | | | | | ○ | |
| audit.export | ● | ● | | | | | | ○ | |
| deleted_items.view (D13 «المحذوفات») | ● | ● | ● | | | | | ○ | |
| deleted_items.restore | ● | ● | ○ | | | | | | |
| licence / edition view | ● | ● | | | | | | | |

### Master data
| Permission | Own | BrA | BrM | Pha | Csh | Stk | Emp | Acc | Dlv |
|---|---|---|---|---|---|---|---|---|---|
| item.view | ● | ● | ● | ● | ● | ● | ● | ● | |
| item.create / update | ● | ● | ● | ● | | ● | | | |
| item.price.set (non-drug free price, D20) | ● | ● | ● | ○ | | | | | |
| item.barcode_alias.manage | ● | ● | ● | ● | | ● | | | |
| item.suspend / archive | ● | ● | ● | ○ | | | | | |
| item.import / merge | ● | ● | ○ | | | | | | |
| supplier.view | ● | ● | ● | ● | | ● | | ● | |
| supplier.create / update | ● | ● | ● | | | ○ | | ○ | |
| customer.view | ● | ● | ● | ● | ● | | ● | ● | ○ |
| customer.create / update | ● | ● | ● | ● | ● | | ○ | | |
| customer.credit_limit.set | ● | ● | ● | | | | | ○ | |
| customer.merge | ● | ● | ○ | | | | | | |
| contract.view | ● | ● | ● | ● | ● | | | ● | |
| contract.manage | ● | ● | ● | | | | | ○ | |

### Inventory
| Permission | Own | BrA | BrM | Pha | Csh | Stk | Emp | Acc | Dlv |
|---|---|---|---|---|---|---|---|---|---|
| stock.view (quantities) | ● | ● | ● | ● | ● | ● | ● | ● | |
| stock.cost.view (cost, profit, margin) | ● | ● | ● | | | | | ● | |
| stock.batch.view (expiry, per-batch prices) | ● | ● | ● | ● | ○ | ● | ○ | ● | |
| stock.adjust (damage, loss, found) with reason | ● | ● | ● | | | ● | | | |
| stock.adjust.approve (above limit) | ● | ● | ● | | | | | | |
| stock.cost_adjust | ● | ● | ○ | | | | | ○ | |
| store.transfer.internal | ● | ● | ● | | | ● | | | |
| stocktake.count | ● | ● | ● | ● | | ● | ○ | | |
| stocktake.approve / apply | ● | ● | ● | | | | | | |
| expiry.alerts.view | ● | ● | ● | ● | | ● | ● | | |
| other_branches.quantities.view (D18, quantities only) | ● | ● | ● | ● | ● | ● | ● | | |

### Purchasing
| Permission | Own | BrA | BrM | Pha | Csh | Stk | Emp | Acc | Dlv |
|---|---|---|---|---|---|---|---|---|---|
| shortage.record / view | ● | ● | ● | ● | ● | ● | ● | | |
| shortage.convert_to_po | ● | ● | ● | ● | | | | | |
| purchase_order.create / update | ● | ● | ● | ● | | ○ | | | |
| purchase_order.cancel | ● | ● | ● | | | | | | |
| purchase_invoice.create (receive + prices) | ● | ● | ● | ● | | ● | | | |
| purchase_invoice.void (before period close) | ● | ● | ● | | | | | ○ | |
| purchase_return.create | ● | ● | ● | ● | | ● | | | |
| supplier_price.view / compare | ● | ● | ● | ● | | ○ | | ● | |
| receiving.verify (storekeeper check) | ● | ● | ● | | | ● | | | |

### Sales / POS
| Permission | Own | BrA | BrM | Pha | Csh | Stk | Emp | Acc | Dlv |
|---|---|---|---|---|---|---|---|---|---|
| sale.create (cash, card) | ● | ● | ● | ● | ● | | ○ | | |
| sale.credit.create (on account) | ● | ● | ● | ● | ○ | | | | |
| sale.hold / resume | ● | ● | ● | ● | ● | | ○ | | |
| sale.discount (up to configured limit) | ● | ● | ● | ● | ○ | | | | |
| sale.discount.override (above limit) | ● | ● | ● | ○ | | | | | |
| sale.price_override | ● | ● | ○ | | | | | | |
| sale.line.delete (before save) | ● | ● | ● | ● | ● | | ○ | | |
| sale.void (after save, with reason; shown in «المحذوفات») | ● | ● | ● | ○ | | | | | |
| sale.return / swap | ● | ● | ● | ● | ○ | | | | |
| sale.view_own / view_all | ● | ● | ● | ● | ○ | | | ● | |
| cashier_session.open / close own | ● | ● | ● | ● | ● | | | | |
| drawer.close.review (differences) | ● | ● | ● | | | | | ● | |
| home_delivery.create / assign | ● | ● | ● | ● | ● | | | | |
| home_delivery.deliver (own orders) | | | | | | | | | ● |
| insurance_claim.submit / reconcile | ● | ● | ● | ○ | | | | ● | |

### Accounts and finance (Admin-controlled)
| Permission | Own | BrA | BrM | Pha | Csh | Stk | Emp | Acc | Dlv |
|---|---|---|---|---|---|---|---|---|---|
| cash.in_out (receipts/payments) | ● | ● | ● | | ○ | | | ● | |
| bank / cheque.manage | ● | ● | ○ | | | | | ● | |
| ledger.view (chart, journal) | ● | ● | | | | | | ● | |
| ledger.post / period.close | ● | ● | | | | | | ○ | |
| statements.view (income, financial position) | ● | ● | | | | | | ● | |
| capital / profit_distribution | ● | | | | | | | | |
| payroll.view / run | ● | ● | | | | | | ○ | |
| salary.view (any person) | ● | ● | | | | | | | |

### Operations and staff
| Permission | Own | BrA | BrM | Pha | Csh | Stk | Emp | Acc | Dlv |
|---|---|---|---|---|---|---|---|---|---|
| customer_request.create / update | ● | ● | ● | ● | ● | | ● | | |
| customer_request.cancel | ● | ● | ● | ● | | | | | |
| notification.view / send | ● | ● | ● | ● | ● | ● | ● | | ● |
| staff_tasks.manage (assign) | ● | ● | ● | | | | | | |
| staff_tasks.my (my tasks) | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| attendance.record_own | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| attendance.approve / leave.approve | ● | ● | ● | | | | | | |
| deductions / incentives / advances.manage | ● | ● | ○ | | | | | | |
| performance.view_own | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| performance.view_team | ● | ● | ● | | | | | | |
| ai.assistant.use | ● | ● | ● | ● | | | ○ | | |
| conversation (WhatsApp) view / reply | ● | ● | ● | ● | ○ | | ○ | | |

### Chain (Chain edition only)
| Permission | Own | BrA | BrM | Pha | Csh | Stk | Emp | Acc | Dlv |
|---|---|---|---|---|---|---|---|---|---|
| transfer.request (from another branch, D19) | ● | ● | ● | ● | | ● | ○ | | |
| transfer.accept / dispatch (holding branch) | ● | ● | ● | | | ● | ○ | | |
| transfer.receive | ● | ● | ● | | | ● | ○ | | |
| transfer.cost_mode.set (D22) | ● | | | | | | | ○ | |
| central_purchase.manage | ● | | | | | | | ○ | |
| consolidated_reports.view | ● | | | | | | | ○ | |
| central_warehouse.manage (D17) | ● | | | | | ● | | | |

### Reports, compliance, integrations
| Permission | Own | BrA | BrM | Pha | Csh | Stk | Emp | Acc | Dlv |
|---|---|---|---|---|---|---|---|---|---|
| report.view (operational, no cost) | ● | ● | ● | ● | | ● | | ● | |
| report.view_financial (cost, profit) | ● | ● | ● | | | | | ● | |
| report.export | ● | ● | ● | | | | | ● | |
| dashboard.executive | ● | ● | | | | | | ○ | |
| dashboard.operational | ● | ● | ● | ● | | ● | ● | | |
| compliance.eta.view / retry / late_submit | ● | ● | ● | | | | | ● | |
| compliance.eda.view / report | ● | ● | ● | ● | | ○ | | | |
| controlled_drug.register.manage | ● | ● | ● | ● | | | | | |
| recall.manage (by batch) | ● | ● | ● | ● | | ● | | | |
| integrations.manage (WhatsApp, payments) | ● | ● | | | | | | | |

## 3. Rules that sit above the matrix
1. **Cost and profit are hidden by default** from Cashier, Employee and Pharmacist (eStock shows them on the cashier screen; we do not). Showing them is an explicit grant.
2. **Finance and salaries are Admin/Owner only** unless granted (Accountant sees finance, never salaries by default).
3. **No-Delete (D13):** there is no "delete" permission anywhere. Void, cancel and archive require a reason, record who/when/why, are hidden from staff screens and visible in the management deleted-items view. Restore is separate from view.
4. **Separation of duties (config, default on):** the person who creates a void, a stock adjustment or a discount override cannot be the one who approves it; in a one-person pharmacy the rule is relaxed automatically and the action is flagged in the audit trail.
5. **Limits are configuration, not code:** discount limit per role, adjustment approval threshold, credit limit defaults.
6. **After day close:** voiding or changing a closed day needs `period.reopen` (Admin/Owner) and is always audited.
7. **Cross-branch (D18):** other branches' data is quantities only; no cost, price history, customers' sales or staff data crosses a branch boundary except to the Owner.
8. **Delivery agent** sees only the orders assigned to him, with the customer address and amount to collect.

## 4. Carry-over from YK and eStock
| Source | Carried as |
|---|---|
| YK catalogue families (customer, customer_request, shortage, purchase_order, receiving, verification, closings, device, role/user, settings.*, conversation, whatsapp_order, notification, performance, report, audit, dashboard) | Same families and semantics; renamed where the domain changed (verification becomes `receiving.verify`) |
| eStock menus (12 menus, 156 entries) | Each entry maps to one permission family above or to a report in the report centre; report visibility is `report.view` + the data's own gate (cost, finance) |
| New in O-Pharmacy | stock/batch/price, sale void/return/discount, cashier session and drawer, ledger and period, transfers (chain), compliance (ETA, EDA, controlled drugs, recall), AI use |

Size: 101 rows above; several rows group two or three actions (for example create / update), so the final key count is set in Phase 2 and reconciled then against the YK 93 (many YK keys map one-to-one).

## 5. Roles outside the branch
- **Customer (app/website):** own profile, own orders and requests, own prescriptions, notifications. No staff data, no stock beyond "available/not available".
- **Super Admin (platform):** tenant onboarding, licences, global updates; **no access to tenant business data** by default; any support access is time-boxed, tenant-approved and audited (D25).
- **Support:** read-only diagnostics on a tenant after the tenant grants a time-boxed session.

## 6. Decisions needed from the owner
1. Approve the default of hiding cost/profit from Pharmacist (a pharmacist who also buys needs the grant).
2. Approve separation of duties as default-on with the one-person relaxation.
3. Should the Cashier be allowed discounts by default up to a small configured limit (proposed: yes, limit set per pharmacy), or none?
