import { Request, Response } from 'express';
import { query } from '../config/database';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { SchedulerService, timeToMinutes, minutesToTime } from '../services/scheduler.service';
import { generatePixCheckout } from '../services/pix.service';
import { Agendamento, Servico, Usuario } from '../models/types';
import { validateCelular } from '../utils/validation';
import { WhatsAppService } from '../services/whatsapp.service';

export class BookingController {
  /**
   * Consulta os slots livres para o link público de agendamento.
   */
  static async getAvailableSlots(req: Request, res: Response) {
    const { usuarioId, servicoId, data, funcionarioId } = req.query;

    if (!usuarioId || !servicoId || !data) {
      return res.status(400).json({ error: 'Parâmetros usuarioId, servicoId e data (AAAA-MM-DD) são obrigatórios.' });
    }

    try {
      const servicoIds = String(servicoId).split(',').map(Number);
      const slots = await SchedulerService.getAvailableSlots(
        Number(usuarioId),
        servicoIds,
        String(data),
        funcionarioId ? String(funcionarioId) : undefined
      );
      return res.json(slots);
    } catch (err: any) {
      console.error(err);
      return res.status(500).json({ error: err.message || 'Erro ao calcular horários disponíveis.' });
    }
  }

  /**
   * Cria um novo agendamento pré-pago (cria checkout Pix).
   */
  static async create(req: Request, res: Response) {
    const { servicoId, clienteNome, clienteWhatsapp, dataAgendamento, horaInicio, funcionarioId, metodoPagamento } = req.body;

    if (!servicoId || !clienteNome || !clienteWhatsapp || !dataAgendamento || !horaInicio) {
      return res.status(400).json({ error: 'Todos os campos são obrigatórios para agendar.' });
    }

    if (!validateCelular(clienteWhatsapp)) {
      return res.status(400).json({ error: 'Número de celular inválido. Certifique-se de digitar o DDD, o dígito 9 e o restante do número (ex: 11999998888).' });
    }

    const cleanWhatsapp = clienteWhatsapp.replace(/\D/g, '');

    try {
      let ids: number[] = [];
      if (Array.isArray(servicoId)) {
        ids = servicoId.map(Number);
      } else if (typeof servicoId === 'string') {
        ids = String(servicoId).split(',').map(Number);
      } else {
        ids = [Number(servicoId)];
      }

      // 1. Busca detalhes de todos os serviços selecionados e dados do profissional
      const servicePlaceholders = ids.map(() => '?').join(',');
      const servicos = await query.all<Servico & { pix_chave: string; usuario_nome: string; usuario_id: number; dono_whatsapp: string; mp_access_token: string; mp_status_conexao: number }>(
        `SELECT s.*, u.pix_chave, COALESCE(NULLIF(u.nome_estabelecimento, ''), u.nome) as usuario_nome, u.id as usuario_id, u.whatsapp as dono_whatsapp, u.mp_access_token, u.mp_status_conexao
         FROM servicos s
         JOIN usuarios u ON s.usuario_id = u.id
         WHERE s.id IN (${servicePlaceholders})`,
        [...ids]
      );

      if (servicos.length !== ids.length) {
        return res.status(404).json({ error: 'Um ou mais serviços não foram encontrados.' });
      }

      const firstUsuarioId = servicos[0].usuario_id;
      if (servicos.some(s => s.usuario_id !== firstUsuarioId)) {
        return res.status(400).json({ error: 'Todos os serviços selecionados devem pertencer ao mesmo estabelecimento.' });
      }

      const precoTotal = servicos.reduce((total, s) => total + Number(s.preco), 0);
      const duracaoTotal = servicos.reduce((total, s) => total + s.duracao_minutos, 0);
      const servicoNomes = servicos.map(s => s.nome).join(', ');

      // 1.1 Busca funcionários ativos que prestam todos os serviços selecionados
      const activeEmployees = await query.all<{ id: number }>(
        `SELECT f.id 
         FROM funcionarios f 
         WHERE f.usuario_id = ? AND f.ativo = 1
           AND (
             SELECT COUNT(DISTINCT fs.servico_id)
             FROM funcionario_servicos fs
             WHERE fs.funcionario_id = f.id AND fs.servico_id IN (${servicePlaceholders})
           ) = ?`,
        [firstUsuarioId, ...ids, ids.length]
      );
      const employeeIds = activeEmployees.map(e => e.id);

      // 1.2 Resolve qual funcionário executará o serviço
      let resolvedFuncId: number | null = null;
      let funcionarioEscolhido = 0;
      
      if (funcionarioId && !isNaN(Number(funcionarioId)) && employeeIds.length > 0) {
        resolvedFuncId = Number(funcionarioId);
        funcionarioEscolhido = 1;
        // Valida se o funcionário selecionado de fato faz todos esses serviços
        if (!employeeIds.includes(resolvedFuncId)) {
          return res.status(400).json({ error: 'O profissional selecionado não executa todos os serviços selecionados.' });
        }
      } else if (employeeIds.length > 0) {
        // Se há funcionários cadastrados e o cliente escolheu "Sem preferência", busca o primeiro livre
        for (const empId of employeeIds) {
          const free = await SchedulerService.isSlotAvailable(
            firstUsuarioId,
            ids,
            dataAgendamento,
            horaInicio,
            empId
          );
          if (free) {
            resolvedFuncId = empId;
            break;
          }
        }

        if (resolvedFuncId === null) {
          return res.status(409).json({ error: 'Desculpe, não há profissionais livres para este horário.' });
        }
      }

      // 2. Valida se o horário selecionado ainda está disponível
      const disponivel = await SchedulerService.isSlotAvailable(
        firstUsuarioId,
        ids,
        dataAgendamento,
        horaInicio,
        resolvedFuncId
      );

      if (!disponivel) {
        return res.status(409).json({ error: 'Desculpe, este horário foi reservado por outro cliente há instantes. Por favor, selecione outro.' });
      }

      // 3. Calcula o horário de término
      const inicioMinutos = timeToMinutes(horaInicio);
      const fimMinutos = inicioMinutos + duracaoTotal;
      const horaFim = minutesToTime(fimMinutos);

      // 3.1 Calcula a comissão do funcionário se aplicável
      let comissao_valor = 0.00;
      if (resolvedFuncId !== null) {
        const links = await query.all<{ servico_id: number; comissao_percentual: number }>(
          `SELECT servico_id, comissao_percentual 
           FROM funcionario_servicos 
           WHERE funcionario_id = ? AND servico_id IN (${servicePlaceholders})`,
          [resolvedFuncId, ...ids]
        );
        for (const s of servicos) {
          const link = links.find(l => l.servico_id === s.id);
          if (link) {
            comissao_valor += parseFloat(((s.preco * link.comissao_percentual) / 100).toFixed(2));
          }
        }
        comissao_valor = parseFloat(comissao_valor.toFixed(2));
      }

      // 1.3 Verifica se o cliente é isento de sinal para este profissional
      const isentoRecord = await query.get(
        'SELECT isento_sinal FROM clientes_isentos WHERE usuario_id = ? AND cliente_whatsapp = ?',
        [firstUsuarioId, cleanWhatsapp]
      );
      const isClientExempt = isentoRecord ? isentoRecord.isento_sinal === 1 : false;

      // 4. Cria ID único do checkout Pix
      const checkoutId = `chk_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      
      let sinal_valor = 0.00;
      let activeMetodoPagamento = metodoPagamento || 'pix';

      if (!isClientExempt) {
        for (const s of servicos) {
          const sinalPorcentagem = s.sinal_porcentagem || 0;
          if (sinalPorcentagem > 0) {
            sinal_valor += parseFloat(((s.preco * sinalPorcentagem) / 100).toFixed(2));
          }
        }
        sinal_valor = parseFloat(sinal_valor.toFixed(2));
      }

      // 4.1 Gera os dados do Pix se for pagamento via Pix
      let pixInfo = null;
      if (activeMetodoPagamento === 'pix') {
        const valorPix = sinal_valor > 0 ? sinal_valor : precoTotal;
        const hasMp = servicos[0].mp_status_conexao === 1 && servicos[0].mp_access_token;

        if (hasMp) {
          try {
            const payerFirstName = clienteNome.split(' ')[0] || 'Cliente';
            const payerLastName = clienteNome.split(' ').slice(1).join(' ') || 'Agendamento';
            const serverUrl = process.env.SERVER_URL || '';
            const crypto = require('crypto');

            const mpResponse = await fetch('https://api.mercadopago.com/v1/payments', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${servicos[0].mp_access_token}`,
                'Content-Type': 'application/json',
                'X-Idempotency-Key': crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex')
              },
              body: JSON.stringify({
                transaction_amount: valorPix,
                description: `Reserva - ${servicoNomes}`,
                payment_method_id: 'pix',
                payer: {
                  email: `${cleanWhatsapp}@agendamente.com.br`,
                  first_name: payerFirstName,
                  last_name: payerLastName
                },
                external_reference: `BOOKING_${checkoutId}`,
                notification_url: `${serverUrl}/api/public/webhooks/mercadopago/booking?checkoutId=${checkoutId}&userId=${firstUsuarioId}`
              })
            });

            if (mpResponse.ok) {
              const mpData = await mpResponse.json() as any;
              const qrCode = mpData.point_of_interaction?.transaction_data?.qr_code;
              const qrCodeBase64 = mpData.point_of_interaction?.transaction_data?.qr_code_base64;

              if (qrCode && qrCodeBase64) {
                pixInfo = {
                  pixCopiaCola: qrCode,
                  qrCodeUrl: `data:image/png;base64,${qrCodeBase64}`
                };
              }
            } else {
              const errBody = await mpResponse.text();
              console.error('[BookingController] Falha ao criar Pix no Mercado Pago do profissional:', errBody);
            }
          } catch (mpErr: any) {
            console.error('[BookingController] Erro na chamada do Mercado Pago do profissional:', mpErr.message);
          }
        }

        if (!pixInfo) {
          pixInfo = generatePixCheckout(servicos[0].pix_chave, valorPix, servicos[0].usuario_nome, checkoutId);
        }
      }

      // 5. Salva o agendamento pendente no banco de dados
      await query.run(
        `INSERT INTO agendamentos (servico_id, cliente_nome, cliente_whatsapp, data_agendamento, hora_inicio, hora_fim, status_pagamento, checkout_id, metodo_pagamento, funcionario_id, comissao_valor, sinal_valor, servico_ids, servico_nomes, preco_total, duracao_total, funcionario_escolhido, pix_info) 
         VALUES (?, ?, ?, ?, ?, ?, 'pendente', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          ids[0], 
          clienteNome, 
          cleanWhatsapp, 
          dataAgendamento, 
          horaInicio, 
          horaFim, 
          checkoutId, 
          activeMetodoPagamento,
          resolvedFuncId,
          comissao_valor,
          sinal_valor,
          ids.join(','),
          servicoNomes,
          precoTotal,
          duracaoTotal,
          funcionarioEscolhido,
          pixInfo ? JSON.stringify(pixInfo) : null
        ]
      );

      // Se for pagamento no local, envia mensagem de confirmação instantânea para o cliente
      if (activeMetodoPagamento === 'presencial') {
        try {
          const employeeName = (resolvedFuncId && funcionarioEscolhido === 1 && employeeIds.length > 0)
            ? (await query.get<{ nome: string }>('SELECT nome FROM funcionarios WHERE id = ?', [resolvedFuncId]))?.nome || null
            : null;
          await WhatsAppService.sendReminder(
            servicos[0].dono_whatsapp,
            cleanWhatsapp,
            clienteNome,
            servicoNomes,
            dataAgendamento,
            horaInicio,
            employeeName,
            'booking_confirmed'
          );
        } catch (whatsappErr: any) {
          console.error('[BookingController] Erro ao disparar WhatsApp de agendamento confirmado (presencial):', whatsappErr.message);
        }
      }

      return res.status(201).json({
        message: activeMetodoPagamento === 'presencial' 
          ? 'Agendamento confirmado com sucesso!' 
          : 'Agendamento reservado com sucesso! Aguardando pagamento.',
        checkoutId,
        pixCopiaCola: pixInfo ? pixInfo.pixCopiaCola : null,
        qrCodeUrl: pixInfo ? pixInfo.qrCodeUrl : null,
        preco: precoTotal,
        sinal_valor,
        clienteNome,
        clienteWhatsapp: cleanWhatsapp,
        dataAgendamento,
        horaInicio,
        horaFim,
        metodoPagamento: activeMetodoPagamento,
        funcionario_id: resolvedFuncId,
        comissao_valor,
        limiteMinutos: activeMetodoPagamento === 'pix' ? 10 : null
      });
    } catch (err: any) {
      console.error(err);
      return res.status(500).json({ error: 'Erro ao criar agendamento.' });
    }
  }

  /**
   * Obtém informações de um checkout específico (com verificação de timeout em tempo real).
   */
  static async getCheckout(req: Request, res: Response) {
    const { checkoutId } = req.params;

    try {
      const agendamento = await query.get<any>(
        `SELECT a.*, s.usuario_id as profissional_id, COALESCE(a.servico_nomes, s.nome) as servico_nome, COALESCE(a.preco_total, s.preco) as preco, COALESCE(NULLIF(u.nome_estabelecimento, ''), u.nome) as profissional_nome, u.pix_chave, u.config_modulos, u.whatsapp as profissional_whatsapp
         FROM agendamentos a
         JOIN servicos s ON a.servico_id = s.id
         JOIN usuarios u ON s.usuario_id = u.id
         WHERE a.checkout_id = ?`,
        [checkoutId]
      );

      if (!agendamento) {
        return res.status(404).json({ error: 'Checkout não encontrado.' });
      }

      // Verificação em tempo real de timeout (10 minutos) apenas para Pix
      if (agendamento.status_pagamento === 'pendente' && agendamento.metodo_pagamento === 'pix') {
        const criadoEm = new Date(agendamento.criado_em.replace(' ', 'T') + 'Z'); // Garante parser UTC
        const agora = new Date();
        const diffMinutos = (agora.getTime() - criadoEm.getTime()) / (1000 * 60);

        if (diffMinutos > 10) {
          // Atualiza status para expirado no banco
          await query.run("UPDATE agendamentos SET status_pagamento = 'expirado' WHERE id = ?", [agendamento.id]);
          agendamento.status_pagamento = 'expirado';
        }
      }

      // Se ainda pendente e for do tipo Pix, tenta carregar o Pix info do banco ou gerar fallback
      let pixInfo = null;
      if (agendamento.status_pagamento === 'pendente' && agendamento.metodo_pagamento === 'pix') {
        if (agendamento.pix_info) {
          try {
            pixInfo = JSON.parse(agendamento.pix_info);
          } catch (e) {
            console.error('Erro ao ler pix_info do banco:', e);
          }
        }
        if (!pixInfo) {
          const valorPix = agendamento.sinal_valor > 0 ? agendamento.sinal_valor : agendamento.preco;
          pixInfo = generatePixCheckout(agendamento.pix_chave, valorPix, agendamento.profissional_nome, checkoutId);
        }
      }

      // Extrai o tema
      let tema = 'indigo';
      if (agendamento.config_modulos) {
        try {
          const modulos = typeof agendamento.config_modulos === 'string'
            ? JSON.parse(agendamento.config_modulos)
            : agendamento.config_modulos;
          if (modulos && modulos.tema) {
            tema = modulos.tema;
          }
        } catch (e) {
          console.error(e);
        }
      }

      return res.json({
        id: agendamento.id,
        profissional_id: agendamento.profissional_id,
        cliente_nome: agendamento.cliente_nome,
        cliente_whatsapp: agendamento.cliente_whatsapp,
        data_agendamento: agendamento.data_agendamento,
        hora_inicio: agendamento.hora_inicio,
        hora_fim: agendamento.hora_fim,
        status_pagamento: agendamento.status_pagamento,
        metodo_pagamento: agendamento.metodo_pagamento,
        servico_nome: agendamento.servico_nome,
        profissional_nome: agendamento.profissional_nome,
        profissional_whatsapp: agendamento.profissional_whatsapp,
        preco: agendamento.preco,
        sinal_valor: agendamento.sinal_valor || 0.00,
        criado_em: agendamento.criado_em,
        tema,
        pixInfo
      });
    } catch (err: any) {
      console.error(err);
      return res.status(500).json({ error: 'Erro ao carregar dados do checkout.' });
    }
  }

  /**
   * Simula a confirmação de pagamento Pix (webhook ou botão manual no MVP).
   */
  static async confirmPayment(req: Request, res: Response) {
    const { checkoutId } = req.params;

    try {
      const agendamento = await query.get<any>(
        `SELECT a.id, a.status_pagamento, a.cliente_nome, a.cliente_whatsapp, a.data_agendamento, a.hora_inicio, a.funcionario_id, a.funcionario_escolhido,
                COALESCE(a.servico_nomes, s.nome) as servico_nome,
                u.whatsapp as profissional_whatsapp,
                COALESCE(NULLIF(u.nome_estabelecimento, ''), u.nome) as profissional_nome,
                f.nome as funcionario_nome, f.whatsapp as funcionario_whatsapp,
                (SELECT COUNT(*) FROM funcionarios WHERE usuario_id = u.id AND ativo = 1) as has_employees
         FROM agendamentos a
         JOIN servicos s ON a.servico_id = s.id
         JOIN usuarios u ON s.usuario_id = u.id
         LEFT JOIN funcionarios f ON a.funcionario_id = f.id
         WHERE a.checkout_id = ?`,
        [checkoutId]
      );

      if (!agendamento) {
        return res.status(404).json({ error: 'Checkout não encontrado.' });
      }

      if (agendamento.status_pagamento === 'pago') {
        return res.json({ message: 'Pagamento já estava confirmado.', status: 'pago' });
      }

      if (agendamento.status_pagamento === 'expirado') {
        return res.status(400).json({ error: 'Não é possível pagar um agendamento expirado. O horário já foi liberado.' });
      }

      await query.run("UPDATE agendamentos SET status_pagamento = 'pago' WHERE checkout_id = ?", [checkoutId]);

      // Notifica o cliente sobre o pagamento confirmado e reserva garantida
      try {
        const profName = (agendamento.funcionario_id && agendamento.funcionario_escolhido === 1 && agendamento.has_employees > 0)
          ? agendamento.funcionario_nome
          : null;
        await WhatsAppService.sendReminder(
          agendamento.profissional_whatsapp,
          agendamento.cliente_whatsapp,
          agendamento.cliente_nome,
          agendamento.servico_nome,
          agendamento.data_agendamento,
          agendamento.hora_inicio,
          profName,
          'payment_confirmed'
        );
      } catch (whatsappErr: any) {
        console.error('[BookingController] Erro ao disparar WhatsApp de pagamento confirmado para o cliente:', whatsappErr.message);
      }

      // Disparar notificação para funcionário se houver um designado
      if (agendamento.funcionario_id && agendamento.funcionario_whatsapp) {
        try {
          await WhatsAppService.sendEmployeeNotification(
            agendamento.profissional_whatsapp || '',
            agendamento.funcionario_whatsapp,
            agendamento.funcionario_nome || '',
            agendamento.cliente_nome,
            agendamento.servico_nome || '',
            agendamento.data_agendamento,
            agendamento.hora_inicio,
            'new_booking'
          );
        } catch (notificationErr) {
          console.error('Erro ao enviar notificação de WhatsApp para funcionário (confirmPayment):', notificationErr);
        }
      }

      return res.json({
        message: 'Pagamento simulado e confirmado com sucesso! Agendamento garantido.',
        status: 'pago'
      });
    } catch (err: any) {
      console.error(err);
      return res.status(500).json({ error: 'Erro ao processar confirmação de pagamento.' });
    }
  }

  /**
   * Estatísticas do Painel Administrativo para o Gráfico Chart.js e Métricas.
   */
  static async getDashboardStats(req: AuthenticatedRequest, res: Response) {
    const userId = req.userId;

    try {
      // 1. Receita de Serviços (Confirmado pago ou presencial, excluindo cancelados)
      const formulaPago = `
        CASE 
          WHEN a.status_pagamento = 'pago' THEN
            CASE 
              WHEN a.sinal_valor > 0 THEN
                CASE WHEN a.restante_pago = 1 THEN COALESCE(a.preco_total, s.preco) ELSE a.sinal_valor END
              ELSE COALESCE(a.preco_total, s.preco)
            END
          ELSE 0.00 
        END
      `;

      const recServTotal = (await query.get<{ total: number }>(`SELECT SUM(${formulaPago}) as total FROM agendamentos a JOIN servicos s ON a.servico_id = s.id WHERE s.usuario_id = ? AND (a.presenca_confirmada IS NULL OR a.presenca_confirmada != 2)`, [userId]))?.total || 0;
      const recServDiario = (await query.get<{ total: number }>(`SELECT SUM(${formulaPago}) as total FROM agendamentos a JOIN servicos s ON a.servico_id = s.id WHERE s.usuario_id = ? AND (a.presenca_confirmada IS NULL OR a.presenca_confirmada != 2) AND a.data_agendamento = date("now")`, [userId]))?.total || 0;
      const recServSemanal = (await query.get<{ total: number }>(`SELECT SUM(${formulaPago}) as total FROM agendamentos a JOIN servicos s ON a.servico_id = s.id WHERE s.usuario_id = ? AND (a.presenca_confirmada IS NULL OR a.presenca_confirmada != 2) AND a.data_agendamento >= date("now", "-7 days")`, [userId]))?.total || 0;
      const recServMensal = (await query.get<{ total: number }>(`SELECT SUM(${formulaPago}) as total FROM agendamentos a JOIN servicos s ON a.servico_id = s.id WHERE s.usuario_id = ? AND (a.presenca_confirmada IS NULL OR a.presenca_confirmada != 2) AND a.data_agendamento >= date("now", "-30 days")`, [userId]))?.total || 0;

      // 2. Receita de Vendas de Produtos
      const recProdTotal = (await query.get<{ total: number }>('SELECT SUM(valor_total) as total FROM vendas_produtos WHERE usuario_id = ?', [userId]))?.total || 0;
      const recProdDiario = (await query.get<{ total: number }>('SELECT SUM(valor_total) as total FROM vendas_produtos WHERE usuario_id = ? AND data_venda = date("now")', [userId]))?.total || 0;
      const recProdSemanal = (await query.get<{ total: number }>('SELECT SUM(valor_total) as total FROM vendas_produtos WHERE usuario_id = ? AND data_venda >= date("now", "-7 days")', [userId]))?.total || 0;
      const recProdMensal = (await query.get<{ total: number }>('SELECT SUM(valor_total) as total FROM vendas_produtos WHERE usuario_id = ? AND data_venda >= date("now", "-30 days")', [userId]))?.total || 0;

      // 3. Despesas Operacionais
      const expTotal = (await query.get<{ total: number }>('SELECT SUM(valor) as total FROM despesas WHERE usuario_id = ?', [userId]))?.total || 0;
      const expDiario = (await query.get<{ total: number }>('SELECT SUM(valor) as total FROM despesas WHERE usuario_id = ? AND data_despesa = date("now")', [userId]))?.total || 0;
      const expSemanal = (await query.get<{ total: number }>('SELECT SUM(valor) as total FROM despesas WHERE usuario_id = ? AND data_despesa >= date("now", "-7 days")', [userId]))?.total || 0;
      const expMensal = (await query.get<{ total: number }>('SELECT SUM(valor) as total FROM despesas WHERE usuario_id = ? AND data_despesa >= date("now", "-30 days")', [userId]))?.total || 0;

      // 4. Totalizadores de Status de Agendamentos (Quantidade)
      const totalizadores = await query.all<{ status_pagamento: string; total: number }>(
        `SELECT a.status_pagamento, COUNT(a.id) as total 
         FROM agendamentos a
         JOIN servicos s ON a.servico_id = s.id
         WHERE s.usuario_id = ? AND (a.presenca_confirmada IS NULL OR a.presenca_confirmada != 2)
         GROUP BY a.status_pagamento`,
        [userId]
      );

      const statusMap = { pago: 0, pendente: 0, expirado: 0 };
      totalizadores.forEach((t) => {
        if (t.status_pagamento in statusMap) {
          statusMap[t.status_pagamento as keyof typeof statusMap] = t.total;
        }
      });

      const proximosAgendamentos = await query.all<any>(
        `SELECT a.id, a.servico_id, s.usuario_id as profissional_id, a.cliente_nome, a.cliente_whatsapp, a.data_agendamento, a.hora_inicio, a.hora_fim, a.status_pagamento, a.metodo_pagamento, a.presenca_confirmada, a.sinal_valor, a.restante_pago, COALESCE(a.servico_nomes, s.nome) as servico_nome, COALESCE(a.preco_total, s.preco) as preco, f.nome as funcionario_nome, s.cor as servico_cor
         FROM agendamentos a
         JOIN servicos s ON a.servico_id = s.id
         LEFT JOIN funcionarios f ON a.funcionario_id = f.id
         WHERE s.usuario_id = ?
           AND a.data_agendamento >= date('now')
           AND (a.presenca_confirmada IS NULL OR a.presenca_confirmada != 2)
           AND (
             a.status_pagamento = 'pago'
             OR a.metodo_pagamento = 'presencial'
             OR (a.status_pagamento = 'pendente' AND a.metodo_pagamento = 'pix' AND datetime(a.criado_em) >= datetime('now', '-10 minutes'))
           )
         ORDER BY a.data_agendamento ASC, a.hora_inicio ASC
         LIMIT 10`,
        [userId]
      );

      // 6. Série Histórica dos Últimos 7 dias para Gráficos
      const faturamentoPorDia = await query.all<{ data: string; total: number }>(
        `SELECT a.data_agendamento as data, SUM(${formulaPago}) as total
         FROM agendamentos a
         JOIN servicos s ON a.servico_id = s.id
         WHERE s.usuario_id = ? AND (a.presenca_confirmada IS NULL OR a.presenca_confirmada != 2) AND a.data_agendamento >= date('now', '-7 days')
         GROUP BY a.data_agendamento
         ORDER BY a.data_agendamento ASC`,
        [userId]
      );

      // 7. Top 5 Clientes que mais geraram faturamento
      const topClientes = await query.all<any>(
        `SELECT a.cliente_nome, a.cliente_whatsapp, COUNT(a.id) as total_agendamentos, SUM(${formulaPago}) as total_gasto
         FROM agendamentos a
         JOIN servicos s ON a.servico_id = s.id
         WHERE s.usuario_id = ? AND (a.presenca_confirmada IS NULL OR a.presenca_confirmada != 2)
         GROUP BY a.cliente_whatsapp, a.cliente_nome
         ORDER BY total_gasto DESC
         LIMIT 5`,
        [userId]
      );

      return res.json({
        financeiro: {
          receitaServicos: { total: recServTotal, diario: recServDiario, semanal: recServSemanal, mensal: recServMensal },
          receitaProdutos: { total: recProdTotal, diario: recProdDiario, semanal: recProdSemanal, mensal: recProdMensal },
          receitaBruta: {
            total: recServTotal + recProdTotal,
            diario: recServDiario + recProdDiario,
            semanal: recServSemanal + recProdSemanal,
            mensal: recServMensal + recProdMensal
          },
          despesas: { total: expTotal, diario: expDiario, semanal: expSemanal, mensal: expMensal },
          lucroLiquido: {
            total: (recServTotal + recProdTotal) - expTotal,
            diario: (recServDiario + recProdDiario) - expDiario,
            semanal: (recServSemanal + recProdSemanal) - expSemanal,
            mensal: (recServMensal + recProdMensal) - expMensal
          }
        },
        agendamentosStatus: statusMap,
        proximosAgendamentos,
        graficoFaturamento: faturamentoPorDia,
        topClientes
      });
    } catch (err: any) {
      console.error(err);
      return res.status(500).json({ error: 'Erro ao gerar dados estatísticos do dashboard.' });
    }
  }

  /**
   * Reagenda um agendamento existente pelo administrador.
   */
  static async reschedule(req: AuthenticatedRequest, res: Response) {
    const { id } = req.params;
    const { dataAgendamento, horaInicio } = req.body;
    const userId = req.userId;

    if (!dataAgendamento || !horaInicio) {
      return res.status(400).json({ error: 'Data e hora de início são obrigatórias para reagendamento.' });
    }

    try {
      // 1. Busca o agendamento e confere se pertence ao profissional logado
      const booking = await query.get<any>(
        `SELECT a.*, s.usuario_id, s.duracao_minutos,
                COALESCE(a.servico_nomes, s.nome) as servico_nome,
                u.whatsapp as profissional_whatsapp,
                f.nome as funcionario_nome, f.whatsapp as funcionario_whatsapp
         FROM agendamentos a
         JOIN servicos s ON a.servico_id = s.id
         JOIN usuarios u ON s.usuario_id = u.id
         LEFT JOIN funcionarios f ON a.funcionario_id = f.id
         WHERE a.id = ? AND s.usuario_id = ?`,
        [id, userId]
      );

      if (!booking) {
        return res.status(404).json({ error: 'Agendamento não encontrado ou não pertence a você.' });
      }

      // 2. Valida se o novo horário está disponível (excluindo este próprio agendamento para evitar auto-conflito)
      const disponivel = await SchedulerService.isSlotAvailable(
        Number(userId),
        Number(booking.servico_id),
        String(dataAgendamento),
        String(horaInicio),
        booking.funcionario_id,
        Number(booking.id)
      );

      if (!disponivel) {
        return res.status(409).json({ error: 'Este horário não está disponível na sua agenda.' });
      }

      // 3. Calcula o novo horário de término
      const inicioMinutos = timeToMinutes(horaInicio);
      const fimMinutos = inicioMinutos + booking.duracao_minutos;
      const horaFim = minutesToTime(fimMinutos);

      // 4. Executa a atualização
      await query.run(
        `UPDATE agendamentos 
         SET data_agendamento = ?, hora_inicio = ?, hora_fim = ? 
         WHERE id = ?`,
        [dataAgendamento, horaInicio, horaFim, id]
      );

      // Enviar notificação de reagendamento para funcionário se designado
      if (booking.funcionario_id && booking.funcionario_whatsapp) {
        try {
          await WhatsAppService.sendEmployeeNotification(
            booking.profissional_whatsapp || '',
            booking.funcionario_whatsapp,
            booking.funcionario_nome || '',
            booking.cliente_nome,
            booking.servico_nome || '',
            dataAgendamento,
            horaInicio,
            'rescheduled'
          );
        } catch (notificationErr) {
          console.error('Erro ao enviar notificação de WhatsApp para funcionário (reschedule):', notificationErr);
        }
      }

      return res.json({
        message: 'Agendamento reagendado com sucesso!',
        dataAgendamento,
        horaInicio,
        horaFim
      });
    } catch (err: any) {
      console.error(err);
      return res.status(500).json({ error: 'Erro ao reagendar agendamento.' });
    }
  }

  /**
   * Obtém detalhes de um agendamento de forma pública para confirmação (sem JWT, validando token/checkout_id).
   */
  static async getBookingPublic(req: Request, res: Response) {
    const { id } = req.params;
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({ error: 'Token de autorização obrigatório.' });
    }

    try {
      const agendamento = await query.get<any>(
        `SELECT a.id, a.cliente_nome, a.data_agendamento, a.hora_inicio, a.hora_fim, a.status_pagamento, a.presenca_confirmada, a.checkout_id,
                s.nome as servico_nome, COALESCE(NULLIF(u.nome_estabelecimento, ''), u.nome) as profissional_nome, u.config_modulos
         FROM agendamentos a
         JOIN servicos s ON a.servico_id = s.id
         JOIN usuarios u ON s.usuario_id = u.id
         WHERE a.id = ? AND a.checkout_id = ?`,
        [id, token]
      );

      if (!agendamento) {
        return res.status(404).json({ error: 'Agendamento não encontrado ou token inválido.' });
      }

      // Extrai o tema
      let tema = 'indigo';
      if (agendamento.config_modulos) {
        try {
          const modulos = typeof agendamento.config_modulos === 'string'
            ? JSON.parse(agendamento.config_modulos)
            : agendamento.config_modulos;
          if (modulos && modulos.tema) {
            tema = modulos.tema;
          }
        } catch (e) {
          console.error(e);
        }
      }

      return res.json({
        ...agendamento,
        config_modulos: undefined,
        tema
      });
    } catch (err: any) {
      console.error(err);
      return res.status(500).json({ error: 'Erro ao carregar dados do agendamento.' });
    }
  }

  /**
   * Confirma a presença no agendamento de forma pública (via cliente).
   */
  static async confirmPresence(req: Request, res: Response) {
    const { id } = req.params;
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'Token de autorização obrigatório.' });
    }

    try {
      const agendamento = await query.get<{
        id: number;
        cliente_nome: string;
        cliente_whatsapp: string;
        data_agendamento: string;
        hora_inicio: string;
        servico_nome: string;
        funcionario_nome: string | null;
        funcionario_id: number | null;
        funcionario_escolhido: number;
        dono_whatsapp: string;
        has_employees: number;
      }>(
        `SELECT 
          a.id, 
          a.cliente_nome, 
          a.cliente_whatsapp, 
          a.data_agendamento, 
          a.hora_inicio, 
          COALESCE(a.servico_nomes, s.nome) as servico_nome, 
          f.nome as funcionario_nome,
          a.funcionario_id,
          COALESCE(a.funcionario_escolhido, 0) as funcionario_escolhido,
          u.whatsapp as dono_whatsapp,
          (SELECT COUNT(*) FROM funcionarios WHERE usuario_id = u.id AND ativo = 1) as has_employees
         FROM agendamentos a
         JOIN servicos s ON a.servico_id = s.id
         JOIN usuarios u ON s.usuario_id = u.id
         LEFT JOIN funcionarios f ON a.funcionario_id = f.id
         WHERE a.id = ? AND a.checkout_id = ?`,
        [id, token]
      );

      if (!agendamento) {
        return res.status(404).json({ error: 'Agendamento não encontrado ou token inválido.' });
      }

      await query.run(
        'UPDATE agendamentos SET presenca_confirmada = 1 WHERE id = ?',
        [id]
      );

      // Dispara a mensagem de confirmação via WhatsApp
      try {
        const profName = (agendamento.funcionario_id && agendamento.funcionario_escolhido === 1 && agendamento.has_employees > 0)
          ? agendamento.funcionario_nome
          : null;
        await WhatsAppService.sendReminder(
          agendamento.dono_whatsapp,
          agendamento.cliente_whatsapp,
          agendamento.cliente_nome,
          agendamento.servico_nome,
          agendamento.data_agendamento,
          agendamento.hora_inicio,
          profName,
          'presence_confirmed'
        );
      } catch (whatsappErr: any) {
        console.error('[BookingController] Erro ao disparar WhatsApp de presença confirmada:', whatsappErr.message);
      }

      return res.json({ message: 'Presença confirmada com sucesso! Te esperamos no estabelecimento.' });
    } catch (err: any) {
      console.error(err);
      return res.status(500).json({ error: 'Erro ao confirmar presença.' });
    }
  }

  /**
   * Cancela o agendamento de forma pública (via cliente).
   */
  static async cancelPresence(req: Request, res: Response) {
    const { id } = req.params;
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'Token de autorização obrigatório.' });
    }

    try {
      const agendamento = await query.get<{
        id: number;
        cliente_nome: string;
        cliente_whatsapp: string;
        data_agendamento: string;
        hora_inicio: string;
        servico_nome: string;
        dono_whatsapp: string;
      }>(
        `SELECT 
          a.id, 
          a.cliente_nome, 
          a.cliente_whatsapp, 
          a.data_agendamento, 
          a.hora_inicio, 
          COALESCE(a.servico_nomes, s.nome) as servico_nome, 
          u.whatsapp as dono_whatsapp
         FROM agendamentos a
         JOIN servicos s ON a.servico_id = s.id
         JOIN usuarios u ON s.usuario_id = u.id
         WHERE a.id = ? AND a.checkout_id = ?`,
        [id, token]
      );

      if (!agendamento) {
        return res.status(404).json({ error: 'Agendamento não encontrado ou token inválido.' });
      }

      await query.run(
        'UPDATE agendamentos SET presenca_confirmada = 2 WHERE id = ?',
        [id]
      );

      // Dispara a mensagem de cancelamento via WhatsApp
      try {
        await WhatsAppService.sendReminder(
          agendamento.dono_whatsapp,
          agendamento.cliente_whatsapp,
          agendamento.cliente_nome,
          agendamento.servico_nome,
          agendamento.data_agendamento,
          agendamento.hora_inicio,
          null,
          'presence_cancelled'
        );
      } catch (whatsappErr: any) {
        console.error('[BookingController] Erro ao disparar WhatsApp de presença cancelada:', whatsappErr.message);
      }

      return res.json({ message: 'Agendamento cancelado com sucesso. O horário foi liberado.' });
    } catch (err: any) {
      console.error(err);
      return res.status(500).json({ error: 'Erro ao cancelar agendamento.' });
    }
  }

  /**
   * Cria um novo agendamento manualmente pelo administrador (com ou sem conflito de horário).
   */
  static async createManual(req: AuthenticatedRequest, res: Response) {
    const userId = req.userId;
    const { 
      servicoId, 
      clienteNome, 
      clienteWhatsapp, 
      dataAgendamento, 
      horaInicio, 
      funcionarioId, 
      metodoPagamento, 
      statusPagamento,
      forcarEncaixe 
    } = req.body;

    if (!servicoId || !clienteNome || !clienteWhatsapp || !dataAgendamento || !horaInicio) {
      return res.status(400).json({ error: 'Todos os campos obrigatórios devem ser preenedores.' });
    }

    if (!validateCelular(clienteWhatsapp)) {
      return res.status(400).json({ error: 'Número de celular inválido. Certifique-se de digitar o DDD, o dígito 9 e o restante do número.' });
    }

    const cleanWhatsapp = clienteWhatsapp.replace(/\D/g, '');

    try {
      let ids: number[] = [];
      if (Array.isArray(servicoId)) {
        ids = servicoId.map(Number);
      } else if (typeof servicoId === 'string') {
        ids = String(servicoId).split(',').map(Number);
      } else {
        ids = [Number(servicoId)];
      }

      // 1. Busca detalhes de todos os serviços selecionados e confere se pertencem ao profissional logado
      const servicePlaceholders = ids.map(() => '?').join(',');
      const servicos = await query.all<Servico>(
        `SELECT * FROM servicos WHERE id IN (${servicePlaceholders}) AND usuario_id = ?`,
        [...ids, userId]
      );

      if (servicos.length !== ids.length) {
        return res.status(404).json({ error: 'Um ou mais serviços não foram encontrados ou não pertencem a você.' });
      }

      const precoTotal = servicos.reduce((total, s) => total + Number(s.preco), 0);
      const duracaoTotal = servicos.reduce((total, s) => total + s.duracao_minutos, 0);
      const servicoNomes = servicos.map(s => s.nome).join(', ');

      // 1.1 Busca funcionários ativos que prestam todos os serviços selecionados
      const activeEmployees = await query.all<{ id: number }>(
        `SELECT f.id 
         FROM funcionarios f 
         WHERE f.usuario_id = ? AND f.ativo = 1
           AND (
             SELECT COUNT(DISTINCT fs.servico_id)
             FROM funcionario_servicos fs
             WHERE fs.funcionario_id = f.id AND fs.servico_id IN (${servicePlaceholders})
           ) = ?`,
         [userId, ...ids, ids.length]
      );
      const employeeIds = activeEmployees.map(e => e.id);

      // 1.2 Resolve qual funcionário executará o serviço
      let resolvedFuncId: number | null = null;
      let funcionarioEscolhido = 0;
      if (funcionarioId && !isNaN(Number(funcionarioId)) && employeeIds.length > 0) {
        resolvedFuncId = Number(funcionarioId);
        funcionarioEscolhido = 1;
        if (!employeeIds.includes(resolvedFuncId)) {
          return res.status(400).json({ error: 'O profissional selecionado não executa todos os serviços selecionados.' });
        }
      }

      // 2. Valida se o horário está livre (se não forçado)
      if (!forcarEncaixe) {
        const disponivel = await SchedulerService.isSlotAvailable(
          Number(userId),
          ids,
          dataAgendamento,
          horaInicio,
          resolvedFuncId
        );

        if (!disponivel) {
          return res.status(409).json({ error: 'Este horário já está ocupado ou fora do expediente. Deseja marcar como encaixe forçado?' });
        }
      }

      // 3. Calcula o horário de término
      const inicioMinutos = timeToMinutes(horaInicio);
      const fimMinutos = inicioMinutos + duracaoTotal;
      const horaFim = minutesToTime(fimMinutos);

      // 3.1 Calcula a comissão do funcionário se aplicável
      let comissao_valor = 0.00;
      if (resolvedFuncId !== null) {
        const links = await query.all<{ servico_id: number; comissao_percentual: number }>(
          `SELECT servico_id, comissao_percentual 
           FROM funcionario_servicos 
           WHERE funcionario_id = ? AND servico_id IN (${servicePlaceholders})`,
          [resolvedFuncId, ...ids]
        );
        for (const s of servicos) {
          const link = links.find(l => l.servico_id === s.id);
          if (link) {
            comissao_valor += parseFloat(((s.preco * link.comissao_percentual) / 100).toFixed(2));
          }
        }
        comissao_valor = parseFloat(comissao_valor.toFixed(2));
      }

      // 4. Cria ID único do checkout amigável
      const checkoutId = `manual_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const activeMetodoPagamento = metodoPagamento || 'presencial';
      const activeStatusPagamento = statusPagamento || 'pago';
      const restantePago = activeStatusPagamento === 'pago' ? 1 : 0;

      // 5. Salva o agendamento no banco
      await query.run(
        `INSERT INTO agendamentos (servico_id, cliente_nome, cliente_whatsapp, data_agendamento, hora_inicio, hora_fim, status_pagamento, checkout_id, metodo_pagamento, funcionario_id, comissao_valor, presenca_confirmada, restante_pago, servico_ids, servico_nomes, preco_total, duracao_total, funcionario_escolhido) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
        [
          ids[0], 
          clienteNome, 
          cleanWhatsapp, 
          dataAgendamento, 
          horaInicio, 
          horaFim, 
          activeStatusPagamento, 
          checkoutId, 
          activeMetodoPagamento,
          resolvedFuncId,
          comissao_valor,
          restantePago,
          ids.join(','),
          servicoNomes,
          precoTotal,
          duracaoTotal,
          funcionarioEscolhido
        ]
      );

      // Enviar notificação de WhatsApp para funcionário se designado
      if (resolvedFuncId !== null) {
        try {
          const owner = await query.get<{ whatsapp: string }>('SELECT whatsapp FROM usuarios WHERE id = ?', [userId]);
          const employee = await query.get<{ nome: string, whatsapp: string }>(
            'SELECT nome, whatsapp FROM funcionarios WHERE id = ?',
            [resolvedFuncId]
          );
          if (employee && employee.whatsapp) {
            await WhatsAppService.sendEmployeeNotification(
              owner?.whatsapp || '',
              employee.whatsapp,
              employee.nome,
              clienteNome,
              servicoNomes,
              dataAgendamento,
              horaInicio,
              'new_booking'
            );
          }
        } catch (notificationErr) {
          console.error('Erro ao enviar notificação de WhatsApp para funcionário (createManual):', notificationErr);
        }
      }

      // Notifica o cliente sobre o agendamento manual criado
      try {
        const owner = await query.get<{ whatsapp: string, nome: string, nome_estabelecimento: string }>('SELECT whatsapp, nome, nome_estabelecimento FROM usuarios WHERE id = ?', [userId]);
        const employeeName = (resolvedFuncId && funcionarioEscolhido === 1 && employeeIds.length > 0)
          ? (await query.get<{ nome: string }>('SELECT nome FROM funcionarios WHERE id = ?', [resolvedFuncId]))?.nome || null
          : null;
        
        await WhatsAppService.sendReminder(
          owner?.whatsapp || '',
          cleanWhatsapp,
          clienteNome,
          servicoNomes,
          dataAgendamento,
          horaInicio,
          employeeName,
          'booking_confirmed'
        );
      } catch (clientNotificationErr: any) {
        console.error('Erro ao enviar confirmação de WhatsApp para o cliente (createManual):', clientNotificationErr.message);
      }

      return res.status(201).json({
        message: 'Agendamento manual criado com sucesso!',
        checkoutId,
        preco: precoTotal,
        clienteNome,
        clienteWhatsapp: cleanWhatsapp,
        dataAgendamento,
        horaInicio,
        horaFim,
        metodoPagamento: activeMetodoPagamento,
        statusPagamento: activeStatusPagamento,
        funcionario_id: resolvedFuncId,
        comissao_valor
      });

    } catch (err: any) {
      console.error(err);
      return res.status(500).json({ error: 'Erro ao criar agendamento manual.' });
    }
  }

  /**
   * Lista todos os agendamentos do profissional com filtros opcionais de busca e status.
   */
  static async listAll(req: AuthenticatedRequest, res: Response) {
    const userId = req.userId;
    const { status, query: searchQuery, limit, offset } = req.query;

    try {
      let sql = `
        SELECT a.id, a.cliente_nome, a.cliente_whatsapp, a.data_agendamento, a.hora_inicio, a.hora_fim, 
               a.status_pagamento, a.metodo_pagamento, a.presenca_confirmada, a.checkout_id,
               a.sinal_valor, a.restante_pago,
               COALESCE(a.servico_nomes, s.nome) as servico_nome, COALESCE(a.preco_total, s.preco) as preco, f.nome as funcionario_nome, s.usuario_id as profissional_id, s.cor as servico_cor
        FROM agendamentos a
        JOIN servicos s ON a.servico_id = s.id
        LEFT JOIN funcionarios f ON a.funcionario_id = f.id
        WHERE s.usuario_id = ?
      `;
      const params: any[] = [userId];

      if (status) {
        if (status === 'confirmado') {
          sql += ' AND (a.status_pagamento = \'pago\' OR a.metodo_pagamento = \'presencial\') AND a.presenca_confirmada = 1';
        } else if (status === 'pendente') {
          sql += ' AND a.status_pagamento = \'pendente\' AND a.metodo_pagamento = \'pix\' AND a.presenca_confirmada = 0';
        } else if (status === 'cancelado') {
          sql += ' AND a.presenca_confirmada = 2';
        }
      }

      if (searchQuery) {
        sql += ' AND (a.cliente_nome LIKE ? OR a.cliente_whatsapp LIKE ?)';
        params.push(`%${searchQuery}%`, `%${searchQuery}%`);
      }

      sql += ' ORDER BY a.data_agendamento ASC, a.hora_inicio ASC';

      if (limit) {
        sql += ' LIMIT ?';
        params.push(Number(limit));
        if (offset) {
          sql += ' OFFSET ?';
          params.push(Number(offset));
        }
      }

      const bookings = await query.all(sql, params);
      return res.json(bookings);
    } catch (err: any) {
      console.error(err);
      return res.status(500).json({ error: 'Erro ao listar agendamentos.' });
    }
  }

  /**
   * Cancela um agendamento pelo administrador.
   */
  static async cancel(req: AuthenticatedRequest, res: Response) {
    const { id } = req.params;
    const userId = req.userId;

    try {
      // 1. Busca o agendamento e confere se pertence ao profissional logado
      const booking = await query.get<any>(
        `SELECT a.id, a.cliente_nome, a.data_agendamento, a.hora_inicio, a.funcionario_id,
                COALESCE(a.servico_nomes, s.nome) as servico_nome,
                u.whatsapp as profissional_whatsapp,
                f.nome as funcionario_nome, f.whatsapp as funcionario_whatsapp
         FROM agendamentos a
         JOIN servicos s ON a.servico_id = s.id
         JOIN usuarios u ON s.usuario_id = u.id
         LEFT JOIN funcionarios f ON a.funcionario_id = f.id
         WHERE a.id = ? AND s.usuario_id = ?`,
        [id, userId]
      );

      if (!booking) {
        return res.status(404).json({ error: 'Agendamento não encontrado ou não pertence a você.' });
      }

      // 2. Executa a atualização
      await query.run(
        `UPDATE agendamentos 
         SET presenca_confirmada = 2 
         WHERE id = ?`,
        [id]
      );

      // Enviar notificação de cancelamento para funcionário se designado
      if (booking.funcionario_id && booking.funcionario_whatsapp) {
        try {
          await WhatsAppService.sendEmployeeNotification(
            booking.profissional_whatsapp || '',
            booking.funcionario_whatsapp,
            booking.funcionario_nome || '',
            booking.cliente_nome,
            booking.servico_nome || '',
            booking.data_agendamento,
            booking.hora_inicio,
            'cancelled'
          );
        } catch (notificationErr) {
          console.error('Erro ao enviar notificação de WhatsApp para funcionário (cancel):', notificationErr);
        }
      }

      return res.json({ message: 'Agendamento cancelado com sucesso!' });
    } catch (err: any) {
      console.error(err);
      return res.status(500).json({ error: 'Erro ao cancelar agendamento.' });
    }
  }

  /**
   * Confirma o pagamento de um agendamento pelo administrador (para pagamentos no local).
   */
  static async confirmPaymentAdmin(req: AuthenticatedRequest, res: Response) {
    const { id } = req.params;
    const userId = req.userId;

    try {
      // 1. Busca o agendamento e confere se pertence ao profissional logado
      const booking = await query.get<any>(
        `SELECT a.id, a.status_pagamento, a.sinal_valor, a.cliente_nome, a.cliente_whatsapp, a.data_agendamento, a.hora_inicio, a.funcionario_id, a.funcionario_escolhido,
                COALESCE(a.servico_nomes, s.nome) as servico_nome,
                u.whatsapp as profissional_whatsapp,
                f.nome as funcionario_nome,
                (SELECT COUNT(*) FROM funcionarios WHERE usuario_id = u.id AND ativo = 1) as has_employees
         FROM agendamentos a
         JOIN servicos s ON a.servico_id = s.id
         JOIN usuarios u ON s.usuario_id = u.id
         LEFT JOIN funcionarios f ON a.funcionario_id = f.id
         WHERE a.id = ? AND s.usuario_id = ?`,
        [id, userId]
      );

      if (!booking) {
        return res.status(404).json({ error: 'Agendamento não encontrado ou não pertence a você.' });
      }

      // Se o agendamento já estava pago (porque o sinal foi pago via Pix),
      // marcar restante como pago. Caso contrário, marca tudo como pago.
      if (booking.status_pagamento === 'pago') {
        await query.run(
          `UPDATE agendamentos 
           SET restante_pago = 1 
           WHERE id = ?`,
          [id]
        );
      } else {
        await query.run(
          `UPDATE agendamentos 
           SET status_pagamento = 'pago', restante_pago = 1 
           WHERE id = ?`,
          [id]
        );
      }

      // Notifica o cliente sobre o pagamento confirmado pelo administrador
      try {
        const profName = (booking.funcionario_id && booking.funcionario_escolhido === 1 && booking.has_employees > 0)
          ? booking.funcionario_nome
          : null;
        await WhatsAppService.sendReminder(
          booking.profissional_whatsapp,
          booking.cliente_whatsapp,
          booking.cliente_nome,
          booking.servico_nome,
          booking.data_agendamento,
          booking.hora_inicio,
          profName,
          'payment_confirmed'
        );
      } catch (whatsappErr: any) {
        console.error('[BookingController] Erro ao disparar WhatsApp de pagamento confirmado (admin) para o cliente:', whatsappErr.message);
      }

      return res.json({ message: 'Pagamento confirmado com sucesso!' });
    } catch (err: any) {
      console.error(err);
      return res.status(500).json({ error: 'Erro ao confirmar pagamento.' });
    }
  }

  static async updatePresenceAdmin(req: AuthenticatedRequest, res: Response) {
    const { id } = req.params;
    const { status } = req.body; // 0 = pendente, 1 = confirmado, 2 = cancelado
    const userId = req.userId;

    if (status === undefined || ![0, 1, 2].includes(Number(status))) {
      return res.status(400).json({ error: 'Status de presença inválido.' });
    }

    try {
      // 1. Busca o agendamento e confere se pertence ao profissional logado
      const booking = await query.get<any>(
        `SELECT a.id, a.cliente_nome, a.cliente_whatsapp, a.data_agendamento, a.hora_inicio, a.funcionario_id, a.funcionario_escolhido,
                COALESCE(a.servico_nomes, s.nome) as servico_nome,
                u.whatsapp as profissional_whatsapp,
                f.nome as funcionario_nome,
                (SELECT COUNT(*) FROM funcionarios WHERE usuario_id = u.id AND ativo = 1) as has_employees
         FROM agendamentos a
         JOIN servicos s ON a.servico_id = s.id
         JOIN usuarios u ON s.usuario_id = u.id
         LEFT JOIN funcionarios f ON a.funcionario_id = f.id
         WHERE a.id = ? AND s.usuario_id = ?`,
        [id, userId]
      );

      if (!booking) {
        return res.status(404).json({ error: 'Agendamento não encontrado ou não pertence a esta conta.' });
      }

      // 2. Atualiza a presença no banco de dados
      await query.run(
        'UPDATE agendamentos SET presenca_confirmada = ? WHERE id = ?',
        [status, id]
      );

      // 3. Dispara mensagem de WhatsApp correspondente
      try {
        const profName = (booking.funcionario_id && booking.funcionario_escolhido === 1 && booking.has_employees > 0)
          ? booking.funcionario_nome
          : null;
        
        const notificationType = status === 1 
          ? 'presence_confirmed' 
          : status === 2 
            ? 'presence_cancelled' 
            : null;

        if (notificationType) {
          await WhatsAppService.sendReminder(
            booking.profissional_whatsapp,
            booking.cliente_whatsapp,
            booking.cliente_nome,
            booking.servico_nome,
            booking.data_agendamento,
            booking.hora_inicio,
            profName,
            notificationType
          );
        }
      } catch (whatsappErr: any) {
        console.error('[BookingController] Erro ao disparar WhatsApp de presença (admin):', whatsappErr.message);
      }

      return res.json({ message: 'Status de presença atualizado com sucesso!' });
    } catch (err: any) {
      console.error(err);
      return res.status(500).json({ error: 'Erro ao atualizar presença.' });
    }
  }

  static async mercadopagoBookingWebhook(req: Request, res: Response) {
    console.log('[MercadoPago Booking Webhook] Recebida notificação:', JSON.stringify(req.body), JSON.stringify(req.query));

    const paymentId = req.body.data?.id || req.body.id || req.query.id;
    const topic = req.body.type || req.body.action || req.query.topic;

    if (!paymentId) {
      return res.status(200).send('OK');
    }

    if (topic && topic !== 'payment' && !topic.startsWith('payment.')) {
      return res.status(200).send('OK');
    }

    const { checkoutId, userId } = req.query;
    if (!checkoutId || !userId) {
      console.error('[MercadoPago Booking Webhook] Ausência de checkoutId ou userId nos query params.');
      return res.status(400).send('Parâmetros obrigatórios ausentes.');
    }

    try {
      const prof = await query.get<{ mp_access_token: string, mp_status_conexao: number }>(
        'SELECT mp_access_token, mp_status_conexao FROM usuarios WHERE id = ?',
        [Number(userId)]
      );

      if (!prof || prof.mp_status_conexao !== 1 || !prof.mp_access_token) {
        console.error(`[MercadoPago Booking Webhook] Profissional ID ${userId} não possui Mercado Pago conectado.`);
        return res.status(400).send('Profissional não possui Mercado Pago conectado.');
      }

      const booking = await query.get<any>(
        `SELECT a.id, a.status_pagamento, a.cliente_nome, a.cliente_whatsapp, a.data_agendamento, a.hora_inicio, a.funcionario_id, a.funcionario_escolhido,
                COALESCE(a.servico_nomes, s.nome) as servico_name,
                u.whatsapp as profissional_whatsapp,
                f.nome as funcionario_nome, f.whatsapp as funcionario_whatsapp,
                (SELECT COUNT(*) FROM funcionarios WHERE usuario_id = u.id AND ativo = 1) as has_employees
         FROM agendamentos a
         JOIN servicos s ON a.servico_id = s.id
         JOIN usuarios u ON s.usuario_id = u.id
         LEFT JOIN funcionarios f ON a.funcionario_id = f.id
         WHERE a.checkout_id = ?`,
        [String(checkoutId)]
      );

      if (!booking) {
        console.error(`[MercadoPago Booking Webhook] Agendamento com checkout_id ${checkoutId} não localizado.`);
        return res.status(404).send('Agendamento não encontrado.');
      }

      if (booking.status_pagamento === 'pago') {
        return res.status(200).send('OK');
      }

      const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: {
          'Authorization': `Bearer ${prof.mp_access_token}`
        }
      });

      if (!mpResponse.ok) {
        console.error(`[MercadoPago Booking Webhook] Erro ao consultar pagamento ${paymentId}: ${mpResponse.statusText}`);
        return res.status(mpResponse.status).send('Erro ao consultar Mercado Pago.');
      }

      const payment = await mpResponse.json() as any;

      if (payment.status !== 'approved') {
        console.log(`[MercadoPago Booking Webhook] Pagamento ${paymentId} está com status '${payment.status}'. Ignorando.`);
        return res.status(200).send('OK');
      }

      await query.run(
        "UPDATE agendamentos SET status_pagamento = 'pago' WHERE id = ?",
        [booking.id]
      );

      console.log(`[MercadoPago Booking Webhook] Agendamento ID ${booking.id} confirmado automaticamente via Pix!`);

      try {
        const profName = (booking.funcionario_id && booking.funcionario_escolhido === 1 && booking.has_employees > 0)
          ? booking.funcionario_nome
          : null;
        await WhatsAppService.sendReminder(
          booking.profissional_whatsapp,
          booking.cliente_whatsapp,
          booking.cliente_nome,
          booking.servico_name,
          booking.data_agendamento,
          booking.hora_inicio,
          profName,
          'payment_confirmed'
        );
      } catch (wppErr: any) {
        console.error('[MercadoPago Booking Webhook] Erro ao enviar WhatsApp de pagamento confirmado:', wppErr.message);
      }

      if (booking.funcionario_id && booking.funcionario_whatsapp) {
        try {
          await WhatsAppService.sendEmployeeNotification(
            booking.profissional_whatsapp || '',
            booking.funcionario_whatsapp,
            booking.funcionario_nome || '',
            booking.cliente_nome,
            booking.servico_name || '',
            booking.data_agendamento,
            booking.hora_inicio,
            'new_booking'
          );
        } catch (notificationErr) {
          console.error('[MercadoPago Booking Webhook] Erro ao enviar notificação de WhatsApp para funcionário:', notificationErr);
        }
      }

      return res.status(200).send('OK');
    } catch (err) {
      console.error('[MercadoPago Booking Webhook] Erro crítico ao processar webhook:', err);
      return res.status(500).send('Erro interno.');
    }
  }
}

