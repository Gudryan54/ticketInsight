/* ============================================================
   TicketInsight — Seed da base de conhecimento
   Indexa os 8 chamados de exemplo (os mesmos do POC do front)
   chamando POST /api/ingest, que gera o embedding e grava no
   SQL Server. A API precisa estar rodando: node server.js
   Uso: node seed.js
   ============================================================ */

import 'dotenv/config';

const API = process.env.API_URL || 'http://localhost:3001';
const SECRET = process.env.WEBHOOK_SECRET || '';

const CHAMADOS = [
  {
    id: 'SUP-18234',
    titulo: 'Erro -5002 ao adicionar nota fiscal de saída',
    modulo: 'Vendas',
    produto: 'SAP B1 10.0',
    keywords:
      'erro -5002 nota fiscal saída adicionar odln depósito quantidade estoque insuficiente item bloqueado',
    causa: 'Quantidade insuficiente no depósito selecionado para um dos itens.',
    solucao:
      'Verificar em Estoque > Relatórios > Situação do estoque a disponibilidade do item no depósito da linha. Ajustar o depósito na linha do documento ou liberar a configuração "Bloquear estoque negativo" apenas se a política da empresa permitir.',
    resolvidoPor: 'C. Almeida',
    data: '2026-03-12',
  },
  {
    id: 'SUP-17911',
    titulo: 'NF-e rejeitada: 539 — duplicidade de NF-e com diferença na chave',
    modulo: 'Fiscal',
    produto: 'BR ONE 4.2',
    keywords:
      'nfe rejeição 539 duplicidade chave acesso sefaz numeração nota fiscal eletrônica reenvio',
    causa:
      'Nota com a mesma numeração já autorizada na SEFAZ com chave diferente, geralmente após falha de comunicação no primeiro envio.',
    solucao:
      'No monitor de NF-e do BR ONE, consultar a situação da nota na SEFAZ (consulta por chave). Importar a autorização existente via "Sincronizar status" e, se necessário, inutilizar a numeração divergente antes de reemitir.',
    resolvidoPor: 'M. Tanaka',
    data: '2026-04-02',
  },
  {
    id: 'SUP-17655',
    titulo: 'Erro ODBC -1029 ao conectar add-on após atualização do SQL Server',
    modulo: 'Infraestrutura',
    produto: 'SAP B1 9.3',
    keywords:
      'odbc -1029 conexão sql server add-on driver native client erro conectar banco dados di api',
    causa: 'Driver SQL Native Client ausente ou incompatível após atualização do servidor.',
    solucao:
      'Reinstalar o SQL Server Native Client compatível com a versão do B1, recriar o DSN de sistema (64 bits) e reiniciar o serviço SBO DI Server. Validar a conexão com o B1 Diagnostic Tool.',
    resolvidoPor: 'R. Souza',
    data: '2026-01-28',
  },
  {
    id: 'SUP-18102',
    titulo: 'Remessa CNAB 240 rejeitada pelo banco — segmento P inválido',
    modulo: 'Financeiro',
    produto: 'BR ONE 4.2',
    keywords:
      'cnab 240 remessa boleto banco rejeitada segmento p carteira nosso número convênio cobrança',
    causa: 'Código de carteira/convênio desatualizado no cadastro de configurações bancárias.',
    solucao:
      'Em BR ONE > Financeiro > Configurações bancárias, conferir carteira, convênio e faixa de nosso número com o gerente da conta. Regerar a remessa após o ajuste; títulos já enviados devem ser reapresentados.',
    resolvidoPor: 'C. Almeida',
    data: '2026-02-19',
  },
  {
    id: 'SUP-16980',
    titulo: 'Timeout na autorização da SEFAZ em horários de pico',
    modulo: 'Fiscal',
    produto: 'BR ONE 4.1',
    keywords:
      'sefaz timeout autorização lenta nfe demora emissão contingência svc pico horário',
    causa: 'Instabilidade no webservice estadual; tempo limite padrão do BR ONE muito baixo.',
    solucao:
      'Aumentar o timeout de autorização para 60 s nas configurações do BR ONE e habilitar o acionamento automático de contingência SVC-AN após 2 tentativas. Orientar o cliente a acompanhar o status pelo monitor.',
    resolvidoPor: 'M. Tanaka',
    data: '2025-11-07',
  },
  {
    id: 'SUP-18301',
    titulo: 'Depreciação de ativo fixo não executa para o período corrente',
    modulo: 'Contabilidade',
    produto: 'SAP B1 10.0',
    keywords:
      'depreciação ativo fixo execução período corrente fechamento área avaliação imobilizado erro',
    causa: 'Período contábil do mês corrente ainda com status "Fechado" após virada de exercício.',
    solucao:
      'Em Administração > Inicialização do sistema > Períodos contábeis, reabrir o período corrente. Executar a depreciação em Ativo fixo > Execução de depreciação e conferir o log de simulação antes de contabilizar.',
    resolvidoPor: 'P. Ferreira',
    data: '2026-05-21',
  },
  {
    id: 'SUP-17542',
    titulo: 'Pedido de venda não permite copiar para nota fiscal — cliente bloqueado',
    modulo: 'Vendas',
    produto: 'SAP B1 10.0',
    keywords:
      'pedido venda copiar para nota fiscal cliente bloqueado limite crédito congelado parceiro negócio',
    causa: 'Parceiro de negócio com status "Congelado" ou limite de crédito excedido.',
    solucao:
      'Verificar o cadastro do PN (aba Geral: campo Congelado; aba Pagamento: limite de crédito). Com aprovação do financeiro, ajustar o limite ou usar o procedimento de autorização configurado para liberar o documento.',
    resolvidoPor: 'R. Souza',
    data: '2026-04-30',
  },
  {
    id: 'SUP-18077',
    titulo: 'Apuração de ICMS-ST divergente no BR ONE após mudança de NCM',
    modulo: 'Fiscal',
    produto: 'BR ONE 4.2',
    keywords:
      'icms st substituição tributária apuração divergente ncm mva alíquota cest imposto cálculo',
    causa: 'Regra fiscal antiga ainda vigente para o NCM alterado, com MVA desatualizado.',
    solucao:
      'Em BR ONE > Fiscal > Regras de tributação, encerrar a vigência da regra anterior e cadastrar nova regra com MVA/CEST atualizados a partir da data da mudança. Reprocessar os documentos do período pelo recálculo fiscal.',
    resolvidoPor: 'P. Ferreira',
    data: '2026-03-29',
  },
];

for (const chamado of CHAMADOS) {
  const r = await fetch(`${API}/api/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-webhook-secret': SECRET },
    body: JSON.stringify(chamado),
  });
  const corpo = await r.json();
  console.log(r.ok ? `ok  ${chamado.id}` : `ERRO ${chamado.id}:`, r.ok ? '' : corpo);
}

console.log('Seed concluído.');