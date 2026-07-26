'use client';
import type { Shift } from '@/lib/api';

const DIAS = [
  ['seg', 'S'],
  ['ter', 'T'],
  ['qua', 'Q'],
  ['qui', 'Q'],
  ['sex', 'S'],
  ['sab', 'S'],
  ['dom', 'D'],
] as const;

/** Editor de disponibilidade (shifts): janelas de horário + dias da semana. */
export function ShiftsEditor({ shifts, onChange }: { shifts: Shift[]; onChange: (s: Shift[]) => void }) {
  const box = { background: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 9, color: 'var(--cream)', fontFamily: 'var(--font-mono)', fontSize: '.85rem', padding: '8px 10px' } as const;

  function upd(i: number, patch: Partial<Shift>) {
    onChange(shifts.map((s, k) => (k === i ? { ...s, ...patch } : s)));
  }
  function toggleDia(i: number, dia: string) {
    const s = shifts[i];
    upd(i, { dias: s.dias.includes(dia) ? s.dias.filter((d) => d !== dia) : [...s.dias, dia] });
  }

  return (
    <div>
      {shifts.length === 0 && <div className="sub" style={{ margin: '4px 0 0' }}>Sempre disponível. Adicione uma janela para restringir por horário/dia.</div>}
      {shifts.map((s, i) => (
        <div key={i} style={{ border: '1px solid var(--line)', borderRadius: 12, background: 'var(--ink2)', padding: 12, marginTop: 10 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="mono" style={{ fontSize: '.58rem', color: 'var(--dim)' }}>das</span>
            <input type="time" style={box} value={s.inicio} onChange={(e) => upd(i, { inicio: e.target.value })} />
            <span className="mono" style={{ fontSize: '.58rem', color: 'var(--dim)' }}>às</span>
            <input type="time" style={box} value={s.fim} onChange={(e) => upd(i, { fim: e.target.value })} />
            <button className="btn ghost mini" style={{ marginLeft: 'auto' }} onClick={() => onChange(shifts.filter((_, k) => k !== i))}>
              remover
            </button>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
            {DIAS.map(([id, ini]) => {
              const on = s.dias.includes(id);
              return (
                <button
                  key={id}
                  onClick={() => toggleDia(i, id)}
                  title={id}
                  style={{ width: 34, height: 34, borderRadius: 9, border: '1px solid var(--line)', cursor: 'pointer', fontWeight: 700, fontSize: '.8rem', background: on ? 'var(--heat)' : 'var(--ink3)', color: on ? 'var(--ink)' : 'var(--dim)' }}
                >
                  {ini}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <button className="btn ghost mini" style={{ marginTop: 10 }} onClick={() => onChange([...shifts, { inicio: '11:00', fim: '15:00', dias: ['seg', 'ter', 'qua', 'qui', 'sex'] }])}>
        + Janela de horário
      </button>
    </div>
  );
}
