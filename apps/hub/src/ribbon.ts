/** The Ribbon (D12): tabs, groups and commands, each command with the permissions that show it. A tab appears when at least one of its commands does. `sprint` marks a screen that arrives in that Phase 7 sprint. */
export interface RibbonCmd { id: string; label: string; icon: string; key: string; perms: string[]; screen: string; primary?: boolean; sprint?: string }
export interface RibbonGroup { label: string; items: RibbonCmd[] }
export interface RibbonTab { id: string; label: string; key: string; groups: RibbonGroup[] }
const C = (id: string, label: string, icon: string, key: string, perms: string[], o: Partial<RibbonCmd> = {}): RibbonCmd => ({ id, label, icon, key, perms, screen: o.screen ?? id, ...o });

export const RIBBON: RibbonTab[] = [
  { id: 'home', label: 'الرئيسية', key: 'KeyH', groups: [
    { label: 'البداية', items: [C('home', 'الصفحة الرئيسية', 'store', 'KeyH', ['item.view', 'user.view', 'report.view', 'staff_tasks.my'], { primary: true })] },
    { label: 'البيع', items: [C('sale', 'فاتورة بيع', 'cart', 'KeyS', ['sale.create'], { sprint: '7.2' }), C('session', 'جلسة الكاشير', 'wallet', 'KeyJ', ['cashier_session.open'], { sprint: '7.2' })] },
    { label: 'بحث', items: [C('items', 'الأصناف والأرصدة', 'search', 'KeyF', ['item.view'])] } ] },
  { id: 'sales', label: 'المبيعات', key: 'KeyS', groups: [
    { label: 'الفواتير', items: [C('sale2', 'فاتورة بيع', 'cart', 'KeyS', ['sale.create'], { screen: 'sale', sprint: '7.2' }), C('returns', 'مرتجع واستبدال', 'undo', 'KeyR', ['sale.return', 'sale.swap'], { sprint: '7.2' }), C('held', 'الفواتير المعلّقة', 'pause', 'KeyH', ['sale.hold'], { sprint: '7.2' })] },
    { label: 'نهاية اليوم', items: [C('closing', 'تقفيل الدرج واليوم', 'check', 'KeyL', ['cashier_session.close', 'drawer.close.review'], { sprint: '7.2' })] } ] },
  { id: 'inv', label: 'المخزون', key: 'KeyI', groups: [
    { label: 'الأصناف', items: [C('items2', 'الأصناف والأرصدة', 'box', 'KeyL', ['item.view'], { screen: 'items' }), C('itemcard', 'كارت الصنف والتشغيلات', 'cal', 'KeyB', ['stock.view'], { sprint: '7.3' })] },
    { label: 'الجرد والمخازن', items: [C('stocktake', 'الجرد والتسويات', 'clip', 'KeyJ', ['stocktake.count', 'stock.adjust'], { sprint: '7.3' }), C('transfer', 'التحويل بين المخازن', 'truck', 'KeyN', ['store.transfer.internal'], { sprint: '7.3' })] },
    { label: 'الاستيراد', items: [C('import', 'استيراد من eStock', 'file', 'KeyE', ['item.import'], { sprint: '7.3' })] } ] },
  { id: 'buy', label: 'المشتريات', key: 'KeyP', groups: [
    { label: 'الشراء', items: [C('pinv', 'فاتورة مشتريات', 'file', 'KeyP', ['purchase_invoice.create'], { primary: true, sprint: '7.3' }), C('po', 'أوامر الشراء', 'clip', 'KeyO', ['purchase_order.create'], { sprint: '7.3' }), C('pret', 'مرتجع مشتريات', 'undo', 'KeyR', ['purchase_return.create'], { sprint: '7.3' })] },
    { label: 'الموردون', items: [C('suppliers', 'الموردون', 'users', 'KeyS', ['supplier.view'], { sprint: '7.3' })] } ] },
  { id: 'cust', label: 'العملاء', key: 'KeyU', groups: [
    { label: 'العملاء', items: [C('customers', 'العملاء والآجل', 'users', 'KeyL', ['customer.view'], { sprint: '7.4' })] } ] },
  { id: 'ops', label: 'العمليات', key: 'KeyO', groups: [
    { label: 'الطلبات', items: [C('requests', 'طلبات العملاء والنواقص', 'bell', 'KeyN', ['customer_request.create', 'shortage.view'], { sprint: '7.4' }), C('delivery', 'التوصيل', 'truck', 'KeyD', ['home_delivery.create', 'home_delivery.deliver'], { sprint: '7.4' })] },
    { label: 'الفريق', items: [C('tasks', 'المهام', 'check', 'KeyT', ['staff_tasks.my', 'staff_tasks.manage'], { sprint: '7.4' }), C('attendance', 'الحضور', 'cal', 'KeyA', ['attendance.record_own', 'attendance.approve'], { sprint: '7.4' })] } ] },
  { id: 'acc', label: 'الحسابات', key: 'KeyA', groups: [
    { label: 'الخزن والبنوك', items: [C('ledger', 'دفتر الخزن والبنوك', 'wallet', 'KeyL', ['ledger.view'], { sprint: '7.5' }), C('cheques', 'الشيكات', 'file', 'KeyC', ['bank_cheque.manage'], { sprint: '7.5' })] },
    { label: 'العامة', items: [C('books', 'القيود والقوائم المالية', 'chart', 'KeyF', ['statements.view'], { sprint: '7.5' })] },
    { label: 'التأمين', items: [C('contracts', 'العقود والمطالبات', 'shield', 'KeyI', ['contract.view'], { sprint: '7.5' })] } ] },
  { id: 'hr', label: 'شئون العاملين', key: 'KeyW', groups: [
    { label: 'المرتبات', items: [C('payroll', 'المرتبات', 'wallet', 'KeyP', ['payroll.view'], { sprint: '7.5' })] } ] },
  { id: 'rep', label: 'التقارير', key: 'KeyR', groups: [
    { label: 'مركز التقارير', items: [C('reports', 'مركز التقارير', 'chart', 'KeyC', ['report.view'], { primary: true, sprint: '7.5' })] } ] },
  { id: 'adm', label: 'الإدارة', key: 'KeyM', groups: [
    { label: 'الأمان', items: [C('people', 'المستخدمون والصلاحيات', 'users', 'KeyU', ['user.view']), C('devices', 'الأجهزة', 'shield', 'KeyD', ['device.approve'])] },
    { label: 'النظام', items: [C('settings', 'الإعدادات', 'gear', 'KeyS', ['settings.branch', 'settings.security']), C('about', 'عن البرنامج', 'file', 'KeyB', ['user.view', 'licence.view'])] } ] },
];

/** The Ribbon one person sees: only commands whose permissions they hold, and only tabs with something in them. */
export function ribbonFor(perms: Set<string>): RibbonTab[] {
  return RIBBON.map(t => ({ ...t, groups: t.groups.map(g => ({ ...g, items: g.items.filter(c => c.perms.some(p => perms.has(p))) })).filter(g => g.items.length) })).filter(t => t.groups.length);
}
