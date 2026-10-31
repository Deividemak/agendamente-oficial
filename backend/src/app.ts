import express from 'express';
import cors from 'cors';
import path from 'path';
import jwt from 'jsonwebtoken';
import { query } from './config/database';
import apiRoutes from './routes/api.routes';
import { demoGuard } from './demo/demo.guard';
import { DEMO_MODE, DEMO_CREDENTIALS } from './demo/demo.config';

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());

// Middleware de Manutenção Global
app.use(async (req, res, next) => {
  try {
    const path = req.path;
    
    // Lista de caminhos que ignoram a manutenção
    const isBypassed =
      path.startsWith('/api/super') ||
      path.startsWith('/super') ||
      path === '/dono' ||
      path === '/super-dashboard' ||
      path === '/api/auth/login' ||
      path === '/admin-login' ||
      path === '/admin-reset-password' ||
      path === '/admin-confirm-email' ||
      path === '/termos' ||
      path === '/privacidade' ||
      path.startsWith('/api/public/webhooks') ||
      path.startsWith('/api/public/oauth') ||
      path.includes('.'); // Ignora arquivos estáticos (CSS, JS, imagens, etc.)

    if (isBypassed) {
      return next();
    }

    // Consulta se o modo manutenção está ativo no banco
    const maintenanceRow = await query.get<{ valor: string }>(
      "SELECT valor FROM configuracoes WHERE chave = 'modo_manutencao_habilitado'"
    );
    const isMaintenance = maintenanceRow?.valor === '1';

    if (!isMaintenance) {
      return next();
    }

    // Se estiver em manutenção, verifica se o usuário logado tem a role 'dono'
    const authHeader = req.headers.authorization;
    if (authHeader) {
      const parts = authHeader.split(' ');
      if (parts.length === 2 && parts[0] === 'Bearer') {
        const token = parts[1];
        try {
          const JWT_SECRET = process.env.JWT_SECRET || 'minha_chave_secreta_super_segura_para_o_mvp_123';
          const decoded = jwt.verify(token, JWT_SECRET) as { userId: number; tipo_usuario: string };
          
          // Se for o dono do SaaS, permite continuar
          if (decoded.tipo_usuario === 'dono') {
            return next();
          }
        } catch (err) {
          // Token inválido, segue para bloqueio
        }
      }
    }

    // Retorna erro 503 para requisições de API e páginas
    return res.status(503).json({
      error: 'modo_manutencao',
      message: 'O sistema está em manutenção para melhorias. Por favor, tente novamente mais tarde.'
    });
  } catch (error) {
    console.error('Erro no middleware de manutenção:', error);
    next();
  }
});

// Modo demonstração: informações públicas da demo e bloqueio de ações sensíveis
app.get('/api/public/demo-info', (req, res) => {
  if (!DEMO_MODE) return res.json({ demo: false });
  return res.json({
    demo: true,
    prestador: DEMO_CREDENTIALS.prestador,
    superAdmin: DEMO_CREDENTIALS.superAdmin,
  });
});
app.use(demoGuard);

// Rotas da API
app.use('/api', apiRoutes);

// Servir arquivos estáticos do Frontend (facilita rodar o MVP com um único comando)
const frontendPath = path.join(__dirname, '../../frontend');
app.use(express.static(frontendPath));

// Fallback para SPA (caso o usuário digite URLs manuais)
app.get('/super-dashboard', (req, res) => {
  res.sendFile(path.join(frontendPath, 'super/index.html'));
});

app.get('/dono', (req, res) => {
  res.sendFile(path.join(frontendPath, 'super/index.html'));
});

app.get('/admin-dashboard', (req, res) => {
  res.sendFile(path.join(frontendPath, 'admin/index.html'));
});

app.get('/admin-login', (req, res) => {
  res.sendFile(path.join(frontendPath, 'admin/login.html'));
});

app.get('/admin-reset-password', (req, res) => {
  res.sendFile(path.join(frontendPath, 'admin/reset-password.html'));
});

app.get('/admin-confirm-email', (req, res) => {
  res.sendFile(path.join(frontendPath, 'admin/confirm-email.html'));
});

app.get('/termos', (req, res) => {
  res.sendFile(path.join(frontendPath, 'termos.html'));
});

app.get('/privacidade', (req, res) => {
  res.sendFile(path.join(frontendPath, 'privacidade.html'));
});

app.get('/agendar', (req, res) => {
  res.sendFile(path.join(frontendPath, 'public/index.html'));
});

app.get('/checkout', (req, res) => {
  res.sendFile(path.join(frontendPath, 'public/checkout.html'));
});

app.get('/confirmar-presenca', (req, res) => {
  res.sendFile(path.join(frontendPath, 'public/confirmacao.html'));
});

// Middleware de tratamento de erros global
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Erro Capturado:', err);
  res.status(500).json({ error: 'Ocorreu um erro interno no servidor.' });
});

export default app;
