-- =============================================================================
-- SCRIPT DE BANCO DE DADOS - MVP MICRO-SAAS DE AGENDAMENTO INTELIGENTE
-- Versões compatíveis: PostgreSQL e MySQL/MariaDB
-- =============================================================================

-- =============================================================================
-- DIALETO: POSTGRESQL
-- =============================================================================

/*
-- Descomente as linhas abaixo para recriar as tabelas se necessário:
DROP TABLE IF EXISTS agendamentos;
DROP TABLE IF EXISTS disponibilidades;
DROP TABLE IF EXISTS servicos;
DROP TABLE IF EXISTS usuarios;
*/

CREATE TABLE usuarios (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(100) NOT NULL,
    email VARCHAR(150) NOT NULL UNIQUE,
    senha_hash VARCHAR(255) NOT NULL,
    whatsapp VARCHAR(20) NOT NULL,
    pix_chave VARCHAR(100) NOT NULL,
    senha_reset_token VARCHAR(100),
    senha_reset_expira TIMESTAMP WITH TIME ZONE,
    email_verificado INT DEFAULT 0,
    verificacao_token VARCHAR(100),
    mensalidade_dia INT DEFAULT 10,
    assinatura_status VARCHAR(20) DEFAULT 'ativo',
    assinatura_valida_ate VARCHAR(20),
    ultimo_aviso_dias INT DEFAULT 0,
    mensalidades_pagas INT DEFAULT 0,
    criado_em TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_usuarios_email ON usuarios(email);

CREATE TABLE servicos (
    id SERIAL PRIMARY KEY,
    usuario_id INT NOT NULL,
    nome VARCHAR(100) NOT NULL,
    descricao TEXT,
    duracao_minutos INT NOT NULL CHECK (duracao_minutos > 0),
    preco DECIMAL(10, 2) NOT NULL CHECK (preco >= 0),
    criado_em TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_servicos_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
);

CREATE INDEX idx_servicos_usuario ON servicos(usuario_id);

CREATE TABLE disponibilidades (
    id SERIAL PRIMARY KEY,
    usuario_id INT NOT NULL,
    dia_semana INT NOT NULL CHECK (dia_semana BETWEEN 0 AND 6), -- 0 = Domingo, 1 = Segunda, ..., 6 = Sábado
    hora_inicio TIME NOT NULL,
    hora_fim TIME NOT NULL,
    CONSTRAINT fk_disponibilidades_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
    CONSTRAINT chk_horas CHECK (hora_inicio < hora_fim)
);

CREATE INDEX idx_disponibilidades_usuario_dia ON disponibilidades(usuario_id, dia_semana);

CREATE TABLE agendamentos (
    id SERIAL PRIMARY KEY,
    servico_id INT NOT NULL,
    cliente_nome VARCHAR(100) NOT NULL,
    cliente_whatsapp VARCHAR(20) NOT NULL,
    data_agendamento DATE NOT NULL,
    hora_inicio TIME NOT NULL,
    hora_fim TIME NOT NULL,
    status_pagamento VARCHAR(20) NOT NULL DEFAULT 'pendente' CHECK (status_pagamento IN ('pendente', 'pago', 'expirado')),
    checkout_id VARCHAR(100) NOT NULL UNIQUE,
    metodo_pagamento VARCHAR(20) NOT NULL DEFAULT 'pix',
    funcionario_id INT,
    comissao_valor DECIMAL(10, 2) DEFAULT 0.00,
    sinal_valor DECIMAL(10, 2) DEFAULT 0.00,
    restante_pago INT DEFAULT 0,
    lembrete_1_dia_enviado INT DEFAULT 0,
    lembrete_dia_enviado INT DEFAULT 0,
    servico_ids TEXT,
    servico_nomes TEXT,
    preco_total DECIMAL(10, 2),
    duracao_total INT,
    comissao_paga INT DEFAULT 0,
    criado_em TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_agendamentos_servico FOREIGN KEY (servico_id) REFERENCES servicos(id) ON DELETE CASCADE,
    CONSTRAINT fk_agendamentos_funcionario FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id) ON DELETE SET NULL,
    CONSTRAINT chk_agendamento_horas CHECK (hora_inicio < hora_fim)
);

CREATE INDEX idx_agendamentos_servico_data ON agendamentos(servico_id, data_agendamento);
CREATE INDEX idx_agendamentos_checkout ON agendamentos(checkout_id);

CREATE TABLE despesas (
    id SERIAL PRIMARY KEY,
    usuario_id INT NOT NULL,
    descricao VARCHAR(255) NOT NULL,
    valor DECIMAL(10, 2) NOT NULL CHECK (valor >= 0),
    data_despesa DATE NOT NULL,
    criado_em TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_despesas_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
);

CREATE INDEX idx_despesas_usuario_data ON despesas(usuario_id, data_despesa);

CREATE TABLE produtos (
    id SERIAL PRIMARY KEY,
    usuario_id INT NOT NULL,
    nome VARCHAR(150) NOT NULL,
    preco DECIMAL(10, 2) NOT NULL CHECK (preco >= 0),
    estoque INT NOT NULL DEFAULT 0 CHECK (estoque >= 0),
    preco_custo DECIMAL(10, 2) DEFAULT 0.00 CHECK (preco_custo >= 0),
    criado_em TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_produtos_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
);

CREATE INDEX idx_produtos_usuario ON produtos(usuario_id);

CREATE TABLE vendas_produtos (
    id SERIAL PRIMARY KEY,
    usuario_id INT NOT NULL,
    produto_id INT NOT NULL,
    quantidade INT NOT NULL CHECK (quantidade > 0),
    valor_total DECIMAL(10, 2) NOT NULL CHECK (valor_total >= 0),
    data_venda DATE NOT NULL,
    criado_em TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_vendas_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
    CONSTRAINT fk_vendas_produto FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE CASCADE
);

CREATE INDEX idx_vendas_usuario ON vendas_produtos(usuario_id);

CREATE TABLE funcionarios (
    id SERIAL PRIMARY KEY,
    usuario_id INT NOT NULL,
    nome VARCHAR(100) NOT NULL,
    whatsapp VARCHAR(20) NOT NULL,
    ativo INT DEFAULT 1 CHECK (ativo IN (0, 1)),
    criado_em TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_funcionarios_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
);

CREATE INDEX idx_funcionarios_usuario ON funcionarios(usuario_id);

CREATE TABLE funcionario_servicos (
    id SERIAL PRIMARY KEY,
    funcionario_id INT NOT NULL,
    servico_id INT NOT NULL,
    comissao_percentual DECIMAL(5, 2) NOT NULL DEFAULT 0.00 CHECK (comissao_percentual BETWEEN 0 AND 100),
    CONSTRAINT fk_func_serv_funcionario FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id) ON DELETE CASCADE,
    CONSTRAINT fk_func_serv_servico FOREIGN KEY (servico_id) REFERENCES servicos(id) ON DELETE CASCADE
);

CREATE INDEX idx_func_serv_funcionario ON funcionario_servicos(funcionario_id);
CREATE INDEX idx_func_serv_servico ON funcionario_servicos(servico_id);

CREATE TABLE comunicados (
    id SERIAL PRIMARY KEY,
    titulo VARCHAR(255) NOT NULL,
    conteudo TEXT NOT NULL,
    criado_em TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE configuracoes (
    chave VARCHAR(100) PRIMARY KEY,
    valor TEXT NOT NULL
);


-- =============================================================================
-- DIALETO: MYSQL / MARIADB (Caso utilize MySQL, descomente e execute este bloco)
-- =============================================================================

/*
CREATE TABLE usuarios (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(100) NOT NULL,
    email VARCHAR(150) NOT NULL UNIQUE,
    senha_hash VARCHAR(255) NOT NULL,
    whatsapp VARCHAR(20) NOT NULL,
    pix_chave VARCHAR(100) NOT NULL,
    senha_reset_token VARCHAR(100),
    senha_reset_expira TIMESTAMP NULL,
    email_verificado INT DEFAULT 0,
    verificacao_token VARCHAR(100),
    mensalidade_dia INT DEFAULT 10,
    assinatura_status VARCHAR(20) DEFAULT 'ativo',
    assinatura_valida_ate VARCHAR(20),
    ultimo_aviso_dias INT DEFAULT 0,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_usuarios_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE servicos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    usuario_id INT NOT NULL,
    nome VARCHAR(100) NOT NULL,
    descricao TEXT,
    duracao_minutos INT NOT NULL,
    preco DECIMAL(10, 2) NOT NULL,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_servicos_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
    INDEX idx_servicos_usuario (usuario_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE disponibilidades (
    id INT AUTO_INCREMENT PRIMARY KEY,
    usuario_id INT NOT NULL,
    dia_semana INT NOT NULL CHECK (dia_semana BETWEEN 0 AND 6),
    hora_inicio TIME NOT NULL,
    hora_fim TIME NOT NULL,
    CONSTRAINT fk_disponibilidades_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
    INDEX idx_disponibilidades_usuario_dia (usuario_id, dia_semana)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE funcionarios (
    id INT AUTO_INCREMENT PRIMARY KEY,
    usuario_id INT NOT NULL,
    nome VARCHAR(100) NOT NULL,
    whatsapp VARCHAR(20) NOT NULL,
    ativo INT DEFAULT 1,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_funcs_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
    INDEX idx_funcs_usuario (usuario_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE funcionario_servicos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    funcionario_id INT NOT NULL,
    servico_id INT NOT NULL,
    comissao_percentual DECIMAL(5, 2) NOT NULL DEFAULT 0.00,
    CONSTRAINT fk_fs_funcionario FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id) ON DELETE CASCADE,
    CONSTRAINT fk_fs_servico FOREIGN KEY (servico_id) REFERENCES servicos(id) ON DELETE CASCADE,
    INDEX idx_fs_funcionario (funcionario_id),
    INDEX idx_fs_servico (servico_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE agendamentos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    servico_id INT NOT NULL,
    cliente_nome VARCHAR(100) NOT NULL,
    cliente_whatsapp VARCHAR(20) NOT NULL,
    data_agendamento DATE NOT NULL,
    hora_inicio TIME NOT NULL,
    hora_fim TIME NOT NULL,
    status_pagamento VARCHAR(20) NOT NULL DEFAULT 'pendente',
    checkout_id VARCHAR(100) NOT NULL UNIQUE,
    metodo_pagamento VARCHAR(20) NOT NULL DEFAULT 'pix',
    funcionario_id INT NULL,
    comissao_valor DECIMAL(10, 2) DEFAULT 0.00,
    sinal_valor DECIMAL(10, 2) DEFAULT 0.00,
    restante_pago INT DEFAULT 0,
    lembrete_1_dia_enviado INT DEFAULT 0,
    lembrete_dia_enviado INT DEFAULT 0,
    servico_ids TEXT,
    servico_nomes TEXT,
    preco_total DECIMAL(10, 2),
    duracao_total INT,
    comissao_paga INT DEFAULT 0,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_agendamentos_servico FOREIGN KEY (servico_id) REFERENCES servicos(id) ON DELETE CASCADE,
    CONSTRAINT fk_agendamentos_funcionario FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id) ON DELETE SET NULL,
    INDEX idx_agendamentos_servico_data (servico_id, data_agendamento),
    INDEX idx_agendamentos_checkout (checkout_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE despesas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    usuario_id INT NOT NULL,
    descricao VARCHAR(255) NOT NULL,
    valor DECIMAL(10, 2) NOT NULL,
    data_despesa DATE NOT NULL,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_despesas_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
    INDEX idx_despesas_usuario_data (usuario_id, data_despesa)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE produtos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    usuario_id INT NOT NULL,
    nome VARCHAR(150) NOT NULL,
    preco DECIMAL(10, 2) NOT NULL,
    estoque INT NOT NULL DEFAULT 0,
    preco_custo DECIMAL(10, 2) DEFAULT 0.00,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_produtos_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
    INDEX idx_produtos_usuario (usuario_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE vendas_produtos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    usuario_id INT NOT NULL,
    produto_id INT NOT NULL,
    quantidade INT NOT NULL,
    valor_total DECIMAL(10, 2) NOT NULL,
    data_venda DATE NOT NULL,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_vendas_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
    CONSTRAINT fk_vendas_produto FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE CASCADE,
    INDEX idx_vendas_usuario (usuario_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
*/
