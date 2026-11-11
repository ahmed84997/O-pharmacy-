import type { Migration } from '@o-pharmacy/hub';
export const HR_MIGRATIONS: Migration[] = [
  { id: 'hr_0001_payroll', sql: `
CREATE TABLE hr_counters (k TEXT PRIMARY KEY, v INTEGER NOT NULL);
CREATE TABLE pay_profiles (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, person_id TEXT NOT NULL, base_salary_minor INTEGER NOT NULL CHECK (base_salary_minor >= 0), hours_per_day REAL NOT NULL CHECK (hours_per_day > 0 AND hours_per_day <= 24), cycle_start_day INTEGER NOT NULL CHECK (cycle_start_day BETWEEN 1 AND 28), effective_from TEXT NOT NULL, set_by TEXT NOT NULL, at TEXT NOT NULL, reason TEXT);
CREATE INDEX pay_profiles_by_person ON pay_profiles(person_id, effective_from);
CREATE TRIGGER pay_profiles_no_update BEFORE UPDATE ON pay_profiles BEGIN SELECT RAISE(ABORT, 'append-only: set a new profile'); END;
CREATE TRIGGER pay_profiles_no_delete BEFORE DELETE ON pay_profiles BEGIN SELECT RAISE(ABORT, 'append-only'); END;
CREATE TABLE pay_adjustments (
  id TEXT PRIMARY KEY, adj_no TEXT NOT NULL UNIQUE, req_key TEXT NOT NULL UNIQUE, person_id TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('bonus','deduction','penalty','advance')), amount_minor INTEGER NOT NULL CHECK (amount_minor > 0), adj_date TEXT NOT NULL, reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','void')), created_by TEXT NOT NULL, created_at TEXT NOT NULL, void_by TEXT, void_at TEXT, void_reason TEXT
);
CREATE INDEX pay_adjustments_by_person ON pay_adjustments(person_id, adj_date);
CREATE TRIGGER pay_adjustments_no_delete BEFORE DELETE ON pay_adjustments BEGIN SELECT RAISE(ABORT, 'adjustments are never deleted: void them'); END;
CREATE TRIGGER pay_adjustments_facts BEFORE UPDATE ON pay_adjustments WHEN NEW.person_id <> OLD.person_id OR NEW.kind <> OLD.kind OR NEW.amount_minor <> OLD.amount_minor OR NEW.adj_date <> OLD.adj_date OR NEW.reason <> OLD.reason BEGIN SELECT RAISE(ABORT, 'an adjustment never changes: void it and add another'); END;
CREATE TRIGGER pay_adjustments_voided BEFORE UPDATE ON pay_adjustments WHEN OLD.status = 'void' BEGIN SELECT RAISE(ABORT, 'a void adjustment cannot change'); END;
CREATE TABLE payroll_runs (id TEXT PRIMARY KEY, run_no TEXT NOT NULL UNIQUE, req_key TEXT NOT NULL UNIQUE, month TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'final' CHECK (status IN ('final','void')), total_net_minor INTEGER NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL, void_by TEXT, void_at TEXT, void_reason TEXT);
CREATE TRIGGER payroll_runs_no_delete BEFORE DELETE ON payroll_runs BEGIN SELECT RAISE(ABORT, 'runs are never deleted: void them'); END;
CREATE TRIGGER payroll_runs_facts BEFORE UPDATE ON payroll_runs WHEN NEW.month <> OLD.month OR NEW.total_net_minor <> OLD.total_net_minor OR OLD.status = 'void' BEGIN SELECT RAISE(ABORT, 'a run never changes except by being voided once'); END;
CREATE TABLE payslips (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES payroll_runs(id), person_id TEXT NOT NULL, period_start TEXT NOT NULL, period_end TEXT NOT NULL, base_minor INTEGER NOT NULL, rate_per_hour_minor INTEGER NOT NULL, worked_minutes INTEGER NOT NULL, late_minutes INTEGER NOT NULL, late_deduction_minor INTEGER NOT NULL,
  overtime_minutes INTEGER NOT NULL, overtime_pay_minor INTEGER NOT NULL, absent_days INTEGER NOT NULL, absence_deduction_minor INTEGER NOT NULL, plus_minor INTEGER NOT NULL, minus_minor INTEGER NOT NULL, net_minor INTEGER NOT NULL, details_json TEXT NOT NULL, UNIQUE (run_id, person_id)
);
CREATE INDEX payslips_by_person ON payslips(person_id, period_start);
CREATE TRIGGER payslips_no_update BEFORE UPDATE ON payslips BEGIN SELECT RAISE(ABORT, 'a payslip never changes: void the run and run again'); END;
CREATE TRIGGER payslips_no_delete BEFORE DELETE ON payslips BEGIN SELECT RAISE(ABORT, 'payslips are never deleted'); END;
CREATE TABLE payslip_payments (payslip_id TEXT PRIMARY KEY REFERENCES payslips(id), method TEXT NOT NULL CHECK (method IN ('cash','bank','wallet')), note TEXT, paid_by TEXT NOT NULL, paid_at TEXT NOT NULL);
CREATE TRIGGER payslip_payments_no_update BEFORE UPDATE ON payslip_payments BEGIN SELECT RAISE(ABORT, 'append-only'); END;
CREATE TRIGGER payslip_payments_no_delete BEFORE DELETE ON payslip_payments BEGIN SELECT RAISE(ABORT, 'append-only'); END;` },
];
