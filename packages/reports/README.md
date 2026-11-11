# @o-pharmacy/reports - report centre (Sprint 6.5)

One place for every report, replacing the many separate eStock report screens. Read-only SQL over the other packages' tables, plus saved views and an audit log. Migration `rep_0001_views_runs`.

- **`ReportCentre(hub, defs = BUILTIN_REPORTS, rules)`**: `catalogue(actor)`, `run`, `export`, `saveView`, `views`, `runView`, `archiveView`, `history`.
- **Built-in reports (13)**: `sales_by_day`, `sales_by_item`, `stock_valuation`, `expiring_batches`, `customer_balances`, `purchases_by_supplier`, `account_balances`, `cheques_due`, `shortages_open`, `requests_by_status`, `attendance_summary`, `payroll_summary`, `claims_outstanding`.
- **Permissions**: a report needs all of its listed permissions (`report.view`, `report.view_financial`; pay also `payroll.view` + `salary.view`) and its tables must exist, so an install without a module simply does not offer its reports. Export needs `report.export`. No new permission.
- **Filters**: typed (`date`, `month`, `int`, `text`), validated, with defaults (`@today`, `@month_start`, `@last_month`). Days are Cairo days (rule `timeZone`).
- **CSV**: UTF-8 BOM (Excel reads Arabic), money as decimals, cells starting with `= + - @` are prefixed so a spreadsheet never runs them; refuses over `maxRows` rows.
- **Saved views**: private; a lead (`report.export`) may share one; archived, never deleted. Every run and export is written to `report_runs` (append-only).
- Adding a report = adding a `ReportDef` (key, tables needed, permissions, params, `run`).
