/**
 * Fundo da tela de login/cadastro: a INTEGRAÇÃO acontecendo. À esquerda, a janela do
 * Regem — alguém editando o cardápio (cursor, clique, preço mudando, "Salvar → Salvo ✓",
 * e um item sendo pausado). Ao centro, o card do Orzuni é a ponte; "pacotes" rotulados
 * (preço / pausa) viajam dele para o iFood. À direita, a janela do iFood recebe a mudança
 * (preço com brilho + selo "atualizado"; o item pausado fica cinza). Loop de ~13s.
 * Puramente visual (aria-hidden), respeita prefers-reduced-motion, some no celular.
 */
export default function FundoLogin() {
  return (
    <div className="lbg" aria-hidden="true">
      {/* a ponte e os pacotes que viajam Regem → iFood */}
      <span className="lbg-pipe" />
      <span className="lbg-pkt lbg-pkt1">preço</span>
      <span className="lbg-pkt lbg-pkt2">pausa</span>

      {/* ESQUERDA — Regem: editando o cardápio */}
      <div className="lbg-win lbg-regem">
        <div className="lbg-bar">
          <span className="lbg-tl" />
          <span className="lbg-tl" />
          <span className="lbg-tl" />
          <span className="lbg-wt">
            <i className="lbg-rdot" /> Regem · Cardápio
          </span>
        </div>
        <div className="lbg-body">
          <div className="lbg-it lbg-it-edit">
            <span className="lbg-th">🍔</span>
            <span className="lbg-nm">X-Salada Duplo</span>
            <span className="lbg-pr">
              <span className="lbg-v lbg-v1">R$ 29,90</span>
              <span className="lbg-v lbg-v2">R$ 32,90</span>
              <span className="lbg-ring" />
            </span>
          </div>
          <div className="lbg-it lbg-it-pause">
            <span className="lbg-th">🍟</span>
            <span className="lbg-nm">Batata frita G</span>
            <span className="lbg-tg">
              <i />
            </span>
            <span className="lbg-ring lbg-ring2" />
          </div>
          <div className="lbg-it">
            <span className="lbg-th">🥤</span>
            <span className="lbg-nm">Guaraná lata</span>
            <span className="lbg-pr">
              <span className="lbg-v">R$ 7,00</span>
            </span>
          </div>
        </div>
        <div className="lbg-foot">
          <span className="lbg-save">
            <span className="lbg-save1">Salvar</span>
            <span className="lbg-save2">Salvo ✓</span>
          </span>
        </div>
        <span className="lbg-cursor" />
      </div>

      {/* DIREITA — iFood: recebendo a atualização */}
      <div className="lbg-win lbg-ifood">
        <div className="lbg-bar">
          <span className="lbg-ifbrand">iFood</span>
          <span className="lbg-wt">Loja · Cardápio</span>
        </div>
        <div className="lbg-body">
          <div className="lbg-card lbg-card-up">
            <span className="lbg-th">🍔</span>
            <span className="lbg-ci">
              <span className="lbg-nm">X-Salada Duplo</span>
              <span className="lbg-tag lbg-tag-on">Disponível</span>
            </span>
            <span className="lbg-pr">
              <span className="lbg-v lbg-v1">R$ 29,90</span>
              <span className="lbg-v lbg-v2">R$ 32,90</span>
            </span>
            <span className="lbg-badge">atualizado</span>
          </div>
          <div className="lbg-card lbg-card-off">
            <span className="lbg-th">🍟</span>
            <span className="lbg-ci">
              <span className="lbg-nm">Batata frita G</span>
              <span className="lbg-tag">
                <span className="t-on">Disponível</span>
                <span className="t-off">Pausado</span>
              </span>
            </span>
            <span className="lbg-pr">
              <span className="lbg-v">R$ 18,00</span>
            </span>
          </div>
          <div className="lbg-card">
            <span className="lbg-th">🥤</span>
            <span className="lbg-ci">
              <span className="lbg-nm">Guaraná lata</span>
              <span className="lbg-tag lbg-tag-on">Disponível</span>
            </span>
            <span className="lbg-pr">
              <span className="lbg-v">R$ 7,00</span>
            </span>
          </div>
        </div>
      </div>

      {/* escurece o centro para o login ficar sempre legível */}
      <span className="lbg-vig" />
    </div>
  );
}
