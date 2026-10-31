export interface Usuario {
  id?: number;
  nome: string;
  nome_estabelecimento?: string;
  nicho?: string;
  email: string;
  senha_hash: string;
  whatsapp: string;
  cpf: string;
  pix_chave: string;
  tipo_usuario?: string;
  assinatura_status?: string;
  assinatura_valida_ate?: string;
  mensalidade_dia?: number;
  config_modulos?: string | any;
  mensalidades_pagas?: number;
  mp_access_token?: string;
  mp_refresh_token?: string;
  mp_user_id?: string;
  mp_status_conexao?: number;
  endereco?: string;
  endereco_link?: string;
  onboarding_concluido?: number;
  criado_em?: string;
}

export interface Servico {
  id?: number;
  usuario_id: number;
  nome: string;
  descricao: string;
  duracao_minutos: number;
  preco: number;
  sinal_porcentagem?: number;
  cor?: string;
  criado_em?: string;
}

export interface Disponibilidade {
  id?: number;
  usuario_id: number;
  dia_semana: number; // 0-6
  hora_inicio: string; // "HH:MM"
  hora_fim: string; // "HH:MM"
}

export interface Agendamento {
  id?: number;
  servico_id: number;
  cliente_nome: string;
  cliente_whatsapp: string;
  data_agendamento: string; // "YYYY-MM-DD"
  hora_inicio: string; // "HH:MM"
  hora_fim: string; // "HH:MM"
  status_pagamento: 'pendente' | 'pago' | 'expirado';
  checkout_id: string;
  metodo_pagamento: 'pix' | 'presencial';
  funcionario_id?: number | null;
  comissao_valor?: number;
  criado_em?: string;
}

export interface Despesa {
  id?: number;
  usuario_id: number;
  descricao: string;
  valor: number;
  data_despesa: string; // "YYYY-MM-DD"
  criado_em?: string;
}

export interface Produto {
  id?: number;
  usuario_id: number;
  nome: string;
  preco: number;
  preco_custo: number;
  estoque: number;
  criado_em?: string;
}

export interface VendaProduto {
  id?: number;
  usuario_id: number;
  produto_id: number;
  quantidade: number;
  valor_total: number;
  data_venda: string; // "YYYY-MM-DD"
  criado_em?: string;
}

export interface Funcionario {
  id?: number;
  usuario_id: number;
  nome: string;
  whatsapp: string;
  ativo: number;
  criado_em?: string;
}

export interface FuncionarioServico {
  id?: number;
  funcionario_id: number;
  servico_id: number;
  comissao_percentual: number;
}
