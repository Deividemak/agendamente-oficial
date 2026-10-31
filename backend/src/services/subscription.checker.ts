import { query } from '../config/database';
import { MailService } from './mail.service';

export async function runDailySubscriptionCheck() {
  console.log('[SubscriptionChecker] Iniciando verificação diária de mensalidades...');
  
  try {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    // Busca todos os usuários ativos ou bloqueados
    const users = await query.all(
      'SELECT id, nome, email, assinatura_status, assinatura_valida_ate, ultimo_aviso_dias FROM usuarios'
    );

    for (const user of users) {
      if (!user.assinatura_valida_ate) {
        continue;
      }

      // Evita problemas de timezone fazendo parse manual de YYYY-MM-DD
      const partes = user.assinatura_valida_ate.split('-');
      if (partes.length !== 3) continue;
      
      const validaAte = new Date(parseInt(partes[0], 10), parseInt(partes[1], 10) - 1, parseInt(partes[2], 10));
      validaAte.setHours(0, 0, 0, 0);

      const diffTime = validaAte.getTime() - hoje.getTime();
      const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

      console.log(`[SubscriptionChecker] Usuário: ${user.email} | Status: ${user.assinatura_status} | Vence em: ${user.assinatura_valida_ate} | Dias restantes: ${diffDays}`);

      if (diffDays === 3) {
        if (user.ultimo_aviso_dias !== 3) {
          await MailService.sendSubscriptionWarning(user.email, 3, user.assinatura_valida_ate);
          await query.run('UPDATE usuarios SET ultimo_aviso_dias = 3 WHERE id = ?', [user.id]);
          console.log(`[SubscriptionChecker] E-mail de aviso de 3 dias enviado para ${user.email}`);
        }
      } else if (diffDays === 2) {
        if (user.ultimo_aviso_dias !== 2) {
          await MailService.sendSubscriptionWarning(user.email, 2, user.assinatura_valida_ate);
          await query.run('UPDATE usuarios SET ultimo_aviso_dias = 2 WHERE id = ?', [user.id]);
          console.log(`[SubscriptionChecker] E-mail de aviso de 2 dias enviado para ${user.email}`);
        }
      } else if (diffDays === 1) {
        if (user.ultimo_aviso_dias !== 1) {
          await MailService.sendSubscriptionWarning(user.email, 1, user.assinatura_valida_ate);
          await query.run('UPDATE usuarios SET ultimo_aviso_dias = 1 WHERE id = ?', [user.id]);
          console.log(`[SubscriptionChecker] E-mail de aviso de 1 dia enviado para ${user.email}`);
        }
      } else if (diffDays < 0) {
        // Bloqueia acesso se já passou do dia de vencimento
        if (user.assinatura_status === 'ativo') {
          await query.run(
            "UPDATE usuarios SET assinatura_status = 'bloqueado', ultimo_aviso_dias = -1 WHERE id = ?",
            [user.id]
          );
          await MailService.sendSubscriptionBlocked(user.email);
          console.log(`[SubscriptionChecker] Usuário ${user.email} BLOQUEADO por falta de pagamento.`);
        }
      }
    }
    console.log('[SubscriptionChecker] Verificação concluída.');
  } catch (err: any) {
    console.error('[SubscriptionChecker] Erro ao verificar assinaturas:', err.message);
  }
}
