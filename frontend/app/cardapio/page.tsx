'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, type ItemCardapio } from '@/lib/api';
import { useToast } from '@/components/toast';
import { MoneyInput, brl } from '@/components/money';

export default function CardapioPage() {
  const [itens, setItens] = useState<ItemCardapio[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [modalCat, setModalCat] = useState(false);
  const [novaCat, setNovaCat] = useState('');
  const [criandoCat, setCriandoCat] = useState(false);
  const [menu, setMenu] = useState<string | null>(null); // pdv com ⋮ aberto
  const [precoEdit, setPrecoEdit] = useState<{ pdv: string; valor: number } | null>(null);
  const [salvandoPreco, setSalvandoPreco] = useState(false);
  const cancelouPreco = useRef(false); // Escape não deve salvar no blur
  const [confirmar, setConfirmar] = useState<ItemCardapio | null>(null); // remover
  const [removendo, setRemovendo] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null); // pdv em ação (duplicar)
  const [precoMassa, setPrecoMassa] = useState<number | null>(null); // preço em massa (seleção)
  const [aplicandoMassa, setAplicandoMassa] = useState(false);
  const [catList, setCatList] = useState<Array<{ nome: string; template: string; itens: number }> | null>(null); // todas as categorias (modal)
  const [removendoCat, setRemovendoCat] = useState<string | null>(null); // nome da categoria em remoção
  const toast = useToast();
  const router = useRouter();

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

  const carregarCategorias = useCallback(async () => {
    setCatList(null);
    try {
      const r = await api.categorias();
      setCatList(r.categorias);
    } catch {
      setCatList([]);
    }
  }, []);

  function abrirCategorias() {
    setModalCat(true);
    carregarCategorias();
  }

  async function criarCategoria() {
    const nome = novaCat.trim();
    if (!nome) return;
    setCriandoCat(true);
    try {
      const r = await api.criarCategoria(nome);
      if (r.ok) {
        toast(`<b style="color:var(--green)">Categoria "${nome}"</b> criada ✓`);
        setNovaCat('');
        carregarCategorias();
        carregar();
      } else {
        toast(`Erro: ${r.erro || 'não foi possível criar'}`);
      }
    } catch (e: any) {
      toast(`Erro: ${e.message}`);
    } finally {
      setCriandoCat(false);
    }
  }

  async function removerCategoria(nome: string) {
    setRemovendoCat(nome);
    try {
      const r = await api.removerCategoria(nome);
      if (r.ok) {
        toast(`<b style="color:var(--green)">Categoria "${nome}"</b> removida ✓`);
        carregarCategorias();
        carregar();
      } else {
        toast(`Erro: ${r.erro || 'não foi possível remover'}`);
      }
    } catch (e: any) {
      toast(`Erro: ${e.message}`);
    } finally {
      setRemovendoCat(null);
    }
  }

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

  // preço EM MASSA: aplica o mesmo preço aos selecionados numa única chamada (PATCH /products/price)
  async function aplicarPrecoMassa() {
    const pdvs = [...sel];
    if (!pdvs.length || precoMassa == null || precoMassa <= 0) return;
    setAplicandoMassa(true);
    try {
      await api.reprecos(pdvs.map((pdv) => ({ pdv, preco: precoMassa })));
      setItens((l) => l?.map((i) => (i.pdv && pdvs.includes(i.pdv) ? { ...i, preco: precoMassa } : i)) ?? null);
      toast(`<b style="color:var(--green)">${pdvs.length} item(ns)</b> → R$ ${brl(precoMassa)} ✓`);
      setPrecoMassa(null);
      setSel(new Set());
    } catch (e: any) {
      toast(`Erro no preço em massa: ${e.message}`);
    } finally {
      setAplicandoMassa(false);
    }
  }

  function toggleSel(pdv: string) {
    setSel((s) => {
      const n = new Set(s);
      n.has(pdv) ? n.delete(pdv) : n.add(pdv);
      return n;
    });
  }

  // salva o preço inline (grava no iFood, preservando a promo de/por).
  async function salvarPreco() {
    if (!precoEdit) return;
    const { pdv, valor } = precoEdit;
    const atual = itens?.find((i) => i.pdv === pdv);
    if (!atual || Math.abs(valor - atual.preco) < 0.005) {
      setPrecoEdit(null);
      return;
    }
    setSalvandoPreco(true);
    try {
      const r = await api.precoItem(pdv, valor); // PATCH /items/price
      if (!r.ok) throw new Error(r.erro || 'não foi possível');
      setItens((l) => l?.map((i) => (i.pdv === pdv ? { ...i, preco: valor } : i)) ?? null);
      toast(`<b style="color:var(--green)">${atual.nome}</b> → R$ ${brl(valor)} ✓`);
      setPrecoEdit(null);
    } catch (e: any) {
      toast(`Erro ao atualizar preço: ${e.message}`);
    } finally {
      setSalvandoPreco(false);
    }
  }

  async function duplicar(it: ItemCardapio) {
    if (!it.pdv) return;
    setMenu(null);
    setOcupado(it.pdv);
    try {
      const r = await api.duplicar(it.pdv);
      if (r.ok) {
        toast(`<b style="color:var(--green)">${it.nome}</b> duplicado (cópia) ✓`);
        carregar();
      } else {
        toast(`Erro ao duplicar: ${r.erro}`);
      }
    } catch (e: any) {
      toast(`Erro ao duplicar: ${e.message}`);
    } finally {
      setOcupado(null);
    }
  }

  async function remover() {
    if (!confirmar?.pdv) return;
    const it = confirmar;
    setRemovendo(true);
    try {
      const r = await api.remover(it.pdv!);
      if (r.ok) {
        setItens((l) => l?.filter((i) => i.pdv !== it.pdv) ?? null);
        toast(`<b style="color:var(--green)">${it.nome}</b> removido do cardápio ✓`);
        setConfirmar(null);
      } else {
        toast(`Erro ao remover: ${r.erro}`);
      }
    } catch (e: any) {
      toast(`Erro ao remover: ${e.message}`);
    } finally {
      setRemovendo(false);
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
          <div className="sub">Seu cardápio do iFood — pause, altere preço, duplique, remova e edite tudo aqui.</div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            placeholder="Buscar item ou PDV…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            style={{ background: 'var(--ink2)', border: '1px solid var(--line)', borderRadius: 11, color: 'var(--cream)', fontFamily: 'inherit', fontSize: '.9rem', padding: '11px 14px', minWidth: 180 }}
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
          <button className="btn ghost" style={{ whiteSpace: 'nowrap' }} onClick={abrirCategorias}>
            Categorias
          </button>
          <Link href="/complementos" className="btn ghost" style={{ whiteSpace: 'nowrap' }}>
            Complementos
          </Link>
        </div>
      </div>

      {modalCat && (
        <div
          onClick={() => !criandoCat && setModalCat(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }}
        >
          <div className="card" onClick={(e) => e.stopPropagation()} style={{ width: 'min(460px, 100%)', maxHeight: '90vh', overflowY: 'auto' }}>
            <h2 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: 4 }}>Categorias</h2>
            <div className="sub" style={{ marginBottom: 14 }}>Crie categorias e remova as que estiverem vazias.</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                autoFocus
                value={novaCat}
                onChange={(e) => setNovaCat(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && criarCategoria()}
                maxLength={100}
                placeholder="Ex.: Bebidas, Sobremesas…"
                style={{ flex: 1, background: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 11, color: 'var(--cream)', fontFamily: 'inherit', fontSize: '.95rem', padding: '12px 14px' }}
              />
              <button className="btn" disabled={criandoCat || !novaCat.trim()} onClick={criarCategoria} style={{ whiteSpace: 'nowrap' }}>
                {criandoCat ? 'Criando…' : 'Criar'}
              </button>
            </div>

            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {catList === null && <div className="sub">Carregando categorias…</div>}
              {catList?.length === 0 && <div className="sub">Nenhuma categoria ainda.</div>}
              {catList?.map((c) => (
                <div key={c.nome} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', background: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 10 }}>
                  <span style={{ fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.nome}
                    {c.template === 'PIZZA' && <span className="sub" style={{ marginLeft: 6 }}>· pizza</span>}
                  </span>
                  <span className="mono sub" style={{ flex: 'none' }}>{c.itens} {c.itens === 1 ? 'item' : 'itens'}</span>
                  {c.itens === 0 ? (
                    <button
                      className="btn ghost mini"
                      disabled={removendoCat === c.nome}
                      onClick={() => removerCategoria(c.nome)}
                      style={{ flex: 'none', color: 'var(--coral, #e5533d)' }}
                      aria-label={`Remover categoria ${c.nome}`}
                    >
                      {removendoCat === c.nome ? '…' : 'Remover'}
                    </button>
                  ) : (
                    <span className="sub" style={{ flex: 'none', fontSize: '.72rem' }} title="Tem itens — remova ou mova os itens antes">em uso</span>
                  )}
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
              <button className="btn ghost mini" disabled={criandoCat} onClick={() => setModalCat(false)}>Fechar</button>
            </div>
          </div>
        </div>
      )}

      {/* confirmação de remoção */}
      {confirmar && (
        <div onClick={() => !removendo && setConfirmar(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 55, padding: 16 }}>
          <div className="card" onClick={(e) => e.stopPropagation()} style={{ width: 'min(440px, 100%)' }}>
            <h2 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: 4 }}>Remover item?</h2>
            <div className="sub" style={{ marginBottom: 16 }}>
              <b>{confirmar.nome}</b> será apagado do cardápio do iFood. Esta ação não pode ser desfeita.
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn ghost mini" disabled={removendo} onClick={() => setConfirmar(null)}>Cancelar</button>
              <button className="btn mini" style={{ background: 'var(--coral, #e5533d)', borderColor: 'transparent' }} disabled={removendo} onClick={remover}>
                {removendo ? 'Removendo…' : 'Remover item'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* barra de ação em massa */}
      {sel.size > 0 && (
        <div className="card" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', borderColor: 'rgba(255,162,38,.4)' }}>
          <b>{sel.size} selecionado(s)</b>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 9, alignItems: 'center', flexWrap: 'wrap' }}>
            {precoMassa == null ? (
              <button className="btn ghost mini" onClick={() => setPrecoMassa(0)}>Alterar preço…</button>
            ) : (
              <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                <MoneyInput valor={precoMassa} onChange={setPrecoMassa} autoFocus ariaLabel="Novo preço para os selecionados" style={{ width: 110, padding: '8px 10px 8px 28px' }} />
                <button className="btn mini" disabled={aplicandoMassa || !precoMassa} onClick={aplicarPrecoMassa}>{aplicandoMassa ? '…' : `Aplicar a ${sel.size}`}</button>
                <button className="btn ghost mini" disabled={aplicandoMassa} onClick={() => setPrecoMassa(null)}>×</button>
              </span>
            )}
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
          <div className="card" style={{ padding: 0, overflow: 'visible' }}>
            {lista
              .filter((i) => i.categoria === cat)
              .map((it) => {
                const editando = precoEdit?.pdv === it.pdv;
                return (
                  <div key={it.pdv ?? it.nome} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', borderTop: '1px solid var(--line)', flexWrap: 'wrap', background: it.pdv && sel.has(it.pdv) ? 'rgba(255,162,38,.06)' : undefined }}>
                    {it.pdv && (
                      <input type="checkbox" checked={sel.has(it.pdv)} onChange={() => toggleSel(it.pdv!)} aria-label={`Selecionar ${it.nome}`} style={{ width: 16, height: 16, accentColor: 'var(--tanger)', cursor: 'pointer', flex: 'none' }} />
                    )}
                    <div style={{ width: 44, height: 44, borderRadius: 9, overflow: 'hidden', flex: 'none', background: 'var(--ink)', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {it.imagem ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={it.imagem} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <span className="mono" style={{ fontSize: '.5rem', color: 'var(--dim)' }}>—</span>
                      )}
                    </div>
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

                    {/* preço — caixa clicável: cinza/neutra fechada, branca ao editar; salva ao sair (blur) ou Enter */}
                    {editando ? (
                      <MoneyInput
                        valor={precoEdit!.valor}
                        onChange={(v) => setPrecoEdit({ pdv: it.pdv!, valor: v })}
                        autoFocus
                        disabled={salvandoPreco}
                        ariaLabel={`Novo preço de ${it.nome}`}
                        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { cancelouPreco.current = true; (e.target as HTMLInputElement).blur(); } }}
                        onBlur={() => { if (cancelouPreco.current) { cancelouPreco.current = false; setPrecoEdit(null); } else { salvarPreco(); } }}
                        style={{ width: 116, padding: '8px 10px 8px 30px', background: 'var(--cream)', border: '1px solid var(--tanger)', color: 'var(--ink)' }}
                      />
                    ) : (
                      <button
                        className="mono"
                        onClick={() => it.pdv && setPrecoEdit({ pdv: it.pdv, valor: it.preco })}
                        disabled={!it.pdv}
                        title={it.pdv ? 'Clique para alterar o preço' : undefined}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          width: 116,
                          justifyContent: 'flex-end',
                          background: 'var(--ink)',
                          border: '1px solid var(--line)',
                          borderRadius: 10,
                          padding: '8px 11px',
                          color: 'var(--dim)',
                          cursor: it.pdv ? 'text' : 'default',
                          textTransform: 'none',
                          letterSpacing: '.02em',
                        }}
                      >
                        {it.promo && <span style={{ textDecoration: 'line-through', opacity: 0.7, fontSize: '.72rem' }}>{brl(it.promo.de)}</span>}
                        <span style={{ color: it.promo ? 'var(--tanger)' : 'var(--cream)' }}>R$ {brl(it.preco)}</span>
                      </button>
                    )}

                    <span className={`pill ${it.status === 'no_ar' ? 'on' : 'off'}`}>
                      <span className="dotp" />
                      {it.status === 'no_ar' ? 'no ar' : 'pausado'}
                    </span>
                    {it.pdv && (
                      <button className="btn ghost mini" onClick={() => alternar(it)}>
                        {it.status === 'no_ar' ? 'Pausar' : 'Reativar'}
                      </button>
                    )}

                    {/* ⋮ menu de opções */}
                    {it.pdv && (
                      <div style={{ position: 'relative', flex: 'none' }}>
                        <button
                          className="btn ghost mini"
                          aria-label="Opções"
                          aria-expanded={menu === it.pdv}
                          disabled={ocupado === it.pdv}
                          onClick={() => setMenu((m) => (m === it.pdv ? null : it.pdv!))}
                          style={{ padding: '6px 10px', fontSize: '1.1rem', lineHeight: 1 }}
                        >
                          {ocupado === it.pdv ? '…' : '⋮'}
                        </button>
                        {menu === it.pdv && (
                          <>
                            <div onClick={() => setMenu(null)} style={{ position: 'fixed', inset: 0, zIndex: 20 }} />
                            <div className="card" style={{ position: 'absolute', top: '110%', right: 0, zIndex: 21, padding: 6, minWidth: 168, display: 'flex', flexDirection: 'column', gap: 2 }}>
                              <button className="menuopt" onClick={() => { setMenu(null); router.push(`/item/${encodeURIComponent(it.pdv!)}`); }}>Ver / editar</button>
                              <button className="menuopt" onClick={() => duplicar(it)}>Duplicar item</button>
                              <button className="menuopt" style={{ color: 'var(--coral, #e5533d)' }} onClick={() => { setMenu(null); setConfirmar(it); }}>Remover item</button>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      ))}

      <style jsx>{`
        .menuopt {
          text-align: left;
          background: none;
          border: none;
          color: var(--cream);
          font-family: inherit;
          font-size: 0.86rem;
          padding: 9px 11px;
          border-radius: 8px;
          cursor: pointer;
        }
        .menuopt:hover {
          background: var(--ink);
        }
      `}</style>
    </>
  );
}
