'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, type Shift } from '@/lib/api';
import { useToast } from '@/components/toast';
import { ShiftsEditor } from '@/components/shifts';
import { MoneyInput } from '@/components/money';
import { usePending } from '@/components/pending-changes';

interface Linha {
  nome: string;
  preco: number;
  pedacos?: string;
  maxSabores?: number;
}

const box = { width: '100%', background: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 11, color: 'var(--cream)', fontFamily: 'inherit', fontSize: '.92rem', padding: '11px 13px' } as const;
const label = { display: 'block', fontFamily: 'var(--font-mono)', fontSize: '.6rem', letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--dim)', marginBottom: 7 } as const;

/** Ilustração: pizza dividida em N fatias/sabores (informativo, como no portal). */
function PizzaSlices({ n }: { n: number }) {
  const cx = 15, cy = 15, r = 13;
  const cores = ['#E9A23B', '#D9722E', '#C94F3B', '#7Fb069'];
  const wedge = (i: number) => {
    if (n <= 1) return <circle key="c" cx={cx} cy={cy} r={r} fill={cores[0]} />;
    const a0 = (i / n) * 2 * Math.PI - Math.PI / 2;
    const a1 = ((i + 1) / n) * 2 * Math.PI - Math.PI / 2;
    const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    return <path key={i} d={`M${cx},${cy} L${x0},${y0} A${r},${r} 0 0 1 ${x1},${y1} Z`} fill={cores[i % cores.length]} />;
  };
  return (
    <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true" style={{ flex: 'none' }}>
      <circle cx={cx} cy={cy} r={r + 1} fill="#8a5a2b" />
      {Array.from({ length: Math.max(1, n) }, (_, i) => wedge(i))}
    </svg>
  );
}

/** Editor de um grupo de linhas (tamanhos/massas/bordas/sabores). */
function Grupo({
  titulo,
  ajuda,
  linhas,
  onChange,
  comTamanho,
}: {
  titulo: string;
  ajuda: string;
  linhas: Linha[];
  onChange: (l: Linha[]) => void;
  comTamanho?: boolean;
}) {
  const add = () => onChange([...linhas, { nome: '', preco: 0, ...(comTamanho ? { pedacos: '', maxSabores: 1 } : {}) }]);
  const upd = (i: number, patch: Partial<Linha>) => onChange(linhas.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const del = (i: number) => onChange(linhas.filter((_, k) => k !== i));

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: linhas.length ? 12 : 0 }}>
        <div>
          <h2 style={{ fontSize: '1.02rem', fontWeight: 700 }}>{titulo}</h2>
          <div className="sub" style={{ marginTop: 2 }}>{ajuda}</div>
        </div>
        <button className="btn ghost mini" style={{ marginLeft: 'auto' }} onClick={add}>+ Adicionar</button>
      </div>
      {linhas.map((l, i) => (
        <div key={i} style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input style={{ ...box, flex: 1, minWidth: 140, padding: '9px 12px' }} value={l.nome} onChange={(e) => upd(i, { nome: e.target.value })} placeholder="Nome" />
            {comTamanho && (
              <>
                <label className="mono" style={{ fontSize: '.55rem', color: 'var(--dim)', display: 'flex', flexDirection: 'column', gap: 3, textTransform: 'uppercase' }}>
                  fatias
                  <input style={{ width: 62, background: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 9, color: 'var(--cream)', fontFamily: 'var(--font-mono)', fontSize: '.82rem', padding: '8px', textAlign: 'center' }} type="number" min={0} value={l.pedacos ?? ''} onChange={(e) => upd(i, { pedacos: e.target.value })} placeholder="8" />
                </label>
                <label className="mono" style={{ fontSize: '.55rem', color: 'var(--dim)', display: 'flex', flexDirection: 'column', gap: 3, textTransform: 'uppercase' }}>
                  máx. sabores
                  <select style={{ width: 70, background: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 9, color: 'var(--cream)', fontFamily: 'var(--font-mono)', fontSize: '.82rem', padding: '8px' }} value={l.maxSabores ?? 1} onChange={(e) => upd(i, { maxSabores: +e.target.value })}>
                    {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
              </>
            )}
            <MoneyInput valor={l.preco} onChange={(v) => upd(i, { preco: v })} style={{ width: 120, fontSize: '.82rem', padding: '9px 8px 9px 30px' }} ariaLabel={`Preço ${titulo}`} />
            <button className="btn ghost mini" onClick={() => del(i)}>×</button>
          </div>
          {comTamanho && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, marginLeft: 2 }}>
              <PizzaSlices n={l.maxSabores ?? 1} />
              <span className="sub" style={{ margin: 0, fontSize: '.72rem' }}>
                {l.pedacos ? `cortada em ${l.pedacos} pedaços · ` : ''}aceita {(l.maxSabores ?? 1) === 1 ? '1 sabor' : `até ${l.maxSabores} sabores`}
              </span>
            </div>
          )}
        </div>
      ))}
      {!linhas.length && <div className="sub" style={{ marginTop: 6, color: 'var(--dim)' }}>Nenhum ainda.</div>}
    </div>
  );
}

export default function NovaPizzaPage() {
  const router = useRouter();
  const toast = useToast();
  const { registrar, navegar } = usePending();
  const [nome, setNome] = useState('');
  const [categoria, setCategoria] = useState('Pizzas');
  const [pdv, setPdv] = useState('');
  const [tamanhos, setTamanhos] = useState<Linha[]>([{ nome: 'Grande', preco: 0, pedacos: '8', maxSabores: 2 }]);
  const [massas, setMassas] = useState<Linha[]>([{ nome: 'Tradicional', preco: 0 }]);
  const [bordas, setBordas] = useState<Linha[]>([{ nome: 'Tradicional', preco: 0 }]);
  const [sabores, setSabores] = useState<Linha[]>([{ nome: '', preco: 0 }]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  const erros: string[] = [];
  if (!nome.trim()) erros.push('informe o nome');
  if (!categoria.trim()) erros.push('informe a categoria');
  if (!tamanhos.length) erros.push('adicione ao menos um tamanho');
  tamanhos.forEach((t, i) => {
    if (!t.nome.trim()) erros.push(`tamanho ${i + 1} sem nome`);
    if (t.preco <= 0) erros.push(`tamanho "${t.nome || i + 1}": preço deve ser positivo`);
  });
  if (!massas.some((m) => m.nome.trim())) erros.push('adicione ao menos uma massa');
  if (!sabores.some((s) => s.nome.trim())) erros.push('adicione ao menos um sabor');
  const valido = erros.length === 0;

  const limpa = (l: Linha[]) => l.filter((x) => x.nome.trim());

  async function salvarInterno(): Promise<boolean> {
    if (!valido) return false;
    setSalvando(true);
    setErro('');
    try {
      const r = await api.criarPizza({
        nome: nome.trim(),
        categoria: categoria.trim(),
        pdv: pdv.trim() || undefined,
        tamanhos: limpa(tamanhos).map((t) => ({ nome: t.nome.trim(), preco: t.preco, pedacos: t.pedacos ? parseInt(t.pedacos, 10) : undefined, maxSabores: t.maxSabores ?? 1 })),
        massas: limpa(massas).map((m) => ({ nome: m.nome.trim(), preco: m.preco })),
        bordas: limpa(bordas).map((b) => ({ nome: b.nome.trim(), preco: b.preco })),
        sabores: limpa(sabores).map((s) => ({ nome: s.nome.trim(), preco: s.preco })),
        shifts: shifts.length ? shifts : undefined,
      });
      if (r.ok) {
        toast('<b style="color:var(--green)">Pizza criada</b> no iFood ✓');
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
  const comecou = !!(nome.trim() || pdv.trim() || sabores.some((s) => s.nome.trim()) || tamanhos.some((t) => t.preco > 0));
  const mudancas: string[] = [];
  if (nome.trim()) mudancas.push(`Nome: ${nome.trim()}`);
  const nSab = sabores.filter((s) => s.nome.trim()).length;
  if (nSab) mudancas.push(`${nSab} sabor(es)`);
  const nTam = tamanhos.filter((t) => t.nome.trim() && t.preco > 0).length;
  if (nTam) mudancas.push(`${nTam} tamanho(s)`);
  if (pdv.trim()) mudancas.push(`Código PDV: ${pdv.trim()}`);
  useEffect(() => {
    registrar(
      comecou
        ? { titulo: 'nova pizza', aviso: 'Você começou a criar uma pizza e ainda não salvou. O que deseja fazer?', mudancas, publicar: salvarInterno, descartar: () => {}, acaoLabel: 'Criar e sair', podePublicar: valido }
        : null,
    );
    return () => registrar(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comecou, valido, mudancas.join('|'), nome, pdv, tamanhos, massas, bordas, sabores, shifts]);

  return (
    <>
      <div style={{ marginBottom: 14 }}>
        <Link href="/cardapio" className="sub" style={{ color: 'var(--dim)' }} onClick={(e) => { e.preventDefault(); navegar(() => router.push('/cardapio')); }}>← Cardápio</Link>
      </div>
      <div className="topbar">
        <div>
          <h1>Nova <span>pizza</span></h1>
          <div className="sub">Tamanho, massa, borda e sabor — a estrutura de pizza do iFood. O preço-base é por tamanho.</div>
        </div>
        <button className="btn" disabled={!valido || salvando} onClick={salvar}>
          {salvando ? 'Criando…' : 'Criar pizza'}
        </button>
      </div>

      {erro && <div className="errbox" style={{ marginBottom: 16 }}>{erro}</div>}

      <div className="card" style={{ marginBottom: 16, borderColor: 'rgba(255,162,38,.35)', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <span style={{ fontSize: '1.2rem', lineHeight: 1 }}>🍕</span>
        <div className="sub" style={{ margin: 0 }}>
          <b>Pizza fica numa categoria própria.</b> É uma regra do iFood: pizzas não entram em categorias comuns (lanches, bebidas). O Orzuni <b>cria/reaproveita automaticamente</b> a categoria de pizza — você não precisa fazer nada.
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div>
            <label style={label}>Nome <span style={{ color: nome.length > 100 ? 'var(--coral)' : 'var(--dim)' }}>({nome.length}/100)</span></label>
            <input style={box} value={nome} onChange={(e) => setNome(e.target.value)} maxLength={120} placeholder="Ex.: Calabresa" />
          </div>
          <div>
            <label style={label}>Categoria (pizza)</label>
            <input style={box} value={categoria} onChange={(e) => setCategoria(e.target.value)} placeholder="Pizzas" />
          </div>
        </div>
        <div style={{ marginTop: 14 }}>
          <label style={label}>Código PDV <span style={{ color: 'var(--dim)' }}>(opcional)</span></label>
          <input style={{ ...box, fontFamily: 'var(--font-mono)' }} value={pdv} onChange={(e) => setPdv(e.target.value)} placeholder="Ex.: 38520 — vincula ao seu Regem/PDV" />
        </div>
        <div className="sub" style={{ marginTop: 10, color: 'var(--dim)' }}>A categoria será criada como categoria de <b>pizza</b> (o iFood aceita uma por loja). Código PDV vazio = gerado automático.</div>
      </div>

      <Grupo titulo="Tamanhos" ajuda="O preço-base da pizza. 'Máx. sabores' habilita meio a meio." linhas={tamanhos} onChange={setTamanhos} comTamanho />
      <Grupo titulo="Massas" ajuda="Ex.: Tradicional (grátis), Fina, Integral (+valor)." linhas={massas} onChange={setMassas} />
      <Grupo titulo="Bordas" ajuda="Ex.: Tradicional (grátis), Recheada (+valor). Opcional para o cliente." linhas={bordas} onChange={setBordas} />
      <Grupo titulo="Sabores" ajuda="Os recheios. Preço adicional por sabor (0 = já incluso no tamanho)." linhas={sabores} onChange={setSabores} />

      <div className="card" style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: '1.02rem', fontWeight: 700, marginBottom: 6 }}>Disponibilidade</h2>
        <div className="sub" style={{ marginBottom: 4 }}>Agende por horário e dias. Vazio = sempre disponível.</div>
        <ShiftsEditor shifts={shifts} onChange={setShifts} />
      </div>

      {!valido && (nome || sabores.some((s) => s.nome)) && (
        <div className="sub" style={{ marginTop: 12, color: 'var(--tanger)' }}>Ajuste antes de criar: {erros.join(' · ')}</div>
      )}
    </>
  );
}
