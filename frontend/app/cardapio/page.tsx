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

  async function alternar(it: ItemCardapio) {
    if (!it.pdv) return;
    const novo = it.status === 'no_ar' ? 'pausado' : 'no_ar';
    try {
      await api.status(it.pdv, novo);
      toast(`${it.nome} ${novo === 'pausado' ? 'pausado' : 'reativado'}.`);
      setTimeout(carregar, 1500);
    } catch (e: any) {
      toast(`Erro: ${e.message}`);
    }
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
          <div className="sub">O cardápio do iFood da loja — pause, reative e acompanhe.</div>
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
        </div>
      </div>

      {erro && <div className="errbox">Não consegui falar com a API: {erro}</div>}
      {!itens && !erro && <div className="loading">Carregando cardápio…</div>}

      {categorias.map((cat) => (
        <div key={cat} style={{ marginBottom: 22 }}>
          <div className="mono" style={{ color: 'var(--dim)', marginBottom: 10 }}>
            {cat}
          </div>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {lista
              .filter((i) => i.categoria === cat)
              .map((it) => (
                <div
                  key={it.pdv ?? it.nome}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                    padding: '14px 18px',
                    borderTop: '1px solid var(--line)',
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 160 }}>
                    {it.pdv ? (
                      <Link href={`/item/${encodeURIComponent(it.pdv)}`} style={{ fontWeight: 600, borderBottom: '1px solid transparent' }} className="itemlink">
                        {it.nome}
                      </Link>
                    ) : (
                      <div style={{ fontWeight: 600 }}>{it.nome}</div>
                    )}
                    <div className="mono" style={{ color: 'var(--dim)', fontSize: '.62rem', textTransform: 'none', marginTop: 2 }}>
                      PDV {it.pdv ?? '—'}
                    </div>
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
