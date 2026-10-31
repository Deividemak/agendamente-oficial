import app from './app';
import { initializeDatabase, query } from './config/database';
import dotenv from 'dotenv';

dotenv.config();

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    // Inicializa o banco de dados SQLite e cria as tabelas se necessário
    await initializeDatabase();

    // Modo demonstração: popula dados fictícios
    if (process.env.DEMO_MODE === 'true') {
      const { seedDemoData } = require('./demo/demo.seed');
      await seedDemoData();
    }

    // Inicializa configurações da Evolution API em memória
    try {
      const rowUrl = await query.get<{ valor: string }>("SELECT valor FROM configuracoes WHERE chave = 'evolution_api_url'");
      const rowKey = await query.get<{ valor: string }>("SELECT valor FROM configuracoes WHERE chave = 'evolution_api_key'");
      const { EvolutionService } = require('./services/evolution.service');
      EvolutionService.updateSettings(rowUrl?.valor, rowKey?.valor);
      console.log('Configurações da Evolution API carregadas em memória.');
    } catch (configErr: any) {
      console.error('Erro ao pré-carregar configurações da Evolution API:', configErr.message);
    }

    // Importa e executa verificação de assinaturas
    const { runDailySubscriptionCheck } = require('./services/subscription.checker');
    await runDailySubscriptionCheck();
    // Agenda para rodar a cada 24 horas
    setInterval(runDailySubscriptionCheck, 24 * 60 * 60 * 1000);

    // Importa e executa verificação de lembretes de agendamentos
    const { runAppointmentNotificationCheck } = require('./services/appointment.notifier');
    await runAppointmentNotificationCheck();
    // Agenda para rodar a cada hora (60 * 60 * 1000)
    setInterval(runAppointmentNotificationCheck, 60 * 60 * 1000);

    // Inicia o servidor HTTP
    app.listen(PORT, () => {
      console.log(`===================================================`);
      console.log(` Servidor rodando com sucesso!`);
      console.log(` URL Local: http://localhost:${PORT}`);
      console.log(` Painel de Login: http://localhost:${PORT}/admin-login`);
      console.log(` Link de Agendamento: http://localhost:${PORT}/agendar?usuarioId=1`);
      console.log(`===================================================`);
    });
  } catch (error) {
    console.error('Falha ao iniciar o servidor:', error);
    process.exit(1);
  }
}

startServer();
