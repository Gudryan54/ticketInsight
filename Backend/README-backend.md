# TicketInsight API — Backend Node.js + SQL Server

Implementa o fluxo: ticket → máscara de PII → embedding → busca híbrida (vetorial em memória + Full-Text do SQL Server + reforço de códigos literais, fusão RRF) → top 5 → GPT gera o procedimento com citações → resposta no formato que o `App.jsx` consome.

## 1. Pré-requisitos

- Node.js 18+ na máquina que rodará a API (pode ser a própria VM).
- SQL Server acessível pela rede (a versão administrada pelo SSMS 20 — 2019/2022 — atende). De preferência com o componente **Full-Text Search** instalado na instância; sem ele a API funciona normalmente, apenas sem a busca léxica (ela detecta e avisa no log).
- Chave de API da OpenAI.

Observação sobre vetores: o SQL Server 2019/2022 não tem índice vetorial nativo, então os embeddings ficam gravados em `VARBINARY` e a similaridade é calculada em memória pela API — até ~100 mil chamados isso responde em milissegundos. Se um dia o volume passar disso, os caminhos são migrar o índice para pgvector/Qdrant ou para o tipo `VECTOR` nativo do SQL Server 2025.

## 2. Banco de dados

No SSMS: crie um banco (ex.: `TicketInsight`), abra o `schema.sql` e execute. Ele cria `Chamados`, `Feedback`, `DocsKB` (já populada) e o índice Full-Text em português. Crie também um login dedicado para a aplicação (ex.: `ticketinsight_app`) com permissão `db_datareader` + `db_datawriter` nesse banco — não use `sa`.

## 3. Subir a API

```bash
npm install
copy .env.example .env   # e preencha credenciais do SQL e da OpenAI
npm start                # TicketInsight API em http://localhost:3001
npm run seed             # indexa os 8 chamados de exemplo (API precisa estar no ar)
```

Teste rápido:

```bash
curl http://localhost:3001/api/health
curl -X POST http://localhost:3001/api/suggest -H "Content-Type: application/json" -d "{\"texto\":\"erro -5002 ao adicionar nota fiscal de saida no SAP B1 10.0\"}"
```

## 4. Conectar o front (App.jsx)

Substitua a função `fetchSuggestions` do `App.jsx` por:

```js
const API = 'http://localhost:3001'; // em produção, URL da API

async function fetchSuggestions(ticketText, aoMudarEtapa) {
  aoMudarEtapa('Analisando o ticket…');
  const r = await fetch(`${API}/api/suggest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ texto: ticketText }),
  });
  if (!r.ok) throw new Error('Falha na análise do ticket.');
  return await r.json();
}
```

E dentro de `registrarFeedback`, envie o feedback real:

```js
fetch(`${API}/api/feedback`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ ticket: texto, sugestao: resultado, resultado: valor }),
}).catch(() => {});
```

As constantes `BASE_CONHECIMENTO`, `DOCS_RELACIONADOS`, `ETAPAS`, `tokenizar` e `pontuar` do front podem ser removidas depois disso — viram responsabilidade do backend.

## 5. Alimentando a base com chamados reais

Cada ticket fechado e bem documentado deve ser enviado a `POST /api/ingest`:

```json
{
  "id": "SUP-19001",
  "titulo": "…",
  "modulo": "Fiscal",
  "produto": "BR ONE 4.2",
  "causa": "…",
  "solucao": "…",
  "keywords": "termos e códigos relevantes",
  "resolvidoPor": "Analista",
  "data": "2026-06-10"
}
```

Comece com uma carga manual/script dos melhores históricos; depois automatize pelo webhook de fechamento do sistema de chamados. O endpoint faz upsert (MERGE), gera o embedding e recarrega o cache vetorial automaticamente.

## 6. Calibração dos limiares de confiança

Os limiares no `.env` (`CONF_ALTA`, `CONF_MEDIA`, `CONF_ABSTENCAO`) operam sobre a similaridade de cosseno do melhor candidato e **dependem do modelo de embedding e dos seus dados** — os valores padrão são apenas ponto de partida. Para calibrar: rode 30–50 tickets reais pela API, anote a similaridade do melhor candidato e se a sugestão era de fato correta, e ajuste os cortes para que "alta" signifique ~95% de acerto e a abstenção dispare antes de sugestões sem relação. Repita a calibração se trocar o `EMBEDDING_MODEL` (e nesse caso reindexe tudo, pois embeddings de modelos diferentes não são comparáveis).

## 7. Segurança

- A máscara de PII (CNPJ, CPF, e-mail, telefone) roda antes de qualquer envio à OpenAI e antes de gravar feedback. É baseada em regex — revise os padrões conforme os dados reais de vocês.
- Restrinja o CORS em produção (`cors({ origin: 'https://painel.suaempresa.com.br' })`).
- A API não tem autenticação neste estágio de POC; antes de expor fora da rede interna, adicione ao menos uma chave de API por header ou coloque atrás do SSO/proxy reverso de vocês.
- Verifique com o jurídico os termos de retenção de dados do provedor de LLM e considere o aviso aos clientes sobre o uso de IA no suporte (LGPD).
