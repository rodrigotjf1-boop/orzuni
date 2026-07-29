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
import { usePending } from '@/components/pending-changes';

const normCompl = (cs: ItemDetalhe['complementos']): GrupoCompl[] =>
  cs.map((g) => ({ grupo: g.grupo, min: g.min, max: g.max, opcoes: g.opcoes.map((o) => ({ nome: o.nome, preco: o.preco, pdv: o.pdv, imagem: o.imagem || null })) }));

export default function EditorPage() {
  const { pdv } = useParams<{ pdv: string }>();
  const router = useRouter();
  const toast = useToast();
  const { registrar, navegar } = usePending();
  const [det, setDet] = useState<ItemDetalhe | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  // campos editáveis
  const [nome, setNome] = useState('');
  const [descricao, setDescricao] = useState('');
  const [preco, setPreco] = useState(0);
  const [status, setStatus] = useState<'no_ar' | 'pausado'>('no_ar');
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [imagem, setImagem] = useState<string | null>(null); // data-URI da foto NOVA (só quando trocada)
  const [fotoAtual, setFotoAtual] = useState<string | null>(null); // URL da foto já cadastrada
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
      setFotoAtual(d.imagem || null);
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

  // lista legível das alterações pendentes (para o aviso ao sair)
  const mudancas: string[] = [];
  if (det) {
    if (nome !== det.nome) mudancas.push('Nome');
    if (descricao !== det.descricao) mudancas.push('Descrição');
    if (Math.abs(preco - det.preco) >= 0.005) mudancas.push(`Preço (R$ ${brl(preco)})`);
    if (status !== det.status) mudancas.push(`Disponibilidade → ${status === 'no_ar' ? 'no ar' : 'pausado'}`);
    if (shiftsMudou) mudancas.push('Horários de disponibilidade');
    if (imagem) mudancas.push('Foto');
    if (pdvMudou) mudancas.push(`Código PDV → ${pdvNovo.trim()}`);
    if (complMudou) mudancas.push('Complementos');
  }

  // faz o PATCH; retorna sucesso. NÃO navega (quem chama decide o que fazer depois).
  async function salvarInterno(): Promise<boolean> {
    if (!det || !dirty) return true;
    setSalvando(true);
    const campos: any = {};
    if (nome !== det.nome) campos.nome = nome;
    if (descricao !== det.descricao) campos.descricao = descricao;
    if (Math.abs(preco - det.preco) >= 0.005) campos.preco = preco;
    if (status !== det.status) campos.status = status;
    if (shiftsMudou) campos.shifts = shifts;
    if (imagem) campos.imagem = imagem;
    if (pdvMudou) campos.pdv = pdvNovo.trim();
    if (complMudou && (det?.tipo ?? 'DEFAULT') === 'DEFAULT')
      campos.complementos = grupos
        .filter((g) => g.grupo.trim())
        .map((g) => ({ grupo: g.grupo.trim(), min: g.min, max: g.max, opcoes: g.opcoes.filter((o) => o.nome.trim()).map((o) => ({ nome: o.nome.trim(), preco: o.preco, pdv: o.pdv.trim() || undefined, imagem: o.imagem || undefined })) }));
    try {
      const r = await api.editar(pdv, campos);
      if (r.ok) {
        toast('<b style="color:var(--green)">Item publicado</b> no iFood ✓');
        return true;
      }
      toast(`Publicado parcialmente. Falhou: ${r.erros.join(', ')}`);
      return false;
    } catch (e: any) {
      toast(`Erro: ${e.message}`);
      return false;
    } finally {
      setSalvando(false);
    }
  }

  // botão "Publicar alterações": salva e recarrega (ou navega se o PDV mudou)
  async function salvar() {
    const ok = await salvarInterno();
    if (ok && pdvMudou) setTimeout(() => router.replace(`/item/${encodeURIComponent(pdvNovo.trim())}`), 1200);
    else setTimeout(carregar, 2500);
  }

  // registra a pendência para o guard (avisa ao trocar de tela/sair sem publicar)
  useEffect(() => {
    registrar(dirty ? { titulo: det?.nome || `item ${pdv}`, mudancas, publicar: salvarInterno, descartar: carregar } : null);
    return () => registrar(null);
    // re-registra com o fechamento mais recente sempre que algo relevante muda
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, mudancas.join('|'), nome, descricao, preco, status, imagem, pdvNovo, shifts, grupos, det]);

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
        <Link href="/cardapio" className="sub" style={{ color: 'var(--dim)' }} onClick={(e) => { e.preventDefault(); navegar(() => router.push('/cardapio')); }}>
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
              <ImageUpload value={imagem ?? fotoAtual ?? undefined} onPick={setImagem} />
              {imagem && <div className="sub" style={{ marginTop: 6, fontSize: '.68rem', color: 'var(--tanger)' }}>Nova foto — publique para atualizar.</div>}
              {!imagem && !fotoAtual && <div className="sub" style={{ marginTop: 6, fontSize: '.68rem' }}>Este item não tem foto. Escolha uma para adicionar.</div>}
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
            {(det?.tipo ?? 'DEFAULT') === 'DEFAULT' ? (
              <>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 12 }}>
                  <div className="mono" style={{ color: 'var(--dim)' }}>complementos ({grupos.length})</div>
                  {complMudou && <span className="mono" style={{ fontSize: '.55rem', color: 'var(--tanger)' }}>alterado</span>}
                </div>
                <ComplementosEditor grupos={grupos} onChange={setGrupos} />
                <div className="sub" style={{ marginTop: 10, fontSize: '.68rem' }}>Editar aqui substitui os complementos do item ao publicar.</div>
              </>
            ) : (
              <div className="sub" style={{ margin: 0, fontSize: '.72rem' }}>
                <b>{det?.tipo === 'PIZZA' ? 'Pizza' : 'Combo'}:</b> a estrutura de {det?.tipo === 'PIZZA' ? 'tamanho/massa/borda/sabor' : 'grupos e opções'} é gerenciada na criação — não é editável por aqui (evita corromper o {det?.tipo === 'PIZZA' ? 'formato da pizza' : 'combo'}). Nome, descrição, foto, preço e disponibilidade acima valem normalmente.
              </div>
            )}

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
