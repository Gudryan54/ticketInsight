/* ============================================================
   TicketInsight — API Node.js (100% local, sem custo)
   Fluxo: ticket → máscara de PII → embedding LOCAL (Transformers.js)
   → busca híbrida (vetorial em memória + Full-Text do SQL Server +
   reforço de códigos literais, fusão RRF) → top 5 → procedimento
   montado a partir dos chamados recuperados → resposta no shape
   que o App.jsx espera.

   Sem OpenAI, sem internet (após o 1º download do modelo), sem
   dados saindo da empresa.

   Endpoints:
     POST /api/suggest   { texto }            → sugestão
     POST /api/feedback  { ticket, sugestao, resultado }
     POST /api/ingest    { id, titulo, ... }  → indexa chamado resolvido
     GET  /api/health
   ============================================================ */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import sql from 'mssql';
import { pipeline } from '@xenova/transformers';

const PORTA = Number(process.env.PORT || 3001);

const SQL_CONFIG = {
  server: process.env.SQL_SERVER,
  port: Number(process.env.SQL_PORT || 1433),
  database: process.env.SQL_DATABASE,
  user: process.env.SQL_USER,
  password: process.env.SQL_PASSWORD,
  options: {
    encrypt: process.env.SQL_ENCRYPT === 'true',
    trustServerCertificate: true, // VM interna com certificado autoassinado
  },
  pool: { max: 10, min: 1 },
};

// Limiares de confiança sobre a similaridade de cosseno do melhor
// candidato. CALIBRAR com tickets reais (ver README, seção 6).
const LIMIAR_ALTA = Number(process.env.CONF_ALTA || 0.86);
const LIMIAR_MEDIA = Number(process.env.CONF_MEDIA || 0.82);
const LIMIAR_ABSTENCAO = Number(process.env.CONF_ABSTENCAO || 0.78);

// Modelo de embeddings local. multilingual-e5-small: bom em PT,
// leve (~470 MB), 384 dimensões. Baixado uma vez e cacheado.
const MODELO_EMB = process.env.MODELO_EMB || 'Xenova/multilingual-e5-small';

// Segredo compartilhado com o webhook do Movidesk. Requisições a
// /api/ingest e /api/movidesk precisam enviar este valor no header
// "x-webhook-secret". Sem ele (ou errado), são recusadas.
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';

/* ---------------- embeddings locais (Transformers.js) ----------------
   Carregado uma vez na subida. A família E5 espera prefixos:
   "query: " para a consulta e "passage: " para os documentos. */

let extrator = null;

async function carregarModelo() {
  if (!extrator) {
    console.log(`[modelo] Carregando ${MODELO_EMB} (1ª vez baixa ~470 MB)…`);
    extrator = await pipeline('feature-extraction', MODELO_EMB);
    console.log('[modelo] Pronto.');
  }
  return extrator;
}

async function gerarEmbedding(texto, tipo /* 'query' | 'passage' */) {
  const ext = await carregarModelo();
  const prefixo = tipo === 'query' ? 'query: ' : 'passage: ';
  const saida = await ext(prefixo + texto.slice(0, 2000), {
    pooling: 'mean',
    normalize: true,
  });
  return Array.from(saida.data); // Float32 normalizado
}

/* ---------------- utilidades: vetores ---------------- */

function float32ParaBuffer(arr) {
  return Buffer.from(new Float32Array(arr).buffer);
}

function bufferParaFloat32(buf) {
  return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
}

// Vetores já vêm normalizados (normalize:true), então o produto
// interno equivale ao cosseno.
function similaridade(a, b) {
  let prod = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) prod += a[i] * b[i];
  return prod;
}

/* ---------------- LGPD: máscara de PII ----------------
   Aplicada antes de gravar feedback e antes de indexar.
   Ordem importa: CNPJ antes de CPF (CNPJ contém padrão de CPF). */

function mascararPII(texto) {
  return texto
    .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, '[CNPJ]')
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[CPF]')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[EMAIL]')
    .replace(/\b(\+?55\s?)?(\(?\d{2}\)?\s?)?9?\d{4}[-\s]\d{4}\b/g, '[TELEFONE]');
}

/* ---------------- montagem do procedimento (sem LLM) ----------------
   Em vez de pedir a um LLM para redigir, montamos os passos a partir
   do melhor chamado recuperado. Determinístico, gratuito e sempre
   ancorado numa fonte real (cita o ID do chamado). */

function montarProcedimento(melhor) {
  return [
    `Confirmar com o cliente o cenário descrito em ${melhor.Id}: ${melhor.Causa}`,
    melhor.Solucao,
    'Validar o resultado com o cliente e registrar a causa raiz no encerramento do ticket.',
  ];
}

/* ---------------- cache vetorial em memória ---------------- */

let cacheVetores = []; // [{ id, vetor: Float32Array }]

async function recarregarCache(pool) {
  const rs = await pool
    .request()
    .query('SELECT Id, Embedding FROM dbo.Chamados WHERE Embedding IS NOT NULL');
  cacheVetores = rs.recordset.map((r) => ({
    id: r.Id,
    vetor: bufferParaFloat32(r.Embedding),
  }));
  console.log(`[cache] ${cacheVetores.length} embeddings carregados.`);
}

/* ---------------- busca híbrida ---------------- */

function buscaVetorial(vetorTicket, topN = 20) {
  return cacheVetores
    .map((c) => ({ id: c.id, sim: similaridade(vetorTicket, c.vetor) }))
    .sort((a, b) => b.sim - a.sim)
    .slice(0, topN);
}

let fullTextDisponivel = true;

async function buscaTextual(pool, texto, topN = 20) {
  if (!fullTextDisponivel) return [];
  try {
    const rs = await pool
      .request()
      .input('q', sql.NVarChar(500), texto.slice(0, 480))
      .query(
        `SELECT TOP (${topN}) K.[KEY] AS Id, K.RANK AS Rk
           FROM FREETEXTTABLE(dbo.Chamados, (Titulo, TextoBusca), @q, LANGUAGE 1046) K
          ORDER BY K.RANK DESC`
      );
    return rs.recordset.map((r) => r.Id);
  } catch (e) {
    fullTextDisponivel = false;
    console.warn('[aviso] Full-Text indisponível, usando apenas busca vetorial:', e.message);
    return [];
  }
}

// Códigos literais (ex.: -5002, 539, ODBC -1029) são o sinal mais
// forte de um ticket SAP B1 — recebem um reforço dedicado via LIKE.
function extrairCodigos(texto) {
  const m = texto.match(/-\d{3,5}\b|\b\d{3}\b(?=\s*[—\-(]|\s+duplicidade|\s+rejei)/gi) || [];
  return [...new Set(m.map((c) => c.trim()))].slice(0, 3);
}

async function buscaPorCodigos(pool, codigos) {
  if (codigos.length === 0) return [];
  const req = pool.request();
  const condicoes = codigos.map((c, i) => {
    req.input(`c${i}`, sql.NVarChar(20), `%${c}%`);
    return `(Titulo LIKE @c${i} OR TextoBusca LIKE @c${i})`;
  });
  const rs = await req.query(
    `SELECT TOP 10 Id FROM dbo.Chamados WHERE ${condicoes.join(' OR ')}`
  );
  return rs.recordset.map((r) => r.Id);
}

// Reciprocal Rank Fusion: combina rankings de naturezas diferentes
// sem precisar normalizar scores.
function fundirRankings(listas, k = 60) {
  const pontos = new Map();
  for (const lista of listas) {
    lista.forEach((id, rank) => {
      pontos.set(id, (pontos.get(id) || 0) + 1 / (k + rank));
    });
  }
  return [...pontos.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

/* ---------------- aplicação ---------------- */

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

let pool;

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    modelo: MODELO_EMB,
    modeloCarregado: !!extrator,
    embeddings: cacheVetores.length,
    fullText: fullTextDisponivel,
  });
});

app.post('/api/suggest', async (req, res) => {
  try {
    const texto = (req.body?.texto || '').trim();
    if (texto.length < 10) {
      return res.status(400).json({ erro: 'Envie o campo "texto" com a descrição do ticket.' });
    }

    const mascarado = mascararPII(texto);

    // 1. Embedding local do ticket (como "query")
    const vetor = await gerarEmbedding(mascarado, 'query');

    // 2. Busca híbrida
    const vetorial = buscaVetorial(vetor, 20);
    const simPorId = new Map(vetorial.map((v) => [v.id, v.sim]));
    const [textual, porCodigo] = await Promise.all([
      buscaTextual(pool, mascarado, 20),
      buscaPorCodigos(pool, extrairCodigos(mascarado)),
    ]);

    const idsFundidos = fundirRankings([
      vetorial.map((v) => v.id),
      textual,
      porCodigo,
      porCodigo, // reforço deliberado a literais
    ]).slice(0, 5);

    const melhorSim = Math.max(0, ...idsFundidos.map((id) => simPorId.get(id) ?? 0));

    // 3. Abstenção
    if (idsFundidos.length === 0 || melhorSim < LIMIAR_ABSTENCAO) {
      return res.json({
        abstencao: true,
        confianca: 'baixa',
        similares: [],
        procedimento: [],
        docs: [],
      });
    }

    // 4. Hidratar candidatos
    const reqRows = pool.request();
    idsFundidos.forEach((id, i) => reqRows.input(`id${i}`, sql.NVarChar(20), id));
    const rows = (
      await reqRows.query(
        `SELECT Id, Titulo, Modulo, Produto, Causa, Solucao, ResolvidoPor, DataResolucao
           FROM dbo.Chamados
          WHERE Id IN (${idsFundidos.map((_, i) => `@id${i}`).join(',')})`
      )
    ).recordset;
    const ordenados = idsFundidos.map((id) => rows.find((r) => r.Id === id)).filter(Boolean);
    const top3 = ordenados.slice(0, 3);

    // 5. Procedimento (sem LLM) + docs do módulo principal
    const docsRs = await pool
      .request()
      .input('mod', sql.NVarChar(60), top3[0].Modulo || '')
      .query('SELECT Ref, Titulo FROM dbo.DocsKB WHERE Modulo = @mod');

    const confianca =
      melhorSim >= LIMIAR_ALTA ? 'alta' : melhorSim >= LIMIAR_MEDIA ? 'media' : 'baixa';

    // 6. Resposta no shape exato esperado pelo App.jsx
    res.json({
      abstencao: false,
      confianca,
      similares: top3.map((r) => ({
        id: r.Id,
        titulo: r.Titulo,
        modulo: r.Modulo,
        produto: r.Produto,
        causa: r.Causa,
        solucao: r.Solucao,
        resolvidoPor: r.ResolvidoPor,
        data: r.DataResolucao ? r.DataResolucao.toISOString().slice(0, 10) : '',
        score: Math.round((simPorId.get(r.Id) ?? LIMIAR_ABSTENCAO) * 100) / 100,
      })),
      procedimento: montarProcedimento(top3[0]),
      docs: docsRs.recordset.map((d) => ({ ref: d.Ref, titulo: d.Titulo })),
    });
  } catch (e) {
    console.error('[suggest]', e);
    res.status(500).json({ erro: 'Falha ao gerar sugestão.', detalhe: e.message });
  }
});

app.post('/api/feedback', async (req, res) => {
  try {
    const { ticket, sugestao, resultado } = req.body || {};
    if (!ticket || !['resolveu', 'parcial', 'nao'].includes(resultado)) {
      return res.status(400).json({ erro: 'Campos esperados: ticket, sugestao, resultado.' });
    }
    await pool
      .request()
      .input('t', sql.NVarChar(sql.MAX), mascararPII(ticket))
      .input('s', sql.NVarChar(sql.MAX), JSON.stringify(sugestao ?? null))
      .input('r', sql.NVarChar(20), resultado)
      .query('INSERT INTO dbo.Feedback (TicketTexto, SugestaoJson, Resultado) VALUES (@t, @s, @r)');
    res.json({ ok: true });
  } catch (e) {
    console.error('[feedback]', e);
    res.status(500).json({ erro: 'Falha ao registrar feedback.' });
  }
});

/* ---------------- autenticação do webhook ----------------
   Exige o header x-webhook-secret igual ao WEBHOOK_SECRET do .env.
   Protege os endpoints que escrevem na base quando o backend
   estiver exposto na internet (via ngrok/proxy). */

function exigirSegredo(req, res, next) {
  if (!WEBHOOK_SECRET) {
    return res
      .status(503)
      .json({ erro: 'WEBHOOK_SECRET não configurado no servidor.' });
  }
  if (req.get('x-webhook-secret') !== WEBHOOK_SECRET) {
    return res.status(401).json({ erro: 'Não autorizado.' });
  }
  next();
}

/* ---------------- tradutor do formato Movidesk ----------------
   Recebe o payload de um ticket do Movidesk e o converte para o
   formato que o /api/ingest usa. O Movidesk envia o ticket com
   estrutura própria (id, subject, actions[], status...). Aqui
   extraímos os campos relevantes.

   IMPORTANTE: o mapeamento abaixo cobre o caso comum. Os nomes
   exatos dos campos dependem de como sua equipe usa o Movidesk e
   de como o gatilho monta o corpo do webhook — ajuste conforme o
   payload real que chegar (veja o log "[movidesk] payload" abaixo). */

function traduzirMovidesk(t) {
  // Ações do ticket em ordem; a última do agente costuma conter a solução.
  const acoes = Array.isArray(t.actions) ? t.actions : [];
  const acoesAgente = acoes.filter(
    (a) => a && (a.type === 2 || a.origin === 1 || a.isPublic) && a.description
  );
  const ultimaAcao = acoesAgente.length
    ? acoesAgente[acoesAgente.length - 1].description
    : acoes.length
    ? acoes[acoes.length - 1].description
    : '';

  // Categoria/serviço do Movidesk → módulo da nossa base
  const modulo =
    t.category ||
    (Array.isArray(t.serviceFull) ? t.serviceFull.join(' > ') : '') ||
    t.serviceFirstLevel ||
    null;

  return {
    id: `MD-${t.id}`,
    titulo: t.subject || `Ticket ${t.id}`,
    modulo,
    produto: t.product || null,
    sintoma: t.description || '',
    causa: '', // o Movidesk não tem campo "causa" nativo; opcional preencher via campo adicional
    solucao: limparHtml(ultimaAcao) || t.description || '',
    keywords: [t.subject, modulo, t.product].filter(Boolean).join(' '),
    resolvidoPor: t.ownerName || (t.owner && t.owner.businessName) || null,
    data: (t.resolvedIn || t.lastUpdate || '').slice(0, 10) || null,
  };
}

// Remove marcação HTML que o Movidesk costuma enviar nas ações.
function limparHtml(texto) {
  return String(texto || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Webhook do Movidesk: recebe o ticket resolvido, traduz e indexa.
app.post('/api/movidesk', exigirSegredo, async (req, res) => {
  try {
    const t = req.body || {};
    // Loga o payload na 1ª vez para você ajustar o mapeamento ao seu Movidesk.
    console.log('[movidesk] payload recebido:', JSON.stringify(t).slice(0, 800));

    if (!t.id) {
      return res.status(400).json({ erro: 'Payload do Movidesk sem "id".' });
    }

    const chamado = traduzirMovidesk(t);
    if (!chamado.solucao) {
      // Sem solução não vira conhecimento útil — ignora sem erro.
      console.log(`[movidesk] ${chamado.id} sem solução; ignorado.`);
      return res.json({ ok: true, ignorado: true, motivo: 'sem solução' });
    }

    await indexarChamado(chamado);
    console.log(`[movidesk] ${chamado.id} indexado.`);
    res.json({ ok: true, id: chamado.id });
  } catch (e) {
    console.error('[movidesk]', e);
    res.status(500).json({ erro: 'Falha ao processar webhook do Movidesk.', detalhe: e.message });
  }
});

// Grava (insere ou atualiza) um chamado na base, gerando o embedding.
// Compartilhada por /api/ingest, /api/movidesk e o seed.
async function indexarChamado(c) {
  const textoBusca = mascararPII(
    [c.titulo, c.sintoma, c.causa, c.solucao, c.keywords].filter(Boolean).join('\n')
  );
  // Documentos são embutidos como "passage"
  const vetor = await gerarEmbedding(textoBusca, 'passage');

  await pool
    .request()
    .input('Id', sql.NVarChar(20), c.id)
    .input('Titulo', sql.NVarChar(300), c.titulo)
    .input('Modulo', sql.NVarChar(60), c.modulo ?? null)
    .input('Produto', sql.NVarChar(60), c.produto ?? null)
    .input('Causa', sql.NVarChar(sql.MAX), c.causa ?? null)
    .input('Solucao', sql.NVarChar(sql.MAX), c.solucao)
    .input('TextoBusca', sql.NVarChar(sql.MAX), textoBusca)
    .input('ResolvidoPor', sql.NVarChar(100), c.resolvidoPor ?? null)
    .input('Data', sql.Date, c.data ?? null)
    .input('Emb', sql.VarBinary(sql.MAX), float32ParaBuffer(vetor))
    .input('EmbModelo', sql.NVarChar(60), MODELO_EMB)
    .query(`
      MERGE dbo.Chamados AS alvo
      USING (SELECT @Id AS Id) AS origem ON alvo.Id = origem.Id
      WHEN MATCHED THEN UPDATE SET
        Titulo=@Titulo, Modulo=@Modulo, Produto=@Produto, Causa=@Causa,
        Solucao=@Solucao, TextoBusca=@TextoBusca, ResolvidoPor=@ResolvidoPor,
        DataResolucao=@Data, Embedding=@Emb, EmbeddingModelo=@EmbModelo,
        AtualizadoEm=SYSUTCDATETIME()
      WHEN NOT MATCHED THEN INSERT
        (Id, Titulo, Modulo, Produto, Causa, Solucao, TextoBusca,
         ResolvidoPor, DataResolucao, Embedding, EmbeddingModelo)
        VALUES (@Id, @Titulo, @Modulo, @Produto, @Causa, @Solucao, @TextoBusca,
         @ResolvidoPor, @Data, @Emb, @EmbModelo);
    `);

  await recarregarCache(pool);
}

// Indexa um chamado resolvido (manual, seed ou webhook do sistema
// de chamados ao fechar tickets bem documentados).
app.post('/api/ingest', exigirSegredo, async (req, res) => {
  try {
    const c = req.body || {};
    if (!c.id || !c.titulo || !c.solucao) {
      return res.status(400).json({ erro: 'Campos mínimos: id, titulo, solucao.' });
    }
    await indexarChamado(c);
    res.json({ ok: true, id: c.id });
  } catch (e) {
    console.error('[ingest]', e);
    res.status(500).json({ erro: 'Falha ao indexar chamado.', detalhe: e.message });
  }
});

/* ---------------- subida ---------------- */

async function iniciar() {
  await carregarModelo(); // baixa/carrega o modelo antes de aceitar requisições
  pool = await sql.connect(SQL_CONFIG);
  await recarregarCache(pool);
  app.listen(PORTA, () => {
    console.log(`TicketInsight API em http://localhost:${PORTA}`);
  });
}

iniciar().catch((e) => {
  console.error('Falha ao iniciar:', e);
  process.exit(1);
});