import { query } from '../config/database';
import { Servico, Disponibilidade, Agendamento } from '../models/types';

// Helper: Converte string "HH:MM" ou "HH:MM:SS" para minutos desde a meia-noite
export function timeToMinutes(timeStr: string): number {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
}

// Helper: Converte minutos para string "HH:MM"
export function minutesToTime(mins: number): string {
  const hours = Math.floor(mins / 60);
  const minutes = mins % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

interface ActiveBooking {
  hora_inicio: string;
  hora_fim: string;
}

export class SchedulerService {
  /**
   * Calcula os slots livres de um profissional (ou funcionários dele) para um serviço específico em uma data.
   */
  static async getAvailableSlots(
    usuarioId: number,
    servicoId: number | number[],
    dataStr: string,
    funcionarioId?: number | string | null,
    excludeBookingId?: number
  ): Promise<string[]> {
    const ids = Array.isArray(servicoId) ? servicoId : [servicoId];
    if (ids.length === 0) {
      throw new Error('Pelo menos um serviço deve ser selecionado.');
    }

    // 1. Busca os detalhes dos serviços selecionados
    const servicePlaceholders = ids.map(() => '?').join(',');
    const servicos = await query.all<Servico>(
      `SELECT * FROM servicos WHERE id IN (${servicePlaceholders}) AND usuario_id = ?`,
      [...ids, usuarioId]
    );
    if (servicos.length !== ids.length) {
      throw new Error('Um ou mais serviços não foram encontrados ou não pertencem a este usuário.');
    }

    const duracao = servicos.reduce((total, s) => total + s.duracao_minutos, 0);

    // 2. Determina o dia da semana (0-6)
    const dataObj = new Date(`${dataStr}T12:00:00`);
    if (isNaN(dataObj.getTime())) {
      throw new Error('Formato de data inválido. Use AAAA-MM-DD.');
    }
    const diaSemana = dataObj.getDay();

    // 3. Busca as janelas de disponibilidade do estabelecimento para esse dia da semana
    const disponibilidades = await query.all<Disponibilidade>(
      'SELECT * FROM disponibilidades WHERE usuario_id = ? AND dia_semana = ? ORDER BY hora_inicio ASC',
      [usuarioId, diaSemana]
    );

    if (disponibilidades.length === 0) {
      return []; // Não trabalha nesse dia
    }

    // 4. Busca funcionários ativos que prestam TODOS os serviços selecionados
    const activeEmployees = await query.all<{ id: number }>(
      `SELECT f.id 
       FROM funcionarios f 
       WHERE f.usuario_id = ? AND f.ativo = 1
         AND (
           SELECT COUNT(DISTINCT fs.servico_id)
           FROM funcionario_servicos fs
           WHERE fs.funcionario_id = f.id AND fs.servico_id IN (${servicePlaceholders})
         ) = ?`,
      [usuarioId, ...ids, ids.length]
    );
    const employeeIds = activeEmployees.map(e => e.id);

    let agendamentosAtivos: any[] = [];
    const targetFuncId = funcionarioId && !isNaN(Number(funcionarioId)) ? Number(funcionarioId) : null;

    if (targetFuncId !== null) {
      // Caso A: Busca agendamentos apenas do funcionário selecionado
      agendamentosAtivos = await query.all(
        `SELECT a.hora_inicio, a.hora_fim, a.funcionario_id 
         FROM agendamentos a
         WHERE a.funcionario_id = ?
           AND a.data_agendamento = ?
           AND a.id != ?
           AND (a.presenca_confirmada IS NULL OR a.presenca_confirmada != 2)
           AND (
             a.status_pagamento = 'pago'
             OR a.metodo_pagamento = 'presencial'
             OR (a.status_pagamento = 'pendente' AND a.metodo_pagamento = 'pix' AND datetime(a.criado_em) >= datetime('now', '-10 minutes'))
           )`,
        [targetFuncId, dataStr, excludeBookingId || -1]
      );
    } else if (employeeIds.length > 0) {
      // Caso B: Busca agendamentos de todos os funcionários deste serviço (para consulta cruzada "Sem preferência")
      const placeholders = employeeIds.map(() => '?').join(',');
      agendamentosAtivos = await query.all(
        `SELECT a.hora_inicio, a.hora_fim, a.funcionario_id 
         FROM agendamentos a
         WHERE a.funcionario_id IN (${placeholders})
           AND a.data_agendamento = ?
           AND a.id != ?
           AND (a.presenca_confirmada IS NULL OR a.presenca_confirmada != 2)
           AND (
             a.status_pagamento = 'pago'
             OR a.metodo_pagamento = 'presencial'
             OR (a.status_pagamento = 'pendente' AND a.metodo_pagamento = 'pix' AND datetime(a.criado_em) >= datetime('now', '-10 minutes'))
           )`,
        [...employeeIds, dataStr, excludeBookingId || -1]
      );
    } else {
      // Caso C: Fallback para o proprietário (funcionario_id IS NULL)
      agendamentosAtivos = await query.all(
        `SELECT a.hora_inicio, a.hora_fim 
         FROM agendamentos a
         JOIN servicos s ON a.servico_id = s.id
         WHERE s.usuario_id = ? 
           AND a.funcionario_id IS NULL
           AND a.data_agendamento = ?
           AND a.id != ?
           AND (a.presenca_confirmada IS NULL OR a.presenca_confirmada != 2)
           AND (
             a.status_pagamento = 'pago'
             OR a.metodo_pagamento = 'presencial'
             OR (a.status_pagamento = 'pendente' AND a.metodo_pagamento = 'pix' AND datetime(a.criado_em) >= datetime('now', '-10 minutes'))
           )`,
        [usuarioId, dataStr, excludeBookingId || -1]
      );
    }

    const stepMinutos = 30; // Grade padrão de início a cada 30 minutos
    const hojeStr = new Date().toISOString().split('T')[0];
    let minutosLimiteHoje = -1;
    if (dataStr === hojeStr) {
      const agora = new Date();
      minutosLimiteHoje = agora.getHours() * 60 + agora.getMinutes();
    }

    const slotsDisponiveis: string[] = [];

    // 5. Varre cada intervalo de trabalho do dia
    for (const disp of disponibilidades) {
      const windowStart = timeToMinutes(disp.hora_inicio);
      const windowEnd = timeToMinutes(disp.hora_fim);

      let T = windowStart;
      while (T + duracao <= windowEnd) {
        const slotInicio = T;
        const slotFim = T + duracao;

        if (slotInicio <= minutosLimiteHoje) {
          T += stepMinutos;
          continue;
        }

        if (targetFuncId !== null) {
          // Mapeia e verifica conflito apenas com este profissional
          const hasOverlap = agendamentosAtivos.some((booking) => {
            const bInicio = timeToMinutes(booking.hora_inicio);
            const bFim = timeToMinutes(booking.hora_fim);
            return slotInicio < bFim && slotFim > bInicio;
          });

          if (!hasOverlap) {
            slotsDisponiveis.push(minutesToTime(slotInicio));
          }
        } else if (employeeIds.length > 0) {
          // "Sem preferência": O slot está livre se pelo menos um profissional estiver livre
          const hasAvailableEmployee = employeeIds.some((empId) => {
            const empBookings = agendamentosAtivos.filter(b => b.funcionario_id === empId);
            const empOverlap = empBookings.some((booking) => {
              const bInicio = timeToMinutes(booking.hora_inicio);
              const bFim = timeToMinutes(booking.hora_fim);
              return slotInicio < bFim && slotFim > bInicio;
            });
            return !empOverlap;
          });

          if (hasAvailableEmployee) {
            slotsDisponiveis.push(minutesToTime(slotInicio));
          }
        } else {
          // Caso C: Fallback para o proprietário
          const hasOverlap = agendamentosAtivos.some((booking) => {
            const bInicio = timeToMinutes(booking.hora_inicio);
            const bFim = timeToMinutes(booking.hora_fim);
            return slotInicio < bFim && slotFim > bInicio;
          });

          if (!hasOverlap) {
            slotsDisponiveis.push(minutesToTime(slotInicio));
          }
        }

        T += stepMinutos;
      }
    }

    return slotsDisponiveis;
  }

  /**
   * Valida se um horário específico para agendamento está disponível.
   */
  static async isSlotAvailable(
    usuarioId: number,
    servicoId: number | number[],
    dataStr: string,
    horaInicioStr: string,
    funcionarioId?: number | string | null,
    excludeBookingId?: number
  ): Promise<boolean> {
    const slots = await this.getAvailableSlots(
      usuarioId,
      servicoId,
      dataStr,
      funcionarioId,
      excludeBookingId
    );
    return slots.includes(horaInicioStr);
  }
}
