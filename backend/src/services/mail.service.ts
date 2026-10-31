import nodemailer from 'nodemailer';
import { query } from '../config/database';

export class MailService {
  /**
   * Envia um e-mail de redefinição de senha para o usuário.
   */
  static async sendResetEmail(email: string, resetLink: string): Promise<void> {
    const host = process.env.SMTP_HOST;
    const port = parseInt(process.env.SMTP_PORT || '587', 10);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const from = process.env.SMTP_FROM || 'no-reply@agendamente.com.br';

    const htmlContent = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
        <div style="text-align: center; margin-bottom: 20px;">
          <h2 style="color: #4f46e5; margin: 0;">Agendamente</h2>
          <p style="color: #64748b; font-size: 14px; margin: 5px 0 0 0;">MVP SaaS de Agendamentos Automatizados</p>
        </div>
        <hr style="border: 0; border-top: 1px solid #f1f5f9; margin-bottom: 20px;" />
        <h3 style="color: #0f172a; margin-top: 0;">Recuperação de Senha</h3>
        <p>Olá,</p>
        <p>Recebemos uma solicitação para redefinir a senha da sua conta no Agendamente.</p>
        <p>Para prosseguir e escolher uma nova senha, clique no botão abaixo. Este link é válido por **1 hora**.</p>
        <div style="margin: 30px 0; text-align: center;">
          <a href="${resetLink}" style="background-color: #4f46e5; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">Redefinir Minha Senha</a>
        </div>
        <p style="color: #64748b; font-size: 14px; line-height: 1.5;">Se você não realizou esta solicitação, nenhuma ação adicional é necessária e sua senha atual permanecerá segura.</p>
        <hr style="border: 0; border-top: 1px solid #f1f5f9; margin: 25px 0 20px 0;" />
        <p style="color: #94a3b8; font-size: 11px; text-align: center; margin: 0;">Este é um e-mail automático. Por favor, não responda.</p>
      </div>
    `;

    if (host && user && pass) {
      try {
        const transporter = nodemailer.createTransport({
          host,
          port,
          secure: port === 465,
          auth: { user, pass }
        });

        await transporter.sendMail({
          from,
          to: email,
          subject: 'Recuperação de Senha - Agendamente',
          html: htmlContent
        });
        console.log(`[SMTP] E-mail de redefinição enviado com sucesso para: ${email}`);
      } catch (err: any) {
        console.error(`[SMTP] Falha ao enviar e-mail via SMTP: ${err.message}`);
        this.logFallback(email, resetLink);
      }
    } else {
      this.logFallback(email, resetLink);
    }
  }

  /**
   * Envia um e-mail de confirmação de cadastro para o usuário.
   */
  static async sendVerificationEmail(email: string, confirmLink: string): Promise<void> {
    const host = process.env.SMTP_HOST;
    const port = parseInt(process.env.SMTP_PORT || '587', 10);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const from = process.env.SMTP_FROM || 'no-reply@agendamente.com.br';

    const htmlContent = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
        <div style="text-align: center; margin-bottom: 20px;">
          <h2 style="color: #4f46e5; margin: 0;">Agendamente</h2>
          <p style="color: #64748b; font-size: 14px; margin: 5px 0 0 0;">SaaS de Agendamentos Automatizados</p>
        </div>
        <hr style="border: 0; border-top: 1px solid #f1f5f9; margin-bottom: 20px;" />
        <h3 style="color: #0f172a; margin-top: 0;">Confirmação de E-mail</h3>
        <p>Olá,</p>
        <p>Obrigado por se cadastrar no Agendamente!</p>
        <p>Para ativar sua conta e ter acesso ao seu Painel Administrativo, por favor confirme seu endereço de e-mail clicando no botão abaixo:</p>
        <div style="margin: 30px 0; text-align: center;">
          <a href="${confirmLink}" style="background-color: #4f46e5; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">Ativar Minha Conta</a>
        </div>
        <p style="color: #64748b; font-size: 14px; line-height: 1.5;">Caso você não tenha se cadastrado na nossa plataforma, por favor ignore este e-mail.</p>
        <hr style="border: 0; border-top: 1px solid #f1f5f9; margin: 25px 0 20px 0;" />
        <p style="color: #94a3b8; font-size: 11px; text-align: center; margin: 0;">Este é um e-mail automático. Por favor, não responda.</p>
      </div>
    `;

    if (host && user && pass) {
      try {
        const transporter = nodemailer.createTransport({
          host,
          port,
          secure: port === 465,
          auth: { user, pass }
        });

        await transporter.sendMail({
          from,
          to: email,
          subject: 'Confirme seu E-mail - Agendamente',
          html: htmlContent
        });
        console.log(`[SMTP] E-mail de confirmação enviado para: ${email}`);
      } catch (err: any) {
        console.error(`[SMTP] Falha ao enviar confirmação SMTP: ${err.message}`);
        this.logVerificationFallback(email, confirmLink);
      }
    } else {
      this.logVerificationFallback(email, confirmLink);
    }
  }

  /**
   * Envia um código de confirmação de segurança para o administrador.
   */
  static async sendSecurityCode(email: string, code: string): Promise<void> {
    const host = process.env.SMTP_HOST;
    const port = parseInt(process.env.SMTP_PORT || '587', 10);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const from = process.env.SMTP_FROM || 'no-reply@agendamente.com.br';

    const htmlContent = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
        <div style="text-align: center; margin-bottom: 20px;">
          <h2 style="color: #4f46e5; margin: 0;">Agendamente</h2>
          <p style="color: #64748b; font-size: 14px; margin: 5px 0 0 0;">SaaS de Agendamentos Automatizados</p>
        </div>
        <hr style="border: 0; border-top: 1px solid #f1f5f9; margin-bottom: 20px;" />
        <h3 style="color: #0f172a; margin-top: 0;">Código de Confirmação de Segurança</h3>
        <p>Olá,</p>
        <p>Você solicitou uma alteração nos dados da sua conta de administrador (nome, e-mail ou senha) no painel do Agendamente.</p>
        <p>Para confirmar esta alteração, utilize o código de 6 dígitos abaixo. Este código é válido por **15 minutos**.</p>
        <div style="margin: 30px 0; text-align: center;">
          <span style="font-size: 32px; font-weight: bold; color: #4f46e5; background-color: #f1f5f9; padding: 10px 20px; border-radius: 8px; display: inline-block; letter-spacing: 5px;">${code}</span>
        </div>
        <p style="color: #64748b; font-size: 14px; line-height: 1.5;">Se você não realizou esta solicitação, por favor altere sua senha imediatamente, pois isso pode indicar que sua conta foi comprometida.</p>
        <hr style="border: 0; border-top: 1px solid #f1f5f9; margin: 25px 0 20px 0;" />
        <p style="color: #94a3b8; font-size: 11px; text-align: center; margin: 0;">Este é um e-mail automático. Por favor, não responda.</p>
      </div>
    `;

    if (host && user && pass) {
      try {
        const transporter = nodemailer.createTransport({
          host,
          port,
          secure: port === 465,
          auth: { user, pass }
        });

        await transporter.sendMail({
          from,
          to: email,
          subject: 'Código de Confirmação de Segurança - Agendamente',
          html: htmlContent
        });
        console.log(`[SMTP] Código de confirmação enviado para: ${email}`);
      } catch (err: any) {
        console.error(`[SMTP] Falha ao enviar código de segurança SMTP: ${err.message}`);
        this.logSecurityCodeFallback(email, code);
      }
    } else {
      this.logSecurityCodeFallback(email, code);
    }
  }

  private static logSecurityCodeFallback(email: string, code: string): void {
    console.log('\n================================================================');
    console.log('📬 SIMULAÇÃO DE E-MAIL (SMTP NÃO CONFIGURADO NO .ENV)');
    console.log(`Para: ${email}`);
    console.log('Assunto: Código de Confirmação de Segurança - Agendamente');
    console.log(`Código de Segurança: ${code}`);
    console.log('================================================================\n');
  }

  private static logVerificationFallback(email: string, confirmLink: string): void {
    console.log('\n================================================================');
    console.log('📬 SIMULAÇÃO DE E-MAIL (SMTP NÃO CONFIGURADO NO .ENV)');
    console.log(`Para: ${email}`);
    console.log('Assunto: Confirme seu E-mail - Agendamente');
    console.log(`Link de Confirmação: ${confirmLink}`);
    console.log('================================================================\n');
  }

  private static logFallback(email: string, resetLink: string): void {
    console.log('\n================================================================');
    console.log('📬 SIMULAÇÃO DE E-MAIL (SMTP NÃO CONFIGURADO NO .ENV)');
    console.log(`Para: ${email}`);
    console.log('Assunto: Recuperação de Senha - Agendamente');
    console.log(`Link de Redefinição: ${resetLink}`);
    console.log('================================================================\n');
  }

  static async sendSubscriptionWarning(email: string, diasRestantes: number, dataVencimento: string): Promise<void> {
    const host = process.env.SMTP_HOST;
    const port = parseInt(process.env.SMTP_PORT || '587', 10);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const from = process.env.SMTP_FROM || 'no-reply@agendamente.com.br';

    let preco = '21,90';
    try {
      const configRow = await query.get<{ valor: string }>(
        "SELECT valor FROM configuracoes WHERE chave = 'preco_mensalidade'"
      );
      if (configRow?.valor) {
        preco = parseFloat(configRow.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      }
    } catch (err) {
      console.error('Erro ao obter preco da mensalidade para email:', err);
    }

    const htmlContent = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
        <div style="text-align: center; margin-bottom: 20px;">
          <h2 style="color: #4f46e5; margin: 0;">Agendamente</h2>
          <p style="color: #64748b; font-size: 14px; margin: 5px 0 0 0;">SaaS de Agendamentos Automatizados</p>
        </div>
        <hr style="border: 0; border-top: 1px solid #f1f5f9; margin-bottom: 20px;" />
        <h3 style="color: #b45309; margin-top: 0;">Aviso de Vencimento de Mensalidade</h3>
        <p>Olá,</p>
        <p>Informamos que a mensalidade da sua assinatura do **Agendamente** vencerá em **${diasRestantes} ${diasRestantes === 1 ? 'dia' : 'dias'}** (no dia **${dataVencimento}**).</p>
        <p>Para evitar a suspensão temporária do seu painel e da sua página de agendamentos online, por favor efectue o pagamento da mensalidade de **R$ ${preco}**.</p>
        <p>Você pode realizar o pagamento Pix diretamente na sua Área Administrativa clicando no botão abaixo:</p>
        <div style="margin: 30px 0; text-align: center;">
          <a href="http://localhost:3000/admin-login" style="background-color: #4f46e5; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">Ir Para a Área Financeira</a>
        </div>
        <p style="color: #64748b; font-size: 14px; line-height: 1.5;">O processo é 100% automático e o seu acesso é liberado instantaneamente após a confirmação do pagamento.</p>
        <hr style="border: 0; border-top: 1px solid #f1f5f9; margin: 25px 0 20px 0;" />
        <p style="color: #94a3b8; font-size: 11px; text-align: center; margin: 0;">Este é um e-mail automático. Por favor, não responda.</p>
      </div>
    `;

    if (host && user && pass) {
      try {
        const transporter = nodemailer.createTransport({
          host,
          port,
          secure: port === 465,
          auth: { user, pass }
        });

        await transporter.sendMail({
          from,
          to: email,
          subject: `Aviso de Vencimento: ${diasRestantes} ${diasRestantes === 1 ? 'dia' : 'dias'} restante(s) - Agendamente`,
          html: htmlContent
        });
        console.log(`[SMTP] E-mail de aviso de vencimento de ${diasRestantes} dias enviado para: ${email}`);
      } catch (err: any) {
        console.error(`[SMTP] Falha ao enviar aviso de vencimento SMTP: ${err.message}`);
        this.logSubscriptionWarningFallback(email, diasRestantes, dataVencimento);
      }
    } else {
      this.logSubscriptionWarningFallback(email, diasRestantes, dataVencimento);
    }
  }

  static async sendSubscriptionBlocked(email: string): Promise<void> {
    const host = process.env.SMTP_HOST;
    const port = parseInt(process.env.SMTP_PORT || '587', 10);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const from = process.env.SMTP_FROM || 'no-reply@agendamente.com.br';

    let preco = '21,90';
    try {
      const configRow = await query.get<{ valor: string }>(
        "SELECT valor FROM configuracoes WHERE chave = 'preco_mensalidade'"
      );
      if (configRow?.valor) {
        preco = parseFloat(configRow.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      }
    } catch (err) {
      console.error('Erro ao obter preco da mensalidade para email:', err);
    }

    const htmlContent = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
        <div style="text-align: center; margin-bottom: 20px;">
          <h2 style="color: #e11d48; margin: 0;">Agendamente</h2>
          <p style="color: #64748b; font-size: 14px; margin: 5px 0 0 0;">SaaS de Agendamentos Automatizados</p>
        </div>
        <hr style="border: 0; border-top: 1px solid #f1f5f9; margin-bottom: 20px;" />
        <h3 style="color: #e11d48; margin-top: 0;">Acesso Suspenso - Mensalidade em Atraso</h3>
        <p>Olá,</p>
        <p>Lamentamos informar que o seu acesso ao **Agendamente** e a sua página de agendamentos foram temporariamente **suspensos** devido ao não pagamento da sua mensalidade de **R$ ${preco}**.</p>
        <p>Para restabelecer o seu acesso e permitir que seus clientes voltem a agendar horários com você, por favor realize o pagamento.</p>
        <p>Você pode acessar a tela de pagamento digitando suas credenciais de acesso no link abaixo:</p>
        <div style="margin: 30px 0; text-align: center;">
          <a href="http://localhost:3000/admin-login" style="background-color: #e11d48; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">Realizar Pagamento Pix</a>
        </div>
        <p style="color: #64748b; font-size: 14px; line-height: 1.5;">Após efetuar o pagamento Pix e clicar em confirmar na tela, a sua conta será reativada automaticamente e de forma instantânea.</p>
        <hr style="border: 0; border-top: 1px solid #f1f5f9; margin: 25px 0 20px 0;" />
        <p style="color: #94a3b8; font-size: 11px; text-align: center; margin: 0;">Este é um e-mail automático. Por favor, não responda.</p>
      </div>
    `;

    if (host && user && pass) {
      try {
        const transporter = nodemailer.createTransport({
          host,
          port,
          secure: port === 465,
          auth: { user, pass }
        });

        await transporter.sendMail({
          from,
          to: email,
          subject: 'Acesso Suspenso por Atraso - Agendamente',
          html: htmlContent
        });
        console.log(`[SMTP] E-mail de suspensão de acesso enviado para: ${email}`);
      } catch (err: any) {
        console.error(`[SMTP] Falha ao enviar e-mail de suspensão SMTP: ${err.message}`);
        this.logSubscriptionBlockedFallback(email);
      }
    } else {
      this.logSubscriptionBlockedFallback(email);
    }
  }

  private static logSubscriptionWarningFallback(email: string, diasRestantes: number, dataVencimento: string): void {
    console.log('\n================================================================');
    console.log('📬 SIMULAÇÃO DE E-MAIL (SMTP NÃO CONFIGURADO NO .ENV)');
    console.log(`Para: ${email}`);
    console.log(`Assunto: Aviso de Vencimento: ${diasRestantes} dia(s) restante(s) - Agendamente`);
    console.log(`Corpo: Sua mensalidade vence dia ${dataVencimento}. Regularize para evitar o bloqueio.`);
    console.log('================================================================\n');
  }

  private static logSubscriptionBlockedFallback(email: string): void {
    console.log('\n================================================================');
    console.log('📬 SIMULAÇÃO DE E-MAIL (SMTP NÃO CONFIGURADO NO .ENV)');
    console.log(`Para: ${email}`);
    console.log('Assunto: Acesso Suspenso por Atraso - Agendamente');
    console.log('Corpo: Seu acesso foi bloqueado por falta de pagamento. Acesse o painel para pagar.');
    console.log('================================================================\n');
  }
}
