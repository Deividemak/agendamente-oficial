import { Request, Response } from 'express';
import { query } from '../config/database';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';

export class ClientController {
  /**
   * Lista todos os clientes únicos que fizeram agendamentos com o profissional logado.
   */
  static async list(req: AuthenticatedRequest, res: Response) {
    const userId = req.userId;

    try {
      // Agrupa pelo WhatsApp do cliente para consolidar registros repetidos.
      // O nome é selecionado como o MAX(cliente_nome) para obter o mais atual/completo.
      // O total gasto soma o valor dos serviços que foram pagos ou agendados presencialmente.
      const clients = await query.all<{
        cliente_nome: string;
        cliente_whatsapp: string;
        total_agendamentos: number;
        total_gasto: number;
        ultimo_agendamento: string;
        isento_sinal: number;
      }>(
        `SELECT 
          MAX(a.cliente_nome) as cliente_nome, 
          a.cliente_whatsapp, 
          COUNT(a.id) as total_agendamentos, 
          SUM(
            CASE 
              WHEN a.status_pagamento = 'pago' THEN 
                CASE 
                  WHEN a.sinal_valor > 0 THEN 
                    CASE WHEN a.restante_pago = 1 THEN COALESCE(a.preco_total, s.preco) ELSE a.sinal_valor END
                  ELSE COALESCE(a.preco_total, s.preco)
                END
              ELSE 0.00
            END
          ) as total_gasto,
          MAX(a.data_agendamento) as ultimo_agendamento,
          COALESCE(ci.isento_sinal, 0) as isento_sinal
        FROM agendamentos a
        JOIN servicos s ON a.servico_id = s.id
        LEFT JOIN clientes_isentos ci ON ci.usuario_id = s.usuario_id AND ci.cliente_whatsapp = a.cliente_whatsapp
        WHERE s.usuario_id = ?
        GROUP BY a.cliente_whatsapp
        ORDER BY total_agendamentos DESC, ultimo_agendamento DESC`,
        [userId]
      );

      return res.json(clients);
    } catch (err: any) {
      console.error('Erro ao listar clientes:', err);
      return res.status(500).json({ error: 'Erro ao obter lista de clientes.' });
    }
  }

  /**
   * Obtém todo o histórico de atendimentos realizados por um cliente específico.
   */
  static async getHistory(req: AuthenticatedRequest, res: Response) {
    const userId = req.userId;
    const { whatsapp } = req.query;

    if (!whatsapp) {
      return res.status(400).json({ error: 'Número de WhatsApp do cliente é obrigatório.' });
    }

    try {
      const history = await query.all<{
        id: number;
        data_agendamento: string;
        hora_inicio: string;
        status_pagamento: string;
        presenca_confirmada: number;
        servico_nome: string;
        preco: number;
        funcionario_nome: string;
      }>(
        `SELECT 
          a.id, 
          a.data_agendamento, 
          a.hora_inicio, 
          a.status_pagamento, 
          a.presenca_confirmada,
          a.sinal_valor,
          a.restante_pago,
          COALESCE(a.servico_nomes, s.nome) as servico_nome, 
          COALESCE(a.preco_total, s.preco) as preco,
          COALESCE(f.nome, 'Titular') as funcionario_nome
        FROM agendamentos a
        JOIN servicos s ON a.servico_id = s.id
        LEFT JOIN funcionarios f ON a.funcionario_id = f.id
        WHERE s.usuario_id = ? AND a.cliente_whatsapp = ?
        ORDER BY a.data_agendamento DESC, a.hora_inicio DESC`,
        [userId, whatsapp]
      );

      return res.json(history);
    } catch (err: any) {
      console.error('Erro ao buscar histórico do cliente:', err);
      return res.status(500).json({ error: 'Erro ao obter histórico do cliente.' });
    }
  }

  /**
   * Alterna o status de isenção de sinal do cliente.
   */
  static async toggleExemption(req: AuthenticatedRequest, res: Response) {
    const userId = req.userId;
    const { whatsapp, isento } = req.body;

    if (!whatsapp) {
      return res.status(400).json({ error: 'WhatsApp do cliente é obrigatório.' });
    }

    try {
      const isentoVal = isento ? 1 : 0;
      
      const existing = await query.get(
        'SELECT id FROM clientes_isentos WHERE usuario_id = ? AND cliente_whatsapp = ?',
        [userId, whatsapp]
      );

      if (existing) {
        await query.run(
          'UPDATE clientes_isentos SET isento_sinal = ? WHERE id = ?',
          [isentoVal, existing.id]
        );
      } else {
        await query.run(
          'INSERT INTO clientes_isentos (usuario_id, cliente_whatsapp, isento_sinal) VALUES (?, ?, ?)',
          [userId, whatsapp, isentoVal]
        );
      }

      return res.json({ message: 'Status de isenção atualizado com sucesso!', isento: isentoVal });
    } catch (err: any) {
      console.error('Erro ao alternar isenção do cliente:', err);
      return res.status(500).json({ error: 'Erro ao alternar status de isenção.' });
    }
  }

  /**
   * Verifica publicamente se um cliente é isento de sinal para determinado profissional.
   */
  static async checkExemptionPublic(req: Request, res: Response) {
    const { usuarioId, whatsapp } = req.query;

    if (!usuarioId || !whatsapp) {
      return res.status(400).json({ error: 'ID do profissional e WhatsApp do cliente são obrigatórios.' });
    }

    try {
      const record = await query.get(
        'SELECT isento_sinal FROM clientes_isentos WHERE usuario_id = ? AND cliente_whatsapp = ?',
        [usuarioId, whatsapp]
      );

      const isento = record ? record.isento_sinal === 1 : false;
      return res.json({ isento });
    } catch (err: any) {
      console.error('Erro ao verificar isenção do cliente:', err);
      return res.status(500).json({ error: 'Erro ao verificar status de isenção.' });
    }
  }
}
