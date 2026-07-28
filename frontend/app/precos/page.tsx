'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type ItemCardapio } from '@/lib/api';
import { useToast } from '@/components/toast';
import { MoneyInput, brl } from '@/components/money';

export default function PrecosPage() {
  const [itens, setItens] = useState<ItemCardapio[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, number>>({}); // pdv → novo preço
  const [enviando, setEnviando] = useState(false);
  const [contextos, setContextos] = useState<string[]>(['DEFAULT']);
  const [canal, setCanal] = useState('DEFAULT');
  const toast = useToast();

  const CANAL_NOME: Record<string, string> = { DEFAULT: 'Delivery', INDOOR: 'Salão', WHITELABEL: 'Cardápio Digital' };

  const carregar = useCallback(async () => {
    try {
      const [r, c] = await Promise.all([api.cardapio(), api.contextos().catch(() => ({ contextos: ['DEFAULT'] }))]);
      setItens(r.itens);
      setContextos(c.contextos.length ? c.contextos : ['DEFAULT']);
      setErro(null);
    } catch (e: any) {
      setErro(e.message);
    }
  }, []);
  useEffect(() => {
    carregar();
  }, [carregar]);

  const pendentes = useMemo(
    () => Object.entries(draft).filter(([pdv, v]) => {
      const it = itens?.find((i) => i.pdv === pdv);
      return it && Math.abs(v - it.preco) >= 0.005;
    }),
    [draft, itens],
  );

  function set(pdv: string, valor: number) {
    setDraft((d) => ({ ...d, [pdv]: valor }));
  }

  async function publicar() {
    if (!pendentes.length) return;
    setEnviando(true);
    try {
      const r = await api.reprecos(pendentes.map(([pdv, preco]) => ({ pdv, preco })), canal);
      toast(`<b style="color:var(--green)">${pendentes.length} preço(s)</b> publicado(s) em ${CANAL_NOME[canal] ?? canal} · lote ${r.batchId?.slice(0, 8) ?? '—'}`);
      setDraft({});
      setTimeout(carregar, 2500);
    } catch (e: any) {
      toast(`Erro ao publicar: ${e.message}`);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <div className="topbar">
        <div>
          <h1>
            Preços <span>em lote</span>
          </h1>
          <div className="sub">Edite os preços do seu cardápio iFood em rascunho e publique de uma vez. A promoção “de/por” é preservada.</div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {contextos.length > 1 && (
            <select value={canal} onChange={(e) => setCanal(e.target.value)} aria-label="Canal" style={{ background: 'var(--ink2)', border: '1px solid var(--line)', borderRadius: 11, color: 'var(--cream)', fontFamily: 'inherit', fontSize: '.85rem', padding: '11px 13px', cursor: 'pointer' }}>
              {contextos.map((c) => (
                <option key={c} value={c}>
                  {CANAL_NOME[c] ?? c}
                </option>
              ))}
            </select>
          )}
          <button className="btn" disabled={!pendentes.length || enviando} onClick={publicar}>
            {enviando ? 'Publicando…' : pendentes.length ? `Publicar ${pendentes.length} preço${pendentes.length > 1 ? 's' : ''}` : 'Publicar'}
          </button>
        </div>
      </div>

      {pendentes.length > 0 && (
        <div className="card" style={{ marginBottom: 18, borderColor: 'rgba(255,162,38,.4)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <b>{pendentes.length} alteração(ões) pendente(s)</b>
          <span className="sub" style={{ margin: 0 }}>guardadas aqui — ainda não enviadas ao iFood.</span>
          <button className="btn ghost mini" style={{ marginLeft: 'auto' }} onClick={() => setDraft({})}>
            Descartar
          </button>
        </div>
      )}

      {erro && <div className="errbox">Não consegui falar com a API: {erro}</div>}
      {!itens && !erro && <div className="loading">Carregando…</div>}

      {itens && (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
            <thead>
              <tr>
                {['Item', 'Preço atual', 'Novo preço', 'Variação'].map((h, i) => (
                  <th
                    key={h}
                    className="mono"
                    style={{ textAlign: i === 0 ? 'left' : 'right', color: 'var(--dim)', fontWeight: 400, padding: '14px 16px', borderBottom: '1px solid var(--line)' }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {itens.map((it) => {
                const pdv = it.pdv ?? '';
                const novo = draft[pdv] ?? it.preco;
                const diff = novo - it.preco;
                const dirty = Math.abs(diff) >= 0.005;
                const pct = it.preco ? (diff / it.preco) * 100 : 0;
                return (
                  <tr key={pdv || it.nome} style={{ background: dirty ? 'rgba(255,162,38,.05)' : undefined }}>
                    <td style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
                      <div style={{ fontWeight: 600, fontSize: '.92rem' }}>{it.nome}</div>
                      <div className="mono" style={{ color: 'var(--dim)', fontSize: '.6rem', textTransform: 'none' }}>
                        PDV {it.pdv ?? '—'}
                        {it.promo ? ` · promo de ${brl(it.promo.de)}` : ''}
                      </div>
                    </td>
                    <td className="mono" style={{ textAlign: 'right', color: 'var(--dim)', padding: '12px 16px', borderBottom: '1px solid var(--line)', textTransform: 'none' }}>
                      R$ {brl(it.preco)}
                    </td>
                    <td style={{ textAlign: 'right', padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
                      <span style={{ display: 'inline-flex', justifyContent: 'flex-end' }}>
                        <MoneyInput
                          valor={novo}
                          onChange={(n) => set(pdv, n)}
                          disabled={!it.pdv}
                          ariaLabel={`Novo preço de ${it.nome}`}
                          style={{
                            width: 118,
                            border: `1px solid ${dirty ? 'var(--tanger)' : 'var(--line)'}`,
                            color: dirty ? 'var(--tanger)' : 'var(--cream)',
                            padding: '9px 11px 9px 30px',
                          }}
                        />
                      </span>
                    </td>
                    <td className="mono" style={{ textAlign: 'right', padding: '12px 16px', borderBottom: '1px solid var(--line)', textTransform: 'none', color: dirty ? (diff > 0 ? 'var(--tanger)' : 'var(--lilac)') : 'var(--dim)' }}>
                      {dirty ? `${diff > 0 ? '+' : '−'}${Math.abs(pct).toFixed(1)}%` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
