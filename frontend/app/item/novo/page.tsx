'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, type Shift } from '@/lib/api';
import { useToast } from '@/components/toast';
import { ShiftsEditor } from '@/components/shifts';

const parse = (v: string) => {
  const n = parseFloat(v.replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3})/g, '').replace(',', '.'));
  return isNaN(n) ? null : n;
};

interface Grupo {
  grupo: string;
  min: number;
  max: number;
  opcoes: Array<{ nome: string; preco: string }>;
}

export default function NovoItemPage() {
  const router = useRouter();
  const toast = useToast();
  const [nome, setNome] = useState('');
  const [descricao, setDescricao] = useState('');
  const [precoStr, setPrecoStr] = useState('');
  const [categoria, setCategoria] = useState('');
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [cats, setCats] = useState<string[]>([]);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const r = await api.cardapio();
      setCats([...new Set(r.itens.map((i) => i.categoria))]);
    } catch {
      /* loja vazia — sem categorias ainda */
    }
  }, []);
  useEffect(() => {
    carregar();
  }, [carregar]);

  // validação no cliente (espelha o backend)
  const preco = parse(precoStr) ?? 0;
  const erros: string[] = [];
  if (!nome.trim()) erros.push('informe o nome');
  else if (nome.length > 100) erros.push('nome até 100 caracteres');
  if (descricao.length > 500) erros.push('descrição até 500 caracteres');
  if (preco <= 0) erros.push('preço deve ser positivo');
  if (!categoria.trim()) erros.push('escolha uma categoria');
  grupos.forEach((g, i) => {
    if (!g.grupo.trim()) erros.push(`grupo ${i + 1} sem nome`);
    if (g.max < g.min) erros.push(`grupo "${g.grupo || i + 1}": máx < mín`);
    if (!g.opcoes.length || g.opcoes.some((o) => !o.nome.trim())) erros.push(`grupo "${g.grupo || i + 1}": opções incompletas`);
  });
  const valido = erros.length === 0;

  function addGrupo() {
    setGrupos((g) => [...g, { grupo: '', min: 1, max: 1, opcoes: [{ nome: '', preco: '' }] }]);
  }
  function upd(i: number, patch: Partial<Grupo>) {
    setGrupos((g) => g.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  }
  function addOpcao(i: number) {
    setGrupos((g) => g.map((x, k) => (k === i ? { ...x, opcoes: [...x.opcoes, { nome: '', preco: '' }] } : x)));
  }
  function updOpcao(i: number, j: number, patch: Partial<{ nome: string; preco: string }>) {
    setGrupos((g) => g.map((x, k) => (k === i ? { ...x, opcoes: x.opcoes.map((o, m) => (m === j ? { ...o, ...patch } : o)) } : x)));
  }

  async function salvar() {
    if (!valido) return;
    setSalvando(true);
    setErro('');
    try {
      const r = await api.criarItem({
        nome: nome.trim(),
        descricao: descricao.trim() || undefined,
        preco,
        categoria: categoria.trim(),
        complementos: grupos.length
          ? grupos.map((g) => ({ grupo: g.grupo.trim(), min: g.min, max: g.max, opcoes: g.opcoes.map((o) => ({ nome: o.nome.trim(), preco: parse(o.preco) ?? 0 })) }))
          : undefined,
        shifts: shifts.length ? shifts : undefined,
      });
      if (r.ok) {
        toast('<b style="color:var(--green)">Item criado</b> no iFood ✓');
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

  const box = { width: '100%', background: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 11, color: 'var(--cream)', fontFamily: 'inherit', fontSize: '.92rem', padding: '11px 13px' } as const;
  const label = { display: 'block', fontFamily: 'var(--font-mono)', fontSize: '.6rem', letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--dim)', marginBottom: 7 } as const;
  const num = { width: 70, background: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 9, color: 'var(--cream)', fontFamily: 'var(--font-mono)', fontSize: '.85rem', padding: '8px 10px', textAlign: 'center' } as const;

  return (
    <>
      <div style={{ marginBottom: 14 }}>
        <Link href="/cardapio" className="sub" style={{ color: 'var(--dim)' }}>← Cardápio</Link>
      </div>
      <div className="topbar">
        <div>
          <h1>Novo <span>item</span></h1>
          <div className="sub">Cria no cardápio do seu iFood. Complementos são opcionais.</div>
        </div>
        <button className="btn" disabled={!valido || salvando} onClick={salvar}>
          {salvando ? 'Criando…' : 'Criar item'}
        </button>
      </div>

      {erro && <div className="errbox" style={{ marginBottom: 16 }}>{erro}</div>}

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ marginBottom: 16 }}>
          <label style={label}>Nome <span style={{ color: nome.length > 100 ? 'var(--coral)' : 'var(--dim)' }}>({nome.length}/100)</span></label>
          <input style={box} value={nome} onChange={(e) => setNome(e.target.value)} maxLength={120} placeholder="Ex.: X-Salada" />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={label}>Descrição <span style={{ color: descricao.length > 500 ? 'var(--coral)' : 'var(--dim)' }}>({descricao.length}/500)</span></label>
          <textarea style={{ ...box, minHeight: 70, resize: 'vertical', lineHeight: 1.5 }} value={descricao} onChange={(e) => setDescricao(e.target.value)} maxLength={600} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div>
            <label style={label}>Preço</label>
            <span style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <span className="mono" style={{ position: 'absolute', left: 13, color: 'var(--dim)', textTransform: 'none' }}>R$</span>
              <input style={{ ...box, paddingLeft: 34, fontFamily: 'var(--font-mono)' }} value={precoStr} onChange={(e) => setPrecoStr(e.target.value)} placeholder="0,00" />
            </span>
          </div>
          <div>
            <label style={label}>Categoria</label>
            <input style={box} value={categoria} onChange={(e) => setCategoria(e.target.value)} list="cats" placeholder="Escolha ou digite uma nova" />
            <datalist id="cats">{cats.map((c) => <option key={c} value={c} />)}</datalist>
          </div>
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: grupos.length ? 14 : 0 }}>
          <h2 style={{ fontSize: '1.02rem', fontWeight: 700 }}>Complementos</h2>
          <button className="btn ghost mini" style={{ marginLeft: 'auto' }} onClick={addGrupo}>+ Grupo</button>
        </div>
        {grupos.length === 0 && <div className="sub" style={{ margin: '8px 0 0' }}>Nenhum. Ex.: "Ponto da carne" (obrigatório), "Adicionais" (opcional).</div>}
        {grupos.map((g, i) => (
          <div key={i} style={{ border: '1px solid var(--line)', borderRadius: 12, background: 'var(--ink2)', padding: 14, marginTop: 12 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <input style={{ ...box, flex: 1, minWidth: 160 }} value={g.grupo} onChange={(e) => upd(i, { grupo: e.target.value })} placeholder="Nome do grupo" />
              <span className="mono" style={{ fontSize: '.58rem', color: 'var(--dim)' }}>mín</span>
              <input style={num} type="number" min={0} value={g.min} onChange={(e) => upd(i, { min: +e.target.value })} />
              <span className="mono" style={{ fontSize: '.58rem', color: 'var(--dim)' }}>máx</span>
              <input style={num} type="number" min={0} value={g.max} onChange={(e) => upd(i, { max: +e.target.value })} />
              <button className="btn ghost mini" onClick={() => setGrupos((x) => x.filter((_, k) => k !== i))}>remover</button>
            </div>
            <div style={{ marginTop: 10 }}>
              {g.opcoes.map((o, j) => (
                <div key={j} style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center' }}>
                  <input style={{ ...box, flex: 1, padding: '8px 11px' }} value={o.nome} onChange={(e) => updOpcao(i, j, { nome: e.target.value })} placeholder="Opção" />
                  <span style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                    <span className="mono" style={{ position: 'absolute', left: 9, color: 'var(--dim)', fontSize: '.7rem', textTransform: 'none' }}>R$</span>
                    <input style={{ width: 92, background: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 9, color: 'var(--cream)', fontFamily: 'var(--font-mono)', fontSize: '.82rem', padding: '8px 8px 8px 28px', textAlign: 'right' }} value={o.preco} onChange={(e) => updOpcao(i, j, { preco: e.target.value })} placeholder="0,00" />
                  </span>
                  {g.opcoes.length > 1 && <button className="btn ghost mini" onClick={() => setGrupos((x) => x.map((y, k) => (k === i ? { ...y, opcoes: y.opcoes.filter((_, m) => m !== j) } : y)))}>×</button>}
                </div>
              ))}
              <button className="btn ghost mini" style={{ marginTop: 8 }} onClick={() => addOpcao(i)}>+ opção</button>
            </div>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: '1.02rem', fontWeight: 700, marginBottom: 6 }}>Disponibilidade</h2>
        <div className="sub" style={{ marginBottom: 4 }}>Agende por horário e dias da semana (ex.: almoço, seg-sex). Vazio = sempre disponível.</div>
        <ShiftsEditor shifts={shifts} onChange={setShifts} />
      </div>

      {!valido && (nome || precoStr || categoria) && (
        <div className="sub" style={{ marginTop: 12, color: 'var(--tanger)' }}>Ajuste antes de criar: {erros.join(' · ')}</div>
      )}
    </>
  );
}
