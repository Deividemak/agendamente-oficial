import { Response } from 'express';
import { query } from '../config/database';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { Funcionario } from '../models/types';
import { validateCelular } from '../utils/validation';

function calculatePeriodDates(periodo: string, dataInicio?: string, dataFim?: string): { start: string; end: string } {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-indexed

  let start = '';
  let end = '';

  if (periodo === 'este_mes') {
    const startDateObj = new Date(year, month, 1);
    const endDateObj = new Date(year, month + 1, 0);
    start = `${startDateObj.getFullYear()}-${String(startDateObj.getMonth() + 1).padStart(2, '0')}-${String(startDateObj.getDate()).padStart(2, '0')}`;
    end = `${endDateObj.getFullYear()}-${String(endDateObj.getMonth() + 1).padStart(2, '0')}-${String(endDateObj.getDate()).padStart(2, '0')}`;
  } else if (periodo === 'mes_passado') {
    const startDateObj = new Date(year, month - 1, 1);
    const endDateObj = new Date(year, month, 0);
    start = `${startDateObj.getFullYear()}-${String(startDateObj.getMonth() + 1).padStart(2, '0')}-${String(startDateObj.getDate()).padStart(2, '0')}`;
    end = `${endDateObj.getFullYear()}-${String(endDateObj.getMonth() + 1).padStart(2, '0')}-${String(endDateObj.getDate()).padStart(2, '0')}`;
  } else if (periodo === 'ultimos_3_meses') {
    const startDateObj = new Date(year, month - 3, 1);
    start = `${startDateObj.getFullYear()}-${String(startDateObj.getMonth() + 1).padStart(2, '0')}-${String(startDateObj.getDate()).padStart(2, '0')}`;
    end = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  } else if (periodo === 'ultimos_6_meses') {
    const startDateObj = new Date(year, month - 6, 1);
    start = `${startDateObj.getFullYear()}-${String(startDateObj.getMonth() + 1).padStart(2, '0')}-${String(startDateObj.getDate()).padStart(2, '0')}`;
    end = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  } else if (periodo === 'personalizado' && dataInicio && dataFim) {
    start = dataInicio;
    end = dataFim;
  }

  return { start, end };
}

export class EmployeeController {
  /**
   * Lista todos os funcionários ativos com seus serviços e comissões associadas.
   */
  static async list(req: AuthenticatedRequest, res: Response) {
    const userId = req.userId;

    try {
      const employees = await query.all<Funcionario>(
        'SELECT * FROM funcionarios WHERE usuario_id = ? AND ativo = 1 ORDER BY nome ASC',
        [userId]
      );

      const associations = await query.all<{
        funcionario_id: number;
        servico_id: number;
        comissao_percentual: number;
        servico_nome: string;
      }>(
        `SELECT fs.funcionario_id, fs.servico_id, fs.comissao_percentual, s.nome as servico_nome 
         FROM funcionario_servicos fs 
         JOIN servicos s ON fs.servico_id = s.id 
         JOIN funcionarios f ON fs.funcionario_id = f.id 
         WHERE f.usuario_id = ? AND f.ativo = 1`,
        [userId]
      );

      // Agrupa associações por ID do funcionário
      const mappedEmployees = employees.map((emp) => {
        const empServicos = associations
          .filter((a) => a.funcionario_id === emp.id)
          .map((a) => ({
            servico_id: a.servico_id,
            servico_nome: a.servico_nome,
            comissao_percentual: parseFloat(a.comissao_percentual as any)
          }));

        return {
          ...emp,
          servicos: empServicos
        };
      });

      return res.json(mappedEmployees);
    } catch (err: any) {
      console.error(err);
      return res.status(500).json({ error: 'Erro ao listar funcionários.' });
    }
  }

  /**
   * Cria ou edita um funcionário e associa seus serviços.
   */
  static async create(req: AuthenticatedRequest, res: Response) {
    const userId = req.userId;
    const { id, nome, whatsapp, servicos } = req.body;

    if (!nome || !whatsapp) {
      return res.status(400).json({ error: 'Nome e WhatsApp são obrigatórios.' });
    }

    if (!validateCelular(whatsapp)) {
      return res.status(400).json({ error: 'Número de celular do funcionário inválido. Certifique-se de digitar o DDD, o dígito 9 e o restante do número (ex: 11999998888).' });
    }

    const cleanWhatsapp = whatsapp.replace(/\D/g, '');

    try {
      let employeeId = id;

      if (id) {
        // Modo Edição: verifica se pertence ao usuário
        const existing = await query.get(
          'SELECT id FROM funcionarios WHERE id = ? AND usuario_id = ? AND ativo = 1',
          [id, userId]
        );
        if (!existing) {
          return res.status(404).json({ error: 'Funcionário não encontrado.' });
        }

        await query.run(
          'UPDATE funcionarios SET nome = ?, whatsapp = ? WHERE id = ?',
          [nome, cleanWhatsapp, id]
        );

        // Limpa associações antigas
        await query.run('DELETE FROM funcionario_servicos WHERE funcionario_id = ?', [id]);
      } else {
        // Modo Criação
        const result = await query.run(
          'INSERT INTO funcionarios (usuario_id, nome, whatsapp, ativo) VALUES (?, ?, ?, 1)',
          [userId, nome, cleanWhatsapp]
        );
        employeeId = result.lastID;
      }

      // Adiciona novas associações de serviços se houver
      if (servicos && Array.isArray(servicos)) {
        for (const item of servicos) {
          const { servico_id, comissao_percentual } = item;
          // Valida se o serviço pertence ao usuário logado
          const servicoValido = await query.get(
            'SELECT id FROM servicos WHERE id = ? AND usuario_id = ?',
            [servico_id, userId]
          );

          if (servicoValido) {
            await query.run(
              'INSERT INTO funcionario_servicos (funcionario_id, servico_id, comissao_percentual) VALUES (?, ?, ?)',
              [employeeId, servico_id, Number(comissao_percentual || 0)]
            );
          }
        }
      }

      return res.status(id ? 200 : 201).json({
        id: employeeId,
        nome,
        whatsapp,
        message: id ? 'Funcionário atualizado com sucesso!' : 'Funcionário criado com sucesso!'
      });
    } catch (err: any) {
      console.error(err);
      return res.status(500).json({ error: 'Erro ao salvar funcionário.' });
    }
  }

  /**
   * Soft delete de funcionário (marca como ativo = 0).
   */
  static async delete(req: AuthenticatedRequest, res: Response) {
    const userId = req.userId;
    const { id } = req.params;

    try {
      const existing = await query.get(
        'SELECT id FROM funcionarios WHERE id = ? AND usuario_id = ?',
        [id, userId]
      );

      if (!existing) {
        return res.status(404).json({ error: 'Funcionário não encontrado ou não pertence a você.' });
      }

      // Soft delete para manter o histórico de comissões íntegro
      await query.run('UPDATE funcionarios SET ativo = 0 WHERE id = ?', [id]);
      return res.json({ message: 'Funcionário desativado com sucesso!' });
    } catch (err: any) {
      console.error(err);
      return res.status(500).json({ error: 'Erro ao desativar funcionário.' });
    }
  }

  /**
   * Retorna o relatório de comissões acumuladas e o histórico de serviços.
   */
  static async getCommissions(req: AuthenticatedRequest, res: Response) {
    const userId = req.userId;
    const { periodo, dataInicio, dataFim } = req.query;

    try {
      // Calcular datas de início e fim baseadas no período escolhido
      const { start, end } = calculatePeriodDates(periodo as string, dataInicio as string, dataFim as string);
      let dateFilter = '';

      if (start && end) {
        dateFilter = ' AND a.data_agendamento >= ? AND a.data_agendamento <= ?';
      }

      // 1. Resumo por funcionário
      const paramsSummary: any[] = [];
      if (start && end) {
        paramsSummary.push(start, end);
      }
      paramsSummary.push(userId);

      const summary = await query.all<{
        funcionario_id: number;
        funcionario_nome: string;
        funcionario_whatsapp: string;
        total_servicos: number;
        receita_total: number;
        comissao_paga: number;
        comissao_pendente: number;
        comissao_total: number;
      }>(
        `SELECT 
          f.id as funcionario_id,
          f.nome as funcionario_nome,
          f.whatsapp as funcionario_whatsapp,
          COUNT(a.id) as total_servicos,
          COALESCE(SUM(s.preco), 0) as receita_total,
          COALESCE(SUM(CASE WHEN a.comissao_paga = 1 THEN a.comissao_valor ELSE 0.00 END), 0.00) as comissao_paga,
          COALESCE(SUM(CASE WHEN a.comissao_paga = 0 OR a.comissao_paga IS NULL THEN a.comissao_valor ELSE 0.00 END), 0.00) as comissao_pendente,
          COALESCE(SUM(a.comissao_valor), 0.00) as comissao_total
        FROM funcionarios f
        LEFT JOIN agendamentos a ON a.funcionario_id = f.id 
          AND (a.status_pagamento = 'pago' OR a.metodo_pagamento = 'presencial')
          ${dateFilter}
        LEFT JOIN servicos s ON a.servico_id = s.id
        WHERE f.usuario_id = ? AND f.ativo = 1
        GROUP BY f.id, f.nome, f.whatsapp
        ORDER BY f.nome ASC`,
        paramsSummary
      );

      // 2. Histórico detalhado de agendamentos realizados com profissional
      const paramsHistory: any[] = [userId];
      if (start && end) {
        paramsHistory.push(start, end);
      }

      const history = await query.all<{
        agendamento_id: number;
        cliente_nome: string;
        cliente_whatsapp: string;
        data_agendamento: string;
        hora_inicio: string;
        servico_nome: string;
        servico_preco: number;
        comissao_valor: number;
        comissao_paga: number;
        funcionario_id: number;
        funcionario_nome: string;
      }>(
        `SELECT 
          a.id as agendamento_id,
          a.cliente_nome,
          a.cliente_whatsapp,
          a.data_agendamento,
          a.hora_inicio,
          s.nome as servico_nome,
          s.preco as servico_preco,
          a.comissao_valor,
          COALESCE(a.comissao_paga, 0) as comissao_paga,
          f.id as funcionario_id,
          f.nome as funcionario_nome
        FROM agendamentos a
        JOIN servicos s ON a.servico_id = s.id
        JOIN funcionarios f ON a.funcionario_id = f.id
        WHERE f.usuario_id = ? AND f.ativo = 1 
          AND (a.status_pagamento = 'pago' OR a.metodo_pagamento = 'presencial')
          ${dateFilter}
        ORDER BY a.data_agendamento DESC, a.hora_inicio DESC`,
        paramsHistory
      );

      return res.json({
        summary,
        history
      });
    } catch (err: any) {
      console.error(err);
      return res.status(500).json({ error: 'Erro ao buscar relatório de comissões.' });
    }
  }

  /**
   * Alterna o status de pagamento de uma comissão de agendamento (pago / pendente).
   */
  static async toggleCommissionPayment(req: AuthenticatedRequest, res: Response) {
    const userId = req.userId;
    const { id } = req.params;

    try {
      // 1. Verifica se o agendamento e o funcionário associado pertencem ao usuário logado
      const booking = await query.get<{ id: number; comissao_paga: number }>(
        `SELECT a.id, a.comissao_paga 
         FROM agendamentos a
         JOIN funcionarios f ON a.funcionario_id = f.id
         WHERE a.id = ? AND f.usuario_id = ?`,
        [id, userId]
      );

      if (!booking) {
        return res.status(404).json({ error: 'Comissão não encontrada ou não pertence a você.' });
      }

      const novoStatus = booking.comissao_paga === 1 ? 0 : 1;

      await query.run(
        'UPDATE agendamentos SET comissao_paga = ? WHERE id = ?',
        [novoStatus, id]
      );

      return res.json({ 
        message: novoStatus === 1 ? 'Comissão marcada como paga!' : 'Comissão marcada como pendente!',
        comissao_paga: novoStatus
      });
    } catch (err: any) {
      console.error(err);
      return res.status(500).json({ error: 'Erro ao alterar status de pagamento da comissão.' });
    }
  }

  /**
   * Marca todas as comissões pendentes de um funcionário no período como pagas.
   */
  static async payAllCommissions(req: AuthenticatedRequest, res: Response) {
    const userId = req.userId;
    const { id } = req.params; // ID do funcionário
    const { periodo, dataInicio, dataFim } = req.body;

    try {
      // 1. Verifica se o funcionário pertence ao usuário logado
      const employee = await query.get<{ id: number; nome: string }>(
        'SELECT id, nome FROM funcionarios WHERE id = ? AND usuario_id = ? AND ativo = 1',
        [id, userId]
      );

      if (!employee) {
        return res.status(404).json({ error: 'Funcionário não encontrado ou não pertence a você.' });
      }

      // 2. Calcula as datas baseadas no período
      const { start, end } = calculatePeriodDates(periodo, dataInicio, dataFim);

      let sql = `
        UPDATE agendamentos 
        SET comissao_paga = 1 
        WHERE funcionario_id = ? 
          AND (status_pagamento = 'pago' OR metodo_pagamento = 'presencial')
          AND (comissao_paga = 0 OR comissao_paga IS NULL)
      `;
      const params = [id];

      if (start && end) {
        sql += ' AND data_agendamento >= ? AND data_agendamento <= ?';
        params.push(start, end);
      }

      const result = await query.run(sql, params);

      return res.json({
        message: `Sucesso! ${result.changes} comissões de ${employee.nome} foram marcadas como pagas no período selecionado.`,
        changes: result.changes
      });
    } catch (err: any) {
      console.error(err);
      return res.status(500).json({ error: 'Erro ao pagar comissões em lote.' });
    }
  }
}
