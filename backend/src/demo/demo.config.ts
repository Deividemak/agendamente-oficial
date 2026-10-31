/**
 * Configuração do Modo Demonstração.
 *
 * Ative com DEMO_MODE=true. Nesse modo:
 *  - o banco SQLite é recriado a cada inicialização (a demo sempre começa limpa);
 *  - um estabelecimento fictício é populado com serviços, equipe, clientes e agendamentos;
 *  - ações que poderiam "quebrar" a demo para o próximo visitante são bloqueadas.
 */
export const DEMO_MODE = process.env.DEMO_MODE === 'true';

export const DEMO_CREDENTIALS = {
  prestador: {
    email: process.env.DEMO_EMAIL || 'demo@agendamente.com.br',
    senha: process.env.DEMO_PASSWORD || 'demo1234',
  },
  superAdmin: {
    email: process.env.DEMO_SUPER_EMAIL || 'admin@agendamente.com.br',
    senha: process.env.DEMO_SUPER_PASSWORD || 'admin1234',
  },
};
