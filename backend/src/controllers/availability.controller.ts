import { Request, Response } from 'express';
import { query } from '../config/database';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { Disponibilidade } from '../models/types';

export class AvailabilityController {
  static async get(req: AuthenticatedRequest, res: Response) {
    const userId = req.userId;

    try {
      const disponibilidades = await query.all<Disponibilidade>(
        'SELECT * FROM disponibilidades WHERE usuario_id = ? ORDER BY dia_semana ASC, hora_inicio ASC',
        [userId]
      );
      return res.json(disponibilidades);
    } catch (err: any) {
      console.error(err);
      return res.status(500).json({ error: 'Erro ao obter disponibilidade.' });
    }
  }

  static async save(req: AuthenticatedRequest, res: Response) {
    const userId = req.userId;
    const { disponibilidades } = req.body; // Espera um array de { dia_semana, hora_inicio, hora_fim }

    if (!Array.isArray(disponibilidades)) {
      return res.status(400).json({ error: 'disponibilidades deve ser um array.' });
    }

    // Validação básica dos dados recebidos
    for (const item of disponibilidades) {
      const { dia_semana, hora_inicio, hora_fim } = item;
      if (
        dia_semana === undefined ||
        dia_semana < 0 ||
        dia_semana > 6 ||
        !hora_inicio ||
        !hora_fim
      ) {
        return res.status(400).json({
          error: 'Campos dia_semana (0-6), hora_inicio (HH:MM) e hora_fim (HH:MM) são obrigatórios e devem ser válidos.'
        });
      }

      if (hora_inicio >= hora_fim) {
        return res.status(400).json({ error: 'hora_inicio deve ser menor que hora_fim.' });
      }
    }

    try {
      // Deleta disponibilidades antigas para esse usuário
      await query.run('DELETE FROM disponibilidades WHERE usuario_id = ?', [userId]);

      // Insere as novas disponibilidades
      for (const item of disponibilidades) {
        const { dia_semana, hora_inicio, hora_fim } = item;
        await query.run(
          'INSERT INTO disponibilidades (usuario_id, dia_semana, hora_inicio, hora_fim) VALUES (?, ?, ?, ?)',
          [userId, dia_semana, hora_inicio, hora_fim]
        );
      }

      return res.json({ message: 'Disponibilidade salva com sucesso!' });
    } catch (err: any) {
      console.error(err);
      return res.status(500).json({ error: 'Erro ao salvar disponibilidade.' });
    }
  }
}
