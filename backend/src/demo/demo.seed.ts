import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { query } from '../config/database';
import { DEMO_CREDENTIALS } from './demo.config';

/**
 * Popula o banco com um estabelecimento fictício ("Barbearia Demo") para
 * que recrutadores e visitantes possam explorar o sistema sem cadastro.
 * Todos os nomes e telefones são fictícios.
 */

const pad = (n: number) => String(n).padStart(2, '0');
const toDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addMinutes = (hhmm: string, min: number) => {
  const [h, m] = hhmm.split(':').map(Number);
  const total = h * 60 + m + min;
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
};

// Gerador pseudoaleatório determinístico: a demo fica igual a cada reinício
function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

const CLIENTES = [
  ['Ana Beatriz Souza', '61900000001'],
  ['Bruno Henrique Lima', '61900000002'],
  ['Carla Mendes', '61900000003'],
  ['Diego Fernandes', '61900000004'],
  ['Eduarda Rocha', '61900000005'],
  ['Felipe Andrade', '61900000006'],
  ['Gabriel Costa', '61900000007'],
  ['Helena Martins', '61900000008'],
  ['Igor Nascimento', '61900000009'],
  ['Juliana Alves', '61900000010'],
  ['Lucas Pereira', '61900000011'],
  ['Mariana Ribeiro', '61900000012'],
];

async function hash(senha: string) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(senha, salt);
}

export async function seedDemoData() {
  const existing = await query.get('SELECT id FROM usuarios WHERE email = ?', [DEMO_CREDENTIALS.prestador.email]);
  if (existing) return;

  console.log('[DEMO] Populando banco com dados de demonstração...');

  // Configurações globais da demo
  const setConfig = (chave: string, valor: string) =>
    query.run('UPDATE configuracoes SET valor = ? WHERE chave = ?', [valor, chave]);
  await setConfig('novos_cadastros_habilitados', '0');
  await setConfig('modo_manutencao_habilitado', '0');
  await setConfig('suporte_email', 'demo@agendamente.com.br');
  await setConfig('suporte_whatsapp', '61900000000');

  // Prestador demo
  const hoje = new Date();
  const validade = new Date(hoje);
  validade.setFullYear(validade.getFullYear() + 5);

  const prestador = await query.run(
    `INSERT INTO usuarios (nome, nome_estabelecimento, nicho, email, senha_hash, whatsapp, cpf, pix_chave, email_verificado,
      mensalidade_dia, assinatura_status, assinatura_valida_ate, tipo_usuario, config_modulos, mensalidades_pagas,
      onboarding_concluido, endereco)
     VALUES (?, ?, 'barbearia_salao', ?, ?, ?, ?, ?, 1, 10, 'ativo', ?, 'profissional', ?, 6, 1, ?)`,
    [
      'Rafael Demo',
      'Barbearia Demo',
      DEMO_CREDENTIALS.prestador.email,
      await hash(DEMO_CREDENTIALS.prestador.senha),
      '61900000100',
      null,
      'demo@agendamente.com.br',
      toDate(validade),
      '{"funcionarios":true,"produtos":true,"despesas":true}',
      'Rua Exemplo, 123 - Brasília/DF',
    ]
  );
  const uid = prestador.lastID;

  // Super Admin (dono do SaaS) da demo — criado depois para o prestador ser o usuarioId=1
  await query.run(
    "INSERT INTO usuarios (nome, email, senha_hash, whatsapp, cpf, pix_chave, email_verificado, mensalidade_dia, assinatura_status, assinatura_valida_ate, tipo_usuario, onboarding_concluido) VALUES (?, ?, ?, ?, ?, ?, 1, 10, 'ativo', '2099-12-31', 'dono', 1)",
    ['Administrador Demo', DEMO_CREDENTIALS.superAdmin.email, await hash(DEMO_CREDENTIALS.superAdmin.senha), '61900000099', null, DEMO_CREDENTIALS.superAdmin.email]
  );


  // Serviços
  const servicosDef = [
    { nome: 'Corte de Cabelo', desc: 'Corte masculino tradicional ou moderno', dur: 30, preco: 45, sinal: 30, cor: '#6366f1' },
    { nome: 'Barba Completa', desc: 'Barba com toalha quente e navalha', dur: 30, preco: 35, sinal: 30, cor: '#f59e0b' },
    { nome: 'Corte + Barba', desc: 'Combo completo', dur: 60, preco: 70, sinal: 30, cor: '#10b981' },
    { nome: 'Sobrancelha', desc: 'Design de sobrancelha na navalha', dur: 15, preco: 15, sinal: 0, cor: '#ec4899' },
    { nome: 'Pigmentação', desc: 'Pigmentação de barba ou cabelo', dur: 45, preco: 60, sinal: 50, cor: '#0ea5e9' },
  ];
  const servicos: Array<{ id: number; nome: string; dur: number; preco: number; sinal: number }> = [];
  for (const s of servicosDef) {
    const r = await query.run(
      'INSERT INTO servicos (usuario_id, nome, descricao, duracao_minutos, preco, sinal_porcentagem, cor) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [uid, s.nome, s.desc, s.dur, s.preco, s.sinal, s.cor]
    );
    servicos.push({ id: r.lastID, nome: s.nome, dur: s.dur, preco: s.preco, sinal: s.sinal });
  }

  // Disponibilidade: segunda a sexta 09h-19h, sábado 08h-14h (0 = domingo)
  for (let dia = 1; dia <= 5; dia++) {
    await query.run('INSERT INTO disponibilidades (usuario_id, dia_semana, hora_inicio, hora_fim) VALUES (?, ?, ?, ?)', [uid, dia, '09:00', '19:00']);
  }
  await query.run('INSERT INTO disponibilidades (usuario_id, dia_semana, hora_inicio, hora_fim) VALUES (?, ?, ?, ?)', [uid, 6, '08:00', '14:00']);

  // Equipe com comissões
  const equipe = [
    { nome: 'Marcos Barbeiro', wpp: '61900000201', comissao: 40 },
    { nome: 'Thiago Barbeiro', wpp: '61900000202', comissao: 35 },
  ];
  const funcionarios: Array<{ id: number; comissao: number }> = [];
  for (const f of equipe) {
    const r = await query.run('INSERT INTO funcionarios (usuario_id, nome, whatsapp, ativo) VALUES (?, ?, ?, 1)', [uid, f.nome, f.wpp]);
    funcionarios.push({ id: r.lastID, comissao: f.comissao });
    for (const s of servicos) {
      await query.run(
        'INSERT INTO funcionario_servicos (funcionario_id, servico_id, comissao_percentual) VALUES (?, ?, ?)',
        [r.lastID, s.id, f.comissao]
      );
    }
  }

  // Produtos
  const produtosDef = [
    ['Pomada Modeladora', 39.9, 18, 20],
    ['Óleo para Barba', 29.9, 12, 15],
    ['Shampoo Antiqueda', 34.9, 15, 10],
    ['Balm Pós-Barba', 24.9, 10, 8],
  ];
  const produtos: Array<{ id: number; preco: number }> = [];
  for (const [nome, preco, custo, estoque] of produtosDef) {
    const r = await query.run(
      'INSERT INTO produtos (usuario_id, nome, preco, estoque, preco_custo) VALUES (?, ?, ?, ?, ?)',
      [uid, nome, preco, estoque, custo]
    );
    produtos.push({ id: r.lastID, preco: preco as number });
  }

  const rand = seededRandom(42);
  const pick = <T>(arr: T[]) => arr[Math.floor(rand() * arr.length)];

  // Agendamentos: últimos 45 dias (concluídos) + próximos 10 dias (futuros)
  const horarios = ['09:00', '09:30', '10:00', '10:30', '11:00', '13:00', '14:00', '14:30', '15:00', '16:00', '17:00', '17:30', '18:00'];
  for (let offset = -45; offset <= 10; offset++) {
    const dia = new Date(hoje);
    dia.setDate(hoje.getDate() + offset);
    const diaSemana = dia.getDay();
    if (diaSemana === 0) continue; // domingo fechado

    const qtd = offset < 0 ? 3 + Math.floor(rand() * 4) : 1 + Math.floor(rand() * 3);
    const usados = new Set<string>();
    for (let i = 0; i < qtd; i++) {
      let hora = pick(horarios);
      if (diaSemana === 6 && hora >= '14:00') hora = '10:00';
      const func = pick(funcionarios);
      const chave = `${hora}-${func.id}`;
      if (usados.has(chave)) continue;
      usados.add(chave);

      const serv = pick(servicos);
      const [clienteNome, clienteWpp] = pick(CLIENTES);
      const passado = offset < 0;
      const presencial = rand() < 0.35;
      const sinal = presencial ? 0 : parseFloat(((serv.preco * serv.sinal) / 100).toFixed(2));
      const comissao = parseFloat(((serv.preco * func.comissao) / 100).toFixed(2));

      let status = 'pago';
      let presenca = 1;
      if (!passado) {
        presenca = 0;
        status = presencial ? 'pendente' : rand() < 0.8 ? 'pago' : 'pendente';
      } else if (rand() < 0.07) {
        presenca = 2; // faltou
      }

      await query.run(
        `INSERT INTO agendamentos (servico_id, cliente_nome, cliente_whatsapp, data_agendamento, hora_inicio, hora_fim,
          status_pagamento, checkout_id, metodo_pagamento, funcionario_id, comissao_valor, sinal_valor, restante_pago,
          presenca_confirmada, servico_ids, servico_nomes, preco_total, duracao_total, funcionario_escolhido, comissao_paga)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        [
          serv.id, clienteNome, clienteWpp, toDate(dia), hora, addMinutes(hora, serv.dur),
          status, crypto.randomUUID(), presencial ? 'presencial' : 'pix', func.id, comissao, sinal,
          passado && presenca === 1 ? 1 : 0, presenca, String(serv.id), serv.nome, serv.preco, serv.dur,
          offset < -15 ? 1 : 0,
        ]
      );
    }

    // Vendas de produtos e despesas no passado
    if (offset < 0 && rand() < 0.4) {
      const p = pick(produtos);
      const qtdVenda = 1 + Math.floor(rand() * 2);
      await query.run(
        'INSERT INTO vendas_produtos (usuario_id, produto_id, quantidade, valor_total, data_venda) VALUES (?, ?, ?, ?, ?)',
        [uid, p.id, qtdVenda, parseFloat((p.preco * qtdVenda).toFixed(2)), toDate(dia)]
      );
    }
  }

  const despesasDef: Array<[string, number, number]> = [
    ['Aluguel do espaço', 1800, -30],
    ['Conta de energia', 320.5, -25],
    ['Reposição de produtos', 540, -20],
    ['Internet', 119.9, -15],
    ['Material de limpeza', 85, -5],
  ];
  for (const [descricao, valor, off] of despesasDef) {
    const d = new Date(hoje);
    d.setDate(hoje.getDate() + off);
    await query.run('INSERT INTO despesas (usuario_id, descricao, valor, data_despesa) VALUES (?, ?, ?, ?)', [uid, descricao, valor, toDate(d)]);
  }

  await query.run('INSERT INTO comunicados (titulo, conteudo) VALUES (?, ?)', [
    'Bem-vindo à demonstração! 👋',
    'Esta é uma versão de demonstração do Agendamente Oficial com dados fictícios. Fique à vontade para explorar: os dados são restaurados automaticamente.',
  ]);

  console.log(`[DEMO] Pronto! Prestador: ${DEMO_CREDENTIALS.prestador.email} | Link público: /agendar?usuarioId=${uid}`);
}
