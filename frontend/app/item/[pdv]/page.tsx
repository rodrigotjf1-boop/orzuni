'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, type ItemDetalhe, type Shift } from '@/lib/api';
import { useToast } from '@/components/toast';
import { ShiftsEditor } from '@/components/shifts';
import { MoneyInput, brl } from '@/components/money';
import { ImageUpload } from '@/components/image-upload';
import { ComplementosEditor, type GrupoCompl } from '@/components/complementos';

const normCompl = (cs: ItemDetalhe['complementos']): GrupoCompl[] =>
  cs.map((g) => ({ grupo: g.grupo, min: g.min, max: g.max, opcoes: g.opcoes.map((o) => ({ nome: o.nome, preco: o.preco, pdv: o.pdv })) }));

export default function EditorPage() {
  const { pdv } = useParams<{ pdv: string }>();
  const router = useRouter();
  const toast = useToast();
  const [det, setDet] = useState<ItemDetalhe | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  // campos editáveis
  const [nome, setNome] = useState('');
  const [descricao, setDescricao] = useState('');
  const [preco, setPreco] = useState(0);
  const [status, setStatus] = useState<'no_ar' | 'pausado'>('no_ar');
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [imagem, setImagem] = useState<string | null>(null); // só quando trocada
  const [pdvNovo, setPdvNovo] = useState('');
  const [grupos, setGrupos] = useState<GrupoCompl[]>([]);

  const carregar = useCallback(async () => {
    try {
      const d = await api.detalhe(pdv);
      setDet(d);
      setNome(d.nome);
      setDescricao(d.descricao);
      setPreco(d.preco);
      setStatus(d.status);
      setShifts(d.disponibilidade ?? []);
      setImagem(null);
      setPdvNovo(d.pdv);
      setGrupos(normCompl(d.complementos ?? []));
      setErro(null);
    } catch (e: any) {
      setErro(e.message);
    }
  }, [pdv]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const shiftsMudou = !!det && JSON.stringify(shifts) !== JSON.stringify(det.disponibilidade ?? []);
  const pdvMudou = !!pdvNovo.trim() && pdvNovo.trim() !== pdv;
  const complMudou = !!det && JSON.stringify(grupos) !== JSON.stringify(normCompl(det.complementos ?? []));
  const dirty =
    !!det &&
    (nome !== det.nome || descricao !== det.descricao || Math.abs(preco - det.preco) >= 0.005 || status !== det.status || shiftsMudou || !!imagem || pdvMudou || complMudou);

  async function salvar() {
    if (!det || !dirty) return;
    setSalvando(true);
    const campos: any = {};
    if (nome !== det.nome) campos.nome = nome;
    if (descricao !== det.descricao) campos.descricao = descricao;
    if (Math.abs(preco - det.preco) >= 0.005) campos.preco = preco;
    if (status !== det.status) campos.status = status;
    if (shiftsMudou) campos.shifts = shifts;
    if (imagem) campos.imagem = imagem;
    if (pdvMudou) campos.pdv = pdvNovo.trim();
    if (complMudou)
      campos.complementos = grupos
        .filter((g) => g.grupo.trim())
        .map((g) => ({ grupo: g.grupo.trim(), min: g.min, max: g.max, opcoes: g.opcoes.filter((o) => o.nome.trim()).map((o) => ({ nome: o.nome.trim(), preco: o.preco, pdv: o.pdv.trim() || undefined })) }));
    try {
      const r = await api.editar(pdv, campos);
      if (r.ok) {
        toast('<b style="color:var(--green)">Item publicado</b> no iFood ✓');
        // se o código PDV mudou, o item passa a ser identificado pelo novo código
        if (r.pdv && r.pdv !== pdv) setTimeout(() => router.replace(`/item/${encodeURIComponent(r.pdv!)}`), 1500);
        else setTimeout(carregar, 2500);
      } else {
        toast(`Publicado parcialmente. Falhou: ${r.erros.join(', ')}`);
        setTimeout(carregar, 2500);
      }
    } catch (e: any) {
      toast(`Erro: ${e.message}`);
    } finally {
      setSalvando(false);
    }
  }

  const box = {
    width: '100%',
    background: 'var(--ink)',
    border: '1px solid var(--line)',
    borderRadius: 11,
    color: 'var(--cream)',
    fontFamily: 'inherit',
    fontSize: '.95rem',
    padding: '12px 14px',
  } as const;
  const label = { display: 'block', fontFamily: 'var(--font-mono)', fontSize: '.6rem', letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--dim)', marginBottom: 7 } as const;

  return (
    <>
      <div style={{ marginBottom: 14 }}>
        <Link href="/cardapio" className="sub" style={{ color: 'var(--dim)' }}>
          ← Cardápio
        </Link>
      </div>
      <div className="topbar">
        <div>
          <h1>
            Editar <span>item</span>
          </h1>
          <div className="mono" style={{ color: 'var(--dim)', marginTop: 6, textTransform: 'none', letterSpacing: '.05em' }}>
            PDV {pdv}
            {det ? ` · ${det.categoria}` : ''}
          </div>
        </div>
        <button className="btn" disabled={!dirty || salvando} onClick={salvar}>
          {salvando ? 'Publicando…' : dirty ? 'Publicar alterações' : 'Publicar'}
        </button>
      </div>

      {erro && <div className="errbox">Não consegui carregar: {erro}</div>}
      {!det && !erro && <div className="loading">Carregando…</div>}

      {det && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.5fr) minmax(0,1fr)', gap: 18, alignItems: 'start' }}>
          <div className="card">
            <div style={{ marginBottom: 16 }}>
              <label style={label}>Foto</label>
              <ImageUpload value={imagem ?? undefined} onPick={setImagem} />
              {!imagem && <div className="sub" style={{ marginTop: 6, fontSize: '.68rem' }}>Escolha uma foto para atualizar a imagem do item.</div>}
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={label}>Nome</label>
              <input style={box} value={nome} onChange={(e) => setNome(e.target.value)} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={label}>Descrição</label>
              <textarea style={{ ...box, minHeight: 80, resize: 'vertical', lineHeight: 1.5 }} value={descricao} onChange={(e) => setDescricao(e.target.value)} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={label}>Código PDV <span style={{ color: pdvMudou ? 'var(--tanger)' : 'var(--dim)' }}>(integração Regem/iFood)</span></label>
              <input style={{ ...box, fontFamily: 'var(--font-mono)' }} value={pdvNovo} onChange={(e) => setPdvNovo(e.target.value)} placeholder="Ex.: 38520" />
              {pdvMudou && <div className="sub" style={{ marginTop: 6, fontSize: '.68rem', color: 'var(--tanger)' }}>O item passará a ser identificado por este código ao publicar.</div>}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div>
                <label style={label}>Preço (entrega)</label>
                <MoneyInput valor={preco} onChange={setPreco} ariaLabel="Preço" />
                {det.promo && (
                  <div className="mono" style={{ color: 'var(--tanger)', fontSize: '.62rem', marginTop: 6, textTransform: 'none' }}>
                    em promoção (de R$ {brl(det.promo.de)}) — o de/por é preservado
                  </div>
                )}
              </div>
              <div>
                <label style={label}>Disponibilidade</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 11, padding: '10px 14px' }}>
                  <div style={{ flex: 1 }}>
                    <b style={{ fontSize: '.9rem' }}>{status === 'no_ar' ? 'No ar' : 'Pausado'}</b>
                  </div>
                  <button
                    role="switch"
                    aria-checked={status === 'no_ar'}
                    onClick={() => setStatus(status === 'no_ar' ? 'pausado' : 'no_ar')}
                    style={{
                      width: 46,
                      height: 26,
                      borderRadius: 20,
                      border: 0,
                      cursor: 'pointer',
                      position: 'relative',
                      background: status === 'no_ar' ? 'var(--green)' : 'var(--ink3)',
                      transition: 'background .2s',
                    }}
                  >
                    <span style={{ position: 'absolute', top: 3, left: status === 'no_ar' ? 23 : 3, width: 20, height: 20, borderRadius: '50%', background: status === 'no_ar' ? 'var(--ink)' : 'var(--cream)', transition: 'left .2s' }} />
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 12 }}>
              <div className="mono" style={{ color: 'var(--dim)' }}>complementos ({grupos.length})</div>
              {complMudou && <span className="mono" style={{ fontSize: '.55rem', color: 'var(--tanger)' }}>alterado</span>}
            </div>
            <ComplementosEditor grupos={grupos} onChange={setGrupos} />
            <div className="sub" style={{ marginTop: 10, fontSize: '.68rem' }}>Editar aqui substitui os complementos do item ao publicar.</div>

            <div style={{ borderTop: '1px solid var(--line)', marginTop: 16, paddingTop: 16 }}>
              <div className="mono" style={{ color: 'var(--dim)', marginBottom: 8 }}>disponibilidade</div>
              <ShiftsEditor shifts={shifts} onChange={setShifts} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
