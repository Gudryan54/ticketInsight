# TicketInsight

Busca inteligente em chamados anteriores para o suporte de **SAP Business One** e **BR ONE**.

Quando um chamado novo chega, o sistema busca no histórico os casos mais parecidos que já foram resolvidos e apresenta ao analista as soluções aplicadas antes, um procedimento sugerido e o nível de confiança da recomendação — reduzindo retrabalho e padronizando o atendimento.

O analista permanece sempre no controle: a ferramenta apoia a decisão, não a substitui.

## Como funciona

1. O analista descreve o chamado.
2. O sistema interpreta o texto e faz uma busca híbrida na base (similaridade semântica + termos exatos, com reforço para códigos de erro).
3. Retorna os chamados semelhantes, a solução de cada um, um procedimento recomendado e a documentação relacionada.
4. Cada chamado resolvido realimenta a base, melhorando as buscas seguintes.

Quando não há caso suficientemente parecido, o sistema se abstém em vez de sugerir algo duvidoso.

## Arquitetura

- **Frontend:** React + Vite
- **Backend:** Node.js + Express
- **Banco:** SQL Server
- **Embeddings:** locais, via Transformers.js (modelo multilingual-e5-small) — sem custo de API e sem dados saindo da empresa
- **Busca:** híbrida (vetorial em memória + Full-Text Search do SQL Server) com fusão por Reciprocal Rank Fusion
- **Integração:** webhook do Movidesk para ingestão automática de chamados resolvidos

## Estrutura

```
ticketinsight/
├── backend/     API Node.js, busca e ingestão
└── frontend/    Painel do analista (React)
```

## Como rodar

Cada pasta tem seu próprio `package.json`. Consulte o `README` do `backend/` para o passo a passo completo (banco, variáveis de ambiente, seed).

Resumo:

```bash
# backend
cd backend
npm install
# copie .env.example para .env e preencha
npm start        # sobe a API em http://localhost:3001
npm run seed     # popula a base com chamados de exemplo

# frontend (em outro terminal)
cd frontend
npm install
npm run dev      # abre em http://localhost:5173
```

## Privacidade

O processamento é 100% local: os embeddings rodam na própria infraestrutura e nenhum dado de chamado é enviado a serviços externos. Há mascaramento de PII (CNPJ, CPF, e-mail, telefone) antes de indexar e de registrar feedback.

## Status

Prova de conceito (POC).
