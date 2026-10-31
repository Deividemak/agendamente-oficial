import { Response } from 'express';
import { query } from '../config/database';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { EvolutionService } from '../services/evolution.service';

// Mapa em memória para simular o tempo de escaneamento do QR Code no modo Mock (sem Evolution API)
const mockConnections = new Map<number, number>();

// Imagem de QR Code mockada válida em Base64
const MOCK_QR_BASE64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAJQAAACUAQMAAAB4b+WFAAAAA1BMVEUAAACnej3aAAAAAXRSTlMAQObYZgAAACNJREFUOMtjGAWjYBSMglEwCkbBKBgFoyACgYGB0f8/gAEAAD//88gB+10k1zoAAAAASUVORK5CYII=';

export class WhatsappController {
  /**
   * Retorna o status da conexão WhatsApp para o usuário logado.
   */
  static async getStatus(req: AuthenticatedRequest, res: Response) {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Não autorizado.' });
    }

    try {
      const user = await query.get(
        'SELECT whatsapp_instancia_nome, whatsapp_instancia_status FROM usuarios WHERE id = ?',
        [userId]
      );

      if (!user) {
        return res.status(404).json({ error: 'Usuário não encontrado.' });
      }

      let status = user.whatsapp_instancia_status || 'desconectado';
      const instanceName = user.whatsapp_instancia_nome;

      // Se a Evolution API estiver desativada (Modo Simulação)
      if (!EvolutionService.isEnabled()) {
        if (status === 'conectando') {
          const startTime = mockConnections.get(userId);
          if (startTime && Date.now() - startTime > 6000) {
            // Após 6 segundos, simula que o usuário escaneou o QR Code
            status = 'conectado';
            await query.run(
              'UPDATE usuarios SET whatsapp_instancia_status = ? WHERE id = ?',
              ['conectado', userId]
            );
            mockConnections.delete(userId);
            console.log(`[WhatsApp Controller] Modo Simulação: Usuário ${userId} foi conectado automaticamente.`);
          }
        }
        return res.json({
          status,
          instanceName: instanceName || null,
          isMock: true
        });
      }

      // Se a Evolution API estiver ATIVADA
      if (instanceName) {
        // Consulta o status real na API
        const apiStatus = await EvolutionService.getInstanceStatus(instanceName);
        
        // Se a API retornou 'conectado' (open)
        if (apiStatus === 'conectado') {
          if (status !== 'conectado') {
            status = 'conectado';
            await query.run(
              'UPDATE usuarios SET whatsapp_instancia_status = ? WHERE id = ?',
              ['conectado', userId]
            );
          }
        } else {
          // Se na API não está conectado (open), mas no banco está 'conectando', mantemos 'conectando'
          // Só mudamos para 'desconectado' se no banco estivesse 'conectado' e agora caiu
          if (status === 'conectado') {
            status = 'desconectado';
            await query.run(
              'UPDATE usuarios SET whatsapp_instancia_status = ? WHERE id = ?',
              ['desconectado', userId]
            );
          }
        }
      } else {
        status = 'desconectado';
      }

      return res.json({
        status,
        instanceName: instanceName || null,
        isMock: false
      });
    } catch (err: any) {
      console.error('Erro ao buscar status do WhatsApp:', err);
      return res.status(500).json({ error: 'Erro ao buscar status do WhatsApp.' });
    }
  }

  /**
   * Inicia o processo de conexão do WhatsApp, criando a instância e retornando o QR Code.
   */
  static async connect(req: AuthenticatedRequest, res: Response) {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Não autorizado.' });
    }
    const { phoneNumber } = req.body;
    const instanceName = `instancia_user_${userId}`;

    try {
      // Se a Evolution API não estiver habilitada, entra no Modo Simulação (Mock)
      if (!EvolutionService.isEnabled()) {
        await query.run(
          'UPDATE usuarios SET whatsapp_instancia_nome = ?, whatsapp_instancia_status = ? WHERE id = ?',
          [instanceName, 'conectando', userId]
        );
        mockConnections.set(userId, Date.now());
        
        return res.json({
          qrCode: MOCK_QR_BASE64,
          pairingCode: phoneNumber ? 'MOCK-1234' : null,
          instanceName,
          isMock: true,
          message: 'Modo simulação ativado. Escaneie ou aguarde 6 segundos para conectar.'
        });
      }

      // Tenta criar a instância na API limpando qualquer estado anterior
      try {
        await EvolutionService.deleteInstance(instanceName).catch(() => {});
        await EvolutionService.createInstance(instanceName, !phoneNumber);
      } catch (err: any) {
        console.log(`Erro ao recriar instância ${instanceName}: ${err.message}`);
      }

      // Obtém o QR Code ou código de pareamento
      const qrData = await EvolutionService.getQrCode(instanceName, phoneNumber);
      if (!qrData) {
        return res.status(500).json({ error: 'Não foi possível gerar os dados de conexão da Evolution API.' });
      }

      // Atualiza o banco de dados para "conectando"
      await query.run(
        'UPDATE usuarios SET whatsapp_instancia_nome = ?, whatsapp_instancia_status = ? WHERE id = ?',
        [instanceName, 'conectando', userId]
      );

      return res.json({
        qrCode: qrData.base64 || null,
        pairingCode: qrData.code || null,
        instanceName,
        isMock: false
      });
    } catch (err: any) {
      console.error('Erro ao conectar WhatsApp:', err);
      return res.status(500).json({ error: 'Erro ao conectar WhatsApp.' });
    }
  }

  /**
   * Desconecta o WhatsApp, deletando a instância na API e limpando os dados no banco.
   */
  static async disconnect(req: AuthenticatedRequest, res: Response) {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Não autorizado.' });
    }

    try {
      const user = await query.get(
        'SELECT whatsapp_instancia_nome FROM usuarios WHERE id = ?',
        [userId]
      );

      if (!user) {
        return res.status(404).json({ error: 'Usuário não encontrado.' });
      }

      const instanceName = user.whatsapp_instancia_nome;

      if (instanceName) {
        if (EvolutionService.isEnabled()) {
          // Deleta a instância na API
          await EvolutionService.deleteInstance(instanceName);
        } else {
          // Limpa do mapa de simulação
          mockConnections.delete(userId);
        }
      }

      // Limpa dados no banco de dados
      await query.run(
        'UPDATE usuarios SET whatsapp_instancia_nome = NULL, whatsapp_instancia_status = ? WHERE id = ?',
        ['desconectado', userId]
      );

      return res.json({ message: 'WhatsApp desconectado com sucesso!' });
    } catch (err: any) {
      console.error('Erro ao desconectar WhatsApp:', err);
      return res.status(500).json({ error: 'Erro ao desconectar WhatsApp.' });
    }
  }
}
