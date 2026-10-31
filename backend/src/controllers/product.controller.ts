import { Response } from 'express';
import { query } from '../config/database';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { Produto } from '../models/types';
import fs from 'fs';
import path from 'path';

export class ProductController {
  static async list(req: AuthenticatedRequest, res: Response) {
    const userId = req.userId;

    try {
      const products = await query.all<Produto>(
        'SELECT * FROM produtos WHERE usuario_id = ? ORDER BY nome ASC',
        [userId]
      );
      return res.json(products);
    } catch (err: any) {
      console.error(err);
      return res.status(500).json({ error: 'Erro ao listar produtos.' });
    }
  }

  static async create(req: AuthenticatedRequest, res: Response) {
    const userId = req.userId;
    const { nome, preco, preco_custo, estoque, imagem_url } = req.body;

    if (!nome || preco === undefined || preco_custo === undefined || estoque === undefined) {
      return res.status(400).json({ error: 'Nome, preço de venda, preço de custo e estoque são obrigatórios.' });
    }

    if (preco < 0 || preco_custo < 0 || estoque < 0) {
      return res.status(400).json({ error: 'Valores não podem ser negativos.' });
    }

    try {
      const result = await query.run(
        'INSERT INTO produtos (usuario_id, nome, preco, preco_custo, estoque, imagem_url) VALUES (?, ?, ?, ?, ?, ?)',
        [userId, nome, preco, preco_custo, estoque, imagem_url || null]
      );

      return res.status(201).json({
        id: result.lastID,
        usuario_id: userId,
        nome,
        preco,
        preco_custo,
        estoque,
        imagem_url: imagem_url || null
      });
    } catch (err: any) {
      console.error(err);
      return res.status(500).json({ error: 'Erro ao criar produto.' });
    }
  }

  static async delete(req: AuthenticatedRequest, res: Response) {
    const userId = req.userId;
    const { id } = req.params;

    try {
      // Verifica se o produto pertence ao profissional
      const product = await query.get<{ id: number; imagem_url: string }>(
        'SELECT id, imagem_url FROM produtos WHERE id = ? AND usuario_id = ?',
        [id, userId]
      );

      if (!product) {
        return res.status(404).json({ error: 'Produto não encontrado ou não pertence a você.' });
      }

      // Exclui fisicamente a imagem do disco se ela existir
      if (product.imagem_url) {
        try {
          const filename = path.basename(product.imagem_url);
          const filepath = path.resolve(__dirname, '../../../frontend/uploads/produtos', filename);
          if (fs.existsSync(filepath)) {
            fs.unlinkSync(filepath);
            console.log(`Foto do produto excluída fisicamente: ${filepath}`);
          }
        } catch (e) {
          console.error('Erro ao excluir arquivo físico de imagem do produto:', e);
        }
      }

      await query.run('DELETE FROM produtos WHERE id = ?', [id]);
      return res.json({ message: 'Produto excluído com sucesso!' });
    } catch (err: any) {
      console.error(err);
      return res.status(500).json({ error: 'Erro ao excluir produto.' });
    }
  }

  static async sell(req: AuthenticatedRequest, res: Response) {
    const userId = req.userId;
    const { produtoId, quantidade, dataVenda } = req.body;

    if (!produtoId || !quantidade || !dataVenda) {
      return res.status(400).json({ error: 'ID do produto, quantidade e data da venda são obrigatórios.' });
    }

    if (quantidade <= 0) {
      return res.status(400).json({ error: 'A quantidade de venda deve ser maior que zero.' });
    }

    try {
      // 1. Busca detalhes do produto e confere estoque
      const product = await query.get<Produto>(
        'SELECT * FROM produtos WHERE id = ? AND usuario_id = ?',
        [produtoId, userId]
      );

      if (!product) {
        return res.status(404).json({ error: 'Produto não encontrado ou não cadastrado por você.' });
      }

      if (product.estoque < quantidade) {
        return res.status(400).json({ error: `Estoque insuficiente. Quantidade disponível: ${product.estoque}` });
      }

      // 2. Calcula valor total
      const valor_total = product.preco * quantidade;

      // 3. Deduz quantidade do estoque
      await query.run(
        'UPDATE produtos SET estoque = estoque - ? WHERE id = ?',
        [quantidade, produtoId]
      );

      // 4. Registra a venda
      const result = await query.run(
        'INSERT INTO vendas_produtos (usuario_id, produto_id, quantidade, valor_total, data_venda) VALUES (?, ?, ?, ?, ?)',
        [userId, produtoId, quantidade, valor_total, dataVenda]
      );

      return res.status(201).json({
        id: result.lastID,
        produto_id: produtoId,
        produto_nome: product.nome,
        quantidade,
        valor_total,
        data_venda: dataVenda,
        novo_estoque: product.estoque - quantidade
      });

    } catch (err: any) {
      console.error(err);
      return res.status(500).json({ error: 'Erro ao registrar venda de produto.' });
    }
  }

  static async upload(req: AuthenticatedRequest, res: Response) {
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    }

    try {
      const filename = req.file.filename;
      const imageUrl = `/uploads/produtos/${filename}`;
      return res.json({ url: imageUrl });
    } catch (err: any) {
      console.error(err);
      return res.status(500).json({ error: 'Erro ao processar upload da imagem.' });
    }
  }
}
