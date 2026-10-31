(function() {
  // Global fetch interceptor
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    try {
      const response = await originalFetch(...args);
      if (response.status === 503) {
        const clone = response.clone();
        try {
          const data = await clone.json();
          if (data && data.error === 'modo_manutencao') {
            showMaintenanceOverlay(data.message);
          }
        } catch (e) {}
      }
      return response;
    } catch (err) {
      throw err;
    }
  };

  function showMaintenanceOverlay(message) {
    if (document.getElementById('maintenance-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'maintenance-overlay';
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.zIndex = '99999';
    overlay.style.display = 'flex';
    overlay.style.flexDirection = 'column';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.padding = '24px';
    overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.85)';
    overlay.style.backdropFilter = 'blur(12px)';
    overlay.style.color = '#ffffff';
    overlay.style.fontFamily = 'Inter, sans-serif';
    
    overlay.innerHTML = `
      <div style="max-width: 440px; width: 100%; padding: 32px; border-radius: 24px; background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); text-align: center; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);">
        <div style="display: inline-flex; padding: 16px; border-radius: 16px; background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.2); color: #fbbf24; margin-bottom: 24px;">
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="8" rx="1"/><path d="M17 14v7"/><path d="M7 14v7"/><path d="M12 2v4"/><path d="M12 14v7"/><path d="M17 6V2"/><path d="M7 6V2"/></svg>
        </div>
        <div style="margin-bottom: 16px;">
          <h2 style="font-size: 24px; font-weight: 900; margin: 0; color: #ffffff; letter-spacing: -0.5px;">Sistema em Manutenção</h2>
          <p style="font-size: 10px; color: #94a3b8; font-weight: bold; text-transform: uppercase; letter-spacing: 1.5px; margin-top: 8px; margin-bottom: 0;">Aviso de Infraestrutura</p>
        </div>
        <p style="color: #cbd5e1; font-size: 13px; line-height: 1.6; margin: 0 0 24px 0;">
          ${message || 'O sistema está passando por melhorias de infraestrutura e voltará a funcionar em instantes.'}
        </p>
        <div style="font-size: 10px; color: #64748b;">
          Agradecemos a sua compreensão.
        </div>
      </div>
    `;
    
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
  }

  // Load configuration and update details
  async function initGlobalSettings() {
    try {
      // Se for o dono do SaaS logado, ignoramos verificação de manutenção preventiva imediata
      const token = localStorage.getItem('token');
      const uLocal = localStorage.getItem('usuario');
      let isDono = false;
      if (token && uLocal) {
        try {
          const u = JSON.parse(uLocal);
          if (u.tipo_usuario === 'dono') {
            isDono = true;
          }
        } catch (e) {}
      }

      const response = await fetch('/api/public/configuracoes');
      if (response.ok) {
        const config = await response.json();

        // 1. Verifica se está em manutenção
        if (config.modo_manutencao_habilitado === 1 && !isDono) {
          // Bypassa se estivermos na rota de login ou páginas de redefinição
          const path = window.location.pathname;
          if (path !== '/admin-login' && path !== '/admin-reset-password' && path !== '/admin-confirm-email') {
            showMaintenanceOverlay(config.modo_manutencao_mensagem);
            return;
          }
        }

        // 2. Atualiza SEO Metadata
        if (config.seo_titulo && document.title) {
          // Se for a landing page, atualiza título
          if (window.location.pathname === '/' || window.location.pathname === '/index.html' || window.location.pathname === '') {
            document.title = config.seo_titulo;
          }
        }
        if (config.seo_descricao) {
          const metaDesc = document.querySelector('meta[name="description"]');
          if (metaDesc && (window.location.pathname === '/' || window.location.pathname === '/index.html' || window.location.pathname === '')) {
            metaDesc.setAttribute('content', config.seo_descricao);
          }
        }

        // 3. Atualiza contatos de suporte dinamicamente nas páginas
        if (config.suporte_email) {
          document.querySelectorAll('.dynamic-support-email').forEach(el => {
            if (el.tagName === 'A') {
              el.setAttribute('href', `mailto:${config.suporte_email}`);
              if (el.children.length === 0) {
                el.innerText = config.suporte_email;
              }
            } else {
              el.innerText = config.suporte_email;
            }
          });
        }
        if (config.suporte_whatsapp) {
          const cleanWpp = config.suporte_whatsapp.replace(/\D/g, '');
          document.querySelectorAll('.dynamic-support-phone').forEach(el => {
            if (el.tagName === 'A') {
              el.setAttribute('href', `https://wa.me/55${cleanWpp}`);
              if (el.children.length === 0) {
                el.innerText = formatPhone(config.suporte_whatsapp);
              }
            } else {
              el.innerText = formatPhone(config.suporte_whatsapp);
            }
          });
        }
        if (config.sistema_nome) {
          document.querySelectorAll('.dynamic-system-name').forEach(el => {
            el.innerText = config.sistema_nome;
          });
        }
      }
    } catch (err) {
      console.error('Erro ao inicializar configurações globais no frontend:', err);
    }
  }

  function formatPhone(phone) {
    if (!phone) return '';
    const clean = phone.replace(/\D/g, '');
    if (clean.length === 11) {
      return `(${clean.substring(0, 2)}) ${clean.substring(2, 7)}-${clean.substring(7)}`;
    }
    return phone;
  }

  // Executa após DOM carregar
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initGlobalSettings);
  } else {
    initGlobalSettings();
  }
})();
