/** The Ribbon (D12): tabs, groups and commands, each command with the permissions that show it. A tab appears when at least one of its commands does. `sprint` marks a screen that arrives in that Phase 7 sprint. */
export interface RibbonCmd { id: string; label: string; icon: string; key: string; perms: string[]; screen: string; primary?: boolean; sprint?: string }
export interface RibbonGroup { label: string; items: RibbonCmd[] }
export interface RibbonTab { id: string; label: string; key: string; groups: RibbonGroup[] }
const C = (id: string, label: string, icon: string, key: string, perms: string[], o: Partial<RibbonCmd> = {}): RibbonCmd => ({ id, label, icon, key, perms, screen: o.screen ?? id, ...o });

export const RIBBON: RibbonTab[] = [
  { id: 'gen', label: 'البيانات العامة', key: 'KeyD', groups: [
    { label: 'المؤسسة', items: [C('org', 'بيانات المؤسسة', 'store', 'KeyB', ['settings.branch'], { primary: true }), C('opsettings', 'إعدادات التشغيل', 'gear', 'KeyT', ['settings.branch', 'settings.security'], { screen: 'settings' })] },
    { label: 'الطباعة', items: [C('rcptset', 'إعدادات طباعة فاتورة البيع', 'print', 'KeyF', ['settings.branch'], { sprint: '7.12' }), C('labelset', 'إعدادات طباعة الباركود', 'barcode', 'KeyL', ['settings.branch'], { sprint: '7.12' }), C('barcodes', 'طباعة باركود', 'barcode', 'KeyP', ['item.view'], { sprint: '7.12' }), C('drawer', 'فتح الدرج', 'wallet', 'KeyJ', ['sale.void']), C('contractpaper', 'إصدار فاتورة ورقية للتعاقد', 'file', 'KeyC', ['contract.view'], { sprint: '7.12' })] },
    { label: 'البيانات', items: [C('backup', 'أخذ نسخة احتياطية', 'shield', 'KeyN', ['settings.security']), C('backupauto', 'نسخ احتياطية دورية', 'clock', 'KeyR', ['settings.security'], { sprint: '7.12' }), C('dbsize', 'حجم قاعدة البيانات', 'chart', 'KeyS', ['settings.security'], { screen: 'backup' })] } ] },
  { id: 'home', label: 'الرئيسية', key: 'KeyH', groups: [
    { label: 'البداية', items: [C('home', 'الصفحة الرئيسية', 'store', 'KeyH', ['item.view', 'user.view', 'report.view', 'staff_tasks.my'], { primary: true }), C('alerts2', 'التنبيهات', 'bell', 'KeyN', ['notification.view'], { screen: 'alerts' })] },
    { label: 'البيع', items: [C('sale', 'فاتورة بيع', 'cart', 'KeyS', ['sale.create']), C('session', 'جلسة الكاشير', 'wallet', 'KeyJ', ['cashier_session.open'])] },
    { label: 'بحث', items: [C('items', 'الأصناف والأرصدة', 'search', 'KeyF', ['item.view'])] } ] },
  { id: 'sales', label: 'المبيعات', key: 'KeyS', groups: [
    { label: 'الفواتير', items: [C('sale2', 'فاتورة بيع', 'cart', 'KeyS', ['sale.create'], { screen: 'sale' }), C('invoices', 'سجل الفواتير', 'history', 'KeyC', ['sale.create', 'sale.view_own', 'sale.view_all']), C('returns', 'مرتجع واستبدال', 'undo', 'KeyR', ['sale.return', 'sale.swap']), C('held', 'الفواتير المعلّقة', 'pause', 'KeyH', ['sale.hold'])] },
    { label: 'التوصيل', items: [C('deliveries', 'توصيل الفواتير', 'truck', 'KeyD', ['home_delivery.create'])] },
    { label: 'نهاية اليوم', items: [C('closing', 'تقفيل الدرج واليوم', 'check', 'KeyL', ['drawer.close.review']), C('eta', 'الفاتورة الإلكترونية', 'file', 'KeyE', ['compliance.eta.view'])] } ] },
  { id: 'inv', label: 'المخزون', key: 'KeyI', groups: [
    { label: 'الأصناف', items: [C('items2', 'الأصناف وكارت الصنف', 'box', 'KeyL', ['item.view'], { screen: 'items', primary: true }), C('expiry', 'الصلاحية والنواقص والتقييم', 'cal', 'KeyB', ['expiry.alerts.view', 'stock.view']), C('catalogs', 'الوحدات والأماكن والمجموعات', 'tag', 'KeyU', ['item.update'])] },
    { label: 'الجرد والمخازن', items: [C('stocktake', 'الجرد والتسويات', 'clip', 'KeyJ', ['stocktake.count', 'stock.adjust', 'stock.adjust.approve']), C('stores', 'المخازن والتحويل', 'truck', 'KeyN', ['store.transfer.internal', 'settings.branch'])] },
    { label: 'الاستيراد', items: [C('import', 'استيراد من eStock', 'file', 'KeyE', ['item.import'])] } ] },
  { id: 'buy', label: 'المشتريات', key: 'KeyP', groups: [
    { label: 'الشراء', items: [C('pinv', 'فاتورة مشتريات', 'file', 'KeyP', ['purchase_invoice.create'], { primary: true }), C('po', 'أوامر الشراء', 'clip', 'KeyO', ['purchase_order.create']), C('pret', 'مرتجع مشتريات', 'undo', 'KeyR', ['purchase_return.create'])] },
    { label: 'الموردون', items: [C('suppliers', 'الموردون', 'users', 'KeyS', ['supplier.view'])] } ] },
  { id: 'cust', label: 'العملاء', key: 'KeyU', groups: [
    { label: 'العملاء', items: [C('customers', 'العملاء والآجل والتحصيل', 'users', 'KeyL', ['customer.view'], { primary: true })] } ] },
  { id: 'ops', label: 'العمليات', key: 'KeyO', groups: [
    { label: 'الطلبات', items: [C('requests', 'طلبات العملاء والنواقص', 'bell', 'KeyN', ['customer_request.create', 'shortage.view'], { primary: true }), C('notify', 'إبلاغ العملاء', 'bell', 'KeyB', ['notification.view']), C('handovers', 'التسليم والتوصيل', 'truck', 'KeyD', ['customer_request.create'])] },
    { label: 'الطلبيات', items: [C('stages', 'مراحل الطلبيات', 'clip', 'KeyS', ['purchase_order.create', 'receiving.verify'])] },
    { label: 'الفريق', items: [C('tasks', 'المهام', 'check', 'KeyT', ['staff_tasks.my', 'staff_tasks.manage']), C('attendance', 'الحضور والإجازات', 'cal', 'KeyA', ['attendance.record_own', 'attendance.approve']), C('alerts', 'التنبيهات', 'bell', 'KeyI', ['notification.view'])] } ] },
  { id: 'acc', label: 'الحسابات', key: 'KeyA', groups: [
    { label: 'الخزن والبنوك', items: [C('ledger', 'دفتر الخزن والبنوك', 'wallet', 'KeyL', ['ledger.view'], { primary: true }), C('cheques', 'الشيكات', 'file', 'KeyC', ['bank_cheque.manage'])] },
    { label: 'العامة', items: [C('books', 'القيود والقوائم المالية', 'chart', 'KeyF', ['statements.view'])] },
    { label: 'التأمين', items: [C('contracts', 'العقود والمطالبات', 'shield', 'KeyI', ['contract.view'])] } ] },
  { id: 'hr', label: 'شئون العاملين', key: 'KeyW', groups: [
    { label: 'المرتبات', items: [C('payroll', 'المرتبات', 'wallet', 'KeyP', ['payroll.view'])] } ] },
  { id: 'rep', label: 'التقارير', key: 'KeyR', groups: [
    { label: 'مركز التقارير', items: [C('reports', 'مركز التقارير', 'chart', 'KeyC', ['report.view'], { primary: true })] } ] },
  { id: 'adm', label: 'الإدارة', key: 'KeyM', groups: [
    { label: 'الأمان', items: [C('people', 'المستخدمون والصلاحيات', 'users', 'KeyU', ['user.view']), C('devices', 'الأجهزة', 'shield', 'KeyD', ['device.approve']), C('deleted', 'المحذوفات والموقوف', 'trash', 'KeyR', ['deleted_items.view'])] },
    { label: 'النظام', items: [C('settings', 'الإعدادات', 'gear', 'KeyS', ['settings.branch', 'settings.security']), C('about', 'عن البرنامج', 'file', 'KeyB', ['user.view', 'licence.view'])] } ] },
];

/** The Ribbon one person sees: only commands whose permissions they hold, and only tabs with something in them. */
export function ribbonFor(perms: Set<string>): RibbonTab[] {
  return RIBBON.map(t => ({ ...t, groups: t.groups.map(g => ({ ...g, items: g.items.filter(c => c.perms.some(p => perms.has(p))) })).filter(g => g.items.length) })).filter(t => t.groups.length);
}
