'use client';
import { useEffect, useState } from 'react';
import { api, type LojaDoRegem, type ResumoImportacao } from '@/lib/api';

// "Importar do Regem". A conexão nasce de dois jeitos (plano "Clique Orzuni → Regem" do hub, 13/11/2026):
//  - pelo CLIQUE ("Conectar pelo Regem"): o dono vai ao Regem, autoriza como presidente e volta ligado, sem chave;
//  - pela CHAVE de integração colada (o caminho de antes), que fica recolhida quando o clique está disponível.
// O servidor diz se o clique está disponível (`clique`); sem ele, a tela é a de antes.

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
  if (r.nadaMudou) {
    return <div style={{ fontWeight: 600 }}>Nada mudou no cardápio do Regem desde a última vez — não havia o que criar.</div>;
  }
  const partes = [
    `${r.criados} ${r.criados === 1 ? 'novo criado' : 'novos criados'}`,
    `${r.jaExistiam} já existiam`,
    r.semPrecoIfoodOuNoIfood ? `${r.semPrecoIfoodOuNoIfood} ainda não vão para o iFood` : '',
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
  const [clique, setClique] = useState(false);
  const [origem, setOrigem] = useState<'chave' | 'clique' | undefined>();
  const [loja, setLoja] = useState<LojaDoRegem | null>(null);
  const [lojas, setLojas] = useState<LojaDoRegem[]>([]);
  const [ultima, setUltima] = useState<string | undefined>();
  const [ultimoResumo, setUltimoResumo] = useState<ResumoImportacao | null>(null);

  const [token, setToken] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [indoAoRegem, setIndoAoRegem] = useState(false);
  const [trocandoLoja, setTrocandoLoja] = useState(false);
  const [importando, setImportando] = useState(false);
  const [msg, setMsg] = useState('');
  const [aviso, setAviso] = useState('');
  const [resultado, setResultado] = useState<ResumoImportacao | null>(null);

  async function carregar() {
    setCarregando(true);
    try {
      const s = await api.importarRegem.status();
      setConectado(s.conectado);
      setClique(s.clique === true);
      setOrigem(s.origem);
      setLoja(s.loja ?? null);
      setLojas(s.lojas ?? []);
      setUltima(s.ultimaImportacao);
      setUltimoResumo((s.ultimoResumo as ResumoImportacao) ?? null);
      return s;
    } catch {
      setMsg('Não consegui carregar a conexão agora. Tente de novo em instantes.');
      return null;
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    // A volta do Regem traz a pessoa para cá com `?conectado=1`: diz a loja e tira o parâmetro do endereço.
    const voltou = new URLSearchParams(window.location.search).get('conectado') === '1';
    if (voltou) window.history.replaceState(null, '', window.location.pathname);
    carregar().then((s) => {
      if (voltou && s?.conectado && s.origem === 'clique') setAviso(`Conectado à loja ${s.loja?.nome ?? 'do Regem'}. Já dá para importar.`);
    });
  }, []);

  /** "Conectar pelo Regem": o servidor abre o pedido lá e devolve a página do Regem; o navegador vai para ela. */
  async function conectarPeloRegem() {
    setMsg('');
    setAviso('');
    setIndoAoRegem(true);
    try {
      const r = await api.importarRegem.cliqueIniciar();
      if (r.ok && r.url) {
        window.location.assign(r.url);
        return; // fica "Abrindo o Regem…" até a página trocar
      }
      setMsg(r.erro || 'Não foi possível abrir a conexão com o Regem agora.');
    } catch {
      setMsg('Não foi possível abrir a conexão com o Regem agora.');
    }
    setIndoAoRegem(false);
  }

  async function trocarLoja(id: string) {
    if (!id || id === loja?.id) return;
    setMsg('');
    setAviso('');
    setResultado(null);
    setTrocandoLoja(true);
    try {
      const r = await api.importarRegem.escolherLoja(id);
      if (r.ok && r.loja) {
        await carregar();
        setAviso(`Agora a importação lê a loja ${r.loja.nome} do Regem.`);
      } else {
        setMsg(r.erro || 'Não foi possível trocar a loja agora.');
      }
    } catch {
      setMsg('Não foi possível trocar a loja agora.');
    } finally {
      setTrocandoLoja(false);
    }
  }

  async function conectar(e: React.FormEvent) {
    e.preventDefault();
    setMsg('');
    setAviso('');
    setSalvando(true);
    try {
      const r = await api.importarRegem.conectar(token.trim());
      if (r.ok) {
        setToken('');
        setAviso(`Conectado ao Regem (${r.produtos ?? 0} itens no cardápio de lá).`);
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
    setAviso('');
    setResultado(null);
    setImportando(true);
    try {
      const r = await api.importarRegem.executar();
      if (r.ok && r.resumo) {
        setResultado(r.resumo);
        if (!r.resumo.nadaMudou) setUltimoResumo(r.resumo);
      } else {
        setMsg(r.erro || 'Não foi possível importar agora.');
      }
    } catch {
      setMsg('Não foi possível importar agora.');
    } finally {
      setImportando(false);
    }
  }

  const peloClique = conectado && origem === 'clique';
  const pelaChave = conectado && !peloClique;
  // O campo da chave e o botão dele: o mesmo na tela de antes e dentro de "Tenho uma chave de integração".
  const campoDaChave = (
    <>
      <input
        type="password"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder={pelaChave ? 'Nova chave de integração (cole para trocar)' : 'Chave de integração do Regem'}
        aria-label="Chave de integração do Regem"
        autoComplete="new-password"
        style={campo}
      />
      <button className="btn" type="submit" disabled={salvando || !token.trim()} style={{ justifyContent: 'center' }}>
        {salvando ? 'Conectando…' : pelaChave ? 'Atualizar conexão' : 'Conectar'}
      </button>
    </>
  );

  return (
    <div style={{ padding: '28px clamp(16px, 4vw, 40px)', maxWidth: 760, margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.4rem', fontWeight: 800, letterSpacing: '-.02em', marginBottom: 4 }}>Importar do Regem</h1>
      <div className="sub" style={{ marginBottom: 24 }}>
        Traga o cardápio da sua loja do Regem para o iFood. O Orzuni compara pelo código do produto e cria no iFood só o que ainda não existe — o que já está lá não é alterado. Vão só os produtos que você marcou para o iFood no Regem, com o preço do iFood preenchido.
      </div>

      {/* conexão */}
      <section className="card" style={{ marginBottom: 18 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>{conectado ? 'Conexão com o Regem' : 'Conectar ao Regem'}</div>
        {carregando ? (
          <div className="sub">Carregando…</div>
        ) : !clique ? (
          <form onSubmit={conectar}>
            {conectado ? (
              <div className="sub" style={{ marginBottom: 12 }}>Conectado ao Regem. Para trocar a chave, cole a nova abaixo.</div>
            ) : (
              <div className="sub" style={{ marginBottom: 12 }}>
                No Regem, abra Integrações, gere a chave de integração para o Orzuni e cole aqui. Pronto — não precisa de mais nada.
              </div>
            )}
            {campoDaChave}
          </form>
        ) : (
          <>
            {peloClique ? (
              <div className="sub" style={{ marginBottom: 12 }}>
                Conectado à loja <strong style={{ color: 'var(--cream)' }}>{loja?.nome ?? 'do Regem'}</strong> do Regem. O Orzuni só lê o cardápio e o preço do iFood de lá.
              </div>
            ) : conectado ? (
              <div className="sub" style={{ marginBottom: 12 }}>
                Conectado ao Regem pela chave de integração. Você pode trocar pela conexão sem chave: o presidente da empresa autoriza no próprio Regem.
              </div>
            ) : (
              <div className="sub" style={{ marginBottom: 12 }}>
                Você vai ao Regem, entra como presidente da empresa, escolhe a loja e confirma com a sua senha. O Orzuni recebe só a leitura do cardápio e do preço do iFood. Não há chave para copiar.
              </div>
            )}
            {peloClique && lojas.length > 1 && (
              <label style={{ display: 'block', marginBottom: 12 }}>
                <span className="sub" style={{ display: 'block', marginBottom: 6 }}>Importar de qual loja do Regem?</span>
                <select value={loja?.id ?? ''} onChange={(e) => trocarLoja(e.target.value)} disabled={trocandoLoja} style={{ ...campo, marginBottom: 0 }}>
                  {!loja && <option value="">Escolha a loja</option>}
                  {lojas.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.nome}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button className={peloClique ? 'btn ghost' : 'btn'} type="button" onClick={conectarPeloRegem} disabled={indoAoRegem} style={{ justifyContent: 'center' }}>
              {indoAoRegem ? 'Abrindo o Regem…' : peloClique ? 'Conectar de novo' : 'Conectar pelo Regem'}
            </button>
            {peloClique && (
              <div className="sub" style={{ marginTop: 8 }}>
                Use &quot;Conectar de novo&quot; para ligar outra loja, ou se a conexão foi desligada no Regem.
              </div>
            )}
            <details style={{ marginTop: 16 }}>
              <summary className="sub" style={{ cursor: 'pointer' }}>Tenho uma chave de integração</summary>
              <form onSubmit={conectar} style={{ marginTop: 12 }}>
                <div className="sub" style={{ marginBottom: 12 }}>
                  Se a equipe do Regem passou uma chave de integração para o Orzuni, cole aqui. Ela vale para uma loja e substitui a conexão atual.
                </div>
                {campoDaChave}
              </form>
            </details>
          </>
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

      {aviso && (
        <div role="status" style={{ color: 'var(--green)', fontSize: '.84rem', marginTop: 16 }}>
          {aviso}
        </div>
      )}
      {msg && (
        <div role="alert" style={{ color: 'var(--coral)', fontSize: '.84rem', marginTop: 16 }}>
          {msg}
        </div>
      )}
    </div>
  );
}
