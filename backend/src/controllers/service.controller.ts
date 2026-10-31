import { Request, Response } from 'express';
import { query } from '../config/database';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { Servico } from '../models/types';

export class ServiceController {
  static async list(req: AuthenticatedRequest, res: Response) {
    const userId = req.userId;

    try {
      const services = await query.all<Servico>(
        'SELECT * FROM servicos WHERE usuario_id = ? ORDER BY criado_em DESC',
        [userId]
      );
      return res.json(services);
    } catch (err: any) {
      console.error(err);
      return res.status(500).json({ error: 'Erro ao listar serviços.' });
    }
  }

  static async create(req: AuthenticatedRequest, res: Response) {
    const userId = req.userId;
    const { nome, descricao, duracao_minutos, preco, sinal_porcentagem, cor } = req.body;

    if (!nome || !duracao_minutos || preco === undefined) {
      return res.status(400).json({ error: 'Nome, duração e preço são obrigatórios.' });
    }

    if (duracao_minutos <= 0 || preco < 0) {
      return res.status(400).json({ error: 'Duração deve ser maior que 0 e preço não pode ser negativo.' });
    }

    const sinalPorcentagemInt = parseInt(sinal_porcentagem, 10) || 0;
    if (sinalPorcentagemInt < 0 || sinalPorcentagemInt > 100) {
      return res.status(400).json({ error: 'O percentual de sinal deve ser entre 0% e 100%.' });
    }

    try {
      const result = await query.run(
        'INSERT INTO servicos (usuario_id, nome, descricao, duracao_minutos, preco, sinal_porcentagem, cor) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [userId, nome, descricao || '', duracao_minutos, preco, sinalPorcentagemInt, cor || null]
      );

      return res.status(201).json({
        id: result.lastID,
        usuario_id: userId,
        nome,
        descricao,
        duracao_minutos,
        preco,
        sinal_porcentagem: sinalPorcentagemInt,
        cor: cor || null
      });
    } catch (err: any) {
      console.error(err);
      return res.status(500).json({ error: 'Erro ao criar serviço.' });
    }
  }

  static async delete(req: AuthenticatedRequest, res: Response) {
    const userId = req.userId;
    const { id } = req.params;

    try {
      // Verifica se o serviço pertence ao usuário logado
      const service = await query.get(
        'SELECT id FROM servicos WHERE id = ? AND usuario_id = ?',
        [id, userId]
      );

      if (!service) {
        return res.status(404).json({ error: 'Serviço não encontrado ou não pertence a este usuário.' });
      }

      await query.run('DELETE FROM servicos WHERE id = ?', [id]);
      return res.json({ message: 'Serviço excluído com sucesso!' });
    } catch (err: any) {
      console.error(err);
      return res.status(500).json({ error: 'Erro ao excluir serviço.' });
    }
  }

  static async update(req: AuthenticatedRequest, res: Response) {
    const userId = req.userId;
    const { id } = req.params;
    const { nome, descricao, duracao_minutos, preco, sinal_porcentagem, cor } = req.body;

    if (!nome || !duracao_minutos || preco === undefined) {
      return res.status(400).json({ error: 'Nome, duração e preço são obrigatórios.' });
    }

    if (duracao_minutos <= 0 || preco < 0) {
      return res.status(400).json({ error: 'Duração deve ser maior que 0 e preço não pode ser negativo.' });
    }

    const sinalPorcentagemInt = parseInt(sinal_porcentagem, 10) || 0;
    if (sinalPorcentagemInt < 0 || sinalPorcentagemInt > 100) {
      return res.status(400).json({ error: 'O percentual de sinal deve ser entre 0% e 100%.' });
    }

    try {
      // Verifica se o serviço pertence ao usuário logado
      const service = await query.get(
        'SELECT id FROM servicos WHERE id = ? AND usuario_id = ?',
        [id, userId]
      );

      if (!service) {
        return res.status(404).json({ error: 'Serviço não encontrado ou não pertence a este usuário.' });
      }

      await query.run(
        'UPDATE servicos SET nome = ?, descricao = ?, duracao_minutos = ?, preco = ?, sinal_porcentagem = ?, cor = ? WHERE id = ?',
        [nome, descricao || '', duracao_minutos, preco, sinalPorcentagemInt, cor || null, id]
      );

      return res.json({
        id: parseInt(id, 10),
        usuario_id: userId,
        nome,
        descricao,
        duracao_minutos,
        preco,
        sinal_porcentagem: sinalPorcentagemInt,
        cor: cor || null
      });
    } catch (err: any) {
      console.error(err);
      return res.status(500).json({ error: 'Erro ao atualizar serviço.' });
    }
  }

  // Rota pública para listar os serviços de um determinado profissional (identificado pelo ID ou email)
  static async listPublic(req: Request, res: Response) {
    const { usuarioId } = req.query;

    if (!usuarioId) {
      return res.status(400).json({ error: 'ID do usuário/profissional é obrigatório na query.' });
    }

    try {
      const services = await query.all<Servico>(
        'SELECT id, nome, descricao, duracao_minutos, preco, sinal_porcentagem, cor FROM servicos WHERE usuario_id = ? ORDER BY nome ASC',
        [usuarioId]
      );
      
      const profissional = await query.get<any>(
        'SELECT nome, nome_estabelecimento, whatsapp, config_modulos FROM usuarios WHERE id = ?',
        [usuarioId]
      );

      if (!profissional) {
        return res.status(404).json({ error: 'Profissional não encontrado.' });
      }

      let mappedEmployees: any[] = [];
      let isFuncionariosEnabled = true;

      if (profissional.config_modulos) {
        try {
          const modulos = typeof profissional.config_modulos === 'string' 
            ? JSON.parse(profissional.config_modulos) 
            : profissional.config_modulos;
          if (modulos && modulos.funcionarios === false) {
            isFuncionariosEnabled = false;
          }
        } catch (e) {
          console.error('Erro ao fazer parse dos módulos:', e);
        }
      }

      if (isFuncionariosEnabled) {
        // Busca funcionários e seus serviços vinculados
        const employees = await query.all<any>(
          'SELECT id, nome, whatsapp FROM funcionarios WHERE usuario_id = ? AND ativo = 1 ORDER BY nome ASC',
          [usuarioId]
        );

        const associations = await query.all<{ funcionario_id: number; servico_id: number }>(
          `SELECT fs.funcionario_id, fs.servico_id 
           FROM funcionario_servicos fs
           JOIN funcionarios f ON fs.funcionario_id = f.id
           WHERE f.usuario_id = ? AND f.ativo = 1`,
          [usuarioId]
        );

        mappedEmployees = employees.map(emp => {
          const servs = associations
            .filter(a => a.funcionario_id === emp.id)
            .map(a => a.servico_id);
          return {
            id: emp.id,
            nome: emp.nome,
            whatsapp: emp.whatsapp,
            servicos: servs
          };
        });
      }

      // Extract theme if it exists in config_modulos
      let tema = 'indigo';
      if (profissional.config_modulos) {
        try {
          const modulos = typeof profissional.config_modulos === 'string'
            ? JSON.parse(profissional.config_modulos)
            : profissional.config_modulos;
          if (modulos && modulos.tema) {
            tema = modulos.tema;
          }
        } catch (e) {
          console.error('Erro ao ler tema de config_modulos:', e);
        }
      }

      // Remove config_modulos da resposta pública por segurança/privacidade
      const publicProfissional = {
        nome: profissional.nome_estabelecimento || profissional.nome,
        whatsapp: profissional.whatsapp,
        tema
      };

      return res.json({
        profissional: publicProfissional,
        servicos: services,
        funcionarios: mappedEmployees
      });
    } catch (err: any) {
      console.error(err);
      return res.status(500).json({ error: 'Erro ao carregar serviços públicos.' });
    }
  }
}
