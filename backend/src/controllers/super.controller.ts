import { Request, Response } from 'express';
import { query } from '../config/database';
import crypto from 'crypto';

export class SuperController {
  private static pendingProfileChanges = new Map<number, {
    code: string;
    expires: number;
    data: {
      nome: string;
      email: string;
      senha?: string;
    }
  }>();

  /**
   * Registra uma nova visita na plataforma (Landing Page ou Área Pública).
   */
  static async recordVisit(req: Request, res: Response) {
    const { pagina } = req.body;
    if (!pagina) {
      return res.status(400).json({ error: 'O campo pagina é obrigatório.' });
    }

    try {
      // Cria um hash SHA-256 do IP por motivos de privacidade/LGPD
      const ip = req.ip || req.headers['x-forwarded-for'] || '';
      const ipHash = crypto.createHash('sha256').update(String(ip)).digest('hex');

      await query.run(
        'INSERT INTO visitas (pagina, ip_hash) VALUES (?, ?)',
        [pagina, ipHash]
      );

      return res.status(201).json({ success: true });
    } catch (err: any) {
      console.error('Erro ao registrar visita:', err);
      return res.status(500).json({ error: 'Erro interno ao registrar visita.' });
    }
  }

  /**
   * Obtém métricas gerais da plataforma SaaS e lista de clientes.
   */
  static async getDashboard(req: Request, res: Response) {
    try {
      // 1. Contagem de inquilinos profissionais
      const totalClientes = (await query.get<{ total: number }>(
        "SELECT COUNT(id) as total FROM usuarios WHERE tipo_usuario = 'profissional'"
      ))?.total || 0;

      const clientesAtivos = (await query.get<{ total: number }>(
        "SELECT COUNT(id) as total FROM usuarios WHERE tipo_usuario = 'profissional' AND assinatura_status = 'ativo'"
      ))?.total || 0;

      const clientesBloqueados = (await query.get<{ total: number }>(
        "SELECT COUNT(id) as total FROM usuarios WHERE tipo_usuario = 'profissional' AND assinatura_status = 'bloqueado'"
      ))?.total || 0;

      // Faturamento SaaS estimado (Preço da mensalidade dinâmico)
      const configRow = await query.get<{ valor: string }>(
        "SELECT valor FROM configuracoes WHERE chave = 'preco_mensalidade'"
      );
      const precoMensalidade = parseFloat(configRow?.valor || '21.90');
      const faturamentoSaaS = clientesAtivos * precoMensalidade;

      // Contagem de visitas / acessos
      const totalVisitas = (await query.get<{ total: number }>(
        "SELECT COUNT(id) as total FROM visitas"
      ))?.total || 0;

      const visitasHoje = (await query.get<{ total: number }>(
        "SELECT COUNT(id) as total FROM visitas WHERE criado_em >= date('now')"
      ))?.total || 0;

      const visitasSemana = (await query.get<{ total: number }>(
        "SELECT COUNT(id) as total FROM visitas WHERE criado_em >= date('now', '-7 days')"
      ))?.total || 0;

      const visitasMes = (await query.get<{ total: number }>(
        "SELECT COUNT(id) as total FROM visitas WHERE criado_em >= date('now', '-30 days')"
      ))?.total || 0;

      const visitasLanding = (await query.get<{ total: number }>(
        "SELECT COUNT(id) as total FROM visitas WHERE pagina = 'landing_page'"
      ))?.total || 0;

      const visitasBooking = (await query.get<{ total: number }>(
        "SELECT COUNT(id) as total FROM visitas WHERE pagina = 'agendamento_publico'"
      ))?.total || 0;

      const clientes = await query.all(
        `SELECT id, nome, email, whatsapp, cpf, pix_chave, assinatura_status, assinatura_valida_ate, mensalidade_dia, criado_em, endereco, endereco_link 
         FROM usuarios 
         WHERE tipo_usuario = 'profissional' 
         ORDER BY criado_em DESC`
      );

      return res.json({
        stats: {
          totalClientes,
          clientesAtivos,
          clientesBloqueados,
          faturamentoSaaS,
          totalVisitas,
          visitasHoje,
          visitasSemana,
          visitasMes,
          visitasLanding,
          visitasBooking
        },
        clientes
      });
    } catch (err: any) {
      console.error(err);
      return res.status(500).json({ error: 'Erro ao carregar dashboard do Super Admin.' });
    }
  }

  /**
   * Obtém detalhes operacionais/suporte e volume de banco de dados de um cliente específico.
   */
  static async getUserDetails(req: Request, res: Response) {
    const { id } = req.params;

    try {
      const cliente = await query.get(
        "SELECT id, nome, email, whatsapp, cpf, pix_chave, assinatura_status, assinatura_valida_ate, mensalidade_dia, criado_em, endereco, endereco_link FROM usuarios WHERE id = ? AND tipo_usuario = 'profissional'",
        [id]
      );

      if (!cliente) {
        return res.status(404).json({ error: 'Cliente não encontrado ou não é um profissional.' });
      }

      // Consulta estatísticas de tabelas de banco de dados dele
      const totalServicos = (await query.get<{ total: number }>(
        "SELECT COUNT(id) as total FROM servicos WHERE usuario_id = ?",
        [id]
      ))?.total || 0;

      const totalAgendamentos = (await query.get<{ total: number }>(
        `SELECT COUNT(a.id) as total 
         FROM agendamentos a 
         JOIN servicos s ON a.servico_id = s.id 
         WHERE s.usuario_id = ?`,
        [id]
      ))?.total || 0;

      const totalProdutos = (await query.get<{ total: number }>(
        "SELECT COUNT(id) as total FROM produtos WHERE usuario_id = ?",
        [id]
      ))?.total || 0;

      const totalDespesas = (await query.get<{ total: number }>(
        "SELECT COUNT(id) as total FROM despesas WHERE usuario_id = ?",
        [id]
      ))?.total || 0;

      const totalFuncionarios = (await query.get<{ total: number }>(
        "SELECT COUNT(id) as total FROM funcionarios WHERE usuario_id = ? AND ativo = 1",
        [id]
      ))?.total || 0;

      // Calcula faturamento total gerado no estabelecimento do cliente (Serviços + Produtos)
      const receitaServicos = (await query.get<{ total: number }>(
        `SELECT SUM(s.preco) as total 
         FROM agendamentos a 
         JOIN servicos s ON a.servico_id = s.id 
         WHERE s.usuario_id = ? AND (a.status_pagamento = 'pago' OR a.metodo_pagamento = 'presencial') AND a.presenca_confirmada != 2`,
        [id]
      ))?.total || 0;

      const receitaProdutos = (await query.get<{ total: number }>(
        "SELECT SUM(valor_total) as total FROM vendas_produtos WHERE usuario_id = ?",
        [id]
      ))?.total || 0;

      const faturamentoEstabelecimento = receitaServicos + receitaProdutos;

      return res.json({
        cliente,
        stats: {
          totalServicos,
          totalAgendamentos,
          totalProdutos,
          totalDespesas,
          totalFuncionarios,
          faturamentoEstabelecimento
        }
      });
    } catch (err: any) {
      console.error(err);
      return res.status(500).json({ error: 'Erro ao carregar detalhes operacionais do cliente.' });
    }
  }

  /**
   * Atualiza a licença (status da assinatura e validade) de um cliente.
   */
  static async updateSubscription(req: Request, res: Response) {
    const { id } = req.params;
    const { assinatura_status, assinatura_valida_ate } = req.body;

    if (!assinatura_status || !assinatura_valida_ate) {
      return res.status(400).json({ error: 'Os campos assinatura_status e assinatura_valida_ate (AAAA-MM-DD) são obrigatórios.' });
    }

    if (assinatura_status !== 'ativo' && assinatura_status !== 'bloqueado') {
      return res.status(400).json({ error: 'Status de assinatura deve ser "ativo" ou "bloqueado".' });
    }

    try {
      const cliente = await query.get(
        "SELECT id FROM usuarios WHERE id = ? AND tipo_usuario = 'profissional'",
        [id]
      );

      if (!cliente) {
        return res.status(404).json({ error: 'Cliente não encontrado ou não é um profissional.' });
      }

      await query.run(
        "UPDATE usuarios SET assinatura_status = ?, assinatura_valida_ate = ?, ultimo_aviso_dias = 0 WHERE id = ?",
        [assinatura_status, assinatura_valida_ate, id]
      );

      return res.json({ message: 'Licença do cliente atualizada com sucesso!' });
    } catch (err: any) {
      console.error(err);
      return res.status(500).json({ error: 'Erro ao atualizar assinatura do cliente.' });
    }
  }

  /**
   * Exclui completamente a conta de um profissional e todas as informações vinculadas.
   */
  static async deleteUser(req: Request, res: Response) {
    const { id } = req.params;

    try {
      const cliente = await query.get(
        "SELECT id FROM usuarios WHERE id = ? AND tipo_usuario = 'profissional'",
        [id]
      );

      if (!cliente) {
        return res.status(404).json({ error: 'Cliente não encontrado ou não é um profissional.' });
      }

      await query.run("DELETE FROM usuarios WHERE id = ?", [id]);

      return res.json({ message: 'Conta do cliente e todos os dados associados foram excluídos permanentemente.' });
    } catch (err: any) {
      console.error(err);
      return res.status(500).json({ error: 'Erro ao excluir conta do cliente.' });
    }
  }

  /**
   * Obtém as configurações gerais do SaaS.
   */
  static async getConfiguracoes(req: Request, res: Response) {
    try {
      const rows = await query.all<{ chave: string, valor: string }>("SELECT * FROM configuracoes");
      const configMap = rows.reduce((map, r) => {
        map[r.chave] = r.valor;
        return map;
      }, {} as Record<string, string>);

      return res.json({
        preco_mensalidade: parseFloat(configMap['preco_mensalidade'] || '19.90'),
        preco_primeiro_mes: parseFloat(configMap['preco_primeiro_mes'] || '14.90'),
        dias_gratis_teste: parseInt(configMap['dias_gratis_teste'] || '7', 10),
        saas_mp_access_token: configMap['saas_mp_access_token'] || '',
        saas_mp_public_key: configMap['saas_mp_public_key'] || '',
        evolution_api_url: configMap['evolution_api_url'] || '',
        evolution_api_key: configMap['evolution_api_key'] || '',
        sistema_nome: configMap['sistema_nome'] || 'Agendamente',
        suporte_email: configMap['suporte_email'] || 'suporte@agendamente.com.br',
        suporte_whatsapp: configMap['suporte_whatsapp'] || '11999999999',
        novos_cadastros_habilitados: parseInt(configMap['novos_cadastros_habilitados'] || '1', 10),
        modo_manutencao_habilitado: parseInt(configMap['modo_manutencao_habilitado'] || '0', 10),
        seo_titulo: configMap['seo_titulo'] || 'Agendamente - Agendamentos Online e Gestão ERP',
        seo_descricao: configMap['seo_descricao'] || 'Plataforma para gestão de agendamentos, clientes e equipe para salões de beleza, barbearias e clínicas.',
        wpp_template_boas_vindas: configMap['wpp_template_boas_vindas'] || '',
        wpp_template_vencimento: configMap['wpp_template_vencimento'] || '',
        wpp_template_suspensao: configMap['wpp_template_suspensao'] || ''
      });
    } catch (err: any) {
      console.error('Erro ao buscar configurações:', err);
      return res.status(500).json({ error: 'Erro interno ao buscar configurações.' });
    }
  }

  /**
   * Atualiza as configurações gerais do SaaS.
   */
  static async updateConfiguracoes(req: Request, res: Response) {
    const fields = req.body;

    try {
      for (const [key, val] of Object.entries(fields)) {
        if (val === undefined || val === null) continue;
        const strVal = String(val).trim();
        const exists = await query.get("SELECT chave FROM configuracoes WHERE chave = ?", [key]);
        if (exists) {
          await query.run("UPDATE configuracoes SET valor = ? WHERE chave = ?", [strVal, key]);
        } else {
          await query.run("INSERT INTO configuracoes (chave, valor) VALUES (?, ?)", [key, strVal]);
        }
      }

      // Recarrega configurações da Evolution API em memória se alteradas
      if (fields['evolution_api_url'] !== undefined || fields['evolution_api_key'] !== undefined) {
        const { EvolutionService } = require('../services/evolution.service');
        const rowUrl = await query.get<{ valor: string }>("SELECT valor FROM configuracoes WHERE chave = 'evolution_api_url'");
        const rowKey = await query.get<{ valor: string }>("SELECT valor FROM configuracoes WHERE chave = 'evolution_api_key'");
        EvolutionService.updateSettings(rowUrl?.valor, rowKey?.valor);
      }

      return res.json({ message: 'Configurações globais atualizadas com sucesso!' });
    } catch (err: any) {
      console.error('Erro ao atualizar configurações:', err);
      return res.status(500).json({ error: 'Erro interno ao atualizar configurações.' });
    }
  }

  /**
   * Verifica se a senha atual está correta para permitir acesso à aba de edição de perfil.
   */
  static async verifyPassword(req: Request, res: Response) {
    const userId = (req as any).userId;
    const { senha } = req.body;

    if (!senha) {
      return res.status(400).json({ error: 'A senha atual é obrigatória.' });
    }

    try {
      const user = await query.get<{ senha_hash: string }>(
        'SELECT senha_hash FROM usuarios WHERE id = ?',
        [userId]
      );

      if (!user) {
        return res.status(404).json({ error: 'Usuário não encontrado.' });
      }

      const bcrypt = require('bcryptjs');
      const match = await bcrypt.compare(senha, user.senha_hash);

      if (!match) {
        return res.status(400).json({ error: 'Senha incorreta.' });
      }

      return res.json({ success: true, message: 'Senha confirmada com sucesso!' });
    } catch (err: any) {
      console.error('Erro ao verificar senha do administrador:', err);
      return res.status(500).json({ error: 'Erro interno ao verificar senha.' });
    }
  }

  /**
   * Solicita alteração de perfil gerando e enviando um código de confirmação por e-mail.
   */
  static async requestProfileChange(req: Request, res: Response) {
    const userId = (req as any).userId;
    const { nome, email, senha } = req.body;

    if (!nome || !email) {
      return res.status(400).json({ error: 'Os campos nome e e-mail são obrigatórios.' });
    }

    try {
      // Verifica se o e-mail já está em uso por outro usuário
      const existingEmail = await query.get(
        'SELECT id FROM usuarios WHERE email = ? AND id != ?',
        [email, userId]
      );
      if (existingEmail) {
        return res.status(400).json({ error: 'Este e-mail já está cadastrado por outro usuário.' });
      }

      if (senha && senha.trim().length > 0) {
        if (senha.trim().length < 6) {
          return res.status(400).json({ error: 'A nova senha deve conter no mínimo 6 caracteres.' });
        }
      }

      // Obtém o usuário atual para enviar o código para o e-mail cadastrado atualmente
      const currentUser = await query.get<{ email: string }>(
        'SELECT email FROM usuarios WHERE id = ?',
        [userId]
      );

      if (!currentUser) {
        return res.status(404).json({ error: 'Usuário não encontrado.' });
      }

      // Gera código de 6 dígitos
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      const expires = Date.now() + 15 * 60 * 1000; // 15 minutos

      // Salva em memória
      SuperController.pendingProfileChanges.set(userId, {
        code,
        expires,
        data: {
          nome,
          email,
          senha: senha && senha.trim().length > 0 ? senha.trim() : undefined
        }
      });

      // Dispara o e-mail
      const { MailService } = require('../services/mail.service');
      await MailService.sendSecurityCode(currentUser.email, code);

      return res.json({
        success: true,
        message: 'Código de confirmação enviado para o e-mail do administrador.'
      });
    } catch (err: any) {
      console.error('Erro ao solicitar alteração de perfil:', err);
      return res.status(500).json({ error: 'Erro interno ao processar a solicitação.' });
    }
  }

  /**
   * Confirma a alteração de perfil com o código de 6 dígitos.
   */
  static async confirmProfileChange(req: Request, res: Response) {
    const userId = (req as any).userId;
    const { codigo } = req.body;

    if (!codigo) {
      return res.status(400).json({ error: 'O código de confirmação é obrigatório.' });
    }

    const pending = SuperController.pendingProfileChanges.get(userId);

    if (!pending) {
      return res.status(400).json({ error: 'Nenhuma alteração pendente encontrada para esta conta.' });
    }

    if (Date.now() > pending.expires) {
      SuperController.pendingProfileChanges.delete(userId);
      return res.status(400).json({ error: 'O código de confirmação expirou. Solicite a alteração novamente.' });
    }

    if (pending.code !== String(codigo).trim()) {
      return res.status(400).json({ error: 'Código de confirmação incorreto.' });
    }

    try {
      const { nome, email, senha } = pending.data;

      // Se há nova senha, gera hash
      if (senha) {
        const bcrypt = require('bcryptjs');
        const salt = await bcrypt.genSalt(10);
        const hash = await bcrypt.hash(senha, salt);

        await query.run(
          'UPDATE usuarios SET nome = ?, email = ?, senha_hash = ? WHERE id = ?',
          [nome, email, hash, userId]
        );
      } else {
        await query.run(
          'UPDATE usuarios SET nome = ?, email = ? WHERE id = ?',
          [nome, email, userId]
        );
      }

      // Remove das pendências
      SuperController.pendingProfileChanges.delete(userId);

      // Retorna usuário atualizado
      const updatedUser = await query.get(
        'SELECT id, nome, email, whatsapp, tipo_usuario FROM usuarios WHERE id = ?',
        [userId]
      );

      return res.json({
        message: 'Dados da sua conta de administrador atualizados com sucesso!',
        usuario: updatedUser
      });
    } catch (err: any) {
      console.error('Erro ao confirmar alteração de perfil:', err);
      return res.status(500).json({ error: 'Erro interno ao atualizar perfil do administrador.' });
    }
  }

  /**
   * Redefine manualmente a senha de um profissional (inquilino/assinante) pelo Super Admin.
   */
  static async resetUserPassword(req: Request, res: Response) {
    const { id } = req.params;
    const { senha } = req.body;

    if (!senha || senha.trim().length < 6) {
      return res.status(400).json({ error: 'A senha é obrigatória e deve conter no mínimo 6 caracteres.' });
    }

    try {
      const user = await query.get(
        "SELECT id FROM usuarios WHERE id = ? AND tipo_usuario = 'profissional'",
        [id]
      );

      if (!user) {
        return res.status(404).json({ error: 'Usuário profissional não encontrado.' });
      }

      const bcrypt = require('bcryptjs');
      const salt = await bcrypt.genSalt(10);
      const hash = await bcrypt.hash(senha.trim(), salt);

      await query.run(
        "UPDATE usuarios SET senha_hash = ?, senha_reset_token = NULL, senha_reset_expira = NULL WHERE id = ?",
        [hash, id]
      );

      return res.json({ success: true, message: 'Senha do profissional redefinida com sucesso!' });
    } catch (err: any) {
      console.error('Erro ao redefinir senha do profissional pelo Super Admin:', err);
      return res.status(500).json({ error: 'Erro interno ao redefinir senha do profissional.' });
    }
  }

  /**
   * Atualiza o perfil (nome, email e senha) do próprio Dono do SaaS.
   * @deprecated Desativado por motivos de segurança.
   */
  static async updateProfile(req: Request, res: Response) {
    return res.status(400).json({ error: 'Este endpoint foi desativado por motivos de segurança. Use as rotas de solicitação e confirmação por e-mail.' });
  }
}
