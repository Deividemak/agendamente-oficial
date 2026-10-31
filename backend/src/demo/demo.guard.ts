import { Request, Response, NextFunction } from 'express';
import { DEMO_MODE } from './demo.config';

/**
 * Rotas bloqueadas no modo demonstração.
 * Evitam que um visitante altere a senha/e-mail da conta demo, coloque o sistema
 * em manutenção, faça upload de arquivos ou dispare integrações reais.
 */
const BLOCKED: Array<{ method: string; pattern: RegExp }> = [
  { method: 'POST', pattern: /^\/api\/auth\/register$/ },
  { method: 'POST', pattern: /^\/api\/auth\/forgot-password$/ },
  { method: 'POST', pattern: /^\/api\/auth\/reset-password$/ },
  { method: 'PUT', pattern: /^\/api\/admin\/profile$/ },
  { method: 'POST', pattern: /^\/api\/admin\/products\/upload$/ },
  { method: 'POST', pattern: /^\/api\/admin\/pay-subscription$/ },
  { method: 'GET', pattern: /^\/api\/admin\/mercadopago\// },
  { method: 'POST', pattern: /^\/api\/admin\/mercadopago\// },
  { method: 'POST', pattern: /^\/api\/admin\/whatsapp\/(connect|disconnect)$/ },
  // Painel Super Admin: somente leitura na demo
  { method: 'POST', pattern: /^\/api\/super\// },
  { method: 'PUT', pattern: /^\/api\/super\// },
  { method: 'DELETE', pattern: /^\/api\/super\// },
];

export function demoGuard(req: Request, res: Response, next: NextFunction) {
  if (!DEMO_MODE) return next();

  const blocked = BLOCKED.some(
    (rule) => rule.method === req.method && rule.pattern.test(req.path)
  );

  if (blocked) {
    return res.status(403).json({
      error: 'Esta ação está desativada na versão de demonstração.',
      demo: true,
    });
  }

  return next();
}
