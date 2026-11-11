# @o-pharmacy/hr (Phase 6, Sprint 6.3)

Pay profiles, adjustments and payroll, built on the attendance days of `@o-pharmacy/ops` (it reads `attendance_days` by SQL, so the ops migration `ops_0004_attendance` must be in the same Hub). Admin-level only: nothing here is open to managers, pharmacists or cashiers. Migration `hr_0001_payroll`.

- **Pay profile** (`setProfile`, `payroll.run`; read with `salary.view`): salary, shift hours per day, a cycle start day per person (1 to 28), effective from a date. Append-only: a raise is a new profile.
- **Hour rate** (from YK): salary / (30 days x shift hours). Late deduction = late minutes x rate. Overtime pay = APPROVED overtime minutes x rate x multiplier. Absence deduction = salary / 30 per absent day; an approved leave is not deducted. Days, late multiplier and overtime multiplier are injected (`PayrollRules`); the overtime multiplier starts at 1 until the owner decides the real one.
- **Adjustments** (`addAdjustment`, `voidAdjustment`): bonus, deduction, penalty, advance; reason required, never deleted (void with a reason); not allowed on a date already inside a final run.
- **Run** (`preview`, `run`, `voidRun`): one immutable payslip per person per cycle; the month must be over; a person already in a final run for that cycle is skipped; a wrong run is voided with a reason (not after a payslip was paid) and run again. A net below zero is saved as zero with the shortfall noted.
- **Paying** (`markPaid`, `unpaid`): recorded once with the method (cash, bank, wallet). Posting the payroll into the books is a later wiring step: a `payroll.run` event carries the totals.
- No new permission: `payroll.run`, `payroll.view`, `salary.view`.
