/* ============================================================
   TicketInsight — Schema SQL Server
   Executar no SSMS conectado ao banco desejado (ex.: TicketInsight).
   Requisito: componente Full-Text Search instalado na instância
   (se não estiver, o backend continua funcionando só com busca
   vetorial — ver README).
   ============================================================ */

-- 1. Chamados resolvidos (base de conhecimento)
IF OBJECT_ID('dbo.Chamados') IS NULL
CREATE TABLE dbo.Chamados (
    Id              NVARCHAR(20)  NOT NULL CONSTRAINT PK_Chamados PRIMARY KEY,
    Titulo          NVARCHAR(300) NOT NULL,
    Modulo          NVARCHAR(60)  NULL,
    Produto         NVARCHAR(60)  NULL,
    Causa           NVARCHAR(MAX) NULL,
    Solucao         NVARCHAR(MAX) NULL,
    TextoBusca      NVARCHAR(MAX) NULL,  -- sintoma + causa + solucao concatenados (alvo do full-text)
    ResolvidoPor    NVARCHAR(100) NULL,
    DataResolucao   DATE          NULL,
    Embedding       VARBINARY(MAX) NULL, -- vetor float32 serializado pelo backend
    EmbeddingModelo NVARCHAR(60)  NULL,
    AtualizadoEm    DATETIME2     NOT NULL CONSTRAINT DF_Chamados_Atu DEFAULT SYSUTCDATETIME()
);
GO

-- 2. Feedback dos analistas (alimenta o aprendizado contínuo)
IF OBJECT_ID('dbo.Feedback') IS NULL
CREATE TABLE dbo.Feedback (
    Id           INT IDENTITY CONSTRAINT PK_Feedback PRIMARY KEY,
    TicketTexto  NVARCHAR(MAX) NOT NULL,
    SugestaoJson NVARCHAR(MAX) NULL,   -- resposta exibida ao analista, para auditoria
    Resultado    NVARCHAR(20)  NOT NULL, -- 'resolveu' | 'parcial' | 'nao'
    CriadoEm     DATETIME2     NOT NULL CONSTRAINT DF_Feedback_Cri DEFAULT SYSUTCDATETIME()
);
GO

-- 3. Documentação relacionada por módulo
IF OBJECT_ID('dbo.DocsKB') IS NULL
CREATE TABLE dbo.DocsKB (
    Ref    NVARCHAR(20)  NOT NULL CONSTRAINT PK_DocsKB PRIMARY KEY,
    Modulo NVARCHAR(60)  NOT NULL,
    Titulo NVARCHAR(300) NOT NULL
);
GO

MERGE dbo.DocsKB AS alvo
USING (VALUES
    ('KB-BR1-014','Fiscal','BR ONE — Guia do monitor de NF-e'),
    ('KB-BR1-022','Fiscal','Manual de contingência SEFAZ (SVC-AN/SVC-RS)'),
    ('KB-B1-031','Vendas','SAP B1 — Documentos de marketing: cópia e estornos'),
    ('KB-B1-008','Vendas','Política de bloqueio de estoque negativo'),
    ('KB-BR1-019','Financeiro','BR ONE — Configuração de cobrança CNAB 240'),
    ('KB-B1-002','Infraestrutura','Matriz de compatibilidade SQL Server × SAP B1'),
    ('KB-B1-027','Contabilidade','SAP B1 — Períodos contábeis e virada de exercício')
) AS origem (Ref, Modulo, Titulo)
ON alvo.Ref = origem.Ref
WHEN NOT MATCHED THEN INSERT (Ref, Modulo, Titulo) VALUES (origem.Ref, origem.Modulo, origem.Titulo);
GO

-- 4. Full-Text Search (busca léxica — códigos de erro, nomes de tabela etc.)
--    Se a instância não tiver o componente Full-Text, comente este bloco.
IF NOT EXISTS (SELECT 1 FROM sys.fulltext_catalogs WHERE name = 'ftTicketInsight')
    CREATE FULLTEXT CATALOG ftTicketInsight AS DEFAULT;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.fulltext_indexes
    WHERE object_id = OBJECT_ID('dbo.Chamados')
)
CREATE FULLTEXT INDEX ON dbo.Chamados
    (Titulo LANGUAGE 1046, TextoBusca LANGUAGE 1046)  -- 1046 = português (Brasil)
    KEY INDEX PK_Chamados
    ON ftTicketInsight
    WITH CHANGE_TRACKING AUTO;
GO
