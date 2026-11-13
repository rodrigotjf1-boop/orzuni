'use client';
import { useEffect, useMemo, useState } from 'react';
import { autorizacao, ehPedidoMorto, type LojaDaTela, type PedidoMorto, type TelaDoPedido } from '@/lib/autorizacao';

// A autorização por clique (Padrão DMS §3): um aplicativo da DMS (o Regem, hoje) pede acesso à conta. A ordem é fixa:
// o aplicativo e quem o faz, a conta que pede (com a confirmação de outra empresa), onde vale (a loja do iFood), as
// permissões (necessárias sem chave, opcionais desligadas), o que ele não pode e a senha. Nada nasce aqui: a ligação só
// existe quando o aplicativo troca o código que esta página devolve.

const cartao: React.CSSProperties = { display: 'grid', gap: 8, padding: '14px 16px' };
const titulo: React.CSSProperties = { margin: 0, fontSize: '.78rem', textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--dim)' };
const tag: React.CSSProperties = { flex: 'none', fontSize: '.72rem', fontWeight: 700, color: 'var(--dim)', border: '1px solid var(--line)', borderRadius: 999, padding: '2px 8px' };

function Chave({ ligada, rotulo, onClick }: { ligada: boolean; rotulo: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={ligada}
      aria-label={rotulo}
      onClick={onClick}
      style={{ flex: 'none', width: 46, height: 28, borderRadius: 999, border: 0, position: 'relative', cursor: 'pointer', background: ligada ? 'var(--green)' : 'var(--ink3)' }}
    >
      <span style={{ position: 'absolute', top: 4, left: ligada ? 22 : 4, width: 20, height: 20, borderRadius: '50%', background: 'var(--cream)', transition: 'left .15s' }} />
    </button>
  );
}

function notaDaLoja(l: LojaDaTela, app: string): string | null {
  if (l.situacao === 'esta') return `já ligada a esta loja do ${app}: você pode liberar mais`;
  if (l.situacao === 'chave') return `ligada ao ${app} pela chave antiga: a ligação nova substitui`;
  if (l.situacao === 'outra') return `já ligada a outra loja do ${app}${l.outraLoja ? ` (${l.outraLoja})` : ''}`;
  return null;
}

export default function AutorizarPage() {
  const [numero, setNumero] = useState('');
  const [tela, setTela] = useState<TelaDoPedido | null>(null);
  const [morto, setMorto] = useState<PedidoMorto | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [loja, setLoja] = useState('');
  const [opcionais, setOpcionais] = useState<string[]>([]);
  const [confirmo, setConfirmo] = useState(false);
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    const n = new URLSearchParams(window.location.search).get('request_uri') ?? '';
    setNumero(n);
    if (!n) {
      setMorto({ erro: 'Este endereço não traz um pedido de autorização. Comece de novo pelo aplicativo.', voltar: null });
      setCarregando(false);
      return;
    }
    autorizacao
      .ler(n)
      .then((r) => {
        if (ehPedidoMorto(r)) {
          setMorto(r);
          return;
        }
        setTela(r);
        // Uma loja só que dá para escolher já vem marcada; a que já está ligada a esta loja do aplicativo também.
        const escolhiveis = r.lojas.filter((l) => l.situacao !== 'outra');
        const esta = r.lojas.find((l) => l.situacao === 'esta');
        if (esta) setLoja(esta.id);
        else if (escolhiveis.length === 1) setLoja(escolhiveis[0].id);
      })
      .catch((e) => setMorto({ erro: e instanceof Error ? e.message : 'Não consegui abrir o pedido agora.', voltar: null }))
      .finally(() => setCarregando(false));
  }, []);

  const travada = useMemo(() => (tela?.travadaAte ? new Date(tela.travadaAte) : null), [tela]);
  const app = tela?.aplicativo.nome ?? 'aplicativo';
  const pronto = !!tela && !!loja && confirmo && senha.length > 0 && !enviando && !travada;

  function alternar(id: string) {
    setOpcionais((atual) => (atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id]));
  }

  async function autorizar(e: React.FormEvent) {
    e.preventDefault();
    if (!pronto) return;
    setErro('');
    setEnviando(true);
    try {
      const r = await autorizacao.autorizar({ pedido: numero, loja, opcionais, senha, confirmo_outra_empresa: confirmo });
      window.location.href = r.redirect;
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não deu certo. Tente de novo.');
      setSenha('');
      setEnviando(false);
    }
  }

  async function agoraNao() {
    setEnviando(true);
    try {
      const r = await autorizacao.recusar(numero);
      if (r.redirect) window.location.href = r.redirect;
      else setMorto({ erro: 'Pedido recusado. Nada mudou na sua conta.', voltar: null });
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não deu certo. Tente de novo.');
      setEnviando(false);
    }
  }

  return (
    <main style={{ minHeight: '100vh', background: 'var(--ink)', padding: '28px 16px 64px' }}>
      <div style={{ maxWidth: 560, margin: '0 auto', display: 'grid', gap: 14 }}>
        <div style={{ fontWeight: 800, fontSize: '1.15rem', letterSpacing: '-.01em' }}>Orzuni</div>

        {carregando && (
          <div className="card" style={cartao} role="status">
            Abrindo o pedido…
          </div>
        )}

        {morto && (
          <div className="card" style={cartao} role="alert">
            <h1 style={{ margin: 0, fontSize: '1.15rem' }}>Este pedido não vale mais</h1>
            <div className="sub">{morto.erro}</div>
            {morto.voltar && (
              <a className="btn" href={morto.voltar} style={{ justifySelf: 'start', marginTop: 6 }}>
                Voltar ao aplicativo
              </a>
            )}
          </div>
        )}

        {tela && !morto && (
          <form onSubmit={autorizar} style={{ display: 'grid', gap: 14 }} noValidate>
            <h1 style={{ margin: 0, fontSize: '1.35rem', lineHeight: 1.25 }}>O {app} pede acesso à sua conta do Orzuni</h1>

            <section className="card" style={cartao} aria-labelledby="t-app">
              <h2 id="t-app" style={titulo}>O aplicativo</h2>
              <div>
                <b>{tela.aplicativo.nome}</b> · {tela.aplicativo.empresa}
              </div>
              {tela.aplicativo.verificado && (
                <span style={{ justifySelf: 'start', fontSize: '.78rem', fontWeight: 700, color: 'var(--green)', background: 'rgba(76,217,100,.12)', borderRadius: 999, padding: '2px 9px' }}>
                  ✓ Verificado pela DMS
                </span>
              )}
            </section>

            <section className="card" style={cartao} aria-labelledby="t-quem">
              <h2 id="t-quem" style={titulo}>Quem pede</h2>
              <div>
                <b>{tela.contaPede.nome}</b>
                {tela.contaPede.cnpj ? ` · CNPJ ${tela.contaPede.cnpj}` : ' · sem CNPJ informado'}
              </div>
              <div className="sub">
                {tela.contaPede.email}
                {tela.contaPede.loja ? ` · no ${app}, loja ${tela.contaPede.loja}` : ''}
              </div>
              <div style={{ border: '1px solid rgba(255,68,56,.45)', background: 'rgba(255,68,56,.08)', borderRadius: 10, padding: '10px 12px', display: 'grid', gap: 8 }}>
                <b style={{ fontSize: '.92rem' }}>Confira se você conhece essa empresa</b>
                <span className="sub">A sua conta do Orzuni não tem CNPJ para comparar. Só autorize se essa empresa é sua ou se você confia nela para mexer no cardápio da loja.</span>
                <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer' }}>
                  <input type="checkbox" checked={confirmo} onChange={(e) => setConfirmo(e.target.checked)} style={{ width: 18, height: 18, marginTop: 2, accentColor: 'var(--coral)' }} />
                  <span>Confirmo que {tela.contaPede.nome} pode mexer no cardápio desta loja do iFood</span>
                </label>
              </div>
            </section>

            <fieldset className="card" style={{ ...cartao, border: '1px solid var(--line)', margin: 0, minWidth: 0 }}>
              <legend style={{ ...titulo, padding: '0 4px' }}>Onde vale</legend>
              {tela.lojas.length === 0 ? (
                <div className="sub">Nenhuma loja do iFood conectada nesta conta. Fale com o suporte do Orzuni para conectar a sua loja, e comece de novo pelo {app}.</div>
              ) : (
                <>
                  <div className="sub">Escolha uma loja do iFood. Uma loja do {app} se liga a uma loja do iFood.</div>
                  <div style={{ display: 'grid', gap: 8 }}>
                    {tela.lojas.map((l) => {
                      const nota = notaDaLoja(l, app);
                      const bloqueada = l.situacao === 'outra';
                      return (
                        <label
                          key={l.id}
                          style={{ display: 'flex', alignItems: 'flex-start', gap: 10, border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px', opacity: bloqueada ? 0.6 : 1, cursor: bloqueada ? 'not-allowed' : 'pointer' }}
                        >
                          <input type="radio" name="loja" value={l.id} checked={loja === l.id} disabled={bloqueada} onChange={() => setLoja(l.id)} style={{ width: 18, height: 18, marginTop: 2, accentColor: 'var(--green)' }} />
                          <span style={{ minWidth: 0 }}>
                            {l.nome}
                            {nota && <small className="sub" style={{ display: 'block' }}>{nota}</small>}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </>
              )}
            </fieldset>

            <section className="card" style={cartao} aria-labelledby="t-pode">
              <h2 id="t-pode" style={titulo}>O que o {app} vai poder fazer</h2>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 12 }}>
                {tela.permissoes.map((p) => (
                  <li key={p.id} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                    <span style={{ minWidth: 0 }}>
                      <b style={{ display: 'block', fontSize: '.95rem' }}>{p.frase}</b>
                      {p.motivo && <small className="sub" style={{ display: 'block' }}>{p.motivo}</small>}
                    </span>
                    {p.necessaria ? <span style={tag}>necessária</span> : <Chave ligada={opcionais.includes(p.id)} rotulo={`Liberar: ${p.frase}`} onClick={() => alternar(p.id)} />}
                  </li>
                ))}
              </ul>
              {tela.permissoes.some((p) => !p.necessaria) && <div className="sub">As opcionais começam desligadas. Ligue só o que você quer liberar.</div>}
            </section>

            <section className="card" style={cartao} aria-labelledby="t-nao">
              <h2 id="t-nao" style={titulo}>O que o {app} não pode</h2>
              <ul style={{ margin: 0, paddingLeft: 18 }} className="sub">
                {tela.naoPode.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </section>

            <section className="card" style={cartao}>
              <label htmlFor="senha-orzuni">
                <b>Sua senha do Orzuni</b>
              </label>
              <input
                id="senha-orzuni"
                type="password"
                autoComplete="current-password"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                disabled={!!travada}
                style={{ width: '100%', minHeight: 44, borderRadius: 10, border: '1px solid var(--line)', background: 'var(--ink)', color: 'var(--cream)', padding: '0 12px', fontFamily: 'inherit' }}
              />
              <div className="sub">Vale até você desligar, em Aplicativos conectados aqui no Orzuni ou no próprio {app}.</div>
              {travada && (
                <div role="alert" style={{ color: 'var(--coral)', fontSize: '.88rem' }}>
                  Muitas senhas erradas: a autorização fica travada até {travada.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}. O login no Orzuni continua normal.
                </div>
              )}
              {erro && (
                <div role="alert" style={{ color: 'var(--coral)', fontSize: '.88rem' }}>
                  {erro}
                </div>
              )}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                <button className="btn" type="submit" disabled={!pronto}>
                  {enviando ? 'Autorizando…' : 'Autorizar'}
                </button>
                <button className="btn ghost" type="button" onClick={agoraNao} disabled={enviando}>
                  Agora não
                </button>
              </div>
            </section>
          </form>
        )}
      </div>
    </main>
  );
}
