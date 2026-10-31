import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller';
import { ServiceController } from '../controllers/service.controller';
import { AvailabilityController } from '../controllers/availability.controller';
import { BookingController } from '../controllers/booking.controller';
import { ExpenseController } from '../controllers/expense.controller';
import { ProductController } from '../controllers/product.controller';
import { ReportController } from '../controllers/report.controller';
import { EmployeeController } from '../controllers/employee.controller';
import { ClientController } from '../controllers/client.controller';
import { authMiddleware } from '../middlewares/auth.middleware';
import { SuperController } from '../controllers/super.controller';
import { superAdminMiddleware } from '../middlewares/super.middleware';
import { ComunicadoController } from '../controllers/comunicado.controller';
import { WhatsappController } from '../controllers/whatsapp.controller';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

// Configuração do Multer para armazenamento de fotos de produtos
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.resolve(__dirname, '../../../frontend/uploads/produtos');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `produto-${uniqueSuffix}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // limite de 2MB
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png|gif|webp/;
    const mimetype = filetypes.test(file.mimetype);
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());

    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error('Apenas imagens (jpeg, jpg, png, gif, webp) são permitidas.'));
  }
});

const router = Router();

// ==========================================
// ROTAS PÚBLICAS (Cliente Final & Auth)
// ==========================================

// Autenticação
router.post('/auth/register', AuthController.register);
router.post('/auth/login', AuthController.login);
router.post('/auth/forgot-password', AuthController.forgotPassword);
router.post('/auth/reset-password', AuthController.resetPassword);
router.get('/auth/confirm-email', AuthController.confirmEmail);
router.post('/public/visit', SuperController.recordVisit);
router.get('/public/configuracoes', SuperController.getConfiguracoes);

// Listar serviços do profissional no link de agendamento
router.get('/public/services', ServiceController.listPublic);

// Verificar isenção de sinal do cliente
router.get('/public/clients/check-exempt', ClientController.checkExemptionPublic);

// Obter slots disponíveis para agendamento
router.get('/public/slots', BookingController.getAvailableSlots);

// Criar reserva de agendamento (iniciar checkout Pix)
router.post('/public/book', BookingController.create);

// Obter detalhes do checkout Pix
router.get('/public/checkout/:checkoutId', BookingController.getCheckout);

// Confirmar pagamento Pix (Simulador)
router.post('/public/checkout/:checkoutId/confirm', BookingController.confirmPayment);

// Webhook do Mercado Pago para Assinatura (SaaS)
router.post('/public/webhooks/mercadopago', AuthController.mercadopagoWebhook);

// Callback OAuth do Mercado Pago para Profissionais
router.get('/public/oauth/mercadopago/callback', AuthController.mercadopagoOAuthCallback);

// Webhook do Mercado Pago para Pagamento de Agendamentos (Profissional)
router.post('/public/webhooks/mercadopago/booking', BookingController.mercadopagoBookingWebhook);

// Confirmar/Cancelar agendamento (Presença Obrigatória via WhatsApp)
router.get('/public/bookings/:id', BookingController.getBookingPublic);
router.post('/public/bookings/:id/confirm-presence', BookingController.confirmPresence);
router.post('/public/bookings/:id/cancel-presence', BookingController.cancelPresence);


// ==========================================
// ROTAS PRIVADAS (Painel do Profissional)
// ==========================================

// Perfil do profissional logado
router.get('/admin/profile', authMiddleware, AuthController.getProfile);
router.put('/admin/profile', authMiddleware, AuthController.updateProfile);
router.patch('/admin/profile/onboarding', authMiddleware, AuthController.completeOnboarding);
router.get('/admin/billing-status', authMiddleware, AuthController.getBillingStatus);
router.post('/admin/pay-subscription', authMiddleware, AuthController.paySubscription);
router.get('/admin/reports', authMiddleware, ReportController.getReports);

// Integração de Pagamento Profissional (Mercado Pago OAuth)
router.get('/admin/mercadopago/oauth-url', authMiddleware, AuthController.getMercadoPagoOAuthUrl);
router.post('/admin/mercadopago/disconnect', authMiddleware, AuthController.disconnectMercadoPago);

// CRUD de Serviços do profissional
router.get('/admin/services', authMiddleware, ServiceController.list);
router.post('/admin/services', authMiddleware, ServiceController.create);
router.put('/admin/services/:id', authMiddleware, ServiceController.update);
router.delete('/admin/services/:id', authMiddleware, ServiceController.delete);

// Configuração de Disponibilidade (agenda semanal)
router.get('/admin/availability', authMiddleware, AvailabilityController.get);
router.post('/admin/availability', authMiddleware, AvailabilityController.save);

// Estatísticas Financeiras e Operacionais do Dashboard
router.get('/admin/dashboard', authMiddleware, BookingController.getDashboardStats);
router.post('/admin/bookings', authMiddleware, BookingController.createManual);
router.get('/admin/bookings', authMiddleware, BookingController.listAll);

// Reagendar agendamento existente pelo administrador
router.patch('/admin/bookings/:id/reschedule', authMiddleware, BookingController.reschedule);
router.patch('/admin/bookings/:id/confirm-payment', authMiddleware, BookingController.confirmPaymentAdmin);
router.patch('/admin/bookings/:id/presence', authMiddleware, BookingController.updatePresenceAdmin);
router.delete('/admin/bookings/:id', authMiddleware, BookingController.cancel);

// Gestão de Despesas do profissional
router.get('/admin/expenses', authMiddleware, ExpenseController.list);
router.post('/admin/expenses', authMiddleware, ExpenseController.create);
router.delete('/admin/expenses/:id', authMiddleware, ExpenseController.delete);

// Gestão de Produtos e registro de Vendas
router.get('/admin/products', authMiddleware, ProductController.list);
router.post('/admin/products/upload', authMiddleware, upload.single('imagem'), ProductController.upload);
router.post('/admin/products', authMiddleware, ProductController.create);
router.delete('/admin/products/:id', authMiddleware, ProductController.delete);
router.post('/admin/products/sell', authMiddleware, ProductController.sell);

// Gestão de Funcionários e comissões
router.get('/admin/employees', authMiddleware, EmployeeController.list);
router.post('/admin/employees', authMiddleware, EmployeeController.create);
router.delete('/admin/employees/:id', authMiddleware, EmployeeController.delete);
router.get('/admin/employees/commissions', authMiddleware, EmployeeController.getCommissions);
router.post('/admin/employees/commissions/:id/toggle-payment', authMiddleware, EmployeeController.toggleCommissionPayment);
router.post('/admin/employees/:id/commissions/pay-all', authMiddleware, EmployeeController.payAllCommissions);

// Gestão de Clientes e Histórico
router.get('/admin/clients', authMiddleware, ClientController.list);
router.get('/admin/clients/history', authMiddleware, ClientController.getHistory);
router.post('/admin/clients/toggle-exemption', authMiddleware, ClientController.toggleExemption);

// Central de Comunicados
router.get('/admin/comunicados/latest', authMiddleware, ComunicadoController.getLatest);

// Integração WhatsApp (Evolution API)
router.get('/admin/whatsapp/status', authMiddleware, WhatsappController.getStatus);
router.post('/admin/whatsapp/connect', authMiddleware, WhatsappController.connect);
router.post('/admin/whatsapp/disconnect', authMiddleware, WhatsappController.disconnect);

// ==========================================
// ROTAS DO SUPER ADMIN (Dono do SaaS)
// ==========================================
router.get('/super/dashboard', superAdminMiddleware, SuperController.getDashboard);
router.post('/super/profile/verify-password', superAdminMiddleware, SuperController.verifyPassword);
router.post('/super/profile/request-change', superAdminMiddleware, SuperController.requestProfileChange);
router.post('/super/profile/confirm-change', superAdminMiddleware, SuperController.confirmProfileChange);
router.put('/super/profile', superAdminMiddleware, SuperController.updateProfile);
router.get('/super/users/:id', superAdminMiddleware, SuperController.getUserDetails);
router.put('/super/users/:id/subscription', superAdminMiddleware, SuperController.updateSubscription);
router.put('/super/users/:id/reset-password', superAdminMiddleware, SuperController.resetUserPassword);
router.delete('/super/users/:id', superAdminMiddleware, SuperController.deleteUser);
router.get('/super/configuracoes', superAdminMiddleware, SuperController.getConfiguracoes);
router.put('/super/configuracoes', superAdminMiddleware, SuperController.updateConfiguracoes);
router.post('/super/comunicados', superAdminMiddleware, ComunicadoController.create);

export default router;
