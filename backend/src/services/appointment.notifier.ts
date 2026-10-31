import { query } from '../config/database';
import { WhatsAppService } from './whatsapp.service';

export async function runAppointmentNotificationCheck() {
  console.log('[AppointmentNotifier] Iniciando verificação de lembretes de agendamentos...');

  try {
    const now = new Date();
    
    // Formata datas locais como YYYY-MM-DD
    const getLocalDateStr = (d: Date) => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    const todayStr = getLocalDateStr(now);
    
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = getLocalDateStr(tomorrow);

    console.log(`[AppointmentNotifier] Hoje: ${todayStr} | Amanhã: ${tomorrowStr}`);

    // Busca agendamentos ativos para hoje ou amanhã
    const appointments = await query.all<{
      id: number;
      cliente_nome: string;
      cliente_whatsapp: string;
      data_agendamento: string;
      hora_inicio: string;
      checkout_id: string;
      lembrete_1_dia_enviado: number;
      lembrete_dia_enviado: number;
      presenca_confirmada: number;
      criado_em: string;
      servico_nome: string;
      funcionario_nome: string | null;
      funcionario_id: number | null;
      funcionario_escolhido: number;
      dono_nome: string;
      dono_whatsapp: string;
      has_employees: number;
    }>(
      `SELECT 
        a.id,
        a.cliente_nome,
        a.cliente_whatsapp,
        a.data_agendamento,
        a.hora_inicio,
        a.checkout_id,
        COALESCE(a.lembrete_1_dia_enviado, 0) as lembrete_1_dia_enviado,
        COALESCE(a.lembrete_dia_enviado, 0) as lembrete_dia_enviado,
        COALESCE(a.presenca_confirmada, 0) as presenca_confirmada,
        a.criado_em,
        s.nome as servico_nome,
        f.nome as funcionario_nome,
        a.funcionario_id,
        COALESCE(a.funcionario_escolhido, 0) as funcionario_escolhido,
        COALESCE(NULLIF(u.nome_estabelecimento, ''), u.nome) as dono_nome,
        u.whatsapp as dono_whatsapp,
        (SELECT COUNT(*) FROM funcionarios WHERE usuario_id = u.id AND ativo = 1) as has_employees
      FROM agendamentos a
      JOIN servicos s ON a.servico_id = s.id
      JOIN usuarios u ON s.usuario_id = u.id
      LEFT JOIN funcionarios f ON a.funcionario_id = f.id
      WHERE (a.status_pagamento = 'pago' OR a.metodo_pagamento = 'presencial')
        AND (a.presenca_confirmada IS NULL OR a.presenca_confirmada != 2)
        AND (a.data_agendamento = ? OR a.data_agendamento = ?)`,
      [todayStr, tomorrowStr]
    );

    console.log(`[AppointmentNotifier] Total de agendamentos localizados para verificação: ${appointments.length}`);

    for (const app of appointments) {
      const profName = (app.funcionario_id && app.funcionario_escolhido === 1 && app.has_employees > 0)
        ? app.funcionario_nome
        : null;

      // Calcular tempo restante local para o início do agendamento
      const [year, month, day] = app.data_agendamento.split('-').map(Number);
      const [hours, minutes] = app.hora_inicio.split(':').map(Number);
      const appTime = new Date(year, month - 1, day, hours, minutes, 0, 0);

      const diffMs = appTime.getTime() - now.getTime();
      const diffHours = diffMs / (1000 * 60 * 60);

      // 1. Cobrança de confirmação de presença (Enviada 2 horas antes)
      if (app.presenca_confirmada === 0 && app.lembrete_1_dia_enviado === 0) {
        if (diffHours > 0 && diffHours <= 2) {
          const baseUrl = process.env.SERVER_URL || 'http://localhost:3000';
          const confirmLink = `${baseUrl}/confirmar-presenca?id=${app.id}&token=${app.checkout_id}`;
          await WhatsAppService.sendReminder(
            app.dono_whatsapp,
            app.cliente_whatsapp,
            app.cliente_nome,
            app.servico_nome,
            app.data_agendamento,
            app.hora_inicio,
            profName,
            '1_day',
            confirmLink
          );

          await query.run(
            'UPDATE agendamentos SET lembrete_1_dia_enviado = 1 WHERE id = ?',
            [app.id]
          );
          console.log(`[AppointmentNotifier] Lembrete de confirmação (2h antes) enviado com sucesso para ${app.cliente_nome} (ID: ${app.id})`);
          continue;
        }
      }

      // 2. Auto-cancelamento automático por falta de confirmação (1 hora antes)
      if (app.presenca_confirmada === 0) {
        if (diffHours > 0 && diffHours <= 1) {
          // Carência: evita cancelar se o agendamento foi agendado há menos de 1.5 horas
          const criadoEm = new Date(app.criado_em.replace(' ', 'T') + 'Z');
          const ageMs = now.getTime() - criadoEm.getTime();
          const ageHours = ageMs / (1000 * 60 * 60);

          if (ageHours < 1.5) {
            console.log(`[AppointmentNotifier] Pulando auto-cancelamento do agendamento ID ${app.id} (criado há apenas ${ageHours.toFixed(2)}h)`);
            continue;
          }

          console.log(`[AppointmentNotifier] Auto-cancelando agendamento ID ${app.id} por falta de confirmação (Faltam ${diffHours.toFixed(2)}h)`);
          
          await query.run(
            'UPDATE agendamentos SET presenca_confirmada = 2 WHERE id = ?',
            [app.id]
          );

          await WhatsAppService.sendReminder(
            app.dono_whatsapp,
            app.cliente_whatsapp,
            app.cliente_nome,
            app.servico_nome,
            app.data_agendamento,
            app.hora_inicio,
            profName,
            'cancellation_notice'
          );
          continue;
        }
      }

      // 3. Lembrete simples de "É hoje!" (Apenas para clientes já confirmados)
      if (app.presenca_confirmada === 1 && app.lembrete_dia_enviado === 0 && app.data_agendamento === todayStr) {
        if (diffHours > 1 && diffHours <= 6) {
          await WhatsAppService.sendReminder(
            app.dono_whatsapp,
            app.cliente_whatsapp,
            app.cliente_nome,
            app.servico_nome,
            app.data_agendamento,
            app.hora_inicio,
            profName,
            'day_of'
          );

          await query.run(
            'UPDATE agendamentos SET lembrete_dia_enviado = 1 WHERE id = ?',
            [app.id]
          );
          console.log(`[AppointmentNotifier] Lembrete do dia enviado para cliente confirmado ${app.cliente_nome} (ID: ${app.id})`);
        }
      }
    }

    console.log('[AppointmentNotifier] Varredura de lembretes concluída.');
  } catch (err: any) {
    console.error('[AppointmentNotifier] Erro ao processar lembretes:', err.message);
  }
}
