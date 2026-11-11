import { Role } from './domain';
import { Screen } from './ui';

export interface Cmd { id: string; label: string; icon: string; key: string; primary?: boolean; screen?: Screen; cmd?: string; roles?: Role[]; stack?: boolean }
export interface Group { label: string; items: Cmd[]; stack?: boolean }
export interface Tab { id: string; label: string; key: string; roles: Role[]; groups: Group[] }

/* physical key -> Arabic letter on the standard Arabic keyboard, so key tips work whichever layout is active */
export const AR: Record<string, string> = { KeyQ: 'ض', KeyW: 'ص', KeyE: 'ث', KeyR: 'ق', KeyT: 'ف', KeyY: 'غ', KeyU: 'ع', KeyI: 'ه', KeyO: 'خ', KeyP: 'ح', KeyA: 'ش', KeyS: 'س', KeyD: 'ي', KeyF: 'ب', KeyG: 'ل', KeyH: 'ا', KeyJ: 'ت', KeyK: 'ن', KeyL: 'م', KeyZ: 'ئ', KeyX: 'ء', KeyC: 'ؤ', KeyV: 'ر', KeyB: 'لا', KeyN: 'ى', KeyM: 'ة' };
const ALL: Role[] = ['owner', 'manager', 'pharmacist', 'cashier'], MGMT: Role[] = ['owner', 'manager'], NOCASH: Role[] = ['owner', 'manager', 'pharmacist'];
const B = (id: string, label: string, icon: string, key: string, o: Partial<Cmd> = {}): Cmd => ({ id, label, icon, key, ...o });

export const TABS: Tab[] = [
  { id: 'home', label: 'الرئيسية', key: 'KeyH', roles: ALL, groups: [
    { label: 'الفاتورة', items: [B('sale', 'فاتورة بيع', 'cart', 'KeyS', { primary: true, screen: 'sale' }), B('hold', 'تعليق الفاتورة', 'pause', 'KeyH', { cmd: 'hold' }), B('last', 'آخر الفواتير', 'history', 'KeyR', { screen: 'invoices' })] },
    { label: 'الأسطر', stack: true, items: [B('addline', 'بحث وإضافة صنف', 'plus', 'KeyA', { cmd: 'focus', screen: 'sale' }), B('delline', 'حذف آخر سطر', 'minus', 'KeyD', { cmd: 'delline', screen: 'sale' }), B('find', 'قائمة الأصناف', 'search', 'KeyF', { screen: 'items' })] },
    { label: 'الصندوق', items: [B('drawer', 'فتح الدرج', 'wallet', 'KeyO', { cmd: 'drawer' }), B('print', 'طباعة الوصل', 'print', 'KeyP', { cmd: 'print' })] },
    { label: 'تنبيهات', items: [B('short', 'كشكول النواقص', 'clip', 'KeyN', { screen: 'short' }), B('exp', 'قرب الانتهاء', 'cal', 'KeyE', { screen: 'soon' })] } ] },
  { id: 'sales', label: 'المبيعات', key: 'KeyS', roles: ALL, groups: [
    { label: 'الفواتير', items: [B('sale2', 'فاتورة بيع', 'cart', 'KeyS', { screen: 'sale' }), B('ret', 'مرتجع بيع', 'undo', 'KeyR', { screen: 'soon' }), B('inv', 'سجل الفواتير', 'file', 'KeyC', { screen: 'invoices' })] },
    { label: 'التوصيل', items: [B('deliv', 'توصيل منزلي', 'truck', 'KeyD', { screen: 'soon' })] },
    { label: 'نهاية اليوم', items: [B('close', 'إغلاق الدرج', 'check', 'KeyL', { roles: MGMT, screen: 'soon' })] } ] },
  { id: 'inv', label: 'المخزون', key: 'KeyI', roles: NOCASH, groups: [
    { label: 'الأصناف', items: [B('items', 'قائمة الأصناف', 'box', 'KeyL', { screen: 'items' }), B('newitem', 'إضافة صنف', 'plus', 'KeyA', { screen: 'items', cmd: 'newitem' }), B('batches', 'الباتشات والصلاحية', 'cal', 'KeyB', { screen: 'soon' })] },
    { label: 'الجرد', items: [B('stocktake', 'جرد', 'clip', 'KeyJ', { screen: 'soon' }), B('adjust', 'تسوية مخزون', 'gear', 'KeyT', { roles: MGMT, screen: 'soon' })] },
    { label: 'المخازن', items: [B('transfer', 'تحويل بين المخازن', 'truck', 'KeyN', { screen: 'soon' }), B('otherbr', 'المتاح في فروع أخرى', 'store', 'KeyO', { screen: 'soon' })] } ] },
  { id: 'buy', label: 'المشتريات', key: 'KeyP', roles: NOCASH, groups: [
    { label: 'الشراء', items: [B('pinv', 'فاتورة مشتريات', 'file', 'KeyP', { primary: true, screen: 'purchase' }), B('po', 'أمر شراء', 'clip', 'KeyO', { screen: 'soon' }), B('pret', 'مرتجع مشتريات', 'undo', 'KeyR', { screen: 'soon' })] },
    { label: 'الموردون', items: [B('sup', 'الموردون', 'users', 'KeyS', { screen: 'soon' }), B('cmp', 'مقارنة الأسعار', 'tag', 'KeyC', { screen: 'soon' })] },
    { label: 'النواقص', items: [B('short2', 'كشكول النواقص', 'clip', 'KeyN', { screen: 'short' })] } ] },
  { id: 'cust', label: 'العملاء', key: 'KeyU', roles: ALL, groups: [
    { label: 'العملاء', items: [B('custs', 'قائمة العملاء', 'users', 'KeyL', { screen: 'customers' }), B('newc', 'عميل جديد', 'plus', 'KeyN', { screen: 'customers', cmd: 'newcust' })] },
    { label: 'الحساب', items: [B('cash', 'توريد نقدية', 'wallet', 'KeyW', { screen: 'receipt' }), B('stmt', 'كشف حساب', 'file', 'KeyK', { screen: 'soon' })] } ] },
  { id: 'acc', label: 'الحسابات', key: 'KeyA', roles: ['owner'], groups: [
    { label: 'اليومية', items: [B('safe', 'الخزينة', 'wallet', 'KeyS', { screen: 'soon' }), B('bank', 'البنوك', 'store', 'KeyB', { screen: 'soon' })] },
    { label: 'العامة', items: [B('fin', 'القوائم المالية', 'chart', 'KeyF', { screen: 'soon' })] } ] },
  { id: 'rep', label: 'التقارير', key: 'KeyR', roles: NOCASH, groups: [
    { label: 'مركز التقارير', items: [B('rc', 'مركز التقارير', 'chart', 'KeyC', { primary: true, screen: 'soon' })] } ] },
  { id: 'adm', label: 'الإدارة', key: 'KeyM', roles: MGMT, groups: [
    { label: 'الأمان', items: [B('del', 'المحذوفات والملغي', 'trash', 'KeyD', { screen: 'del' }), B('usr', 'المستخدمون والصلاحيات', 'users', 'KeyU', { screen: 'soon' })] },
    { label: 'النظام', items: [B('set', 'الإعدادات', 'gear', 'KeyS', { screen: 'soon' })] } ] },
];
export const visTabs = (r: Role) => TABS.filter(t => t.roles.includes(r));
export const visItems = (g: Group, r: Role) => g.items.filter(i => !i.roles || i.roles.includes(r));
