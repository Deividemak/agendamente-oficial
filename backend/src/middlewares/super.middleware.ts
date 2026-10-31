import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AuthenticatedRequest } from './auth.middleware';
import { query } from '../config/database';

const JWT_SECRET = process.env.JWT_SECRET || 'minha_chave_secreta_super_segura_para_o_mvp_123';

export async function superAdminMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: 'Token de autenticação não fornecido.' });
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return res.status(401).json({ error: 'Formato do token inválido.' });
  }

  const token = parts[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: number; tipo_usuario: string };
    
    // Consulta o banco para garantir que o tipo do usuário está correto e que ele ainda existe
    const user = await query.get(
      'SELECT id, tipo_usuario FROM usuarios WHERE id = ?',
      [decoded.userId]
    );

    if (!user) {
      return res.status(401).json({ error: 'Usuário não encontrado.' });
    }

    if (user.tipo_usuario !== 'dono') {
      return res.status(403).json({ error: 'Acesso restrito ao Dono do SaaS.' });
    }

    req.userId = decoded.userId;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido ou expirado.' });
  }
}
