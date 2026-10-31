import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { query } from '../config/database';

const JWT_SECRET = process.env.JWT_SECRET || 'minha_chave_secreta_super_segura_para_o_mvp_123';

export interface AuthenticatedRequest extends Request {
  userId?: number;
}

export async function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: 'Token de autenticação não fornecido.' });
  }

  // Espera formato "Bearer <TOKEN>"
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return res.status(401).json({ error: 'Formato do token inválido.' });
  }

  const token = parts[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: number };
    
    // Consulta status da assinatura no banco de dados
    const user = await query.get('SELECT assinatura_status FROM usuarios WHERE id = ?', [decoded.userId]);
    if (!user) {
      return res.status(401).json({ error: 'Usuário não encontrado.' });
    }

    if (user.assinatura_status === 'bloqueado') {
      // Permite apenas rotas financeiras de faturamento/pagamento da própria mensalidade
      const allowedPaths = ['/admin/billing-status', '/admin/pay-subscription'];
      if (!allowedPaths.includes(req.path)) {
        return res.status(402).json({ 
          error: 'assinatura_bloqueada', 
          message: 'Sua assinatura está suspensa por falta de pagamento. Por favor, regularize sua mensalidade.' 
        });
      }
    }

    req.userId = decoded.userId;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido ou expirado.' });
  }
}
