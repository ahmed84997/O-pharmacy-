import { useEffect, useState } from 'react';
import { Icon, useApp } from './ui';

interface Note { screen: string; text: string; prio: 'عالية' | 'متوسطة' | 'منخفضة' }
const KEY = 'op-demo-feedback';
const load = (): Note[] => { try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; } };

export default function Feedback({ screen }: { screen: string }) {
  const { toast } = useApp();
  const [open, setOpen] = useState(false); const [notes, setNotes] = useState<Note[]>(load); const [text, setText] = useState(''); const [prio, setPrio] = useState<Note['prio']>('متوسطة');
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(notes)); } catch { /* storage may be blocked */ } }, [notes]);
  const add = () => { if (!text.trim()) { toast('اكتب الملاحظة'); return; } setNotes(n => [...n, { screen, text: text.trim(), prio }]); setText(''); };
  const md = () => ['| الشاشة | المتوقع / الملاحظة | الاولوية |', '|---|---|---|', ...notes.map(n => `| ${n.screen} | ${n.text.replace(/\|/g, '/').replace(/\n/g, ' ')} | ${n.prio} |`)].join('\n');
  const copy = async () => { try { await navigator.clipboard.writeText(md()); toast('اتنسخت الملاحظات - ابعتهالي في الشات'); } catch { toast('النسخ مش متاح - حدد النص وانسخه بإيدك'); } };
  return (
    <>
      <button className="fb-btn" onClick={() => setOpen(o => !o)} aria-expanded={open}><Icon n="clip" /> ملاحظة{notes.length ? ` (${notes.length})` : ''}</button>
      {open && (
        <div className="fb-panel card" role="dialog" aria-label="ملاحظات التجربة">
          <strong>سجّل ملاحظتك على: {screen}</strong>
          <div className="field" style={{ marginTop: 8 }}><label htmlFor="fbt">ايه اللي متوقعه او مش عاجبك؟</label><textarea id="fbt" className="txt" rows={3} value={text} onChange={e => setText(e.target.value)} /></div>
          <div className="row" style={{ alignItems: 'flex-end', marginBottom: 8 }}>
            <div className="field"><label htmlFor="fbp">الاولوية</label><select id="fbp" value={prio} onChange={e => setPrio(e.target.value as Note['prio'])}><option>عالية</option><option>متوسطة</option><option>منخفضة</option></select></div>
            <span className="actions"><button className="btn" onClick={add}>اضافة</button></span>
          </div>
          {notes.length > 0 && <ol className="fb-list">{notes.map((n, i) => <li key={i}><b>{n.screen}</b> - {n.text} <span className="pill warn">{n.prio}</span> <button className="qbtn" aria-label="شيل" onClick={() => setNotes(x => x.filter((_, k) => k !== i))}><Icon n="x" /></button></li>)}</ol>}
          <div className="actions" style={{ marginInlineStart: 0 }}><button className="btn primary" disabled={!notes.length} onClick={copy}>نسخ الكل</button><button className="btn ghost" onClick={() => setOpen(false)}>اغلاق</button></div>
          <p className="hint" style={{ marginBottom: 0 }}>الملاحظات بتتحفظ في متصفحك بس. انسخها وابعتها في الشات.</p>
        </div>
      )}
    </>
  );
}
