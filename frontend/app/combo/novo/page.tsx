'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, type Shift, type ItemCardapio } from '@/lib/api';
import { useToast } from '@/components/toast';
import { ShiftsEditor } from '@/components/shifts';
import { MoneyInput, brl } from '@/components/money';
import { ImageUpload } from '@/components/image-upload';
import { usePending } from '@/components/pending-changes';

type Tipo = 'ingredientes' | 'especificacao';
interface Custom {
  nome: string;
  tipo: Tipo;
  min: number;
  max: number;
  opcoes: Array<{ nome: string; preco: number }>;
}
interface Opcao {
  nome: string;
  preco: number;
  refPdv?: string; // set = referencia um item já cadastrado do cardápio
  customizacoes: Custom[];
}
interface Grupo {
  nome: string;
  principal: boolean;
  min: number;
  max: number;
  opcoes: Opcao[];
}

const box = { width: '100%', background: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 11, color: 'var(--cream)', fontFamily: 'inherit', fontSize: '.92rem', padding: '11px 13px' } as const;
const label = { display: 'block', fontFamily: 'var(--font-mono)', fontSize: '.6rem', letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--dim)', marginBottom: 7 } as const;
const num = { width: 58, background: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 9, color: 'var(--cream)', fontFamily: 'var(--font-mono)', fontSize: '.82rem', padding: '8px', textAlign: 'center' } as const;
const MinMax = ({ min, max, onMin, onMax }: { min: number; max: number; onMin: (n: number) => void; onMax: (n: number) => void }) => (
  <>
    <span className="mono" style={{ fontSize: '.55rem', color: 'var(--dim)' }}>mín</span>
    <input style={num} type="number" min={0} value={min} onChange={(e) => onMin(+e.target.value)} />
    <span className="mono" style={{ fontSize: '.55rem', color: 'var(--dim)' }}>máx</span>
    <input style={num} type="number" min={0} value={max} onChange={(e) => onMax(+e.target.value)} />
  </>
);
const PrecoInput = ({ v, onChange }: { v: number; onChange: (n: number) => void }) => (
  <MoneyInput valor={v} onChange={onChange} style={{ width: 96, fontSize: '.82rem', padding: '8px 8px 8px 28px' }} ariaLabel="Preço" />
);

export default function NovoComboPage() {
  const router = useRouter();
  const toast = useToast();
  const { registrar, navegar } = usePending();
  const [nome, setNome] = useState('');
  const [descricao, setDescricao] = useState('');
  const [imagem, setImagem] = useState<string | null>(null);
  const [categoria, setCategoria] = useState('Combos');
  const [pdv, setPdv] = useState('');
  const [grupos, setGrupos] = useState<Grupo[]>([
    { nome: '', principal: true, min: 1, max: 1, opcoes: [{ nome: '', preco: 0, customizacoes: [] }] },
  ]);
  const [modoPreco, setModoPreco] = useState<'produtos' | 'combo'>('produtos');
  const [precoTotal, setPrecoTotal] = useState(0);
  const [desconto, setDesconto] = useState(0);
  const [itens, setItens] = useState<ItemCardapio[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  // itens já cadastrados (para referenciar em uma opção)
  useEffect(() => {
    api.cardapio().then((r) => setItens(r.itens.filter((i) => i.pdv))).catch(() => {});
  }, []);
  const precoFinal = Math.max(0, precoTotal * (1 - (desconto || 0) / 100));

  const updGrupo = (gi: number, patch: Partial<Grupo>) => setGrupos((g) => g.map((x, k) => (k === gi ? { ...x, ...patch } : x)));
  const marcarPrincipal = (gi: number) => setGrupos((g) => g.map((x, k) => ({ ...x, principal: k === gi })));
  const addGrupo = () => setGrupos((g) => [...g, { nome: '', principal: false, min: 1, max: 1, opcoes: [{ nome: '', preco: 0, customizacoes: [] }] }]);
  const delGrupo = (gi: number) => setGrupos((g) => g.filter((_, k) => k !== gi));

  const updOpcao = (gi: number, oi: number, patch: Partial<Opcao>) =>
    setGrupos((g) => g.map((x, k) => (k === gi ? { ...x, opcoes: x.opcoes.map((o, m) => (m === oi ? { ...o, ...patch } : o)) } : x)));
  const addOpcao = (gi: number) => setGrupos((g) => g.map((x, k) => (k === gi ? { ...x, opcoes: [...x.opcoes, { nome: '', preco: 0, customizacoes: [] }] } : x)));
  const delOpcao = (gi: number, oi: number) => setGrupos((g) => g.map((x, k) => (k === gi ? { ...x, opcoes: x.opcoes.filter((_, m) => m !== oi) } : x)));

  const setCustoms = (gi: number, oi: number, cs: Custom[]) => updOpcao(gi, oi, { customizacoes: cs });

  const erros: string[] = [];
  if (!nome.trim()) erros.push('informe o nome');
  if (!categoria.trim()) erros.push('informe a categoria');
  if (grupos.filter((g) => g.principal).length !== 1) erros.push('marque exatamente um grupo como principal');
  grupos.forEach((g, i) => {
    if (!g.nome.trim()) erros.push(`grupo ${i + 1} sem nome`);
    if (g.max < g.min || g.max < 1) erros.push(`grupo "${g.nome || i + 1}": mín/máx inválidos`);
    if (!g.opcoes.some((o) => o.nome.trim() || o.refPdv)) erros.push(`grupo "${g.nome || i + 1}" sem opções`);
  });
  if (modoPreco === 'combo' && precoTotal <= 0) erros.push('informe o preço total do combo');
  const valido = erros.length === 0;

  async function salvarInterno(): Promise<boolean> {
    if (!valido) return false;
    setSalvando(true);
    setErro('');
    try {
      const r = await api.criarCombo({
        nome: nome.trim(),
        descricao: descricao.trim() || undefined,
        imagem: imagem || undefined,
        categoria: categoria.trim(),
        pdv: pdv.trim() || undefined,
        modoPreco,
        ...(modoPreco === 'combo' ? { precoTotal, descontoPct: desconto || 0 } : {}),
        grupos: grupos.map((g) => ({
          nome: g.nome.trim(),
          principal: g.principal,
          min: g.min,
          max: g.max,
          opcoes: g.opcoes
            .filter((o) => o.nome.trim() || o.refPdv)
            .map((o) => {
              const customizacoes = o.customizacoes.length
                ? o.customizacoes
                    .filter((c) => c.nome.trim())
                    .map((c) => ({
                      nome: c.nome.trim(),
                      tipo: c.tipo,
                      min: c.min,
                      max: c.max,
                      opcoes: c.opcoes.filter((co) => co.nome.trim()).map((co) => ({ nome: co.nome.trim(), preco: co.preco })),
                    }))
                : undefined;
              // referencia item existente OU cria produto novo
              return o.refPdv ? { refPdv: o.refPdv, customizacoes } : { nome: o.nome.trim(), preco: o.preco, customizacoes };
            }),
        })),
        shifts: shifts.length ? shifts : undefined,
      });
      if (r.ok) {
        toast('<b style="color:var(--green)">Combo criado</b> no iFood ✓');
        return true;
      }
      setErro(r.erro || 'não foi possível criar');
      return false;
    } catch (e: any) {
      setErro(e.message);
      return false;
    } finally {
      setSalvando(false);
    }
  }

  async function salvar() {
    if (await salvarInterno()) router.push('/cardapio');
  }

  // guarda de "começou a criar e não salvou"
  const comecou = !!(nome.trim() || pdv.trim() || grupos.some((g) => g.nome.trim() || g.opcoes.some((o) => o.nome.trim())));
  const mudancas: string[] = [];
  if (nome.trim()) mudancas.push(`Nome: ${nome.trim()}`);
  const nGrp = grupos.filter((g) => g.nome.trim()).length;
  if (nGrp) mudancas.push(`${nGrp} grupo(s)`);
  const nOpc = grupos.reduce((s, g) => s + g.opcoes.filter((o) => o.nome.trim()).length, 0);
  if (nOpc) mudancas.push(`${nOpc} opção(ões)`);
  if (pdv.trim()) mudancas.push(`Código PDV: ${pdv.trim()}`);
  useEffect(() => {
    registrar(
      comecou
        ? { titulo: 'novo combo', aviso: 'Você começou a criar um combo e ainda não salvou. O que deseja fazer?', mudancas, publicar: salvarInterno, descartar: () => {}, acaoLabel: 'Criar e sair', podePublicar: valido }
        : null,
    );
    return () => registrar(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comecou, valido, mudancas.join('|'), nome, pdv, grupos, shifts]);

  return (
    <>
      <div style={{ marginBottom: 14 }}>
        <Link href="/cardapio" className="sub" style={{ color: 'var(--dim)' }} onClick={(e) => { e.preventDefault(); navegar(() => router.push('/cardapio')); }}>← Cardápio</Link>
      </div>
      <div className="topbar">
        <div>
          <h1>Novo <span>combo</span></h1>
          <div className="sub">Grupos principais (escolha o lanche, a bebida) + customizações por opção (ponto da carne, tirar ingrediente).</div>
        </div>
        <button className="btn" disabled={!valido || salvando} onClick={salvar}>
          {salvando ? 'Criando…' : 'Criar combo'}
        </button>
      </div>

      {erro && <div className="errbox" style={{ marginBottom: 16 }}>{erro}</div>}

      <div className="card">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div>
            <label style={label}>Nome <span style={{ color: nome.length > 100 ? 'var(--coral)' : 'var(--dim)' }}>({nome.length}/100)</span></label>
            <input style={box} value={nome} onChange={(e) => setNome(e.target.value)} maxLength={120} placeholder="Ex.: Combo Burger + Refri" />
          </div>
          <div>
            <label style={label}>Categoria</label>
            <input style={box} value={categoria} onChange={(e) => setCategoria(e.target.value)} placeholder="Combos" />
          </div>
        </div>
        <div style={{ marginTop: 14 }}>
          <label style={label}>Descrição <span style={{ color: 'var(--dim)' }}>(opcional)</span></label>
          <textarea style={{ ...box, minHeight: 66, resize: 'vertical' }} value={descricao} onChange={(e) => setDescricao(e.target.value)} maxLength={1000} placeholder="O que vem no combo…" />
        </div>
        <div style={{ marginTop: 14 }}>
          <label style={label}>Foto do combo <span style={{ color: 'var(--dim)' }}>(opcional)</span></label>
          <ImageUpload value={imagem} onPick={setImagem} />
        </div>
        <div style={{ marginTop: 14 }}>
          <label style={label}>Código PDV <span style={{ color: 'var(--dim)' }}>(opcional)</span></label>
          <input style={{ ...box, fontFamily: 'var(--font-mono)' }} value={pdv} onChange={(e) => setPdv(e.target.value)} placeholder="Ex.: 90210 — vincula ao seu Regem/PDV" />
          <div className="sub" style={{ marginTop: 6, fontSize: '.68rem' }}>Código do seu PDV/Regem para integração. Vazio = gerado automático.</div>
        </div>
      </div>

      {grupos.map((g, gi) => (
        <div key={gi} className="card" style={{ marginTop: 16, borderColor: g.principal ? 'rgba(255,162,38,.4)' : undefined }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <input style={{ ...box, flex: 1, minWidth: 160 }} value={g.nome} onChange={(e) => updGrupo(gi, { nome: e.target.value })} placeholder="Nome do grupo (ex.: Escolha o lanche)" />
            <label className="mono" style={{ fontSize: '.62rem', color: g.principal ? 'var(--tanger)' : 'var(--dim)', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', textTransform: 'none' }}>
              <input type="radio" name="principal" checked={g.principal} onChange={() => marcarPrincipal(gi)} style={{ accentColor: 'var(--tanger)', cursor: 'pointer' }} />
              principal
            </label>
            <MinMax min={g.min} max={g.max} onMin={(n) => updGrupo(gi, { min: n })} onMax={(n) => updGrupo(gi, { max: n })} />
            {grupos.length > 1 && <button className="btn ghost mini" onClick={() => delGrupo(gi)}>remover grupo</button>}
          </div>

          <div style={{ marginTop: 12, paddingLeft: 4 }}>
            {g.opcoes.map((o, oi) => (
              <div key={oi} style={{ border: '1px solid var(--line)', borderRadius: 12, background: 'var(--ink2)', padding: 12, marginTop: 8 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <select
                    value={o.refPdv ?? ''}
                    onChange={(e) => {
                      const p = e.target.value;
                      if (!p) updOpcao(gi, oi, { refPdv: undefined, nome: '', preco: 0 });
                      else {
                        const it = itens.find((i) => i.pdv === p);
                        updOpcao(gi, oi, { refPdv: p, nome: it?.nome ?? '', preco: it?.preco ?? 0 });
                      }
                    }}
                    title="Criar um produto novo ou usar um item já cadastrado no cardápio"
                    style={{ background: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 9, color: 'var(--cream)', fontFamily: 'inherit', fontSize: '.8rem', padding: '9px 10px', maxWidth: 200, cursor: 'pointer' }}
                  >
                    <option value="">✍️ Criar novo</option>
                    {itens.length > 0 && <optgroup label="Do cardápio">{itens.map((i) => <option key={i.pdv} value={i.pdv!}>{i.nome}</option>)}</optgroup>}
                  </select>
                  {o.refPdv ? (
                    <span style={{ flex: 1, minWidth: 130, padding: '9px 12px', background: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 11, fontSize: '.9rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                      {o.nome || '(item)'}
                      <span className="mono" style={{ color: 'var(--dim)', fontSize: '.58rem' }}>· do cardápio</span>
                    </span>
                  ) : (
                    <input style={{ ...box, flex: 1, minWidth: 130, padding: '9px 12px' }} value={o.nome} onChange={(e) => updOpcao(gi, oi, { nome: e.target.value })} placeholder="Opção (ex.: X-Burger)" />
                  )}
                  {modoPreco === 'produtos' &&
                    (o.refPdv ? (
                      <span className="mono" style={{ color: 'var(--dim)', fontSize: '.82rem', minWidth: 74, textAlign: 'right' }}>R$ {brl(o.preco)}</span>
                    ) : (
                      <PrecoInput v={o.preco} onChange={(v) => updOpcao(gi, oi, { preco: v })} />
                    ))}
                  {g.opcoes.length > 1 && <button className="btn ghost mini" onClick={() => delOpcao(gi, oi)}>×</button>}
                </div>
                <CustomEditor customs={o.customizacoes} onChange={(cs) => setCustoms(gi, oi, cs)} />
              </div>
            ))}
            <button className="btn ghost mini" style={{ marginTop: 8 }} onClick={() => addOpcao(gi)}>+ opção</button>
          </div>
        </div>
      ))}

      <button className="btn ghost" style={{ marginTop: 14 }} onClick={addGrupo}>+ Grupo</button>

      <div className="card" style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: '1.02rem', fontWeight: 700, marginBottom: 4 }}>Como cobrar o combo?</h2>
        <div className="sub" style={{ marginBottom: 12 }}>Escolha a modalidade de preço.</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {[
            { v: 'produtos', t: 'Preço nos produtos', d: 'O combo custa a soma dos itens escolhidos pelo cliente.' },
            { v: 'combo', t: 'Preço no combo', d: 'Você define um preço fixo com desconto — vira uma oferta “de/por”.' },
          ].map((m) => (
            <label
              key={m.v}
              onClick={() => setModoPreco(m.v as 'produtos' | 'combo')}
              style={{ border: `1px solid ${modoPreco === m.v ? 'var(--tanger)' : 'var(--line)'}`, borderRadius: 12, padding: 12, cursor: 'pointer', background: modoPreco === m.v ? 'rgba(255,162,38,.06)' : 'var(--ink)' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
                <input type="radio" name="modoPreco" checked={modoPreco === m.v} onChange={() => setModoPreco(m.v as 'produtos' | 'combo')} style={{ accentColor: 'var(--tanger)' }} />
                {m.t}
              </div>
              <div className="sub" style={{ margin: '6px 0 0', fontSize: '.75rem' }}>{m.d}</div>
            </label>
          ))}
        </div>
        {modoPreco === 'combo' && (
          <div style={{ display: 'flex', gap: 16, marginTop: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div>
              <label style={label}>Preço total</label>
              <MoneyInput valor={precoTotal} onChange={setPrecoTotal} style={{ width: 130 }} ariaLabel="Preço total do combo" />
            </div>
            <div>
              <label style={label}>Desconto (%)</label>
              <input type="number" min={0} max={99} value={desconto} onChange={(e) => setDesconto(Math.min(99, Math.max(0, +e.target.value)))} style={{ ...num, width: 84 }} />
            </div>
            <div>
              <label style={label}>Preço final</label>
              <div className="mono" style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--tanger)', padding: '4px 0' }}>R$ {brl(precoFinal)}</div>
            </div>
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: '1.02rem', fontWeight: 700, marginBottom: 6 }}>Disponibilidade</h2>
        <div className="sub" style={{ marginBottom: 4 }}>Agende por horário e dias. Vazio = sempre disponível.</div>
        <ShiftsEditor shifts={shifts} onChange={setShifts} />
      </div>

      {!valido && nome && (
        <div className="sub" style={{ marginTop: 12, color: 'var(--tanger)' }}>Ajuste antes de criar: {erros.join(' · ')}</div>
      )}
    </>
  );
}

/** 3º nível: customizações da opção (ingredientes / especificação). */
function CustomEditor({ customs, onChange }: { customs: Custom[]; onChange: (c: Custom[]) => void }) {
  const add = () => onChange([...customs, { nome: '', tipo: 'especificacao', min: 0, max: 1, opcoes: [{ nome: '', preco: 0 }] }]);
  const upd = (ci: number, patch: Partial<Custom>) => onChange(customs.map((c, k) => (k === ci ? { ...c, ...patch } : c)));
  const del = (ci: number) => onChange(customs.filter((_, k) => k !== ci));
  const addOp = (ci: number) => onChange(customs.map((c, k) => (k === ci ? { ...c, opcoes: [...c.opcoes, { nome: '', preco: 0 }] } : c)));
  const updOp = (ci: number, oi: number, patch: Partial<{ nome: string; preco: number }>) =>
    onChange(customs.map((c, k) => (k === ci ? { ...c, opcoes: c.opcoes.map((o, m) => (m === oi ? { ...o, ...patch } : o)) } : c)));
  const delOp = (ci: number, oi: number) => onChange(customs.map((c, k) => (k === ci ? { ...c, opcoes: c.opcoes.filter((_, m) => m !== oi) } : c)));

  return (
    <div style={{ marginTop: 10, marginLeft: 10, paddingLeft: 12, borderLeft: '2px solid var(--line)' }}>
      {customs.map((c, ci) => (
        <div key={ci} style={{ marginTop: ci ? 10 : 2 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input style={{ ...box, flex: 1, minWidth: 130, padding: '8px 11px' }} value={c.nome} onChange={(e) => upd(ci, { nome: e.target.value })} placeholder="Customização (ex.: Ponto da carne)" />
            <select style={{ background: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 9, color: 'var(--cream)', fontFamily: 'var(--font-mono)', fontSize: '.75rem', padding: '8px' }} value={c.tipo} onChange={(e) => upd(ci, { tipo: e.target.value as Tipo })}>
              <option value="especificacao">especificação</option>
              <option value="ingredientes">ingredientes</option>
            </select>
            <MinMax min={c.min} max={c.max} onMin={(n) => upd(ci, { min: n })} onMax={(n) => upd(ci, { max: n })} />
            <button className="btn ghost mini" onClick={() => del(ci)}>×</button>
          </div>
          <div style={{ marginTop: 6, marginLeft: 8 }}>
            {c.opcoes.map((o, oi) => (
              <div key={oi} style={{ display: 'flex', gap: 6, marginTop: 5, alignItems: 'center' }}>
                <input style={{ ...box, flex: 1, padding: '7px 10px', fontSize: '.85rem' }} value={o.nome} onChange={(e) => updOp(ci, oi, { nome: e.target.value })} placeholder="Opção (ex.: Ao ponto)" />
                <PrecoInput v={o.preco} onChange={(v) => updOp(ci, oi, { preco: v })} />
                {c.opcoes.length > 1 && <button className="btn ghost mini" onClick={() => delOp(ci, oi)}>×</button>}
              </div>
            ))}
            <button className="btn ghost mini" style={{ marginTop: 6 }} onClick={() => addOp(ci)}>+ opção</button>
          </div>
        </div>
      ))}
      <button className="btn ghost mini" style={{ marginTop: 8 }} onClick={add}>+ customização (3º nível)</button>
    </div>
  );
}
