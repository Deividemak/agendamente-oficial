import dotenv from 'dotenv';
dotenv.config();

let EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || '';
let EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || '';

export class EvolutionService {
  /**
   * Atualiza as configurações da Evolution API em memória.
   */
  static updateSettings(url: string, key: string) {
    EVOLUTION_API_URL = url || process.env.EVOLUTION_API_URL || '';
    EVOLUTION_API_KEY = key || process.env.EVOLUTION_API_KEY || '';
  }

  /**
   * Verifica se as variáveis de ambiente da Evolution API estão configuradas.
   */
  static isEnabled(): boolean {
    return !!(EVOLUTION_API_URL && EVOLUTION_API_KEY);
  }

  /**
   * Retorna os headers padrão com a apikey de autenticação.
   */
  private static getHeaders() {
    return {
      'Content-Type': 'application/json',
      'apikey': EVOLUTION_API_KEY
    };
  }

  /**
   * Cria uma nova instância na Evolution API.
   */
  static async createInstance(instanceName: string, useQrcode: boolean = true): Promise<any> {
    if (!this.isEnabled()) {
      throw new Error('Evolution API não está configurada no arquivo .env');
    }

    const url = `${EVOLUTION_API_URL}/instance/create`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          instanceName,
          qrcode: useQrcode,
          integration: 'WHATSAPP-BAILEYS'
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error(`Erro ao criar instância na Evolution API: ${response.status} - ${errText}`);
        throw new Error(`Erro na API Evolution: ${response.statusText}`);
      }

      return await response.json();
    } catch (error: any) {
      console.error(`Erro na requisição createInstance:`, error);
      throw error;
    }
  }

  /**
   * Obtém o QR Code em Base64 para escaneamento ou o código de pareamento por número.
   */
  static async getQrCode(instanceName: string, phoneNumber?: string): Promise<{ code: string; base64: string } | null> {
    if (!this.isEnabled()) {
      throw new Error('Evolution API não está configurada no arquivo .env');
    }

    let url = `${EVOLUTION_API_URL}/instance/connect/${instanceName}`;
    if (phoneNumber) {
      const cleanPhone = phoneNumber.replace(/\D/g, '');
      let formattedPhone = cleanPhone;
      if (cleanPhone.length === 10 || cleanPhone.length === 11) {
        formattedPhone = `55${cleanPhone}`;
      }
      url += `?number=${formattedPhone}`;
    }

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: this.getHeaders()
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error(`Erro ao obter dados de conexão da instância ${instanceName}: ${response.status} - ${errText}`);
        return null;
      }

      const data = (await response.json()) as any;
      if (data) {
        return {
          code: data.pairingCode || data.code || '',
          base64: data.base64 || ''
        };
      }
      return null;
    } catch (error: any) {
      console.error(`Erro na requisição getQrCode para ${instanceName}:`, error);
      return null;
    }
  }

  /**
   * Consulta o status de conexão da instância (aberta/desconectada).
   * Retorna 'conectado' se o status for 'open', caso contrário 'desconectado'.
   */
  static async getInstanceStatus(instanceName: string): Promise<'conectado' | 'desconectado'> {
    if (!this.isEnabled()) {
      return 'desconectado';
    }

    const url = `${EVOLUTION_API_URL}/instance/connectionState/${instanceName}`;
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: this.getHeaders()
      });

      if (!response.ok) {
        // Se a instância não existir ou retornar 404, consideramos desconectado
        return 'desconectado';
      }

      const data = (await response.json()) as any;
      if (data && data.instance && data.instance.state === 'open') {
        return 'conectado';
      }

      return 'desconectado';
    } catch (error: any) {
      console.error(`Erro ao consultar status da instância ${instanceName}:`, error);
      return 'desconectado';
    }
  }

  /**
   * Deleta a instância na Evolution API (desconecta e limpa sessão).
   */
  static async deleteInstance(instanceName: string): Promise<boolean> {
    if (!this.isEnabled()) {
      return false;
    }

    const url = `${EVOLUTION_API_URL}/instance/delete/${instanceName}`;
    try {
      const response = await fetch(url, {
        method: 'DELETE',
        headers: this.getHeaders()
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error(`Erro ao deletar instância ${instanceName}: ${response.status} - ${errText}`);
        return false;
      }

      return true;
    } catch (error: any) {
      console.error(`Erro ao deletar instância ${instanceName}:`, error);
      return false;
    }
  }

  /**
   * Envia uma mensagem real de texto via WhatsApp.
   */
  static async sendTextMessage(instanceName: string, toPhone: string, text: string): Promise<boolean> {
    if (!this.isEnabled()) {
      console.log(`[Evolution API] Simulação de envio desabilitada (API não configurada).`);
      return false;
    }

    const formattedNumber = this.formatToWhatsappNumber(toPhone);
    if (!formattedNumber) {
      console.error(`Número de telefone inválido para envio: ${toPhone}`);
      return false;
    }

    const url = `${EVOLUTION_API_URL}/message/sendText/${instanceName}`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          number: formattedNumber,
          text: text,
          options: {
            delay: 1200,
            presence: 'composing',
            linkPreview: false
          }
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error(`Falha ao enviar mensagem de WhatsApp via ${instanceName}: ${response.status} - ${errText}`);
        return false;
      }

      return true;
    } catch (error: any) {
      console.error(`Erro ao enviar mensagem de WhatsApp via ${instanceName}:`, error);
      return false;
    }
  }

  /**
   * Formata um número de telefone para o padrão aceito pela Evolution API.
   * Garante o código de país 55 para o Brasil e remove caracteres não numéricos.
   */
  private static formatToWhatsappNumber(phone: string): string {
    const clean = phone.replace(/\D/g, '');
    if (!clean) return '';

    // Se já tiver DDI do Brasil e tamanho de celular (55 + DDD + 9 ou 8 dígitos)
    if (clean.startsWith('55') && (clean.length === 12 || clean.length === 13)) {
      return clean;
    }

    // Se for apenas DDD + número (ex: 11999999999 ou 1188888888)
    if (clean.length === 10 || clean.length === 11) {
      return `55${clean}`;
    }

    return clean;
  }
}
