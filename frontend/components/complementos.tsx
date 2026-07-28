'use client';
import { MoneyInput } from '@/components/money';

export interface GrupoCompl {
  grupo: string;
  min: number;
  max: number;
  opcoes: Array<{ nome: string; preco: number }>;
}

const box = { width: '100%', background: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--cream)', fontFamily: 'inherit', fontSize: '.88rem', padding: '9px 11px' } as const;
const num = { width: 52, background: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 8, color: 'var(--cream)', fontFamily: 'var(--font-mono)', fontSize: '.8rem', padding: '7px', textAlign: 'center' } as const;

/** Editor de complementos (grupos + opções, com min/máx e preço). Substitui os complementos ao publicar. */
export function ComplementosEditor({ grupos, onChange }: { grupos: GrupoCompl[]; onChange: (g: GrupoCompl[]) => void }) {
  const updG = (i: number, patch: Partial<GrupoCompl>) => onChange(grupos.map((g, k) => (k === i ? { ...g, ...patch } : g)));
  const addG = () => onChange([...grupos, { grupo: '', min: 0, max: 1, opcoes: [{ nome: '', preco: 0 }] }]);
  const delG = (i: number) => onChange(grupos.filter((_, k) => k !== i));
  const addO = (i: number) => onChange(grupos.map((g, k) => (k === i ? { ...g, opcoes: [...g.opcoes, { nome: '', preco: 0 }] } : g)));
  const updO = (i: number, j: number, patch: Partial<{ nome: string; preco: number }>) =>
    onChange(grupos.map((g, k) => (k === i ? { ...g, opcoes: g.opcoes.map((o, m) => (m === j ? { ...o, ...patch } : o)) } : g)));
  const delO = (i: number, j: number) => onChange(grupos.map((g, k) => (k === i ? { ...g, opcoes: g.opcoes.filter((_, m) => m !== j) } : g)));

  return (
    <div>
      {grupos.length === 0 && <div className="sub" style={{ margin: '4px 0 0' }}>Nenhum complemento. Adicione um grupo (ex.: "Adicionais").</div>}
      {grupos.map((g, i) => (
        <div key={i} style={{ border: '1px solid var(--line)', borderRadius: 12, background: 'var(--ink2)', padding: 12, marginBottom: 10 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input style={{ ...box, flex: 1, minWidth: 120 }} value={g.grupo} onChange={(e) => updG(i, { grupo: e.target.value })} placeholder="Nome do grupo" />
            <span className="mono" style={{ fontSize: '.55rem', color: 'var(--dim)' }}>mín</span>
            <input style={num} type="number" min={0} value={g.min} onChange={(e) => updG(i, { min: +e.target.value })} />
            <span className="mono" style={{ fontSize: '.55rem', color: 'var(--dim)' }}>máx</span>
            <input style={num} type="number" min={0} value={g.max} onChange={(e) => updG(i, { max: +e.target.value })} />
            <button className="btn ghost mini" onClick={() => delG(i)}>remover</button>
          </div>
          <div style={{ marginTop: 8 }}>
            {g.opcoes.map((o, j) => (
              <div key={j} style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center' }}>
                <input style={{ ...box, flex: 1, padding: '7px 10px' }} value={o.nome} onChange={(e) => updO(i, j, { nome: e.target.value })} placeholder="Opção" />
                <MoneyInput valor={o.preco} onChange={(v) => updO(i, j, { preco: v })} style={{ width: 104, fontSize: '.8rem', padding: '7px 8px 7px 28px' }} ariaLabel="Preço da opção" />
                {g.opcoes.length > 1 && <button className="btn ghost mini" onClick={() => delO(i, j)}>×</button>}
              </div>
            ))}
            <button className="btn ghost mini" style={{ marginTop: 8 }} onClick={() => addO(i)}>+ opção</button>
          </div>
        </div>
      ))}
      <button className="btn ghost mini" onClick={addG}>+ Grupo</button>
    </div>
  );
}
