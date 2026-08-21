import React, { useState, useRef, useEffect } from 'react';

const API = 'http://localhost:3001'; // em produção, URL da API

/* ---------- etapas do pipeline (exibidas durante a análise) ---------- */

const ETAPAS = [
  { rotulo: 'Interpretando o ticket', detalhe: 'Módulo, produto e códigos de erro' },
  { rotulo: 'Busca híbrida na base', detalhe: 'Similaridade semântica e termos exatos' },
  { rotulo: 'Reordenando candidatos', detalhe: 'Rerank por relevância real' },
  { rotulo: 'Gerando recomendação', detalhe: 'Síntese com citação das fontes' },
];

const EXEMPLOS = [
  {
    rotulo: 'Erro -5002',
    texto:
      'Cliente Metalúrgica Andrade relata erro -5002 ao tentar adicionar nota fiscal de saída a partir do pedido 4471. Acontece só com o item ACO-1020. SAP B1 10.0 PL08.',
  },
  {
    rotulo: 'Rejeição 539',
    texto:
      'NF-e número 8812 está sendo rejeitada com o código 539 (duplicidade com diferença na chave de acesso). Ontem houve queda de internet durante a emissão. 4.2.',
  },
  {
    rotulo: 'Boleto CNAB',
    texto:
      'O banco devolveu a remessa de cobrança CNAB 240 inteira, informando segmento P inválido. Cliente trocou de agência no mês passado. 4.2.',
  },
];

const CONF = {
  alta: { texto: 'Confiança alta', cor: 'petrol', nota: 'Casos muito próximos na base.' },
  media: { texto: 'Confiança média', cor: 'ambar', nota: 'Há semelhança — valide os detalhes.' },
  baixa: { texto: 'Confiança baixa', cor: 'tijolo', nota: 'Use apenas como ponto de partida.' },
};

/* ---------- chamada ao backend ---------- */

async function pedirSugestao(texto) {
  const r = await fetch(`${API}/api/suggest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ texto }),
  });
  if (!r.ok) throw new Error(`O servidor respondeu ${r.status}.`);
  return r.json();
}

/* ---------- ícones (inline, sem dependências) ---------- */

const Icone = {
  spark: (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.4 2.4M15.3 15.3l2.4 2.4M17.7 6.3l-2.4 2.4M8.7 15.3l-2.4 2.4"
        stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  check: (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  busca: (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.7" />
      <path d="M20 20l-3.2-3.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  ),
  doc: (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 3h7l4 4v14H7z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M14 3v4h4M9.5 12h5M9.5 15.5h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
};

/* ---------- medidor de confiança (elemento de assinatura) ---------- */

function MedidorConfianca({ pct, cor, rotulo, nota }) {
  const RAIO = 70;
  const comprimento = Math.PI * RAIO; // semicircunferência
  const offset = comprimento * (1 - Math.max(0, Math.min(1, pct)));

  return (
    <div className="medidor">
      <div className="medidor-grafico">
        <svg viewBox="0 0 160 98" className="medidor-svg" role="img" aria-label={`${rotulo}: ${Math.round(pct * 100)}%`}>
          <path className="medidor-trilha" d="M12 88 A70 70 0 0 1 148 88" />
          <path
            className={`medidor-arco arco-${cor}`}
            d="M12 88 A70 70 0 0 1 148 88"
            style={{ strokeDasharray: comprimento, strokeDashoffset: offset }}
          />
        </svg>
        <div className="medidor-centro">
          <span className={`medidor-pct cor-${cor}`}>{Math.round(pct * 100)}%</span>
          <span className="medidor-escala">similaridade</span>
        </div>
      </div>
      <div className="medidor-texto">
        <span className={`selo selo-${cor}`}>{rotulo}</span>
        <p>{nota}</p>
      </div>
    </div>
  );
}

/* ---------- barra de score do cartão ---------- */

function BarraScore({ score }) {
  const pct = Math.round(score * 100);
  const nivel = score >= 0.55 ? 'petrol' : score >= 0.42 ? 'ambar' : 'tijolo';
  return (
    <div className="score-bloco" title={`Similaridade ${pct}%`}>
      <div className="score-trilha">
        <div className={`score-preench bg-${nivel}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`score-num cor-${nivel}`}>{pct}%</span>
    </div>
  );
}

function CartaoSimilar({ item, indice, expandido, aoExpandir }) {
  return (
    <article
      className={`cartao ${expandido ? 'cartao-aberto' : ''}`}
      style={{ animationDelay: `${indice * 70}ms` }}
    >
      <button className="cartao-cab" onClick={aoExpandir} aria-expanded={expandido}>
        <div className="cartao-topo">
          <span className="chip chip-id">{item.id}</span>
          <span className="chip">{item.modulo}</span>
          <span className="chip chip-prod">{item.produto}</span>
          <span className={`seta ${expandido ? 'seta-aberta' : ''}`} aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </span>
        </div>
        <h4 className="cartao-titulo">{item.titulo}</h4>
        <BarraScore score={item.score} />
      </button>
      {expandido && (
        <div className="cartao-corpo">
          <div className="campo">
            <span className="campo-rotulo">Causa raiz</span>
            <p>{item.causa}</p>
          </div>
          <div className="campo">
            <span className="campo-rotulo">Solução aplicada</span>
            <p>{item.solucao}</p>
          </div>
          <p className="cartao-rodape">
            Resolvido por {item.resolvidoPor} · {item.data}
          </p>
        </div>
      )}
    </article>
  );
}

/* ---------- pipeline animado ---------- */

function Pipeline({ etapaAtual }) {
  return (
    <ol className="pipeline">
      {ETAPAS.map((e, i) => {
        const estado = i < etapaAtual ? 'feito' : i === etapaAtual ? 'ativo' : 'aguardando';
        return (
          <li key={e.rotulo} className={`pipe-item pipe-${estado}`}>
            <span className="pipe-marca">
              {estado === 'feito' ? Icone.check : <span className="pipe-ponto" />}
            </span>
            <span className="pipe-texto">
              <span className="pipe-rotulo">{e.rotulo}</span>
              <span className="pipe-detalhe">{e.detalhe}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/* ================= APP ================= */

export default function App() {
  const [texto, setTexto] = useState('');
  const [fase, setFase] = useState('ocioso'); // ocioso | analisando | pronto | erro
  const [etapaIdx, setEtapaIdx] = useState(0);
  const [resultado, setResultado] = useState(null);
  const [erro, setErro] = useState(null);
  const [expandido, setExpandido] = useState(0);
  const [feedback, setFeedback] = useState(null);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const etapaTimer = useRef(null);

  const analisando = fase === 'analisando';

  useEffect(
    () => () => {
      clearInterval(etapaTimer.current);
      clearTimeout(toastTimer.current);
    },
    []
  );

  async function analisar() {
    if (!texto.trim() || analisando) return;
    setFase('analisando');
    setResultado(null);
    setErro(null);
    setFeedback(null);
    setExpandido(0);
    setEtapaIdx(0);

    clearInterval(etapaTimer.current);
    etapaTimer.current = setInterval(() => {
      setEtapaIdx((i) => Math.min(i + 1, ETAPAS.length - 1));
    }, 650);

    try {
      const r = await pedirSugestao(texto);
      clearInterval(etapaTimer.current);
      setResultado(r);
      setFase('pronto');
    } catch (e) {
      clearInterval(etapaTimer.current);
      setErro(e.message);
      setFase('erro');
    }
  }

  function registrarFeedback(valor) {
    setFeedback(valor);
    fetch(`${API}/api/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket: texto, sugestao: resultado, resultado: valor }),
    }).catch(() => {});
    setToast('Feedback registrado — ele realimenta a base.');
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }

  const conf = resultado && !resultado.abstencao ? CONF[resultado.confianca] ?? CONF.baixa : null;
  const gaugePct =
    resultado?.similares?.[0]?.score ??
    (resultado?.confianca === 'alta' ? 0.8 : resultado?.confianca === 'media' ? 0.55 : 0.35);

  return (
    <div className="app">
      <style>{CSS}</style>

      <header className="topo">
        <div className="marca">
          <span className="marca-logo">{Icone.spark}</span>
          <div className="marca-nome">
            <h1>TicketInsight</h1>
            <p>Busca em chamados anteriores — SAP Business One</p>
          </div>
        </div>
      </header>

      <main className="grade">
        {/* ---------- entrada ---------- */}
        <section className="painel painel-entrada">
          <span className="olho">Entrada</span>
          <h2>Descreva o chamado</h2>
          <p className="dica">
            Cole o relato do cliente. Em produção, o webhook do sistema de chamados preenche este
            campo automaticamente.
          </p>

          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Ex.: erro -5002 ao adicionar nota fiscal de saída no SAP B1 10.0…"
            rows={9}
            disabled={analisando}
          />

          <div className="exemplos">
            <span className="exemplos-rotulo">Exemplos</span>
            <div className="exemplos-chips">
              {EXEMPLOS.map((ex) => (
                <button
                  key={ex.rotulo}
                  className="chip-exemplo"
                  onClick={() => setTexto(ex.texto)}
                  disabled={analisando}
                >
                  {ex.rotulo}
                </button>
              ))}
            </div>
          </div>

          <button className="botao-primario" onClick={analisar} disabled={!texto.trim() || analisando}>
            <span className="botao-icone">{analisando ? Icone.busca : Icone.spark}</span>
            {analisando ? 'Analisando…' : 'Analisar ticket'}
          </button>
        </section>

        {/* ---------- saída ---------- */}
        <section className="painel painel-saida">
          {fase === 'ocioso' && (
            <div className="estado-vazio">
              <span className="vazio-icone">{Icone.busca}</span>
              <h3>Pronto para analisar</h3>
              <p>
                As recomendações aparecem aqui: chamados resolvidos parecidos, o procedimento sugerido
                e a documentação relacionada do SAP B1.
              </p>
            </div>
          )}

          {analisando && (
            <div className="analisando-area">
              <span className="olho">Processando</span>
              <Pipeline etapaAtual={etapaIdx} />
              <div className="esqueleto">
                <span className="sk sk-lg" />
                <span className="sk sk-md" />
                <span className="sk sk-sm" />
              </div>
            </div>
          )}

          {fase === 'erro' && (
            <div className="estado-erro">
              <h3>Não foi possível analisar</h3>
              <p>
                O serviço de IA não respondeu ({erro}). Confirme se o backend está rodando em{' '}
                <code>{API}</code> e tente novamente.
              </p>
              <button className="botao-secundario" onClick={analisar}>
                Tentar de novo
              </button>
            </div>
          )}

          {fase === 'pronto' && resultado?.abstencao && (
            <div className="estado-abstencao">
              <span className="olho">Sem correspondência</span>
              <h3>Nenhum caso próximo o bastante</h3>
              <p>
                A base ainda não tem chamados semelhantes a este cenário. Trate como caso novo — ao
                resolvê-lo com boa documentação, ele passará a ajudar os próximos analistas.
              </p>
            </div>
          )}

          {fase === 'pronto' && resultado && !resultado.abstencao && (
            <div className="resultado">
              <MedidorConfianca pct={gaugePct} cor={conf.cor} rotulo={conf.texto} nota={conf.nota} />

              <div className="bloco">
                <span className="olho">Procedimento recomendado</span>
                <ol className="procedimento">
                  {resultado.procedimento.map((p, i) => (
                    <li key={i}>
                      <span className="passo-num">{i + 1}</span>
                      <span className="passo-texto">{p}</span>
                    </li>
                  ))}
                </ol>
              </div>

              <div className="bloco">
                <span className="olho">
                  Chamados similares <span className="contagem">{resultado.similares.length}</span>
                </span>
                <div className="lista-cartoes">
                  {resultado.similares.map((item, i) => (
                    <CartaoSimilar
                      key={item.id}
                      item={item}
                      indice={i}
                      expandido={expandido === i}
                      aoExpandir={() => setExpandido(expandido === i ? null : i)}
                    />
                  ))}
                </div>
              </div>

              {resultado.docs?.length > 0 && (
                <div className="bloco">
                  <span className="olho">Documentação relacionada</span>
                  <ul className="docs">
                    {resultado.docs.map((d) => (
                      <li key={d.ref}>
                        <span className="doc-icone">{Icone.doc}</span>
                        <span className="chip chip-id">{d.ref}</span>
                        <span className="doc-titulo">{d.titulo}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="feedback">
                <p>Esta recomendação ajudou na resolução?</p>
                <div className="feedback-botoes">
                  {[
                    ['resolveu', 'Resolveu'],
                    ['parcial', 'Ajudou em parte'],
                    ['nao', 'Sem relação'],
                  ].map(([valor, rotulo]) => (
                    <button
                      key={valor}
                      className={`botao-feedback ${feedback === valor ? 'fb-ativo' : ''}`}
                      onClick={() => registrarFeedback(valor)}
                    >
                      {rotulo}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>
      </main>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

/* ================= estilos ================= */

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');

:root {
  --ink: #101c2b;
  --ink-2: #1b3552;
  --tinta: #1c2734;
  --tinta-suave: #5e7185;
  --tinta-fraca: #8595a6;
  --papel: #eef2f6;
  --branco: #ffffff;
  --borda: #dde5ec;
  --borda-forte: #c7d3de;
  --azul: #1f5d97;
  --azul-vivo: #2b74bd;
  --petrol: #0c7a63;
  --petrol-claro: #e0f2ed;
  --ambar: #a9740f;
  --ambar-claro: #f9efd8;
  --tijolo: #b23a28;
  --tijolo-claro: #f9e6e1;
  --sombra: 0 1px 2px rgba(16,28,43,.04), 0 8px 24px rgba(16,28,43,.06);
  --sombra-forte: 0 12px 40px rgba(16,28,43,.12);
}

* { box-sizing: border-box; margin: 0; }
body { background: var(--papel); }

.app {
  min-height: 100vh;
  font-family: 'IBM Plex Sans', system-ui, sans-serif;
  color: var(--tinta);
  max-width: 1200px;
  margin: 0 auto;
  padding: 22px 24px 72px;
  -webkit-font-smoothing: antialiased;
}

/* ---------- cabeçalho ---------- */
.topo {
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  background: linear-gradient(135deg, var(--ink) 0%, var(--ink-2) 100%);
  color: #fff; border-radius: 18px; padding: 20px 24px; margin-bottom: 22px;
  box-shadow: var(--sombra-forte); position: relative; overflow: hidden;
}
.topo::after {
  content: ''; position: absolute; right: -60px; top: -80px; width: 240px; height: 240px;
  background: radial-gradient(circle, rgba(43,116,189,.35), transparent 65%); pointer-events: none;
}
.marca { display: flex; align-items: center; gap: 14px; z-index: 1; }
.marca-logo {
  width: 46px; height: 46px; border-radius: 12px; display: grid; place-items: center;
  background: linear-gradient(135deg, var(--azul-vivo), #45c2a8); color: #fff;
  box-shadow: 0 4px 14px rgba(43,116,189,.4);
}
.marca-logo svg { width: 24px; height: 24px; }
.marca-nome h1 { font-size: 20px; font-weight: 700; letter-spacing: -0.015em; }
.marca-nome p { font-size: 12.5px; color: #aebfd2; margin-top: 2px; }

/* ---------- grade ---------- */
.grade { display: grid; grid-template-columns: 5fr 7fr; gap: 22px; align-items: start; }
@media (max-width: 900px) { .grade { grid-template-columns: 1fr; } }

.painel {
  background: var(--branco); border: 1px solid var(--borda);
  border-radius: 18px; padding: 26px; box-shadow: var(--sombra);
}
.painel-saida { min-height: 460px; }

.olho {
  display: inline-block; font-family: 'IBM Plex Mono', monospace;
  font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .12em;
  color: var(--azul); margin-bottom: 10px;
}
.painel h2 { font-size: 19px; font-weight: 600; letter-spacing: -0.01em; }
.dica { font-size: 13px; color: var(--tinta-suave); line-height: 1.6; margin: 8px 0 16px; }

/* ---------- entrada ---------- */
textarea {
  width: 100%; resize: vertical; font: inherit; font-size: 14px; line-height: 1.65;
  border: 1px solid var(--borda-forte); border-radius: 12px; padding: 14px 16px;
  color: var(--tinta); background: #fbfcfd; transition: border-color .15s, box-shadow .15s;
}
textarea::placeholder { color: var(--tinta-fraca); }
textarea:focus {
  outline: none; border-color: var(--azul-vivo);
  box-shadow: 0 0 0 4px rgba(43,116,189,.12); background: #fff;
}
textarea:disabled { opacity: .6; }

.exemplos { margin: 16px 0 20px; }
.exemplos-rotulo {
  display: block; font-size: 11.5px; color: var(--tinta-fraca); margin-bottom: 8px;
  text-transform: uppercase; letter-spacing: .08em; font-weight: 600;
}
.exemplos-chips { display: flex; gap: 8px; flex-wrap: wrap; }
.chip-exemplo {
  font: inherit; font-size: 12.5px; cursor: pointer; color: var(--azul);
  border: 1px solid var(--borda-forte); background: #fff;
  border-radius: 999px; padding: 6px 14px; transition: all .15s;
}
.chip-exemplo:hover:not(:disabled) { border-color: var(--azul-vivo); background: #f2f8fd; }
.chip-exemplo:disabled { opacity: .5; cursor: default; }

.botao-primario {
  width: 100%; display: flex; align-items: center; justify-content: center; gap: 9px;
  font: inherit; font-weight: 600; font-size: 15px; cursor: pointer; color: #fff;
  background: linear-gradient(135deg, var(--azul-vivo), var(--azul));
  border: none; border-radius: 12px; padding: 14px;
  box-shadow: 0 6px 18px rgba(31,93,151,.28); transition: transform .12s, box-shadow .12s, opacity .15s;
}
.botao-primario:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 10px 26px rgba(31,93,151,.34); }
.botao-primario:active:not(:disabled) { transform: translateY(0); }
.botao-primario:disabled { opacity: .5; cursor: default; box-shadow: none; }
.botao-icone { display: grid; place-items: center; }
.botao-icone svg { width: 18px; height: 18px; }

/* ---------- estados vazio / erro ---------- */
.estado-vazio { text-align: center; padding: 64px 28px; }
.vazio-icone {
  width: 54px; height: 54px; border-radius: 14px; margin: 0 auto 18px;
  display: grid; place-items: center; color: var(--azul);
  background: linear-gradient(135deg, #eaf3fb, #e3f2ee);
}
.vazio-icone svg { width: 26px; height: 26px; }
.estado-vazio h3 { font-size: 16px; font-weight: 600; margin-bottom: 8px; }
.estado-vazio p { font-size: 13.5px; line-height: 1.65; color: var(--tinta-suave); max-width: 380px; margin: 0 auto; }

.estado-erro { padding: 48px 24px; text-align: center; }
.estado-erro h3 { font-size: 16px; font-weight: 600; color: var(--tijolo); margin-bottom: 8px; }
.estado-erro p { font-size: 13.5px; line-height: 1.65; color: var(--tinta-suave); max-width: 420px; margin: 0 auto 18px; }
.estado-erro code { font-family: 'IBM Plex Mono', monospace; font-size: 12.5px; background: var(--papel); padding: 1px 6px; border-radius: 5px; }
.botao-secundario {
  font: inherit; font-size: 13.5px; font-weight: 500; cursor: pointer; color: var(--azul);
  border: 1px solid var(--borda-forte); background: #fff; border-radius: 10px; padding: 9px 18px;
}
.botao-secundario:hover { border-color: var(--azul-vivo); background: #f2f8fd; }

.estado-abstencao { padding: 48px 8px; }
.estado-abstencao h3 { font-size: 17px; font-weight: 600; margin-bottom: 10px; }
.estado-abstencao p { font-size: 14px; line-height: 1.7; color: var(--tinta-suave); }

/* ---------- pipeline ---------- */
.analisando-area { padding: 6px 4px; }
.pipeline { list-style: none; display: grid; gap: 2px; margin: 6px 0 24px; }
.pipe-item { display: flex; align-items: flex-start; gap: 13px; padding: 11px 12px; border-radius: 10px; position: relative; }
.pipe-item:not(:last-child)::before {
  content: ''; position: absolute; left: 23px; top: 36px; bottom: -2px; width: 2px; background: var(--borda);
}
.pipe-marca {
  flex: none; width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center;
  border: 2px solid var(--borda-forte); background: #fff; color: #fff; z-index: 1;
}
.pipe-marca svg { width: 13px; height: 13px; }
.pipe-ponto { width: 7px; height: 7px; border-radius: 50%; background: var(--borda-forte); }
.pipe-rotulo { display: block; font-size: 14px; font-weight: 500; color: var(--tinta-fraca); }
.pipe-detalhe { display: block; font-size: 12px; color: var(--tinta-fraca); margin-top: 1px; }

.pipe-ativo { background: #f2f8fd; }
.pipe-ativo .pipe-marca { border-color: var(--azul-vivo); }
.pipe-ativo .pipe-ponto { background: var(--azul-vivo); animation: piscar 1s ease-in-out infinite; }
.pipe-ativo .pipe-rotulo { color: var(--tinta); }
.pipe-ativo .pipe-detalhe { color: var(--tinta-suave); }
@keyframes piscar { 50% { opacity: .3; } }

.pipe-feito .pipe-marca { border-color: var(--petrol); background: var(--petrol); }
.pipe-feito .pipe-rotulo { color: var(--tinta); }
.pipe-feito::before { background: var(--petrol) !important; }

.esqueleto { display: grid; gap: 12px; padding: 4px 12px; }
.sk { height: 14px; border-radius: 6px; background: linear-gradient(90deg, #eef2f6 25%, #e2e8ef 37%, #eef2f6 63%); background-size: 400% 100%; animation: brilho 1.4s ease infinite; }
.sk-lg { width: 100%; } .sk-md { width: 82%; } .sk-sm { width: 60%; }
@keyframes brilho { 0% { background-position: 100% 0; } 100% { background-position: -100% 0; } }

/* ---------- resultado ---------- */
.resultado { animation: surge .35s ease both; }
@keyframes surge { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
.bloco { margin-top: 26px; }

/* medidor */
.medidor {
  display: flex; align-items: center; gap: 22px;
  background: linear-gradient(135deg, #f7fafc, #eef4f9); border: 1px solid var(--borda);
  border-radius: 16px; padding: 18px 22px;
}
.medidor-grafico { position: relative; flex: none; width: 160px; }
.medidor-svg { width: 160px; display: block; }
.medidor-trilha { fill: none; stroke: #dde5ec; stroke-width: 12; stroke-linecap: round; }
.medidor-arco { fill: none; stroke-width: 12; stroke-linecap: round; transition: stroke-dashoffset 1s cubic-bezier(.4,0,.2,1); }
.arco-petrol { stroke: var(--petrol); }
.arco-ambar { stroke: var(--ambar); }
.arco-tijolo { stroke: var(--tijolo); }
.medidor-centro { position: absolute; left: 0; right: 0; bottom: 6px; text-align: center; }
.medidor-pct { display: block; font-family: 'IBM Plex Mono', monospace; font-size: 26px; font-weight: 600; letter-spacing: -.02em; }
.medidor-escala { display: block; font-size: 10.5px; color: var(--tinta-fraca); text-transform: uppercase; letter-spacing: .1em; }
.medidor-texto { flex: 1; }
.medidor-texto p { font-size: 13px; color: var(--tinta-suave); line-height: 1.55; margin-top: 8px; }
.cor-petrol { color: var(--petrol); } .cor-ambar { color: var(--ambar); } .cor-tijolo { color: var(--tijolo); }

.selo { display: inline-block; font-size: 12.5px; font-weight: 600; border-radius: 999px; padding: 5px 14px; }
.selo-petrol { background: var(--petrol-claro); color: var(--petrol); }
.selo-ambar { background: var(--ambar-claro); color: var(--ambar); }
.selo-tijolo { background: var(--tijolo-claro); color: var(--tijolo); }

.contagem { font-family: 'IBM Plex Mono', monospace; font-weight: 500; color: var(--tinta-suave); background: var(--papel); border: 1px solid var(--borda); border-radius: 6px; padding: 0 7px; margin-left: 4px; }

/* procedimento */
.procedimento { list-style: none; display: grid; gap: 10px; }
.procedimento li { display: flex; gap: 13px; align-items: flex-start; }
.passo-num {
  flex: none; width: 26px; height: 26px; border-radius: 8px; display: grid; place-items: center;
  font-family: 'IBM Plex Mono', monospace; font-size: 13px; font-weight: 600;
  background: var(--ink); color: #fff;
}
.passo-texto { font-size: 14px; line-height: 1.6; padding-top: 2px; }

/* cartões */
.lista-cartoes { display: grid; gap: 10px; }
.cartao { border: 1px solid var(--borda); border-radius: 14px; overflow: hidden; background: #fff; animation: surge .4s ease both; transition: border-color .15s, box-shadow .15s; }
.cartao:hover { box-shadow: var(--sombra); }
.cartao-aberto { border-color: var(--azul-vivo); box-shadow: 0 0 0 3px rgba(43,116,189,.1); }
.cartao-cab { width: 100%; text-align: left; font: inherit; cursor: pointer; background: none; border: none; padding: 15px 17px; display: grid; gap: 9px; }
.cartao-topo { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.chip { font-size: 11.5px; color: var(--tinta-suave); background: var(--papel); border: 1px solid var(--borda); border-radius: 7px; padding: 2px 9px; }
.chip-id { font-family: 'IBM Plex Mono', monospace; color: var(--azul); font-weight: 500; }
.chip-prod { color: var(--tinta-fraca); }
.seta { margin-left: auto; color: var(--tinta-fraca); display: grid; place-items: center; transition: transform .2s; }
.seta svg { width: 18px; height: 18px; }
.seta-aberta { transform: rotate(180deg); color: var(--azul-vivo); }
.cartao-titulo { font-size: 14.5px; font-weight: 500; line-height: 1.4; }

.score-bloco { display: flex; align-items: center; gap: 10px; }
.score-trilha { flex: 1; height: 6px; background: var(--papel); border-radius: 4px; overflow: hidden; }
.score-preench { height: 100%; border-radius: 4px; transition: width .6s ease; }
.bg-petrol { background: var(--petrol); } .bg-ambar { background: var(--ambar); } .bg-tijolo { background: var(--tijolo); }
.score-num { font-family: 'IBM Plex Mono', monospace; font-size: 12.5px; font-weight: 600; min-width: 38px; text-align: right; }

.cartao-corpo { border-top: 1px solid var(--borda); padding: 16px 17px; display: grid; gap: 14px; background: #fbfcfd; }
.campo-rotulo { display: block; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .07em; color: var(--tinta-fraca); margin-bottom: 4px; }
.campo p { font-size: 13.5px; line-height: 1.6; color: var(--tinta); }
.cartao-rodape { color: var(--tinta-fraca); font-size: 12.5px; padding-top: 2px; }

/* docs */
.docs { list-style: none; display: grid; gap: 8px; }
.docs li { display: flex; align-items: center; gap: 10px; font-size: 13.5px; padding: 11px 14px; border: 1px solid var(--borda); border-radius: 11px; background: #fbfcfd; transition: border-color .15s; }
.docs li:hover { border-color: var(--borda-forte); }
.doc-icone { color: var(--azul); display: grid; place-items: center; }
.doc-icone svg { width: 18px; height: 18px; }
.doc-titulo { color: var(--tinta); }

/* feedback */
.feedback { margin-top: 28px; border-top: 1px solid var(--borda); padding-top: 20px; }
.feedback p { font-size: 13.5px; font-weight: 500; margin-bottom: 12px; }
.feedback-botoes { display: flex; gap: 8px; flex-wrap: wrap; }
.botao-feedback { font: inherit; font-size: 13px; font-weight: 500; cursor: pointer; border: 1px solid var(--borda-forte); background: #fff; color: var(--tinta); border-radius: 999px; padding: 8px 18px; transition: all .15s; }
.botao-feedback:hover { border-color: var(--azul-vivo); background: #f2f8fd; }
.fb-ativo { background: var(--ink); border-color: var(--ink); color: #fff; }
.fb-ativo:hover { background: var(--ink); }

/* toast */
.toast { position: fixed; bottom: 26px; left: 50%; transform: translateX(-50%); background: var(--ink); color: #fff; font-size: 13.5px; border-radius: 12px; padding: 12px 22px; box-shadow: var(--sombra-forte); animation: surge .25s ease; z-index: 50; }

button:focus-visible, textarea:focus-visible, .cartao-cab:focus-visible { outline: 2px solid var(--azul-vivo); outline-offset: 2px; }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
}
`;