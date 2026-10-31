import { Response } from 'express';
import { query } from '../config/database';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';

export class ReportController {
  static async getReports(req: AuthenticatedRequest, res: Response) {
    const userId = req.userId;

    try {
      // 1. Resumo financeiro do estoque
      const estoqueSummary = await query.get(
        `SELECT 
          COUNT(id) as total_produtos,
          COALESCE(SUM(estoque), 0) as estoque_total,
          COALESCE(SUM(estoque * preco_custo), 0) as valor_custo_total,
          COALESCE(SUM(estoque * preco), 0) as valor_venda_total
        FROM produtos 
        WHERE usuario_id = ?`,
        [userId]
      );

      const total_produtos = estoqueSummary?.total_produtos || 0;
      const estoque_total = estoqueSummary?.estoque_total || 0;
      const valor_custo_total = parseFloat(estoqueSummary?.valor_custo_total || 0);
      const valor_venda_total = parseFloat(estoqueSummary?.valor_venda_total || 0);
      const lucro_potencial = valor_venda_total - valor_custo_total;

      // 2. Produtos com estoque baixo (estoque <= 2)
      const baixoEstoque = await query.all(
        'SELECT nome, estoque FROM produtos WHERE usuario_id = ? AND estoque <= 2 ORDER BY estoque ASC',
        [userId]
      );

      // 3. Top 5 produtos por receita total
      const topReceita = await query.all(
        `SELECT 
          p.nome, 
          SUM(v.quantidade) as quantidade_vendida, 
          SUM(v.valor_total) as receita_total
        FROM vendas_produtos v
        JOIN produtos p ON v.produto_id = p.id
        WHERE v.usuario_id = ?
        GROUP BY v.produto_id, p.nome
        ORDER BY receita_total DESC
        LIMIT 5`,
        [userId]
      );

      // 4. Top 5 produtos por lucro total
      const topLucro = await query.all(
        `SELECT 
          p.nome, 
          SUM(v.quantidade) as quantidade_vendida, 
          SUM(v.valor_total - (v.quantidade * p.preco_custo)) as lucro_total
        FROM vendas_produtos v
        JOIN produtos p ON v.produto_id = p.id
        WHERE v.usuario_id = ?
        GROUP BY v.produto_id, p.nome
        ORDER BY lucro_total DESC
        LIMIT 5`,
        [userId]
      );

      return res.json({
        estoque: {
          total_produtos,
          estoque_total,
          valor_custo_total,
          valor_venda_total,
          lucro_potencial,
          itens_baixo_estoque: baixoEstoque
        },
        topReceita,
        topLucro
      });
    } catch (err: any) {
      console.error(err);
      return res.status(500).json({ error: 'Erro ao gerar relatórios de faturamento e estoque.' });
    }
  }
}
