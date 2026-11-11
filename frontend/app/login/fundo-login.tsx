/**
 * Fundo decorativo da tela de login: à ESQUERDA, alguém mexendo no cardápio no Regem;
 * ao CENTRO, o próprio card do Orzuni faz a ponte; à DIREITA, o cardápio do iFood sendo
 * atualizado — o preço editado no Regem "viaja" pela ponte e aparece no iFood. Opacidade
 * leve + movimento suave; respeita prefers-reduced-motion. Puramente visual (aria-hidden).
 */
export default function FundoLogin() {
  return (
    <div className="login-bg" aria-hidden="true">
      {/* a linha da ponte e os pontos que viajam Regem → iFood */}
      <span className="lb-line" />
      <i className="lb-flow lb-f1" />
      <i className="lb-flow lb-f2" />
      <i className="lb-flow lb-f3" />

      {/* ESQUERDA — Regem: editando o cardápio */}
      <div className="lb-panel lb-regem">
        <div className="lb-head">
          <span className="lb-dot" style={{ background: 'var(--tanger)' }} /> Regem · cardápio
        </div>
        <div className="lb-row">
          <span className="lb-name" style={{ width: '56%' }} />
          <span className="lb-price">R$ 24,90</span>
        </div>
        <div className="lb-row lb-active">
          <span className="lb-name" style={{ width: '72%' }} />
          <span className="lb-price lb-edit">
            <span className="lb-v lb-v1">R$ 29,90</span>
            <span className="lb-v lb-v2">R$ 32,90</span>
            <span className="lb-caret" />
          </span>
        </div>
        <div className="lb-row">
          <span className="lb-name" style={{ width: '48%' }} />
          <span className="lb-price">R$ 18,00</span>
        </div>
        <div className="lb-row">
          <span className="lb-name" style={{ width: '63%' }} />
          <span className="lb-price">R$ 41,50</span>
        </div>
      </div>

      {/* DIREITA — iFood: o cardápio sendo atualizado */}
      <div className="lb-panel lb-ifood">
        <div className="lb-head">
          <span className="lb-dot" style={{ background: 'var(--coral)' }} /> iFood
        </div>
        <div className="lb-item">
          <span className="lb-thumb" />
          <span className="lb-name" style={{ width: '54%' }} />
          <span className="lb-price">R$ 24,90</span>
        </div>
        <div className="lb-item lb-sync">
          <span className="lb-thumb" />
          <span className="lb-name" style={{ width: '66%' }} />
          <span className="lb-price lb-edit">
            <span className="lb-v lb-v1">R$ 29,90</span>
            <span className="lb-v lb-v2">R$ 32,90</span>
          </span>
        </div>
        <div className="lb-item">
          <span className="lb-thumb" />
          <span className="lb-name" style={{ width: '50%' }} />
          <span className="lb-price">R$ 18,00</span>
        </div>
      </div>

      {/* escurece o centro para o login ficar sempre legível */}
      <span className="lb-vignette" />
    </div>
  );
}
