'use client';
import { useEffect, useState } from 'react';
import { MoneyInput, brl } from '@/components/money';
import { ImagemMini } from '@/components/image-upload';
import { api } from '@/lib/api';

export interface OpcaoCompl {
  nome: string;
  preco: number;
  pdv: string;
  imagem?: string | null; // data-URI (nova) ou URL (atual); a imagem é redimensionada no cliente
}
export interface GrupoCompl {
  grupo: string;
  min: number;
  max: number;
  refId?: string; // set = REUSA um grupo existente (compartilhado entre itens); opções só de leitura
  opcoes: OpcaoCompl[];
}

const box = { width: '100%', background: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--cream)', fontFamily: 'inherit', fontSize: '.88rem', padding: '9px 11px' } as const;
const num = { width: 52, background: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 8, color: 'var(--cream)', fontFamily: 'var(--font-mono)', fontSize: '.8rem', padding: '7px', textAlign: 'center' } as const;

/**
 * Editor de complementos (grupos + opções, com min/máx, preço e imagem por opção).
 * Substitui os complementos ao publicar. `bloquearGrupos` esconde adicionar/copiar
 * grupo (usado ao editar UM grupo isolado, na tela Complementos).
 */
export function ComplementosEditor({ grupos, onChange, bloquearGrupos }: { grupos: GrupoCompl[]; onChange: (g: GrupoCompl[]) => void; bloquearGrupos?: boolean }) {
  const [existentes, setExistentes] = useState<Array<{ id: string; nome: string; min: number; max: number; opcoes: Array<{ nome: string; preco: number; pdv: string; imagem: string }> }>>([]);
  useEffect(() => {
    if (bloquearGrupos) return;
    api.complementos().then((r) => setExistentes(r.grupos)).catch(() => {});
  }, [bloquearGrupos]);

  const updG = (i: number, patch: Partial<GrupoCompl>) => onChange(grupos.map((g, k) => (k === i ? { ...g, ...patch } : g)));
  const addG = () => onChange([...grupos, { grupo: '', min: 0, max: 1, opcoes: [{ nome: '', preco: 0, pdv: '' }] }]);
  const delG = (i: number) => onChange(grupos.filter((_, k) => k !== i));
  const addO = (i: number) => onChange(grupos.map((g, k) => (k === i ? { ...g, opcoes: [...g.opcoes, { nome: '', preco: 0, pdv: '' }] } : g)));
  const updO = (i: number, j: number, patch: Partial<OpcaoCompl>) =>
    onChange(grupos.map((g, k) => (k === i ? { ...g, opcoes: g.opcoes.map((o, m) => (m === j ? { ...o, ...patch } : o)) } : g)));
  const delO = (i: number, j: number) => onChange(grupos.map((g, k) => (k === i ? { ...g, opcoes: g.opcoes.filter((_, m) => m !== j) } : g)));

  // REUSA um grupo já existente (mesmo grupo compartilhado entre itens) — entra como
  // referência (refId); as opções ficam só de leitura (edita-se na tela Complementos).
  const reusar = (id: string) => {
    const g = existentes.find((x) => x.id === id);
    if (!g) return;
    onChange([...grupos, { grupo: g.nome, min: g.min, max: g.max, refId: g.id, opcoes: g.opcoes.map((o) => ({ nome: o.nome, preco: o.preco, pdv: o.pdv, imagem: o.imagem || null })) }]);
  };

  return (
    <div>
      {grupos.length === 0 && <div className="sub" style={{ margin: '4px 0 0' }}>Nenhum complemento. Adicione um grupo (ex.: "Adicionais") ou copie um já existente.</div>}
      {grupos.map((g, i) =>
        g.refId ? (
          // grupo REUSADO (compartilhado): só de leitura, com mín/máx por item
          <div key={i} style={{ border: '1px solid var(--tanger)', borderRadius: 12, background: 'var(--ink2)', padding: 12, marginBottom: 10 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700 }}>{g.grupo}</span>
              <span className="mono" style={{ fontSize: '.5rem', color: 'var(--tanger)', border: '1px solid var(--tanger)', borderRadius: 999, padding: '2px 8px', textTransform: 'uppercase', letterSpacing: '.08em' }}>grupo compartilhado</span>
              <span className="mono" style={{ fontSize: '.55rem', color: 'var(--dim)', marginLeft: 'auto' }}>mín</span>
              <input style={num} type="number" min={0} value={g.min} onChange={(e) => updG(i, { min: +e.target.value })} />
              <span className="mono" style={{ fontSize: '.55rem', color: 'var(--dim)' }}>máx</span>
              <input style={num} type="number" min={0} value={g.max} onChange={(e) => updG(i, { max: +e.target.value })} />
              <button className="btn ghost mini" onClick={() => delG(i)}>remover</button>
            </div>
            <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {g.opcoes.map((o, j) => (
                <span key={j} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 999, padding: '3px 9px 3px 4px', fontSize: '.78rem' }}>
                  {o.imagem ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={o.imagem} alt="" style={{ width: 18, height: 18, borderRadius: 999, objectFit: 'cover' }} />
                  ) : (
                    <span style={{ width: 18, height: 18, borderRadius: 999, background: 'var(--ink2)' }} />
                  )}
                  {o.nome}
                  {o.preco > 0 && <span className="mono" style={{ color: 'var(--dim)', fontSize: '.6rem' }}>+{brl(o.preco)}</span>}
                </span>
              ))}
            </div>
            <div className="sub" style={{ marginTop: 8, fontSize: '.66rem' }}>Reutiliza o mesmo grupo (compartilhado entre itens). Para editar as opções, use a tela Complementos.</div>
          </div>
        ) : (
          <div key={i} style={{ border: '1px solid var(--line)', borderRadius: 12, background: 'var(--ink2)', padding: 12, marginBottom: 10 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input style={{ ...box, flex: 1, minWidth: 120 }} value={g.grupo} onChange={(e) => updG(i, { grupo: e.target.value })} placeholder="Nome do grupo" />
              <span className="mono" style={{ fontSize: '.55rem', color: 'var(--dim)' }}>mín</span>
              <input style={num} type="number" min={0} value={g.min} onChange={(e) => updG(i, { min: +e.target.value })} />
              <span className="mono" style={{ fontSize: '.55rem', color: 'var(--dim)' }}>máx</span>
              <input style={num} type="number" min={0} value={g.max} onChange={(e) => updG(i, { max: +e.target.value })} />
              {!bloquearGrupos && <button className="btn ghost mini" onClick={() => delG(i)}>remover</button>}
            </div>
            <div style={{ marginTop: 8 }}>
              {g.opcoes.map((o, j) => (
                <div key={j} style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <ImagemMini value={o.imagem ?? null} onPick={(uri) => updO(i, j, { imagem: uri })} />
                  <input style={{ ...box, flex: 1, minWidth: 110, padding: '7px 10px' }} value={o.nome} onChange={(e) => updO(i, j, { nome: e.target.value })} placeholder="Opção" />
                  <input style={{ ...box, width: 92, padding: '7px 8px', fontFamily: 'var(--font-mono)', fontSize: '.72rem' }} value={o.pdv} onChange={(e) => updO(i, j, { pdv: e.target.value })} placeholder="PDV" title="Código PDV da opção (opcional)" />
                  <MoneyInput valor={o.preco} onChange={(v) => updO(i, j, { preco: v })} style={{ width: 96, fontSize: '.8rem', padding: '7px 8px 7px 28px' }} ariaLabel="Preço da opção" />
                  {g.opcoes.length > 1 && <button className="btn ghost mini" onClick={() => delO(i, j)}>×</button>}
                </div>
              ))}
              <button className="btn ghost mini" style={{ marginTop: 8 }} onClick={() => addO(i)}>+ opção</button>
            </div>
          </div>
        ),
      )}
      {!bloquearGrupos && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn ghost mini" onClick={addG}>+ Grupo novo</button>
          {existentes.length > 0 && (
            <select
              value=""
              onChange={(e) => { if (e.target.value) { reusar(e.target.value); e.target.value = ''; } }}
              title="Reutilizar o MESMO grupo (compartilhado) que já existe no seu cardápio"
              style={{ background: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 9, color: 'var(--cream)', fontFamily: 'inherit', fontSize: '.8rem', padding: '8px 10px', cursor: 'pointer', maxWidth: 260 }}
            >
              <option value="">＋ Usar grupo existente…</option>
              {existentes.map((g) => (
                <option key={g.id} value={g.id}>{g.nome} ({g.opcoes.length} opç{g.opcoes.length === 1 ? 'ão' : 'ões'})</option>
              ))}
            </select>
          )}
        </div>
      )}
    </div>
  );
}
