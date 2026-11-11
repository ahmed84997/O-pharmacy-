import type { Hub } from '@o-pharmacy/hub';
export type ColType = 'text' | 'money' | 'int' | 'date' | 'percent';
export interface Col { key: string; label: string; type: ColType }
export type Row = Record<string, string | number | null>;
export type ParamType = 'date' | 'int' | 'text' | 'month';
export interface ParamDef { name: string; label: string; type: ParamType; required?: boolean; default?: string | number; min?: number; max?: number }
export interface ReportContext { db: Hub['db']; now: string; today: string; localDate(iso: string): string; has(table: string): boolean }
export interface ReportResult { columns: Col[]; rows: Row[]; totals?: Row }
export interface ReportDef { key: string; title: string; category: 'sales' | 'stock' | 'purchasing' | 'customers' | 'money' | 'operations' | 'hr' | 'insurance'; needs: string[]; permissions: string[]; params: ParamDef[]; run(ctx: ReportContext, p: Record<string, string | number>): ReportResult }
