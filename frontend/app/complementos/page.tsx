'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, type GrupoComplemento } from '@/lib/api';
import { useToast } from '@/components/toast';
import { brl } from '@/components/money';
import { ComplementosEditor, type GrupoCompl } from '@/components/complementos';

const grupoNoAr = (g: GrupoComplemento) => g.opcoes.length > 0 && g.opcoes.every((o) => o.status === 'no_ar');
// status do grupo: no ar (todas ativas), pausado (todas pausadas) ou parcial (algumas)
function grupoStatus(g: GrupoComplemento): 'no_ar' | 'pausado' | 'parcial' {
  if (!g.opcoes.length) return 'pausado';
  const ativas = g.opcoes.filter((o) => o.status === 'no_ar').length;
  if (ativas === g.opcoes.length) return 'no_ar';
  if (ativas === 0) return 'pausado';
  return 'parcial';
}

export default function ComplementosPage() {
  const [grupos, setGrupos] = useState<GrupoComplemento[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [ocupado, setOcupado] = useState<string | null>(null); // id em ação
  const [editar, setEditar] = useState<GrupoComplemento | null>(null);
  const [draft, setDraft] = useState<GrupoCompl | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [confirmar, setConfirmar] = useState<GrupoComplemento | null>(null);
  const toast = useToast();

  const carregar = useCallback(async () => {
    try {
      const r = await api.complementos();
      setGrupos(r.grupos);
      setErro(null);
    } catch (e: any) {
      setErro(e.message);
    }
  }, []);
  useEffect(() => {
    carregar();
  }, [carregar]);

  async function alternar(g: GrupoComplemento) {
    const novo = grupoNoAr(g) ? 'pausado' : 'no_ar';
    setOcupado(g.id);
    try {
      const r = await api.statusGrupo(g.id, novo);
      if (r.ok) {
        setGrupos((l) => l?.map((x) => (x.id === g.id ? { ...x, opcoes: x.opcoes.map((o) => ({ ...o, status: novo })) } : x)) ?? null);
        toast(`Grupo <b>${g.nome}</b> ${novo === 'pausado' ? 'pausado' : 'reativado'}.`);
      } else toast(`Erro: ${r.erro}`);
    } catch (e: any) {
      toast(`Erro: ${e.message}`);
    } finally {
      setOcupado(null);
    }
  }

  // pausa/reativa UMA opção — cascateia para todos os itens que usam o grupo.
  async function alternarOpcao(g: GrupoComplemento, idx: number) {
    const o = g.opcoes[idx];
    const novo = o.status === 'no_ar' ? 'pausado' : 'no_ar';
    const aplicar = (st: 'no_ar' | 'pausado') =>
      setGrupos((l) => l?.map((x) => (x.id === g.id ? { ...x, opcoes: x.opcoes.map((oo, i) => (i === idx ? { ...oo, status: st } : oo)) } : x)) ?? null);
    aplicar(novo); // otimista
    try {
      const r = await api.statusOpcao(o.id, novo);
      if (!r.ok) throw new Error(r.erro || 'falhou');
      toast(`<b>${o.nome}</b> ${novo === 'pausado' ? 'pausado' : 'reativado'} — vale em todos os itens do grupo.`);
    } catch (e: any) {
      aplicar(o.status); // reverte
      toast(`Erro: ${e.message}`);
    }
  }

  function abrirEditar(g: GrupoComplemento) {
    setEditar(g);
    setDraft({ grupo: g.nome, min: g.min, max: g.max, opcoes: g.opcoes.map((o) => ({ nome: o.nome, preco: o.preco, pdv: o.pdv, imagem: o.imagem || null })) });
  }

  async function salvarEditar() {
    if (!editar || !draft) return;
    if (!draft.grupo.trim()) return toast('Dê um nome ao grupo.');
    if (!draft.opcoes.some((o) => o.nome.trim())) return toast('O grupo precisa de ao menos uma opção.');
    setSalvando(true);
    try {
      const r = await api.editarGrupo(editar.id, {
        nome: draft.grupo.trim(),
        min: draft.min,
        max: draft.max,
        opcoes: draft.opcoes.filter((o) => o.nome.trim()).map((o) => ({ nome: o.nome.trim(), preco: o.preco, pdv: o.pdv.trim() || undefined, imagem: o.imagem || undefined })),
      });
      if (r.ok) {
        toast(`<b style="color:var(--green)">${draft.grupo}</b> atualizado ✓`);
        setEditar(null);
        setDraft(null);
        carregar();
      } else toast(`Erro ao salvar: ${r.erro}`);
    } catch (e: any) {
      toast(`Erro ao salvar: ${e.message}`);
    } finally {
      setSalvando(false);
    }
  }

  async function remover() {
    if (!confirmar) return;
    const g = confirmar;
    setOcupado(g.id);
    try {
      const r = await api.removerGrupo(g.id);
      if (r.ok) {
        setGrupos((l) => l?.filter((x) => x.id !== g.id) ?? null);
        toast(`Grupo <b>${g.nome}</b> removido ✓`);
        setConfirmar(null);
      } else toast(`Erro ao remover: ${r.erro}`);
    } catch (e: any) {
      toast(`Erro ao remover: ${e.message}`);
    } finally {
      setOcupado(null);
    }
  }

  const lista = (grupos ?? []).filter((g) =>
    (g.nome + ' ' + g.itens.map((i) => i.nome).join(' ') + ' ' + g.opcoes.map((o) => o.nome).join(' ')).toLowerCase().includes(busca.toLowerCase()),
  );

  return (
    <>
      <div className="topbar">
        <div>
          <h1>
            Comple<span>mentos</span>
          </h1>
          <div className="sub">Grupos de complemento (adicionais) do seu cardápio — pause, edite ou remova, e veja onde cada um aparece.</div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            placeholder="Buscar grupo, opção ou item…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            style={{ background: 'var(--ink2)', border: '1px solid var(--line)', borderRadius: 11, color: 'var(--cream)', fontFamily: 'inherit', fontSize: '.9rem', padding: '11px 14px', minWidth: 200 }}
          />
          <Link href="/cardapio" className="btn ghost" style={{ whiteSpace: 'nowrap' }}>
            ← Cardápio
          </Link>
        </div>
      </div>

      {erro && <div className="errbox">Não consegui falar com a API: {erro}</div>}
      {!grupos && !erro && <div className="loading">Carregando complementos…</div>}
      {grupos && lista.length === 0 && !erro && (
        <div className="card" style={{ textAlign: 'center', padding: '32px 20px' }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Nenhum grupo de complemento</div>
          <div className="sub">Os grupos aparecem aqui quando você adiciona complementos a um item (ex.: "Adicionais").</div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
        {lista.map((g) => {
          const st = grupoStatus(g);
          const noAr = grupoNoAr(g);
          const pillTxt = st === 'no_ar' ? 'no ar' : st === 'parcial' ? 'parcial' : 'pausado';
          return (
            <div key={g.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: '1rem' }}>{g.nome || '(sem nome)'}</div>
                  <div className="mono" style={{ color: 'var(--dim)', fontSize: '.58rem', textTransform: 'uppercase', letterSpacing: '.08em', marginTop: 2 }}>
                    {g.opcoes.length} opç{g.opcoes.length === 1 ? 'ão' : 'ões'} · escolha {g.min}–{g.max}
                  </div>
                </div>
                <span className={`pill ${st === 'no_ar' ? 'on' : 'off'}`}>
                  <span className="dotp" />
                  {pillTxt}
                </span>
              </div>

              {/* opções — pausar/reativar cada uma (cascateia p/ todos os itens do grupo) */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {g.opcoes.map((o, i) => {
                  const pausada = o.status === 'pausado';
                  return (
                    <div key={o.id || i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderTop: i ? '1px solid var(--line)' : 'none' }}>
                      {o.imagem ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={o.imagem} alt="" style={{ width: 24, height: 24, borderRadius: 6, objectFit: 'cover', flex: 'none', opacity: pausada ? 0.5 : 1 }} />
                      ) : (
                        <span style={{ width: 24, height: 24, borderRadius: 6, background: 'var(--ink)', border: '1px solid var(--line)', flex: 'none' }} />
                      )}
                      <span style={{ flex: 1, minWidth: 0, fontSize: '.85rem', color: pausada ? 'var(--dim)' : 'var(--cream)', textDecoration: pausada ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {o.nome}
                      </span>
                      {o.preco > 0 && <span className="mono" style={{ color: 'var(--dim)', fontSize: '.64rem' }}>+{brl(o.preco)}</span>}
                      <button
                        className="btn ghost mini"
                        onClick={() => alternarOpcao(g, i)}
                        title={pausada ? 'Reativar esta opção' : 'Pausar esta opção (ex.: acabou)'}
                        style={{ fontSize: '.66rem', padding: '4px 9px', flex: 'none' }}
                      >
                        {pausada ? 'Reativar' : 'Pausar'}
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* itens associados */}
              <div className="sub" style={{ margin: 0, fontSize: '.72rem' }}>
                <span style={{ color: 'var(--dim)' }}>Disponível em: </span>
                {g.itens.length ? g.itens.map((i) => i.nome).join(', ') : '— nenhum item'}
              </div>

              {/* ações do grupo */}
              <div style={{ display: 'flex', gap: 8, marginTop: 'auto', paddingTop: 6, flexWrap: 'wrap' }}>
                <button className="btn ghost mini" disabled={ocupado === g.id} onClick={() => alternar(g)}>
                  {ocupado === g.id ? '…' : noAr ? 'Pausar todas' : 'Reativar todas'}
                </button>
                <button className="btn ghost mini" disabled={ocupado === g.id} onClick={() => abrirEditar(g)}>Editar</button>
                <button className="btn ghost mini" style={{ color: 'var(--coral, #e5533d)', marginLeft: 'auto' }} disabled={ocupado === g.id} onClick={() => setConfirmar(g)}>Remover</button>
              </div>
            </div>
          );
        })}
      </div>

      {/* modal editar grupo */}
      {editar && draft && (
        <div onClick={() => !salvando && (setEditar(null), setDraft(null))} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 55, padding: 16 }}>
          <div className="card" onClick={(e) => e.stopPropagation()} style={{ width: 'min(560px, 100%)', maxHeight: '86vh', overflowY: 'auto' }}>
            <h2 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: 4 }}>Editar grupo</h2>
            <div className="sub" style={{ marginBottom: 14 }}>
              As mudanças valem em <b>todos os {editar.itens.length} item(ns)</b> que usam este grupo. Imagens são ajustadas automaticamente.
            </div>
            <ComplementosEditor grupos={[draft]} onChange={(gs) => setDraft(gs[0] ?? draft)} bloquearGrupos />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
              <button className="btn ghost mini" disabled={salvando} onClick={() => { setEditar(null); setDraft(null); }}>Cancelar</button>
              <button className="btn" disabled={salvando} onClick={salvarEditar}>{salvando ? 'Salvando…' : 'Publicar alterações'}</button>
            </div>
          </div>
        </div>
      )}

      {/* confirmar remoção */}
      {confirmar && (
        <div onClick={() => ocupado !== confirmar.id && setConfirmar(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 55, padding: 16 }}>
          <div className="card" onClick={(e) => e.stopPropagation()} style={{ width: 'min(440px, 100%)' }}>
            <h2 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: 4 }}>Remover grupo?</h2>
            <div className="sub" style={{ marginBottom: 16 }}>
              <b>{confirmar.nome}</b> será desanexado dos {confirmar.itens.length} item(ns) e apagado. Esta ação não pode ser desfeita.
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn ghost mini" disabled={ocupado === confirmar.id} onClick={() => setConfirmar(null)}>Cancelar</button>
              <button className="btn mini" style={{ background: 'var(--coral, #e5533d)', borderColor: 'transparent' }} disabled={ocupado === confirmar.id} onClick={remover}>
                {ocupado === confirmar.id ? 'Removendo…' : 'Remover grupo'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
