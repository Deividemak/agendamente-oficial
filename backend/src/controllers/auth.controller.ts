import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from '../config/database';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { Usuario } from '../models/types';
import crypto from 'crypto';
import { MailService } from '../services/mail.service';
import { validateEmail, validateCelular, validateCPFOrCNPJ } from '../utils/validation';
import { generatePixCheckout } from '../services/pix.service';

const JWT_SECRET = process.env.JWT_SECRET || 'minha_chave_secreta_super_segura_para_o_mvp_123';

function calcularVencimento(dia: number, mesesAdicionais = 1): string {
  const hoje = new Date();
  let ano = hoje.getFullYear();
  let mes = hoje.getMonth();
  
  let vencimento = new Date(ano, mes, dia);
  if (vencimento <= hoje) {
    mes += mesesAdicionais;
  } else if (mesesAdicionais > 1) {
    mes += (mesesAdicionais - 1);
  }
  
  while (mes > 11) {
    mes -= 12;
    ano += 1;
  }
  
  vencimento = new Date(ano, mes, dia);
  const yyyy = vencimento.getFullYear();
  const mm = String(vencimento.getMonth() + 1).padStart(2, '0');
  const dd = String(vencimento.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function estenderVencimento(dataAtualStr: string, dia: number, mesesAdicionais = 1): string {
  // Substitui hífens por barras se necessário para evitar parse incorreto de timezone local em Date
  const partes = dataAtualStr.split('-');
  const dataAtual = new Date(parseInt(partes[0]), parseInt(partes[1]) - 1, parseInt(partes[2]));
  let ano = dataAtual.getFullYear();
  let mes = dataAtual.getMonth() + mesesAdicionais; // Avança N meses
  while (mes > 11) {
    mes -= 12;
    ano += 1;
  }
  const novoVencimento = new Date(ano, mes, dia);
  const yyyy = novoVencimento.getFullYear();
  const mm = String(novoVencimento.getMonth() + 1).padStart(2, '0');
  const dd = String(novoVencimento.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export class AuthController {
  static async register(req: Request, res: Response) {
    try {
      const regEnabledRow = await query.get<{ valor: string }>(
        "SELECT valor FROM configuracoes WHERE chave = 'novos_cadastros_habilitados'"
      );
      if (regEnabledRow && regEnabledRow.valor === '0') {
        return res.status(403).json({ error: 'Novos cadastros de profissionais estão temporariamente suspensos.' });
      }
    } catch (e) {
      console.error('Erro ao verificar liberação de cadastros:', e);
    }

    const { nome, nome_estabelecimento, nicho, email, senha, whatsapp, cpf, pix_chave, mensalidade_dia } = req.body;

    if (!nome || !nome_estabelecimento || !email || !senha || !whatsapp || !cpf || !pix_chave || !mensalidade_dia) {
      return res.status(400).json({ error: 'Todos os campos são obrigatórios.' });
    }

    if (!validateEmail(email)) {
      return res.status(400).json({ error: 'Formato de e-mail inválido.' });
    }

    if (!validateCelular(whatsapp)) {
      return res.status(400).json({ error: 'Número de celular inválido. Certifique-se de digitar o DDD, o dígito 9 e o restante do número (ex: 11999998888).' });
    }

    if (!validateCPFOrCNPJ(cpf)) {
      const cleanDoc = cpf.replace(/\D/g, '');
      const docType = cleanDoc.length <= 11 ? 'CPF' : 'CNPJ';
      return res.status(400).json({ error: `${docType} inválido. Digite um ${docType} válido.` });
    }

    const cleanCpf = cpf.replace(/\D/g, '');
    const cleanWhatsapp = whatsapp.replace(/\D/g, '');

    try {
      // Verifica se e-mail já existe
      const existingUser = await query.get('SELECT id FROM usuarios WHERE email = ?', [email]);
      if (existingUser) {
        return res.status(400).json({ error: 'Este e-mail já está cadastrado.' });
      }

      // Verifica se CPF/CNPJ já existe
      const existingCpf = await query.get('SELECT id FROM usuarios WHERE cpf = ?', [cleanCpf]);
      if (existingCpf) {
        const docType = cleanCpf.length <= 11 ? 'CPF' : 'CNPJ';
        return res.status(400).json({ error: `Este ${docType} já está cadastrado.` });
      }

      // Verifica se WhatsApp já existe
      const existingWhatsapp = await query.get('SELECT id FROM usuarios WHERE whatsapp = ?', [cleanWhatsapp]);
      if (existingWhatsapp) {
        return res.status(400).json({ error: 'Este número de WhatsApp já está cadastrado.' });
      }

      // Hash da senha
      const salt = await bcrypt.genSalt(10);
      const senha_hash = await bcrypt.hash(senha, salt);

      // Gera token de confirmação de e-mail
      const token = crypto.randomBytes(32).toString('hex');

      // Calcula o primeiro vencimento com base no período de teste grátis configurado
      const trialRow = await query.get<{ valor: string }>(
        "SELECT valor FROM configuracoes WHERE chave = 'dias_gratis_teste'"
      );
      const diasGratis = parseInt(trialRow?.valor || '7', 10);
      const hoje = new Date();
      hoje.setDate(hoje.getDate() + diasGratis);
      const vencimento = hoje.toISOString().split('T')[0];
      const diaVenc = parseInt(mensalidade_dia, 10);

      const finalNicho = nicho || 'outros';

      // Insere usuário com email_verificado = 0 (aguardando confirmação), status de assinatura inicial e mensalidades_pagas = 0
      const result = await query.run(
        'INSERT INTO usuarios (nome, nome_estabelecimento, nicho, email, senha_hash, whatsapp, cpf, pix_chave, email_verificado, verificacao_token, mensalidade_dia, assinatura_status, assinatura_valida_ate, ultimo_aviso_dias, tipo_usuario, config_modulos, mensalidades_pagas) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, \'ativo\', ?, 0, \'profissional\', ?, 0)',
        [nome, nome_estabelecimento, finalNicho, email, senha_hash, cleanWhatsapp, cleanCpf, pix_chave, token, diaVenc, vencimento, '{"funcionarios":true,"produtos":true,"despesas":true}']
      );

      // Envia e-mail de confirmação (opcional/silencioso caso falhe)
      try {
        const confirmLink = `${req.protocol}://${req.get('host')}/admin-confirm-email?token=${token}`;
        await MailService.sendVerificationEmail(email, confirmLink);
      } catch (mailErr) {
        console.log('Envio de e-mail de verificação pulado ou falhou:', mailErr);
      }

      return res.status(201).json({
        message: 'Conta criada com sucesso! Enviamos um link de confirmação para o seu e-mail. Por favor, confirme seu e-mail para ativar sua conta antes de fazer login.',
        userId: result.lastID
      });
    } catch (err: any) {
      console.error(err);
      return res.status(500).json({ error: 'Erro interno no servidor ao registrar usuário.' });
    }
  }

  static async login(req: Request, res: Response) {
    const { email, senha } = req.body;

    if (!email || !senha) {
      return res.status(400).json({ error: 'E-mail e senha são obrigatórios.' });
    }

    try {
      // Busca usuário
      const user = await query.get<Usuario & { 
        email_verificado: number, 
        assinatura_status: string, 
        assinatura_valida_ate: string, 
        mensalidade_dia: number 
      }>('SELECT * FROM usuarios WHERE email = ?', [email]);
      
      if (!user) {
        return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
      }

      // Bloqueia login se o e-mail não estiver verificado
      if (user.email_verificado === 0) {
        return res.status(403).json({ error: 'Por favor, confirme seu e-mail antes de fazer login. Verifique sua caixa de entrada.' });
      }

      // Compara senhas
      const isMatch = await bcrypt.compare(senha, user.senha_hash);
      if (!isMatch) {
        return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
      }

      // Cria token JWT
      const token = jwt.sign({ userId: user.id, tipo_usuario: user.tipo_usuario }, JWT_SECRET, { expiresIn: '7d' });

      return res.json({
        token,
        usuario: {
          id: user.id,
          nome: user.nome,
          nome_estabelecimento: user.nome_estabelecimento,
          nicho: user.nicho || 'outros',
          email: user.email,
          whatsapp: user.whatsapp,
          cpf: user.cpf,
          pix_chave: user.pix_chave,
          assinatura_status: user.assinatura_status,
          assinatura_valida_ate: user.assinatura_valida_ate,
          mensalidade_dia: user.mensalidade_dia,
          tipo_usuario: user.tipo_usuario,
          config_modulos: typeof user.config_modulos === 'string' ? JSON.parse(user.config_modulos) : user.config_modulos,
          mensalidades_pagas: user.mensalidades_pagas,
          onboarding_concluido: user.onboarding_concluido,
          endereco: user.endereco,
          endereco_link: user.endereco_link
        }
      });
    } catch (err: any) {
      console.error(err);
      return res.status(500).json({ error: 'Erro interno no servidor ao realizar login.' });
    }
  }

  static async getProfile(req: AuthenticatedRequest, res: Response) {
    const userId = req.userId;

    try {
      const user = await query.get<Usuario>(
        'SELECT id, nome, nome_estabelecimento, nicho, email, whatsapp, cpf, pix_chave, config_modulos, criado_em, assinatura_status, assinatura_valida_ate, mensalidades_pagas, mp_status_conexao, mp_user_id, onboarding_concluido, endereco, endereco_link FROM usuarios WHERE id = ?',
        [userId]
      );

      if (!user) {
        return res.status(404).json({ error: 'Usuário não encontrado.' });
      }

      if (user && typeof user.config_modulos === 'string') {
        user.config_modulos = JSON.parse(user.config_modulos);
      }
      return res.json(user);
    } catch (err: any) {
      console.error(err);
      return res.status(500).json({ error: 'Erro interno ao obter perfil.' });
    }
  }

  static async updateProfile(req: AuthenticatedRequest, res: Response) {
    const userId = req.userId;
    const { nome, nome_estabelecimento, nicho, email, cpf, whatsapp, pix_chave, config_modulos, senhaAtual, endereco, endereco_link } = req.body;

    if (!nome || !nome_estabelecimento || !email || !cpf || !whatsapp || !pix_chave || !senhaAtual) {
      return res.status(400).json({ error: 'Todos os campos (incluindo a senha atual) são obrigatórios.' });
    }

    if (!validateEmail(email)) {
      return res.status(400).json({ error: 'Formato de e-mail inválido.' });
    }

    if (!validateCPFOrCNPJ(cpf)) {
      const cleanDoc = cpf.replace(/\D/g, '');
      const docType = cleanDoc.length <= 11 ? 'CPF' : 'CNPJ';
      return res.status(400).json({ error: `${docType} inválido. Digite um ${docType} válido.` });
    }

    if (!validateCelular(whatsapp)) {
      return res.status(400).json({ error: 'Número de celular inválido. Certifique-se de digitar o DDD, o dígito 9 e o restante do número (ex: 11999998888).' });
    }

    const cleanCpf = cpf.replace(/\D/g, '');
    const cleanWhatsapp = whatsapp.replace(/\D/g, '');

    try {
      // 1. Busca a senha cadastrada no banco para validar
      const user = await query.get<{ senha_hash: string }>(
        'SELECT senha_hash FROM usuarios WHERE id = ?',
        [userId]
      );

      if (!user) {
        return res.status(404).json({ error: 'Usuário não encontrado.' });
      }

      // 2. Compara a senha atual
      const isMatch = await bcrypt.compare(senhaAtual, user.senha_hash);
      if (!isMatch) {
        return res.status(401).json({ error: 'Senha atual incorreta. Confirmação de segurança falhou.' });
      }

      // 3. Verifica se o novo e-mail já existe para outro usuário
      const existingEmail = await query.get('SELECT id FROM usuarios WHERE email = ? AND id != ?', [email, userId]);
      if (existingEmail) {
        return res.status(400).json({ error: 'Este e-mail já está cadastrado por outro usuário.' });
      }

      // 4. Verifica se o novo CPF/CNPJ já existe para outro usuário
      const existingCpf = await query.get('SELECT id FROM usuarios WHERE cpf = ? AND id != ?', [cleanCpf, userId]);
      if (existingCpf) {
        const docType = cleanCpf.length <= 11 ? 'CPF' : 'CNPJ';
        return res.status(400).json({ error: `Este ${docType} já está cadastrado por outro usuário.` });
      }

      // 4b. Verifica se o novo WhatsApp já existe para outro usuário
      const existingWhatsapp = await query.get('SELECT id FROM usuarios WHERE whatsapp = ? AND id != ?', [cleanWhatsapp, userId]);
      if (existingWhatsapp) {
        return res.status(400).json({ error: 'Este número de WhatsApp já está cadastrado por outro usuário.' });
      }

      // 5. Atualiza os dados de forma condicional
      let queryStr = 'UPDATE usuarios SET nome = ?, nome_estabelecimento = ?, nicho = ?, email = ?, cpf = ?, whatsapp = ?, pix_chave = ?, endereco = ?, endereco_link = ?';
      const params = [nome, nome_estabelecimento, nicho || 'outros', email, cleanCpf, cleanWhatsapp, pix_chave, endereco, endereco_link];

      if (config_modulos !== undefined) {
        queryStr += ', config_modulos = ?';
        params.push(typeof config_modulos === 'string' ? config_modulos : JSON.stringify(config_modulos));
      }

      queryStr += ' WHERE id = ?';
      params.push(userId);

      await query.run(queryStr, params);

      return res.json({
        message: 'Configurações de perfil atualizadas com sucesso!',
        usuario: {
          nome,
          nome_estabelecimento,
          nicho: nicho || 'outros',
          email,
          cpf: cleanCpf,
          whatsapp: cleanWhatsapp,
          pix_chave,
          config_modulos: typeof config_modulos === 'string' ? JSON.parse(config_modulos) : config_modulos,
          endereco,
          endereco_link
        }
      });
    } catch (err: any) {
      console.error(err);
      return res.status(500).json({ error: 'Erro interno ao atualizar perfil.' });
    }
  }

  static async completeOnboarding(req: AuthenticatedRequest, res: Response) {
    const userId = req.userId;
    const { nome_estabelecimento, nicho, pix_chave } = req.body;

    if (!nome_estabelecimento || !nicho || !pix_chave) {
      return res.status(400).json({ error: 'Nome do estabelecimento, nicho e chave Pix são obrigatórios.' });
    }

    try {
      await query.run(
        'UPDATE usuarios SET nome_estabelecimento = ?, nicho = ?, pix_chave = ?, onboarding_concluido = 1 WHERE id = ?',
        [nome_estabelecimento, nicho, pix_chave, userId]
      );

      return res.json({ message: 'Onboarding concluído com sucesso!' });
    } catch (err: any) {
      console.error(err);
      return res.status(500).json({ error: 'Erro interno ao salvar onboarding.' });
    }
  }

  static async forgotPassword(req: Request, res: Response) {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'O e-mail é obrigatório.' });
    }

    try {
      // 1. Verifica se o usuário existe
      const user = await query.get<Usuario>('SELECT id FROM usuarios WHERE email = ?', [email]);
      if (!user) {
        return res.status(404).json({ error: 'Nenhum usuário cadastrado com este e-mail.' });
      }

      // 2. Gera token de redefinição seguro e data de expiração (1 hora)
      const token = crypto.randomBytes(32).toString('hex');
      const expiraEm = new Date(Date.now() + 3600000).toISOString();

      // 3. Salva no banco de dados
      await query.run(
        'UPDATE usuarios SET senha_reset_token = ?, senha_reset_expira = ? WHERE email = ?',
        [token, expiraEm, email]
      );

      // 4. Dispara e-mail de redefinição (ou simula no console)
      const resetLink = `${req.protocol}://${req.get('host')}/admin-reset-password?token=${token}`;
      await MailService.sendResetEmail(email, resetLink);

      return res.json({ message: 'E-mail de recuperação enviado com sucesso!' });
    } catch (err: any) {
      console.error(err);
      return res.status(500).json({ error: 'Erro interno ao processar recuperação de senha.' });
    }
  }

  static async resetPassword(req: Request, res: Response) {
    const { token, novaSenha } = req.body;

    if (!token || !novaSenha) {
      return res.status(400).json({ error: 'Token e nova senha são obrigatórios.' });
    }

    if (novaSenha.length < 6) {
      return res.status(400).json({ error: 'A senha deve conter no mínimo 6 caracteres.' });
    }

    try {
      // 1. Busca usuário pelo token
      const user = await query.get<any>('SELECT * FROM usuarios WHERE senha_reset_token = ?', [token]);
      if (!user) {
        return res.status(400).json({ error: 'Token de redefinição inválido ou expirado.' });
      }

      // 2. Valida expiração do token no backend usando data em JS
      const expiraData = new Date(user.senha_reset_expira);
      if (expiraData.getTime() < Date.now()) {
        return res.status(400).json({ error: 'O link de redefinição de senha expirou. Solicite um novo.' });
      }

      // 3. Criptografa a nova senha
      const salt = await bcrypt.genSalt(10);
      const senha_hash = await bcrypt.hash(novaSenha, salt);

      // 4. Salva a nova senha e limpa o token de redefinição
      await query.run(
        'UPDATE usuarios SET senha_hash = ?, senha_reset_token = NULL, senha_reset_expira = NULL WHERE id = ?',
        [senha_hash, user.id]
      );

      return res.json({ message: 'Senha redefinida com sucesso! Você já pode fazer login.' });
    } catch (err: any) {
      console.error(err);
      return res.status(500).json({ error: 'Erro interno ao redefinir senha.' });
    }
  }

  static async confirmEmail(req: Request, res: Response) {
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({ error: 'Token de confirmação é obrigatório.' });
    }

    try {
      // Busca o usuário pelo token de verificação
      const user = await query.get<Usuario>('SELECT id FROM usuarios WHERE verificacao_token = ?', [token]);
      if (!user) {
        return res.status(400).json({ error: 'Token de confirmação inválido ou já utilizado.' });
      }

      // Ativa o usuário e limpa o token
      await query.run(
        'UPDATE usuarios SET email_verificado = 1, verificacao_token = NULL WHERE id = ?',
        [user.id]
      );

      return res.json({ message: 'E-mail verificado com sucesso! Sua conta foi ativada.' });
    } catch (err: any) {
      console.error(err);
      return res.status(500).json({ error: 'Erro interno ao confirmar e-mail.' });
    }
  }

  static async getBillingStatus(req: AuthenticatedRequest, res: Response) {
    const userId = req.userId;
    const meses = parseInt(req.query.meses as string || '1', 10);

    try {
      const user = await query.get<{
        nome: string,
        email: string,
        cpf: string,
        mensalidade_dia: number,
        assinatura_status: string,
        assinatura_valida_ate: string,
        mensalidades_pagas: number
      }>(
        'SELECT nome, email, cpf, mensalidade_dia, assinatura_status, assinatura_valida_ate, mensalidades_pagas FROM usuarios WHERE id = ?',
        [userId]
      );

      if (!user) {
        return res.status(404).json({ error: 'Usuário não encontrado.' });
      }

      // Preço base da mensalidade
      const rowPrice = await query.get<{ valor: string }>(
        "SELECT valor FROM configuracoes WHERE chave = 'preco_mensalidade'"
      );
      const rowPromo = await query.get<{ valor: string }>(
        "SELECT valor FROM configuracoes WHERE chave = 'preco_primeiro_mes'"
      );
      const precoMensalidade = parseFloat(rowPrice?.valor || '21.90');
      const precoPrimeiroMes = parseFloat(rowPromo?.valor || '14.90');

      let valorTotal = 0;
      let pagouPrimeiroMes = (user.mensalidades_pagas || 0) > 0;

      for (let i = 0; i < meses; i++) {
        if (!pagouPrimeiroMes) {
          valorTotal += precoPrimeiroMes;
          pagouPrimeiroMes = true;
        } else {
          valorTotal += precoMensalidade;
        }
      }

      // Aplica descontos progressivos
      let descontoPercentual = 0;
      if (meses === 3) descontoPercentual = 5; // 5%
      else if (meses === 6) descontoPercentual = 10; // 10%
      else if (meses === 12) descontoPercentual = 20; // 20%

      const valorOriginal = valorTotal;
      const valorComDesconto = parseFloat((valorTotal * (1 - descontoPercentual / 100)).toFixed(2));

      const rowMpToken = await query.get<{ valor: string }>(
        "SELECT valor FROM configuracoes WHERE chave = 'saas_mp_access_token'"
      );
      const mpAccessToken = rowMpToken?.valor || process.env.MERCADO_PAGO_ACCESS_TOKEN;
      const serverUrl = process.env.SERVER_URL || '';

      let pixCopiaCola = '';
      let qrCodeUrl = '';

      if (mpAccessToken && mpAccessToken.startsWith('APP_USR')) {
        const payerFirstName = user.nome.split(' ')[0] || 'Assinante';
        const payerLastName = user.nome.split(' ').slice(1).join(' ') || 'Agendamente';
        const cleanCpf = user.cpf ? user.cpf.replace(/\D/g, '') : '00000000000';
        const payerIdentificationType = cleanCpf.length <= 11 ? 'CPF' : 'CNPJ';

        const mpPayload = {
          transaction_amount: valorComDesconto,
          description: `Mensalidade Agendamente - ${meses} mês(es)`,
          payment_method_id: 'pix',
          payer: {
            email: user.email,
            first_name: payerFirstName,
            last_name: payerLastName,
            identification: {
              type: payerIdentificationType,
              number: cleanCpf
            }
          },
          external_reference: `SAAS_usr${userId}_m${meses}_${Date.now()}`,
          notification_url: `${serverUrl}/api/public/webhooks/mercadopago`
        };

        const mpResponse = await fetch('https://api.mercadopago.com/v1/payments', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${mpAccessToken}`,
            'Content-Type': 'application/json',
            'X-Idempotency-Key': crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex')
          },
          body: JSON.stringify(mpPayload)
        });

        if (!mpResponse.ok) {
          const errBody = await mpResponse.text();
          console.error('Erro ao criar pagamento no Mercado Pago:', errBody);
          throw new Error('Falha ao gerar o pagamento Pix no Mercado Pago.');
        }

        const mpData = await mpResponse.json() as any;
        const qrCode = mpData.point_of_interaction?.transaction_data?.qr_code;
        const qrCodeBase64 = mpData.point_of_interaction?.transaction_data?.qr_code_base64;

        if (!qrCode || !qrCodeBase64) {
          throw new Error('Não foi possível obter os dados do Pix do Mercado Pago.');
        }

        pixCopiaCola = qrCode;
        qrCodeUrl = `data:image/png;base64,${qrCodeBase64}`;
      } else {
        // Fallback simulation
        const pixChave = '9f053f3e-57d4-4972-b9cc-2f0e2cb4af3f';
        const pixCheckout = generatePixCheckout(pixChave, valorComDesconto, 'AGENDAMENTE', `SAAS${userId}M${meses}`);
        pixCopiaCola = pixCheckout.pixCopiaCola;
        qrCodeUrl = pixCheckout.qrCodeUrl;
      }

      return res.json({
        mensalidade_dia: user.mensalidade_dia,
        assinatura_status: user.assinatura_status,
        assinatura_valida_ate: user.assinatura_valida_ate,
        valor: valorComDesconto,
        valorOriginal,
        descontoPercentual,
        pix_copia_cola: pixCopiaCola,
        qr_code_url: qrCodeUrl
      });
    } catch (err: any) {
      console.error(err);
      return res.status(500).json({ error: err.message || 'Erro interno ao obter status de faturamento.' });
    }
  }

  static async paySubscription(req: AuthenticatedRequest, res: Response) {
    const userId = req.userId;
    const { meses } = req.body;
    const numMeses = parseInt(meses || '1', 10);

    try {
      const user = await query.get<{
        mensalidade_dia: number,
        assinatura_valida_ate: string,
        mensalidades_pagas: number
      }>(
        'SELECT mensalidade_dia, assinatura_valida_ate, mensalidades_pagas FROM usuarios WHERE id = ?',
        [userId]
      );

      if (!user) {
        return res.status(404).json({ error: 'Usuário não encontrado.' });
      }

      let novoVencimento: string;
      const hojeStr = new Date().toISOString().split('T')[0];
      
      // Se a assinatura ainda é válida, estende a partir da data de vencimento atual
      // Caso contrário, recalcula o vencimento a partir de hoje
      if (user.assinatura_valida_ate && user.assinatura_valida_ate >= hojeStr) {
        novoVencimento = estenderVencimento(user.assinatura_valida_ate, user.mensalidade_dia, numMeses);
      } else {
        novoVencimento = calcularVencimento(user.mensalidade_dia, numMeses);
      }

      // Reativa e define novo vencimento, limpando contadores de aviso e incrementando mensalidades_pagas
      await query.run(
        'UPDATE usuarios SET assinatura_status = \'ativo\', assinatura_valida_ate = ?, ultimo_aviso_dias = 0, mensalidades_pagas = COALESCE(mensalidades_pagas, 0) + ? WHERE id = ?',
        [novoVencimento, numMeses, userId]
      );

      return res.json({
        message: `Assinatura renovada por ${numMeses} mês(es) com sucesso!`,
        assinatura_status: 'ativo',
        assinatura_valida_ate: novoVencimento
      });
    } catch (err: any) {
      console.error(err);
      return res.status(500).json({ error: 'Erro interno ao simular pagamento de mensalidade.' });
    }
  }

  static async mercadopagoWebhook(req: Request, res: Response) {
    console.log('[MercadoPago Webhook] Recebida notificação de webhook:', JSON.stringify(req.body), JSON.stringify(req.query));

    const paymentId = req.body.data?.id || req.body.id || req.query.id;
    const topic = req.body.type || req.body.action || req.query.topic;

    if (!paymentId) {
      console.log('[MercadoPago Webhook] Webhook ignorado. ID de pagamento não encontrado.');
      return res.status(200).send('OK');
    }

    if (topic && topic !== 'payment' && !topic.startsWith('payment.')) {
      console.log(`[MercadoPago Webhook] Notificação ignorada para tópico: ${topic}`);
      return res.status(200).send('OK');
    }

    try {
      const rowMpToken = await query.get<{ valor: string }>(
        "SELECT valor FROM configuracoes WHERE chave = 'saas_mp_access_token'"
      );
      const mpAccessToken = rowMpToken?.valor || process.env.MERCADO_PAGO_ACCESS_TOKEN;
      if (!mpAccessToken || !mpAccessToken.startsWith('APP_USR')) {
        console.error('[MercadoPago Webhook] Erro: Access Token do Mercado Pago não configurado corretamente.');
        return res.status(500).json({ error: 'Mercado Pago Token not configured' });
      }

      // 1. Evita processamento duplicado verificando no banco
      const alreadyProcessed = await query.get(
        'SELECT id FROM mensalidades_pagas_historico WHERE payment_id = ?',
        [String(paymentId)]
      );

      if (alreadyProcessed) {
        console.log(`[MercadoPago Webhook] Pagamento ${paymentId} já foi processado anteriormente.`);
        return res.status(200).send('OK');
      }

      // 2. Busca os detalhes do pagamento no Mercado Pago
      const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: {
          'Authorization': `Bearer ${mpAccessToken}`
        }
      });

      if (!mpResponse.ok) {
        console.error(`[MercadoPago Webhook] Erro ao buscar pagamento ${paymentId}: ${mpResponse.statusText}`);
        return res.status(mpResponse.status).send('Erro ao obter dados de pagamento.');
      }

      const payment = await mpResponse.json() as any;
      
      if (payment.status !== 'approved') {
        console.log(`[MercadoPago Webhook] Pagamento ${paymentId} está com status '${payment.status}'. Ignorando atualização.`);
        return res.status(200).send('OK');
      }

      const externalRef = payment.external_reference;
      if (!externalRef || !externalRef.startsWith('SAAS_usr')) {
        console.log(`[MercadoPago Webhook] Pagamento ${paymentId} ignorado pois possui external_reference inválido: ${externalRef}`);
        return res.status(200).send('OK');
      }

      const match = externalRef.match(/^SAAS_usr(\d+)_m(\d+)/);
      if (!match) {
        console.log(`[MercadoPago Webhook] Pagamento ${paymentId} ignorado. Padrão de external_reference inválido: ${externalRef}`);
        return res.status(200).send('OK');
      }

      const userId = parseInt(match[1], 10);
      const meses = parseInt(match[2], 10);
      const transactionAmount = payment.transaction_amount || 0.00;

      const user = await query.get<{
        mensalidade_dia: number,
        assinatura_valida_ate: string,
        assinatura_status: string
      }>(
        'SELECT mensalidade_dia, assinatura_valida_ate, assinatura_status FROM usuarios WHERE id = ?',
        [userId]
      );

      if (!user) {
        console.error(`[MercadoPago Webhook] Usuário ID ${userId} não encontrado para o pagamento ${paymentId}`);
        return res.status(404).send('Usuário não encontrado.');
      }

      let novoVencimento: string;
      const hojeStr = new Date().toISOString().split('T')[0];
      
      if (user.assinatura_valida_ate && user.assinatura_valida_ate >= hojeStr) {
        novoVencimento = estenderVencimento(user.assinatura_valida_ate, user.mensalidade_dia, meses);
      } else {
        novoVencimento = calcularVencimento(user.mensalidade_dia, meses);
      }

      await query.run(
        'INSERT INTO mensalidades_pagas_historico (usuario_id, payment_id, valor, meses) VALUES (?, ?, ?, ?)',
        [userId, String(paymentId), transactionAmount, meses]
      );

      await query.run(
        "UPDATE usuarios SET assinatura_status = 'ativo', assinatura_valida_ate = ?, ultimo_aviso_dias = 0, mensalidades_pagas = COALESCE(mensalidades_pagas, 0) + ? WHERE id = ?",
        [novoVencimento, meses, userId]
      );

      console.log(`[MercadoPago Webhook] Pagamento ${paymentId} processado com sucesso! Assinatura do Usuário ${userId} estendida até ${novoVencimento}.`);
      return res.status(200).send('OK');
    } catch (err: any) {
      console.error('[MercadoPago Webhook] Erro crítico ao processar webhook:', err);
      return res.status(500).send('Erro interno do servidor.');
    }
  }

  static async getMercadoPagoOAuthUrl(req: AuthenticatedRequest, res: Response) {
    const userId = req.userId;
    const clientId = process.env.MERCADO_PAGO_CLIENT_ID;
    const serverUrl = process.env.SERVER_URL || '';

    if (!clientId) {
      return res.status(500).json({ error: 'Mercado Pago Client ID não configurado no servidor.' });
    }

    const redirectUri = `${serverUrl}/api/public/oauth/mercadopago/callback`;
    const state = String(userId);
    const authUrl = `https://auth.mercadopago.com/authorization?client_id=${clientId}&response_type=code&platform_id=mp&state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}`;

    return res.json({ url: authUrl });
  }

  static async mercadopagoOAuthCallback(req: Request, res: Response) {
    const { code, state } = req.query;

    if (!code || !state) {
      console.error('[MercadoPago OAuth Callback] Parâmetros de redirecionamento inválidos.');
      return res.status(400).send('Código ou Estado inválido.');
    }

    const userId = parseInt(state as string, 10);
    const clientId = process.env.MERCADO_PAGO_CLIENT_ID;
    const clientSecret = process.env.MERCADO_PAGO_CLIENT_SECRET;
    const serverUrl = process.env.SERVER_URL || '';

    if (!clientId || !clientSecret) {
      console.error('[MercadoPago OAuth Callback] Chaves de aplicação OAuth não configuradas.');
      return res.status(500).send('Chaves de aplicação OAuth não configuradas no servidor.');
    }

    const redirectUri = `${serverUrl}/api/public/oauth/mercadopago/callback`;

    try {
      const response = await fetch('https://api.mercadopago.com/oauth/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'authorization_code',
          code: code as string,
          redirect_uri: redirectUri
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[MercadoPago OAuth Callback] Erro ao trocar token no Mercado Pago:', errorText);
        return res.status(500).send('Falha ao autenticar com o Mercado Pago.');
      }

      const tokenData = await response.json() as any;
      const accessToken = tokenData.access_token;
      const refreshToken = tokenData.refresh_token;
      const mpUserId = String(tokenData.user_id);

      if (!accessToken) {
        return res.status(500).send('Token de acesso não retornado pelo Mercado Pago.');
      }

      await query.run(
        'UPDATE usuarios SET mp_access_token = ?, mp_refresh_token = ?, mp_user_id = ?, mp_status_conexao = 1 WHERE id = ?',
        [accessToken, refreshToken, mpUserId, userId]
      );

      console.log(`[MercadoPago OAuth] Profissional ID ${userId} conectado com sucesso ao Mercado Pago (User ID MP: ${mpUserId}).`);

      return res.redirect(`${serverUrl}/admin#configuracoes?mp_connected=true`);
    } catch (err: any) {
      console.error('[MercadoPago OAuth Callback] Erro crítico ao processar login OAuth:', err);
      return res.status(500).send('Erro interno do servidor ao processar autorização.');
    }
  }

  static async disconnectMercadoPago(req: AuthenticatedRequest, res: Response) {
    const userId = req.userId;

    try {
      await query.run(
        'UPDATE usuarios SET mp_access_token = NULL, mp_refresh_token = NULL, mp_user_id = NULL, mp_status_conexao = 0 WHERE id = ?',
        [userId]
      );
      console.log(`[MercadoPago OAuth] Profissional ID ${userId} desconectou a conta do Mercado Pago.`);
      return res.json({ message: 'Mercado Pago desconectado com sucesso!' });
    } catch (err: any) {
      console.error(err);
      return res.status(500).json({ error: 'Erro interno ao desconectar Mercado Pago.' });
    }
  }
}
