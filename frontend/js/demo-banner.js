/**
 * Banner do Modo Demonstração.
 * Só aparece quando o backend roda com DEMO_MODE=true (consulta /api/public/demo-info).
 * - Landing page: faixa no topo com atalho para a demo.
 * - Tela de login: card com as credenciais e botões de preenchimento automático.
 * - Painéis: faixa discreta informando que é uma demonstração.
 */
(function () {
  fetch('/api/public/demo-info')
    .then(function (r) { return r.json(); })
    .then(function (info) {
      if (!info || !info.demo) return;
      var path = window.location.pathname;
      var isLogin = path.indexOf('admin-login') !== -1 || path.indexOf('/admin/login') !== -1;

      var bar = document.createElement('div');
      bar.style.cssText = (isLogin ? 'position:fixed;left:0;right:0;' : 'position:sticky;') + 'top:0;z-index:9999;width:100%;box-sizing:border-box;background:linear-gradient(90deg,#4f46e5,#7c3aed);color:#fff;font:600 12px/1.4 system-ui,sans-serif;padding:8px 12px;text-align:center';
      bar.innerHTML = '🧪 <b>Versão de demonstração</b> — dados fictícios, restaurados automaticamente. ' +
        (isLogin ? '' : '<a href="/admin-login" style="color:#fff;text-decoration:underline;margin-left:6px">Entrar na demo →</a>');
      document.body.insertBefore(bar, document.body.firstChild);

      if (!isLogin) return;
      var form = document.getElementById('form-login');
      if (!form) return;

      var card = document.createElement('div');
      card.style.cssText = 'margin-bottom:16px;padding:14px;border-radius:12px;border:1px solid rgba(129,140,248,.4);background:rgba(79,70,229,.12);color:#e0e7ff;font:500 12px/1.5 system-ui,sans-serif';
      card.innerHTML =
        '<div style="font-weight:800;margin-bottom:6px">Acesso de demonstração</div>' +
        '<div>Prestador: <code>' + info.prestador.email + '</code> / <code>' + info.prestador.senha + '</code></div>' +
        '<div>Super Admin: <code>' + info.superAdmin.email + '</code> / <code>' + info.superAdmin.senha + '</code></div>' +
        '<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">' +
        '<button type="button" data-demo="prestador" style="flex:1;padding:8px;border-radius:8px;border:0;background:#4f46e5;color:#fff;font-weight:700;cursor:pointer">Entrar como Prestador</button>' +
        '<button type="button" data-demo="superAdmin" style="flex:1;padding:8px;border-radius:8px;border:1px solid #818cf8;background:transparent;color:#e0e7ff;font-weight:700;cursor:pointer">Entrar como Super Admin</button>' +
        '</div>';
      form.parentNode.insertBefore(card, form);

      card.querySelectorAll('button[data-demo]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var cred = info[btn.getAttribute('data-demo')];
          document.getElementById('login-email').value = cred.email;
          document.getElementById('login-senha').value = cred.senha;
          if (form.requestSubmit) form.requestSubmit(); else form.dispatchEvent(new Event('submit', { cancelable: true }));
        });
      });
    })
    .catch(function () { /* sem demo: nada a fazer */ });
})();
