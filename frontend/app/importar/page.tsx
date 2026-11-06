'use client';
import { useEffect, useState } from 'react';
import { api, type ResumoImportacao } from '@/lib/api';

const campo: React.CSSProperties = {
  width: '100%',
  background: 'var(--ink)',
  border: '1px solid var(--line)',
  borderRadius: 11,
  color: 'var(--cream)',
  fontFamily: 'inherit',
  fontSize: '.95rem',
  padding: '12px 14px',
  marginBottom: 12,
};

function Resumo({ r }: { r: ResumoImportacao }) {
  const partes = [
    `${r.criados} ${r.criados === 1 ? 'novo criado' : 'novos criados'}`,
    `${r.jaExistiam} já existiam`,
    r.semPrecoIfoodOuNoIfood ? `${r.semPrecoIfoodOuNoIfood} sem preço no iFood` : '',
    r.semCodigo ? `${r.semCodigo} sem código` : '',
    r.falhas?.length ? `${r.falhas.length} com erro` : '',
  ].filter(Boolean);
  return (
    <div>
      <div style={{ fontWeight: 600 }}>{partes.join(' · ')}</div>
      {r.falhas?.length > 0 && (
        <ul className="sub" style={{ margin: '8px 0 0', paddingLeft: 18 }}>
          {r.falhas.slice(0, 20).map((f, i) => (
            <li key={i}>
              Código {f.codigo}: {f.erro || 'não foi possível criar'}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function ImportarPage() {
  const [carregando, setCarregando] = useState(true);
  const [conectado, setConectado] = useState(false);
  const [endereco, setEndereco] = useState('');
  const [ultima, setUltima] = useState<string | undefined>();
  const [ultimoResumo, setUltimoResumo] = useState<ResumoImportacao | null>(null);

  const [formEndereco, setFormEndereco] = useState('');
  const [token, setToken] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [importando, setImportando] = useState(false);
  const [msg, setMsg] = useState('');
  const [resultado, setResultado] = useState<ResumoImportacao | null>(null);

  async function carregar() {
    setCarregando(true);
    try {
      const s = await api.importarRegem.status();
      setConectado(s.conectado);
      setEndereco(s.endereco || '');
      setFormEndereco(s.endereco || '');
      setUltima(s.ultimaImportacao);
      setUltimoResumo((s.ultimoResumo as ResumoImportacao) ?? null);
    } catch {
      setMsg('Não consegui carregar a conexão agora. Tente de novo em instantes.');
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    carregar();
  }, []);

  async function conectar(e: React.FormEvent) {
    e.preventDefault();
    setMsg('');
    setSalvando(true);
    try {
      const r = await api.importarRegem.conectar(formEndereco.trim(), token.trim());
      if (r.ok) {
        setToken('');
        setMsg(`Conectado ao Regem (${r.produtos ?? 0} itens no cardápio de lá).`);
        await carregar();
      } else {
        setMsg(r.erro || 'Não foi possível conectar ao Regem.');
      }
    } catch {
      setMsg('Não foi possível conectar ao Regem.');
    } finally {
      setSalvando(false);
    }
  }

  async function importar() {
    setMsg('');
    setResultado(null);
    setImportando(true);
    try {
      const r = await api.importarRegem.executar();
      if (r.ok && r.resumo) {
        setResultado(r.resumo);
        setUltimoResumo(r.resumo);
      } else {
        setMsg(r.erro || 'Não foi possível importar agora.');
      }
    } catch {
      setMsg('Não foi possível importar agora.');
    } finally {
      setImportando(false);
    }
  }

  return (
    <div style={{ padding: '28px clamp(16px, 4vw, 40px)', maxWidth: 760, margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.4rem', fontWeight: 800, letterSpacing: '-.02em', marginBottom: 4 }}>Importar do Regem</h1>
      <div className="sub" style={{ marginBottom: 24 }}>
        Traga o cardápio da sua loja do Regem para o iFood. O Orzuni compara pelo código do produto e cria no iFood só o que ainda não existe — o que já está lá não é alterado.
      </div>

      {/* conexão */}
      <section className="card" style={{ marginBottom: 18 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>{conectado ? 'Conexão com o Regem' : 'Conectar ao Regem'}</div>
        {carregando ? (
          <div className="sub">Carregando…</div>
        ) : (
          <form onSubmit={conectar}>
            {conectado && <div className="sub" style={{ marginBottom: 12 }}>Conectado a <b>{endereco}</b>. Para trocar, informe os dados de novo.</div>}
            <input
              type="url"
              value={formEndereco}
              onChange={(e) => setFormEndereco(e.target.value)}
              placeholder="Endereço do seu Regem (ex.: https://sualoja.regem...)"
              style={campo}
            />
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={conectado ? 'Nova chave de integração (deixe em branco para manter)' : 'Chave de integração do Regem'}
              autoComplete="off"
              style={campo}
            />
            <button className="btn" type="submit" disabled={salvando || !formEndereco.trim() || !token.trim()} style={{ justifyContent: 'center' }}>
              {salvando ? 'Conectando…' : conectado ? 'Atualizar conexão' : 'Conectar'}
            </button>
          </form>
        )}
      </section>

      {/* importar */}
      {conectado && (
        <section className="card">
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Importar agora</div>
          <div className="sub" style={{ marginBottom: 14 }}>
            Puxa o cardápio do Regem e cria no iFood os produtos que ainda não estão lá (pelo código do produto).
            {ultima && <> Última importação: {new Date(ultima).toLocaleString('pt-BR')}.</>}
          </div>
          {ultimoResumo && !resultado && (
            <div style={{ marginBottom: 14, border: '1px solid var(--line)', borderRadius: 12, background: 'var(--ink2)', padding: '12px 14px' }}>
              <div className="sub" style={{ marginBottom: 4 }}>Resultado da última vez:</div>
              <Resumo r={ultimoResumo} />
            </div>
          )}
          <button className="btn" onClick={importar} disabled={importando}>
            {importando ? 'Importando…' : 'Importar agora'}
          </button>
          {resultado && (
            <div style={{ marginTop: 16, border: '1px solid var(--line)', borderRadius: 12, background: 'var(--ink2)', padding: '12px 14px' }}>
              <Resumo r={resultado} />
            </div>
          )}
        </section>
      )}

      {msg && <div style={{ color: 'var(--coral)', fontSize: '.84rem', marginTop: 16 }}>{msg}</div>}
    </div>
  );
}
