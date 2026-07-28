'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, type Shift } from '@/lib/api';
import { useToast } from '@/components/toast';
import { ShiftsEditor } from '@/components/shifts';

const parse = (v: string) => {
  const n = parseFloat(v.replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3})/g, '').replace(',', '.'));
  return isNaN(n) ? null : n;
};

interface Linha {
  nome: string;
  preco: string;
  pedacos?: string;
  maxSabores?: number;
}

const box = { width: '100%', background: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 11, color: 'var(--cream)', fontFamily: 'inherit', fontSize: '.92rem', padding: '11px 13px' } as const;
const label = { display: 'block', fontFamily: 'var(--font-mono)', fontSize: '.6rem', letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--dim)', marginBottom: 7 } as const;
const precoBox = { width: 100, background: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 9, color: 'var(--cream)', fontFamily: 'var(--font-mono)', fontSize: '.82rem', padding: '8px 8px 8px 28px', textAlign: 'right' } as const;

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
  const add = () => onChange([...linhas, { nome: '', preco: '', ...(comTamanho ? { pedacos: '', maxSabores: 1 } : {}) }]);
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
        <div key={i} style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
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
          <span style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <span className="mono" style={{ position: 'absolute', left: 9, color: 'var(--dim)', fontSize: '.7rem', textTransform: 'none' }}>R$</span>
            <input style={precoBox} value={l.preco} onChange={(e) => upd(i, { preco: e.target.value })} placeholder={comTamanho ? '0,00' : '0,00'} />
          </span>
          <button className="btn ghost mini" onClick={() => del(i)}>×</button>
        </div>
      ))}
      {!linhas.length && <div className="sub" style={{ marginTop: 6, color: 'var(--dim)' }}>Nenhum ainda.</div>}
    </div>
  );
}

export default function NovaPizzaPage() {
  const router = useRouter();
  const toast = useToast();
  const [nome, setNome] = useState('');
  const [categoria, setCategoria] = useState('Pizzas');
  const [tamanhos, setTamanhos] = useState<Linha[]>([{ nome: 'Grande', preco: '', pedacos: '8', maxSabores: 2 }]);
  const [massas, setMassas] = useState<Linha[]>([{ nome: 'Tradicional', preco: '' }]);
  const [bordas, setBordas] = useState<Linha[]>([{ nome: 'Tradicional', preco: '' }]);
  const [sabores, setSabores] = useState<Linha[]>([{ nome: '', preco: '' }]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  const erros: string[] = [];
  if (!nome.trim()) erros.push('informe o nome');
  if (!categoria.trim()) erros.push('informe a categoria');
  if (!tamanhos.length) erros.push('adicione ao menos um tamanho');
  tamanhos.forEach((t, i) => {
    if (!t.nome.trim()) erros.push(`tamanho ${i + 1} sem nome`);
    if ((parse(t.preco) ?? 0) <= 0) erros.push(`tamanho "${t.nome || i + 1}": preço deve ser positivo`);
  });
  if (!massas.some((m) => m.nome.trim())) erros.push('adicione ao menos uma massa');
  if (!sabores.some((s) => s.nome.trim())) erros.push('adicione ao menos um sabor');
  const valido = erros.length === 0;

  const limpa = (l: Linha[]) => l.filter((x) => x.nome.trim());

  async function salvar() {
    if (!valido) return;
    setSalvando(true);
    setErro('');
    try {
      const r = await api.criarPizza({
        nome: nome.trim(),
        categoria: categoria.trim(),
        tamanhos: limpa(tamanhos).map((t) => ({ nome: t.nome.trim(), preco: parse(t.preco) ?? 0, pedacos: t.pedacos ? parseInt(t.pedacos, 10) : undefined, maxSabores: t.maxSabores ?? 1 })),
        massas: limpa(massas).map((m) => ({ nome: m.nome.trim(), preco: parse(m.preco) ?? 0 })),
        bordas: limpa(bordas).map((b) => ({ nome: b.nome.trim(), preco: parse(b.preco) ?? 0 })),
        sabores: limpa(sabores).map((s) => ({ nome: s.nome.trim(), preco: parse(s.preco) ?? 0 })),
        shifts: shifts.length ? shifts : undefined,
      });
      if (r.ok) {
        toast('<b style="color:var(--green)">Pizza criada</b> no iFood ✓');
        router.push('/cardapio');
      } else {
        setErro(r.erro || 'não foi possível criar');
      }
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <>
      <div style={{ marginBottom: 14 }}>
        <Link href="/cardapio" className="sub" style={{ color: 'var(--dim)' }}>← Cardápio</Link>
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
        <div className="sub" style={{ marginTop: 10, color: 'var(--dim)' }}>A categoria será criada como categoria de <b>pizza</b> (o iFood aceita uma por loja).</div>
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
