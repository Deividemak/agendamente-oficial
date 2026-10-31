import { query } from '../config/database';
import { EvolutionService } from './evolution.service';

export class WhatsAppService {
  /**
   * Envia ou simula o envio de uma mensagem de WhatsApp de lembrete para o cliente.
   */
  static async sendReminder(
    senderPhone: string,
    to: string,
    clientName: string,
    serviceName: string,
    dateStr: string,
    timeStr: string,
    professionalName: string | null,
    type: '1_day' | 'day_of' | 'cancellation_notice' | 'presence_confirmed' | 'presence_cancelled' | 'booking_confirmed' | 'payment_confirmed',
    confirmLink?: string
  ): Promise<void> {
    const formattedSender = this.formatPhoneDisplay(senderPhone);
    const formattedPhone = this.formatPhoneDisplay(to);
    const dateFormatted = this.formatDateBR(dateStr);

    let message = '';
    if (type === '1_day') {
      message = `Olá, *${clientName}*! Passando para lembrar que você tem um agendamento de *${serviceName}* marcado para às *${timeStr}*h (dia *${dateFormatted}*)${
        professionalName ? ` com o profissional *${professionalName}*` : ''
      }.\n\n⚠️ *ATENÇÃO:* Por favor, confirme ou cancele sua presença pelo link abaixo nas próximas horas. *Caso não confirme, seu horário será cancelado automaticamente.*\n\n🔗 Clique aqui para confirmar: ${confirmLink || ''}`;
    } else if (type === 'day_of') {
      message = `Olá, *${clientName}*! Lembramos que hoje é o dia do seu agendamento de *${serviceName}* às *${timeStr}*h${
        professionalName ? ` com o profissional *${professionalName}*` : ''
      }. Te esperamos!`;
    } else if (type === 'cancellation_notice') {
      message = `Olá, *${clientName}*! Seu agendamento de *${serviceName}* marcado para *${dateFormatted}* às *${timeStr}*h foi cancelado automaticamente por falta de confirmação de presença. O horário foi liberado para outros clientes.`;
    } else if (type === 'presence_confirmed') {
      message = `Olá, *${clientName}*! Sua presença foi *confirmada* com sucesso para o agendamento de *${serviceName}* no dia *${dateFormatted}* às *${timeStr}*h${
        professionalName ? ` com o profissional *${professionalName}*` : ''
      }. Te esperamos lá!`;
    } else if (type === 'presence_cancelled') {
      message = `Olá, *${clientName}*! Seu agendamento de *${serviceName}* no dia *${dateFormatted}* às *${timeStr}*h foi *cancelado* com sucesso. O horário foi liberado para outros clientes.`;
    } else if (type === 'booking_confirmed') {
      message = `Olá, *${clientName}*! Seu agendamento de *${serviceName}* foi realizado com sucesso para o dia *${dateFormatted}* às *${timeStr}*h${
        professionalName ? ` com o profissional *${professionalName}*` : ''
      }. Te esperamos!`;
    } else if (type === 'payment_confirmed') {
      message = `Olá, *${clientName}*! Seu pagamento foi confirmado e seu agendamento de *${serviceName}* está garantido para o dia *${dateFormatted}* às *${timeStr}*h${
        professionalName ? ` com o profissional *${professionalName}*` : ''
      }. Te esperamos!`;
    }

    // Tenta obter a instância ativa do remetente e o endereço do estabelecimento
    let sentReal = false;
    try {
      const cleanSender = senderPhone.replace(/\D/g, '');
      const owner = await query.get<{
        whatsapp_instancia_nome: string | null;
        whatsapp_instancia_status: string | null;
        endereco: string | null;
        endereco_link: string | null;
      }>(
        'SELECT whatsapp_instancia_nome, whatsapp_instancia_status, endereco, endereco_link FROM usuarios WHERE whatsapp = ? OR whatsapp = ?',
        [senderPhone, cleanSender]
      );

      if (owner && owner.endereco) {
        const tiposemEndereco = ['cancellation_notice', 'presence_cancelled'];
        if (!tiposemEndereco.includes(type)) {
          message += `\n\n📍 *Endereço:* ${owner.endereco}`;
          if (owner.endereco_link) {
            message += `\n🗺️ *Como Chegar:* ${owner.endereco_link}`;
          } else {
            const encoded = encodeURIComponent(owner.endereco);
            message += `\n🗺️ *Como Chegar:* https://www.google.com/maps/search/?api=1&query=${encoded}`;
          }
        }
      }

      if (
        owner &&
        owner.whatsapp_instancia_nome &&
        owner.whatsapp_instancia_status === 'conectado' &&
        EvolutionService.isEnabled()
      ) {
        sentReal = await EvolutionService.sendTextMessage(
          owner.whatsapp_instancia_nome,
          to,
          message
        );
      }
    } catch (err: any) {
      console.error('[WhatsAppService] Erro ao tentar enviar mensagem real:', err.message);
    }

    if (sentReal) {
      console.log('\n================================================================');
      console.log('📱 WHATSAPP REAL DISPARADO COM SUCESSO (VIA EVOLUTION API)');
      console.log(`Enviado por: ${formattedSender}`);
      console.log(`Para: ${formattedPhone} (Cliente: ${clientName})`);
      console.log(`Mensagem: ${message}`);
      console.log('================================================================\n');
    } else {
      console.log('\n================================================================');
      console.log('📱 SIMULAÇÃO DE WHATSAPP (MENSAGEM AUTOMÁTICA ENVIADA)');
      console.log(`Enviado por: ${formattedSender}`);
      console.log(`Para: ${formattedPhone} (Cliente: ${clientName})`);
      console.log(`Mensagem: ${message}`);
      console.log('================================================================\n');
    }
  }

  /**
   * Envia ou simula o envio de uma notificação de WhatsApp para o funcionário sobre eventos de agendamento.
   */
  static async sendEmployeeNotification(
    senderPhone: string,
    toEmployeePhone: string,
    employeeName: string,
    clientName: string,
    serviceName: string,
    dateStr: string,
    timeStr: string,
    type: 'new_booking' | 'rescheduled' | 'cancelled'
  ): Promise<void> {
    const formattedSender = this.formatPhoneDisplay(senderPhone);
    const formattedEmployee = this.formatPhoneDisplay(toEmployeePhone);
    const dateFormatted = this.formatDateBR(dateStr);

    let message = '';
    if (type === 'new_booking') {
      message = `Olá, *${employeeName}*! Você tem um *novo agendamento* de *${serviceName}* com o cliente *${clientName}* marcado para o dia *${dateFormatted}* às *${timeStr}*h.`;
    } else if (type === 'rescheduled') {
      message = `Olá, *${employeeName}*! Atenção: o seu agendamento de *${serviceName}* com o cliente *${clientName}* foi *reagendado* para o dia *${dateFormatted}* às *${timeStr}*h.`;
    } else if (type === 'cancelled') {
      message = `Olá, *${employeeName}*! Atenção: o seu agendamento de *${serviceName}* com o cliente *${clientName}* que seria no dia *${dateFormatted}* às *${timeStr}*h foi *cancelado*.`;
    }

    // Tenta obter a instância ativa do remetente
    let sentReal = false;
    try {
      const cleanSender = senderPhone.replace(/\D/g, '');
      const owner = await query.get<{
        whatsapp_instancia_nome: string | null;
        whatsapp_instancia_status: string | null;
      }>(
        'SELECT whatsapp_instancia_nome, whatsapp_instancia_status FROM usuarios WHERE whatsapp = ? OR whatsapp = ?',
        [senderPhone, cleanSender]
      );

      if (
        owner &&
        owner.whatsapp_instancia_nome &&
        owner.whatsapp_instancia_status === 'conectado' &&
        EvolutionService.isEnabled()
      ) {
        sentReal = await EvolutionService.sendTextMessage(
          owner.whatsapp_instancia_nome,
          toEmployeePhone,
          message
        );
      }
    } catch (err: any) {
      console.error('[WhatsAppService] Erro ao tentar notificar funcionário via mensagem real:', err.message);
    }

    if (sentReal) {
      console.log('\n================================================================');
      console.log('📱 NOTIFICAÇÃO REAL ENVIADA PARA FUNCIONÁRIO (VIA EVOLUTION API)');
      console.log(`Enviado por: ${formattedSender}`);
      console.log(`Para: ${formattedEmployee} (Funcionário: ${employeeName})`);
      console.log(`Mensagem: ${message}`);
      console.log('================================================================\n');
    } else {
      console.log('\n================================================================');
      console.log('📱 SIMULAÇÃO DE WHATSAPP (NOTIFICAÇÃO ENVIADA PARA FUNCIONÁRIO)');
      console.log(`Enviado por: ${formattedSender}`);
      console.log(`Para: ${formattedEmployee} (Funcionário: ${employeeName})`);
      console.log(`Mensagem: ${message}`);
      console.log('================================================================\n');
    }
  }

  /**
   * Auxiliar para formatar número de telefone de forma visual.
   */
  private static formatPhoneDisplay(value: string): string {
    const clean = value.replace(/\D/g, '');
    if (clean.length === 11) {
      return `(${clean.substring(0, 2)}) ${clean.substring(2, 7)}-${clean.substring(7)}`;
    }
    return value;
  }

  /**
   * Auxiliar para formatar data de YYYY-MM-DD para DD/MM/YYYY.
   */
  private static formatDateBR(dateStr: string): string {
    const partes = dateStr.split('-');
    if (partes.length === 3) {
      return `${partes[2]}/${partes[1]}/${partes[0]}`;
    }
    return dateStr;
  }
}
