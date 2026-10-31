import { Request, Response } from 'express';
import { query } from '../config/database';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';

export class ComunicadoController {
  /**
   * Cria um novo comunicado (Dono do SaaS).
   * Se solicitado, realiza o disparo seguro simulado por WhatsApp.
   */
  static async create(req: AuthenticatedRequest, res: Response) {
    const { titulo, conteudo, dispararPainel, dispararWhatsapp } = req.body;

    if (!titulo || !conteudo) {
      return res.status(400).json({ error: 'Título e conteúdo são obrigatórios.' });
    }

    try {
      let comunicadoId = null;

      // 1. Salva no banco de dados se for para disparar no painel
      if (dispararPainel) {
        const result = await query.run(
          'INSERT INTO comunicados (titulo, conteudo) VALUES (?, ?)',
          [titulo, conteudo]
        );
        comunicadoId = result.lastID;
      }

      // 2. Disparo de WhatsApp em lote (Simulado com fila segura em background)
      if (dispararWhatsapp) {
        // Busca todos os administradores ativos (inquilinos)
        const usuarios = await query.all<{ nome: string; whatsapp: string }>(
          "SELECT nome, whatsapp FROM usuarios WHERE tipo_usuario = 'profissional'"
        );

        if (usuarios.length > 0) {
          // Dispara em background de forma assíncrona (não-bloqueante para o HTTP)
          (async () => {
            console.log(`\n[Anti-Ban Queue] Iniciando fila de disparo seguro de WhatsApp para ${usuarios.length} administradores.`);
            console.log(`[Anti-Ban Queue] Configurado delay de 5 segundos entre disparos para segurança da conta.`);
            
            for (let i = 0; i < usuarios.length; i++) {
              const u = usuarios[i];
              const delayMs = i * 5000; // Intervalo de 5 segundos

              setTimeout(async () => {
                const message = `Olá, *${u.nome}*!\n\n📢 *${titulo}*\n\n${conteudo}`;
                const cleanPhone = u.whatsapp.replace(/\D/g, '');
                
                // Formatação do número para exibição
                let formattedPhone = u.whatsapp;
                if (cleanPhone.length === 11) {
                  formattedPhone = `(${cleanPhone.substring(0, 2)}) ${cleanPhone.substring(2, 7)}-${cleanPhone.substring(7)}`;
                }

                console.log('\n================================================================');
                console.log(`📱 SIMULAÇÃO DE WHATSAPP (MENSAGEM EM MASSA - FILA SEGURA [${i + 1}/${usuarios.length}])`);
                console.log(`Enviado por: (11) 99999-9999 (Sistema Agendamente)`);
                console.log(`Para: ${formattedPhone} (Administrador: ${u.nome})`);
                console.log(`Mensagem:\n${message}`);
                console.log('================================================================\n');
              }, delayMs);
            }
          })().catch(err => console.error('Erro na fila de envio de comunicados:', err));
        }
      }

      return res.status(201).json({
        message: 'Comunicado enviado com sucesso!',
        id: comunicadoId
      });
    } catch (err: any) {
      console.error(err);
      return res.status(500).json({ error: 'Erro ao registrar comunicado.' });
    }
  }

  /**
   * Retorna o último comunicado cadastrado (Painel do Profissional).
   */
  static async getLatest(req: AuthenticatedRequest, res: Response) {
    try {
      const latest = await query.get<{ id: number; titulo: string; conteudo: string; criado_em: string }>(
        'SELECT id, titulo, conteudo, criado_em FROM comunicados ORDER BY id DESC LIMIT 1'
      );

      if (!latest) {
        return res.json(null);
      }

      return res.json(latest);
    } catch (err: any) {
      console.error(err);
      return res.status(500).json({ error: 'Erro ao carregar comunicado.' });
    }
  }
}
