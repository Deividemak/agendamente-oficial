import sqlite3 from 'sqlite3';
import { Pool } from 'pg';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const isPostgres = process.env.DB_TYPE === 'postgres';

let pgPool: Pool | null = null;
let sqliteDb: sqlite3.Database | null = null;

if (isPostgres) {
  pgPool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASS || 'postgres',
    database: process.env.DB_NAME || 'agendamento',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });
  
  pgPool.on('error', (err) => {
    console.error('Erro inesperado no Pool do PostgreSQL:', err);
  });
  console.log('Conexão: Inicializando pool de conexões PostgreSQL...');
} else {
  const dbPath = path.resolve(process.cwd(), process.env.DB_PATH || './database.sqlite');
  const dbDir = path.dirname(dbPath);

  // Modo demonstração: recria o banco a cada inicialização para a demo sempre começar limpa
  if (process.env.DEMO_MODE === 'true' && fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
    console.log('[DEMO] Banco de dados anterior removido. Iniciando demo limpa.');
  }

  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  sqliteDb = new sqlite3.Database(dbPath, (err) => {
    if (err) {
      console.error('Erro ao conectar no SQLite:', err.message);
    } else {
      console.log(`Banco de dados conectado com sucesso em: ${dbPath}`);
      // Ativa suporte a chaves estrangeiras no SQLite
      sqliteDb?.run('PRAGMA foreign_keys = ON;');
    }
  });
}

// Função para traduzir queries de dialeto SQLite para PostgreSQL
export function translateQuery(sql: string, forcePostgres = false): string {
  if (!isPostgres && !forcePostgres) return sql;

  // 1. Traduz placeholders ? para $1, $2, $3...
  let index = 1;
  let translated = sql.replace(/\?/g, () => `$${index++}`);

  // 2. Traduz funções de data do SQLite para PostgreSQL
  translated = translated.replace(/date\(\s*['"]now['"]\s*\)/gi, "TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD')");
  translated = translated.replace(/date\(\s*['"]now['"]\s*,\s*['"]-(\d+)\s+days['"]\s*\)/gi, "TO_CHAR(CURRENT_DATE - INTERVAL '$1 days', 'YYYY-MM-DD')");
  translated = translated.replace(/datetime\(\s*a\.criado_em\s*\)/gi, "a.criado_em");
  translated = translated.replace(/datetime\(\s*['"]now['"]\s*,\s*['"]-(\d+)\s+minutes['"]\s*\)/gi, "(NOW() - INTERVAL '$1 minutes')");

  // 3. Garante que se for um INSERT, retorne o id para emular lastID no run()
  if (translated.trim().toUpperCase().startsWith('INSERT ')) {
    if (!translated.toUpperCase().includes(' RETURNING ')) {
      // Remove ponto e vírgula se houver no final antes de concatenar
      translated = translated.trim();
      if (translated.endsWith(';')) {
        translated = translated.substring(0, translated.length - 1);
      }
      translated += ' RETURNING id';
    }
  }

  return translated;
}

// Função para traduzir o schema de SQLite para PostgreSQL
export function translateSchema(schema: string): string {
  return schema
    .replace(/INTEGER PRIMARY KEY AUTOINCREMENT/gi, 'SERIAL PRIMARY KEY')
    .replace(/DATETIME DEFAULT CURRENT_TIMESTAMP/gi, 'TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP');
}

// Helper genérico para rodar queries SQL usando promises
export const query = {
  async run(sql: string, params: any[] = []): Promise<{ lastID: number; changes: number }> {
    if (isPostgres) {
      const translatedSql = translateQuery(sql);
      const res = await pgPool!.query(translatedSql, params);
      const lastID = res.rows[0]?.id || 0;
      const changes = res.rowCount || 0;
      return { lastID, changes };
    } else {
      return new Promise((resolve, reject) => {
        sqliteDb!.run(sql, params, function (err) {
          if (err) return reject(err);
          resolve({ lastID: this.lastID, changes: this.changes });
        });
      });
    }
  },

  async get<T = any>(sql: string, params: any[] = []): Promise<T | undefined> {
    if (isPostgres) {
      const translatedSql = translateQuery(sql);
      const res = await pgPool!.query(translatedSql, params);
      return res.rows[0] as T;
    } else {
      return new Promise((resolve, reject) => {
        sqliteDb!.get(sql, params, (err, row) => {
          if (err) return reject(err);
          resolve(row as T);
        });
      });
    }
  },

  async all<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    if (isPostgres) {
      const translatedSql = translateQuery(sql);
      const res = await pgPool!.query(translatedSql, params);
      return res.rows as T[];
    } else {
      return new Promise((resolve, reject) => {
        sqliteDb!.all(sql, params, (err, rows) => {
          if (err) return reject(err);
          resolve(rows as T[]);
        });
      });
    }
  },

  async exec(sql: string): Promise<void> {
    if (isPostgres) {
      const translated = translateSchema(sql);
      await pgPool!.query(translated);
    } else {
      return new Promise((resolve, reject) => {
        sqliteDb!.exec(sql, (err) => {
          if (err) return reject(err);
          resolve();
        });
      });
    }
  }
};

// Função para inicializar as tabelas do banco de dados relacional
export async function initializeDatabase() {
  const schema = `
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      nome_estabelecimento TEXT,
      email TEXT NOT NULL UNIQUE,
      senha_hash TEXT NOT NULL,
      whatsapp TEXT NOT NULL,
      cpf TEXT UNIQUE,
      pix_chave TEXT NOT NULL,
      senha_reset_token TEXT,
      senha_reset_expira DATETIME,
      email_verificado INTEGER DEFAULT 0,
      verificacao_token TEXT,
      mensalidade_dia INTEGER DEFAULT 10,
      assinatura_status TEXT DEFAULT 'ativo',
      assinatura_valida_ate TEXT,
      ultimo_aviso_dias INTEGER DEFAULT 0,
      tipo_usuario TEXT DEFAULT 'profissional',
      config_modulos TEXT,
      nicho TEXT DEFAULT 'outros',
      mp_access_token TEXT,
      mp_refresh_token TEXT,
      mp_user_id TEXT,
      mp_status_conexao INTEGER DEFAULT 0,
      onboarding_concluido INTEGER DEFAULT 0,
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS servicos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL,
      nome TEXT NOT NULL,
      descricao TEXT,
      duracao_minutos INTEGER NOT NULL,
      preco DECIMAL(10, 2) NOT NULL,
      sinal_porcentagem INTEGER DEFAULT 0,
      cor TEXT,
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS disponibilidades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL,
      dia_semana INTEGER NOT NULL,
      hora_inicio TEXT NOT NULL,
      hora_fim TEXT NOT NULL,
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS agendamentos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      servico_id INTEGER NOT NULL,
      cliente_nome TEXT NOT NULL,
      cliente_whatsapp TEXT NOT NULL,
      data_agendamento TEXT NOT NULL,
      hora_inicio TEXT NOT NULL,
      hora_fim TEXT NOT NULL,
      status_pagamento TEXT NOT NULL DEFAULT 'pendente',
      checkout_id TEXT NOT NULL UNIQUE,
      metodo_pagamento TEXT NOT NULL DEFAULT 'pix',
      sinal_valor DECIMAL(10, 2) DEFAULT 0.00,
      restante_pago INTEGER DEFAULT 0,
      lembrete_1_dia_enviado INTEGER DEFAULT 0,
      lembrete_dia_enviado INTEGER DEFAULT 0,
      presenca_confirmada INTEGER DEFAULT 0,
      servico_ids TEXT,
      servico_nomes TEXT,
      preco_total DECIMAL(10, 2),
      duracao_total INTEGER,
      comissao_paga INTEGER DEFAULT 0,
      funcionario_escolhido INTEGER DEFAULT 0,
      pix_info TEXT,
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (servico_id) REFERENCES servicos(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS despesas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL,
      descricao TEXT NOT NULL,
      valor DECIMAL(10, 2) NOT NULL,
      data_despesa TEXT NOT NULL,
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS produtos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL,
      nome TEXT NOT NULL,
      preco DECIMAL(10, 2) NOT NULL,
      estoque INTEGER NOT NULL DEFAULT 0,
      preco_custo DECIMAL(10, 2) DEFAULT 0.00,
      imagem_url TEXT,
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS vendas_produtos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL,
      produto_id INTEGER NOT NULL,
      quantidade INTEGER NOT NULL,
      valor_total DECIMAL(10, 2) NOT NULL,
      data_venda TEXT NOT NULL,
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
      FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS funcionarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL,
      nome TEXT NOT NULL,
      whatsapp TEXT NOT NULL,
      ativo INTEGER DEFAULT 1,
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS funcionario_servicos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      funcionario_id INTEGER NOT NULL,
      servico_id INTEGER NOT NULL,
      comissao_percentual DECIMAL(5, 2) NOT NULL DEFAULT 0.00,
      FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id) ON DELETE CASCADE,
      FOREIGN KEY (servico_id) REFERENCES servicos(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS visitas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pagina TEXT NOT NULL,
      ip_hash TEXT,
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS clientes_isentos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL,
      cliente_whatsapp TEXT NOT NULL,
      isento_sinal INTEGER DEFAULT 1,
      UNIQUE(usuario_id, cliente_whatsapp),
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS comunicados (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      titulo TEXT NOT NULL,
      conteudo TEXT NOT NULL,
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS mensalidades_pagas_historico (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL,
      payment_id TEXT NOT NULL UNIQUE,
      valor DECIMAL(10, 2) NOT NULL,
      meses INTEGER NOT NULL,
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
    );

    CREATE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios(email);
    CREATE INDEX IF NOT EXISTS idx_servicos_usuario ON servicos(usuario_id);
    CREATE INDEX IF NOT EXISTS idx_disponibilidades_usuario_dia ON disponibilidades(usuario_id, dia_semana);
    CREATE INDEX IF NOT EXISTS idx_agendamentos_servico_data ON agendamentos(servico_id, data_agendamento);
    CREATE INDEX IF NOT EXISTS idx_agendamentos_checkout ON agendamentos(checkout_id);
    CREATE INDEX IF NOT EXISTS idx_despesas_usuario_data ON despesas(usuario_id, data_despesa);
    CREATE INDEX IF NOT EXISTS idx_produtos_usuario ON produtos(usuario_id);
    CREATE INDEX IF NOT EXISTS idx_vendas_usuario ON vendas_produtos(usuario_id);
    CREATE INDEX IF NOT EXISTS idx_funcionarios_usuario ON funcionarios(usuario_id);
    CREATE INDEX IF NOT EXISTS idx_func_serv_funcionario ON funcionario_servicos(funcionario_id);
    CREATE INDEX IF NOT EXISTS idx_func_serv_servico ON funcionario_servicos(servico_id);
    CREATE INDEX IF NOT EXISTS idx_visitas_criado_em ON visitas(criado_em);
    CREATE INDEX IF NOT EXISTS idx_clientes_isentos_usuario ON clientes_isentos(usuario_id);
    CREATE INDEX IF NOT EXISTS idx_clientes_isentos_whatsapp ON clientes_isentos(cliente_whatsapp);
  `;

  try {
    await query.exec(schema);
    console.log('Tabelas do banco de dados prontas.');
    
    // Migração incremental de visitas
    try {
      await query.exec(`
        CREATE TABLE IF NOT EXISTS visitas (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          pagina TEXT NOT NULL,
          ip_hash TEXT,
          criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await query.exec("CREATE INDEX IF NOT EXISTS idx_visitas_criado_em ON visitas(criado_em)");
      console.log('Migração: Tabela de visitas e índice criados com sucesso.');
    } catch (e) {
      // Ignora se a tabela já existir
    }

    // Migração incremental
    try {
      await query.exec("ALTER TABLE agendamentos ADD COLUMN metodo_pagamento TEXT NOT NULL DEFAULT 'pix'");
      console.log('Migração: Coluna metodo_pagamento adicionada com sucesso.');
    } catch (e) {
      // Ignora se a coluna já existe
    }

    try {
      await query.exec("ALTER TABLE usuarios ADD COLUMN senha_reset_token TEXT");
      console.log('Migração: Coluna senha_reset_token adicionada com sucesso.');
    } catch (e) {
      // Ignora se a coluna já existe
    }

    try {
      await query.exec("ALTER TABLE usuarios ADD COLUMN senha_reset_expira DATETIME");
      console.log('Migração: Coluna senha_reset_expira adicionada com sucesso.');
    } catch (e) {
      // Ignora se a coluna já existe
    }

    try {
      await query.exec("ALTER TABLE usuarios ADD COLUMN email_verificado INTEGER DEFAULT 0");
      console.log('Migração: Coluna email_verificado adicionada com sucesso.');
    } catch (e) {
      // Ignora se a coluna já existe
    }

    try {
      await query.exec("ALTER TABLE usuarios ADD COLUMN verificacao_token TEXT");
      console.log('Migração: Coluna verificacao_token adicionada com sucesso.');
    } catch (e) {
      // Ignora se a coluna já existe
    }

    // Ativa usuários legados que existiam antes desta migração (sem token de verificação)
    try {
      await query.run("UPDATE usuarios SET email_verificado = 1 WHERE email_verificado IS NULL OR (email_verificado = 0 AND verificacao_token IS NULL)");
      console.log('Migração: Usuários existentes marcados como verificados.');
    } catch (e) {
      // Ignora se falhar
    }

    try {
      await query.exec("ALTER TABLE usuarios ADD COLUMN mensalidade_dia INTEGER DEFAULT 10");
      console.log('Migração: Coluna mensalidade_dia adicionada com sucesso.');
    } catch (e) {
      // Ignora se a coluna já existe
    }

    try {
      await query.exec("ALTER TABLE usuarios ADD COLUMN assinatura_status TEXT DEFAULT 'ativo'");
      console.log('Migração: Coluna assinatura_status adicionada com sucesso.');
    } catch (e) {
      // Ignora se a coluna já existe
    }

    try {
      await query.exec("ALTER TABLE usuarios ADD COLUMN assinatura_valida_ate TEXT");
      console.log('Migração: Coluna assinatura_valida_ate adicionada com sucesso.');
    } catch (e) {
      // Ignora se a coluna já existe
    }

    try {
      await query.exec("ALTER TABLE usuarios ADD COLUMN ultimo_aviso_dias INTEGER DEFAULT 0");
      console.log('Migração: Coluna ultimo_aviso_dias adicionada com sucesso.');
    } catch (e) {
      // Ignora se a coluna já existe
    }

    // Inicializa valores da assinatura para usuários legados
    try {
      await query.run("UPDATE usuarios SET mensalidade_dia = 10 WHERE mensalidade_dia IS NULL");
      await query.run("UPDATE usuarios SET assinatura_status = 'ativo' WHERE assinatura_status IS NULL");
      // Define vencimento dos legados para 30 dias a partir de hoje
      const dataTrintaDias = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      await query.run("UPDATE usuarios SET assinatura_valida_ate = ? WHERE assinatura_valida_ate IS NULL", [dataTrintaDias]);
      await query.run("UPDATE usuarios SET ultimo_aviso_dias = 0 WHERE ultimo_aviso_dias IS NULL");
      console.log('Migração: Dados de assinatura dos usuários existentes atualizados.');
    } catch (e) {
      // Ignora se falhar
    }

    try {
      await query.exec("ALTER TABLE produtos ADD COLUMN preco_custo DECIMAL(10, 2) DEFAULT 0.00");
      console.log('Migração: Coluna preco_custo adicionada aos produtos com sucesso.');
    } catch (e) {
      // Ignora se a coluna já existe
    }

    try {
      await query.exec("ALTER TABLE produtos ADD COLUMN imagem_url TEXT");
      console.log('Migração: Coluna imagem_url adicionada aos produtos com sucesso.');
    } catch (e) {
      // Ignora se a coluna já existe
    }

    try {
      await query.exec("ALTER TABLE agendamentos ADD COLUMN funcionario_id INTEGER");
      console.log('Migração: Coluna funcionario_id adicionada aos agendamentos com sucesso.');
    } catch (e) {
      // Ignora se a coluna já existe
    }

    try {
      await query.exec("ALTER TABLE agendamentos ADD COLUMN comissao_valor DECIMAL(10, 2) DEFAULT 0.00");
      console.log('Migração: Coluna comissao_valor adicionada aos agendamentos com sucesso.');
    } catch (e) {
      // Ignora se a coluna já existe
    }

    try {
      await query.exec("ALTER TABLE usuarios ADD COLUMN cpf TEXT");
      console.log('Migração: Coluna cpf adicionada com sucesso.');
    } catch (e) {
      // Ignora se a coluna já existe
    }

    try {
      await query.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_cpf ON usuarios(cpf)");
      console.log('Migração: Índice único de cpf criado com sucesso.');
    } catch (e) {
      // Ignora se falhar
    }

    try {
      await query.exec("ALTER TABLE agendamentos ADD COLUMN lembrete_1_dia_enviado INTEGER DEFAULT 0");
      console.log('Migração: Coluna lembrete_1_dia_enviado adicionada com sucesso.');
    } catch (e) {
      // Ignora se a coluna já existe
    }

    try {
      await query.exec("ALTER TABLE agendamentos ADD COLUMN lembrete_dia_enviado INTEGER DEFAULT 0");
      console.log('Migração: Coluna lembrete_dia_enviado adicionada com sucesso.');
    } catch (e) {
      // Ignora se a coluna já existe
    }

    try {
      await query.exec("ALTER TABLE agendamentos ADD COLUMN presenca_confirmada INTEGER DEFAULT 0");
      console.log('Migração: Coluna presenca_confirmada adicionada com sucesso.');
    } catch (e) {
      // Ignora se a coluna já existe
    }

    try {
      await query.exec("ALTER TABLE usuarios ADD COLUMN tipo_usuario TEXT DEFAULT 'profissional'");
      console.log('Migração: Coluna tipo_usuario adicionada com sucesso.');
    } catch (e) {
      // Ignora se a coluna já existe
    }

    try {
      await query.exec("ALTER TABLE usuarios ADD COLUMN config_modulos TEXT");
      console.log('Migração: Coluna config_modulos adicionada com sucesso.');
    } catch (e) {
      // Ignora se a coluna já existe
    }

    try {
      await query.run("UPDATE usuarios SET config_modulos = '{\"funcionarios\":true,\"produtos\":true,\"despesas\":true}' WHERE config_modulos IS NULL");
      console.log('Migração: Valores padrão de módulos configurados para usuários legados.');
    } catch (e) {
      // Ignora se falhar
    }

    try {
      await query.exec("ALTER TABLE usuarios ADD COLUMN nome_estabelecimento TEXT");
      console.log('Migração: Coluna nome_estabelecimento adicionada com sucesso.');
    } catch (e) {
      // Ignora se a coluna já existe
    }

    try {
      await query.run("UPDATE usuarios SET nome_estabelecimento = nome WHERE nome_estabelecimento IS NULL");
      console.log('Migração: Dados legados de nome_estabelecimento preenchidos com o nome do usuário.');
    } catch (e) {
      // Ignora se falhar
    }

    try {
      await query.exec("ALTER TABLE usuarios ADD COLUMN nicho TEXT DEFAULT 'outros'");
      console.log('Migração: Coluna nicho adicionada com sucesso.');
    } catch (e) {
      // Ignora se a coluna já existe
    }

    try {
      // Para manter compatibilidade retroativa de usuários que já possuem serviços cadastrados do tipo Barbearia
      await query.run("UPDATE usuarios SET nicho = 'barbearia_salao' WHERE nicho IS NULL OR nicho = 'outros'");
      console.log('Migração: Nicho dos usuários existentes atualizado para barbearia_salao.');
    } catch (e) {
      // Ignora se falhar
    }

    // Migrações do Sistema de Sinal e Lista de Confiança
    try {
      await query.exec(`
        CREATE TABLE IF NOT EXISTS clientes_isentos (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          usuario_id INTEGER NOT NULL,
          cliente_whatsapp TEXT NOT NULL,
          isento_sinal INTEGER DEFAULT 1,
          UNIQUE(usuario_id, cliente_whatsapp),
          FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
        );
      `);
      await query.exec("CREATE INDEX IF NOT EXISTS idx_clientes_isentos_usuario ON clientes_isentos(usuario_id)");
      await query.exec("CREATE INDEX IF NOT EXISTS idx_clientes_isentos_whatsapp ON clientes_isentos(cliente_whatsapp)");
      console.log('Migração: Tabela clientes_isentos e índices criados com sucesso.');
    } catch (e) {
      // Ignora se falhar ou já existir
    }

    try {
      await query.exec("ALTER TABLE servicos ADD COLUMN sinal_porcentagem INTEGER DEFAULT 0");
      console.log('Migração: Coluna sinal_porcentagem adicionada aos servicos com sucesso.');
    } catch (e) {
      // Ignora se a coluna já existe
    }

    try {
      await query.exec("ALTER TABLE servicos ADD COLUMN cor TEXT");
      console.log('Migração: Coluna cor adicionada aos servicos com sucesso.');
    } catch (e) {
      // Ignora se a coluna já existe
    }

    try {
      await query.exec("ALTER TABLE agendamentos ADD COLUMN sinal_valor DECIMAL(10, 2) DEFAULT 0.00");
      console.log('Migração: Coluna sinal_valor adicionada aos agendamentos com sucesso.');
    } catch (e) {
      // Ignora se a coluna já existe
    }

    try {
      await query.exec("ALTER TABLE agendamentos ADD COLUMN restante_pago INTEGER DEFAULT 0");
      console.log('Migração: Coluna restante_pago adicionada aos agendamentos com sucesso.');
    } catch (e) {
      // Ignora se a coluna já existe
    }

    try {
      await query.exec("ALTER TABLE agendamentos ADD COLUMN servico_ids TEXT");
      console.log('Migração: Coluna servico_ids adicionada com sucesso.');
    } catch (e) {
      // Ignora
    }

    try {
      await query.exec("ALTER TABLE agendamentos ADD COLUMN servico_nomes TEXT");
      console.log('Migração: Coluna servico_nomes adicionada com sucesso.');
    } catch (e) {
      // Ignora
    }

    try {
      await query.exec("ALTER TABLE agendamentos ADD COLUMN preco_total DECIMAL(10, 2)");
      console.log('Migração: Coluna preco_total adicionada com sucesso.');
    } catch (e) {
      // Ignora
    }

    try {
      await query.exec("ALTER TABLE agendamentos ADD COLUMN duracao_total INTEGER");
      console.log('Migração: Coluna duracao_total adicionada com sucesso.');
    } catch (e) {
      // Ignora
    }

    try {
      await query.exec("ALTER TABLE agendamentos ADD COLUMN comissao_paga INTEGER DEFAULT 0");
      console.log('Migração: Coluna comissao_paga adicionada aos agendamentos com sucesso.');
    } catch (e) {
      // Ignora
    }

    try {
      await query.exec(`
        CREATE TABLE IF NOT EXISTS comunicados (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          titulo TEXT NOT NULL,
          conteudo TEXT NOT NULL,
          criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);
      console.log('Migração: Tabela comunicados criada com sucesso.');
    } catch (e) {
      // Ignora se falhar ou já existir
    }

    // Criação e seeding da tabela configuracoes
    try {
      await query.exec(`
        CREATE TABLE IF NOT EXISTS configuracoes (
          chave TEXT PRIMARY KEY,
          valor TEXT NOT NULL
        );
      `);
      
      const seedConfig = async (chave: string, valorPadrao: string) => {
        const exists = await query.get("SELECT valor FROM configuracoes WHERE chave = ?", [chave]);
        if (!exists) {
          await query.run("INSERT INTO configuracoes (chave, valor) VALUES (?, ?)", [chave, valorPadrao]);
          console.log(`Seeding: Configuração '${chave}' definida como '${valorPadrao}'.`);
        }
      };

      await seedConfig('preco_mensalidade', '19.90');
      await seedConfig('preco_primeiro_mes', '14.90');
      await seedConfig('dias_gratis_teste', '7');
      await seedConfig('saas_mp_access_token', '');
      await seedConfig('saas_mp_public_key', '');
      await seedConfig('evolution_api_url', '');
      await seedConfig('evolution_api_key', '');
      await seedConfig('sistema_nome', 'Agendamente');
      await seedConfig('suporte_email', 'suporte@agendamente.com.br');
      await seedConfig('suporte_whatsapp', '11999999999');
      await seedConfig('novos_cadastros_habilitados', '1');
      await seedConfig('modo_manutencao_habilitado', '0');
      await seedConfig('seo_titulo', 'Agendamente - Agendamentos Online e Gestão ERP');
      await seedConfig('seo_descricao', 'Plataforma para gestão de agendamentos, clientes e equipe para salões de beleza, barbearias e clínicas.');
      await seedConfig('wpp_template_boas_vindas', 'Olá {nome}, bem-vindo ao {sistema_nome}! Sua conta foi criada com sucesso e seu teste de {dias} dias está ativo.');
      await seedConfig('wpp_template_vencimento', 'Olá {nome}, lembramos que sua licença do {sistema_nome} vence em {dias} dia(s) ({data}). Evite bloqueios realizando o Pix no painel.');
      await seedConfig('wpp_template_suspensao', 'Olá {nome}, sua conta no {sistema_nome} foi suspensa devido ao vencimento da sua assinatura. Efetue o pagamento no painel para reativar seu acesso.');

    } catch (e) {
      console.error("Erro ao inicializar configuracoes:", e);
    }

    // Migração: Adiciona coluna mensalidades_pagas à tabela usuarios se não existir
    try {
      await query.exec("ALTER TABLE usuarios ADD COLUMN mensalidades_pagas INTEGER DEFAULT 0");
      console.log("Migração: Coluna mensalidades_pagas adicionada com sucesso.");
    } catch (e) {
      // Ignora se a coluna já existe
    }

    // Migração: Adiciona colunas para conexão WhatsApp (Evolution API)
    try {
      await query.exec("ALTER TABLE usuarios ADD COLUMN whatsapp_instancia_nome TEXT");
      console.log("Migração: Coluna whatsapp_instancia_nome adicionada com sucesso.");
    } catch (e) {
      // Ignora se a coluna já existe
    }

    try {
      await query.exec("ALTER TABLE usuarios ADD COLUMN whatsapp_instancia_status TEXT DEFAULT 'desconectado'");
      console.log("Migração: Coluna whatsapp_instancia_status adicionada com sucesso.");
    } catch (e) {
      // Ignora se a coluna já existe
    }

    try {
      await query.exec("ALTER TABLE agendamentos ADD COLUMN funcionario_escolhido INTEGER DEFAULT 0");
      console.log("Migração: Coluna funcionario_escolhido adicionada com sucesso.");
    } catch (e) {
      // Ignora se a coluna já existe
    }

    try {
      await query.exec("ALTER TABLE agendamentos ADD COLUMN pix_info TEXT");
      console.log("Migração: Coluna pix_info adicionada a agendamentos com sucesso.");
    } catch (e) {
      // Ignora se a coluna já existe
    }

    try {
      await query.exec(`
        CREATE TABLE IF NOT EXISTS mensalidades_pagas_historico (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          usuario_id INTEGER NOT NULL,
          payment_id TEXT NOT NULL UNIQUE,
          valor DECIMAL(10, 2) NOT NULL,
          meses INTEGER NOT NULL,
          criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
        );
      `);
      console.log("Migração: Tabela mensalidades_pagas_historico criada com sucesso.");
    } catch (e) {
      // Ignora se a tabela já existe
    }

    // Migrações Mercado Pago OAuth
    try {
      await query.exec("ALTER TABLE usuarios ADD COLUMN mp_access_token TEXT");
      console.log("Migração: Coluna mp_access_token adicionada com sucesso.");
    } catch (e) {}

    try {
      await query.exec("ALTER TABLE usuarios ADD COLUMN mp_refresh_token TEXT");
      console.log("Migração: Coluna mp_refresh_token adicionada com sucesso.");
    } catch (e) {}

    try {
      await query.exec("ALTER TABLE usuarios ADD COLUMN mp_user_id TEXT");
      console.log("Migração: Coluna mp_user_id adicionada com sucesso.");
    } catch (e) {}

    try {
      await query.exec("ALTER TABLE usuarios ADD COLUMN mp_status_conexao INTEGER DEFAULT 0");
      console.log("Migração: Coluna mp_status_conexao adicionada com sucesso.");
    } catch (e) {}

    try {
      await query.exec("ALTER TABLE usuarios ADD COLUMN onboarding_concluido INTEGER DEFAULT 0");
      console.log("Migração: Coluna onboarding_concluido adicionada com sucesso.");
      // Atualiza usuários legados para evitar exibir onboarding para quem já usa
      await query.run("UPDATE usuarios SET onboarding_concluido = 1 WHERE onboarding_concluido IS NULL");
    } catch (e) {}

    try {
      await query.exec("ALTER TABLE usuarios ADD COLUMN endereco TEXT");
      console.log("Migração: Coluna endereco adicionada com sucesso.");
    } catch (e) {}

    try {
      await query.exec("ALTER TABLE usuarios ADD COLUMN endereco_link TEXT");
      console.log("Migração: Coluna endereco_link adicionada com sucesso.");
    } catch (e) {}

    // Seeding: Garante que exista pelo menos um usuário dono
    try {
      const owner = await query.get("SELECT id FROM usuarios WHERE tipo_usuario = 'dono'");
      // No modo demo o Super Admin é criado pelo seed de demonstração
      if (!owner && process.env.DEMO_MODE !== 'true') {
        const bcrypt = require('bcryptjs');
        const crypto = require('crypto');
        // Senha definida via variável de ambiente; se ausente, gera uma senha aleatória e exibe uma única vez no log
        const ownerPassword = process.env.SUPER_ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
        const salt = await bcrypt.genSalt(10);
        const hash = await bcrypt.hash(ownerPassword, salt);
        
        await query.run(
          "INSERT INTO usuarios (nome, email, senha_hash, whatsapp, cpf, pix_chave, email_verificado, mensalidade_dia, assinatura_status, assinatura_valida_ate, tipo_usuario) VALUES (?, ?, ?, ?, ?, ?, 1, 10, 'ativo', '2099-12-31', 'dono')",
          ['Dono Agendamente', 'dono@agendamente.com', hash, '11999999999', '00000000000', 'dono@agendamente.com']
        );
        console.log(`Seeding: Usuário Dono padrão criado (dono@agendamente.com). Senha: ${process.env.SUPER_ADMIN_PASSWORD ? '(definida em SUPER_ADMIN_PASSWORD)' : ownerPassword}`);
      }
    } catch (e) {
      console.error('Seeding: Falha ao garantir usuário Dono:', e);
    }
  } catch (err) {
    console.error('Erro ao inicializar o banco de dados:', err);
    throw err;
  }
}

const db = isPostgres ? pgPool : sqliteDb;
export default db;
