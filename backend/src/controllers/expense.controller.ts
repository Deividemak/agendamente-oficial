import { Response } from 'express';
import { query } from '../config/database';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { Despesa } from '../models/types';

export class ExpenseController {
  static async list(req: AuthenticatedRequest, res: Response) {
    const userId = req.userId;

    try {
      const expenses = await query.all<Despesa>(
        'SELECT * FROM despesas WHERE usuario_id = ? ORDER BY data_despesa DESC, criado_em DESC',
        [userId]
      );
      return res.json(expenses);
    } catch (err: any) {
      console.error(err);
      return res.status(500).json({ error: 'Erro ao listar despesas.' });
    }
  }

  static async create(req: AuthenticatedRequest, res: Response) {
    const userId = req.userId;
    const { descricao, valor, data_despesa } = req.body;

    if (!descricao || valor === undefined || !data_despesa) {
      return res.status(400).json({ error: 'Descrição, valor e data da despesa são obrigatórios.' });
    }

    if (valor <= 0) {
      return res.status(400).json({ error: 'O valor da despesa deve ser maior que zero.' });
    }

    try {
      const result = await query.run(
        'INSERT INTO despesas (usuario_id, descricao, valor, data_despesa) VALUES (?, ?, ?, ?)',
        [userId, descricao, valor, data_despesa]
      );

      return res.status(201).json({
        id: result.lastID,
        usuario_id: userId,
        descricao,
        valor,
        data_despesa
      });
    } catch (err: any) {
      console.error(err);
      return res.status(500).json({ error: 'Erro ao criar despesa.' });
    }
  }

  static async delete(req: AuthenticatedRequest, res: Response) {
    const userId = req.userId;
    const { id } = req.params;

    try {
      // Verifica se a despesa pertence ao usuário
      const expense = await query.get(
        'SELECT id FROM despesas WHERE id = ? AND usuario_id = ?',
        [id, userId]
      );

      if (!expense) {
        return res.status(404).json({ error: 'Despesa não encontrada ou não pertence a você.' });
      }

      await query.run('DELETE FROM despesas WHERE id = ?', [id]);
      return res.json({ message: 'Despesa excluída com sucesso!' });
    } catch (err: any) {
      console.error(err);
      return res.status(500).json({ error: 'Erro ao excluir despesa.' });
    }
  }
}
