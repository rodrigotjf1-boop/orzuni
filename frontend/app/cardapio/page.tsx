'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, type ItemCardapio } from '@/lib/api';
import { useToast } from '@/components/toast';

const brl = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function CardapioPage() {
  const [itens, setItens] = useState<ItemCardapio[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const toast = useToast();

  const carregar = useCallback(async () => {
    try {
      const r = await api.cardapio();
      setItens(r.itens);
      setErro(null);
    } catch (e: any) {
      setErro(e.message);
    }
  }, []);
  useEffect(() => {
    carregar();
  }, [carregar]);

  // reflexão instantânea (≤2s): atualiza o estado local na hora; confirma em segundo plano.
  function refletir(pdvs: string[], status: 'no_ar' | 'pausado') {
    setItens((l) => l?.map((i) => (i.pdv && pdvs.includes(i.pdv) ? { ...i, status } : i)) ?? null);
  }

  async function alternar(it: ItemCardapio) {
    if (!it.pdv) return;
    const antes = it.status;
    const novo = antes === 'no_ar' ? 'pausado' : 'no_ar';
    refletir([it.pdv], novo);
    try {
      await api.status(it.pdv, novo);
      toast(`${it.nome} ${novo === 'pausado' ? 'pausado' : 'reativado'}.`);
    } catch (e: any) {
      refletir([it.pdv], antes); // reverte
      toast(`Erro ao ${novo === 'pausado' ? 'pausar' : 'reativar'}: ${e.message}`);
    }
  }

  async function emMassa(status: 'no_ar' | 'pausado') {
    const pdvs = [...sel];
    if (!pdvs.length) return;
    refletir(pdvs, status);
    setSel(new Set());
    try {
      await api.statusMassa(pdvs.map((pdv) => ({ pdv, status })));
      toast(`<b style="color:var(--green)">${pdvs.length} item(ns)</b> ${status === 'pausado' ? 'pausados' : 'reativados'}.`);
    } catch (e: any) {
      carregar();
      toast(`Erro na ação em massa: ${e.message}`);
    }
  }

  function toggleSel(pdv: string) {
    setSel((s) => {
      const n = new Set(s);
      n.has(pdv) ? n.delete(pdv) : n.add(pdv);
      return n;
    });
  }

  const lista = (itens ?? []).filter((i) =>
    (i.nome + ' ' + (i.pdv ?? '') + ' ' + i.categoria).toLowerCase().includes(busca.toLowerCase()),
  );
  const categorias = [...new Set(lista.map((i) => i.categoria))];

  return (
    <>
      <div className="topbar">
        <div>
          <h1>
            Card<span>ápio</span>
          </h1>
          <div className="sub">O cardápio do seu iFood — pause, reative (em massa) e acompanhe.</div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            placeholder="Buscar item ou PDV…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            style={{ background: 'var(--ink2)', border: '1px solid var(--line)', borderRadius: 11, color: 'var(--cream)', fontFamily: 'inherit', fontSize: '.9rem', padding: '11px 14px', minWidth: 200 }}
          />
          <Link href="/item/novo" className="btn" style={{ whiteSpace: 'nowrap' }}>
            + Novo item
          </Link>
          <Link href="/pizza/novo" className="btn ghost" style={{ whiteSpace: 'nowrap' }}>
            + Pizza
          </Link>
          <Link href="/combo/novo" className="btn ghost" style={{ whiteSpace: 'nowrap' }}>
            + Combo
          </Link>
        </div>
      </div>

      {/* barra de ação em massa */}
      {sel.size > 0 && (
        <div className="card" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', borderColor: 'rgba(255,162,38,.4)' }}>
          <b>{sel.size} selecionado(s)</b>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 9 }}>
            <button className="btn ghost mini" onClick={() => emMassa('pausado')}>Pausar selecionados</button>
            <button className="btn mini" onClick={() => emMassa('no_ar')}>Reativar selecionados</button>
            <button className="btn ghost mini" onClick={() => setSel(new Set())}>Limpar</button>
          </div>
        </div>
      )}

      {erro && <div className="errbox">Não consegui falar com a API: {erro}</div>}
      {!itens && !erro && <div className="loading">Carregando cardápio…</div>}

      {categorias.map((cat) => (
        <div key={cat} style={{ marginBottom: 22 }}>
          <div className="mono" style={{ color: 'var(--dim)', marginBottom: 10 }}>{cat}</div>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {lista
              .filter((i) => i.categoria === cat)
              .map((it) => (
                <div key={it.pdv ?? it.nome} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', borderTop: '1px solid var(--line)', flexWrap: 'wrap', background: it.pdv && sel.has(it.pdv) ? 'rgba(255,162,38,.06)' : undefined }}>
                  {it.pdv && (
                    <input type="checkbox" checked={sel.has(it.pdv)} onChange={() => toggleSel(it.pdv!)} aria-label={`Selecionar ${it.nome}`} style={{ width: 16, height: 16, accentColor: 'var(--tanger)', cursor: 'pointer', flex: 'none' }} />
                  )}
                  <div style={{ flex: 1, minWidth: 150 }}>
                    {it.pdv ? (
                      <Link href={`/item/${encodeURIComponent(it.pdv)}`} style={{ fontWeight: 600, borderBottom: '1px solid transparent' }} className="itemlink">
                        {it.nome}
                      </Link>
                    ) : (
                      <div style={{ fontWeight: 600 }}>{it.nome}</div>
                    )}
                    <div className="mono" style={{ color: 'var(--dim)', fontSize: '.62rem', textTransform: 'none', marginTop: 2 }}>PDV {it.pdv ?? '—'}</div>
                  </div>
                  <div className="mono" style={{ textTransform: 'none', letterSpacing: '.02em' }}>
                    {it.promo && <span style={{ color: 'var(--dim)', textDecoration: 'line-through', marginRight: 6 }}>R$ {brl(it.promo.de)}</span>}
                    <span style={{ color: it.promo ? 'var(--tanger)' : 'var(--cream)' }}>R$ {brl(it.preco)}</span>
                  </div>
                  <span className={`pill ${it.status === 'no_ar' ? 'on' : 'off'}`}>
                    <span className="dotp" />
                    {it.status === 'no_ar' ? 'no ar' : 'pausado'}
                  </span>
                  {it.pdv && (
                    <button className="btn ghost mini" onClick={() => alternar(it)}>
                      {it.status === 'no_ar' ? 'Pausar' : 'Reativar'}
                    </button>
                  )}
                </div>
              ))}
          </div>
        </div>
      ))}
    </>
  );
}
