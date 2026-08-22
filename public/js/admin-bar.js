/* admin-bar.js — Injects the admin toolbar on all public pages when admin is logged in. */
(function () {
  'use strict';

  let session = null;
  try { session = JSON.parse(localStorage.getItem('user-session') || 'null'); } catch {}
  if (!session || !['admin', 'superadmin'].includes(session.role)) return;

  const css = `
    #admin-bar {
      position: fixed; top: 0; left: 0; right: 0; z-index: 99999;
      min-height: 44px; background: #0f172a;
      color: #e2e8f0; display: flex; align-items: center; flex-wrap: wrap;
      padding: 6px 14px; gap: 6px 8px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 12px; font-weight: 500;
      box-shadow: 0 2px 12px rgba(0,0,0,.5);
      user-select: none;
    }
    #admin-bar .ab-badge {
      display: inline-flex; align-items: center; gap: 5px;
      background: #1e3a5f; color: #60a5fa;
      border: 1px solid #1d4ed8; border-radius: 5px;
      padding: 3px 9px; font-size: 11px; font-weight: 700;
      letter-spacing: .4px; flex-shrink: 0;
    }
    #admin-bar .ab-user {
      color: #94a3b8; font-size: 11px; flex-shrink: 0; margin-left: 2px;
    }
    #admin-bar .ab-spacer { flex: 1 0 0; min-width: 0; }
    #admin-bar button, #admin-bar a.ab-btn {
      border: none; cursor: pointer; border-radius: 6px;
      padding: 5px 11px; font-size: 11px; font-weight: 600;
      transition: all .15s; font-family: inherit;
      text-decoration: none; white-space: nowrap;
      display: inline-flex; align-items: center; gap: 4px;
      flex-shrink: 0;
    }
    #admin-bar .ab-edit-btn {
      background: #1e293b; color: #cbd5e1; border: 1px solid #334155;
    }
    #admin-bar .ab-edit-btn:hover { background: #334155; }
    #admin-bar .ab-edit-btn.active {
      background: #1d4ed8; color: #fff; border-color: #3b82f6;
      box-shadow: 0 0 0 2px rgba(59,130,246,.3);
    }
    #admin-bar .ab-new-btn {
      background: #065f46; color: #6ee7b7; border: 1px solid #059669;
    }
    #admin-bar .ab-new-btn:hover { background: #047857; color: #fff; }
    #admin-bar .ab-devops-btn {
      background: transparent; color: #7dd3fc; border: 1px solid #1e3a5f;
    }
    #admin-bar .ab-devops-btn:hover { background: #1e3a5f; }
    #admin-bar .ab-logout-btn {
      background: transparent; color: #f87171; border: 1px solid transparent;
    }
    #admin-bar .ab-logout-btn:hover { background: #7f1d1d; color: #fecaca; border-color: #7f1d1d; }
    #admin-bar .ab-deploy-btn {
      background: #78350f; color: #fcd34d; border: 1px solid #b45309; flex-shrink: 0; margin-left: 4px;
    }
    #admin-bar .ab-deploy-btn:hover { background: #92400e; }
    #admin-bar .ab-deploy-btn.active { background: #b45309; color: #fff; }
    #ab-deploy-panel {
      position: fixed; top: calc(var(--admin-bar-h, 44px) + 6px); z-index: 100000;
      background: #0f172a; border: 1px solid #334155; border-radius: 10px;
      width: min(340px, 92vw); box-shadow: 0 12px 40px rgba(0,0,0,.5);
      padding: 14px; display: none;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      color: #e2e8f0;
    }
    #ab-deploy-panel.open { display: block; }
    #ab-deploy-panel h4 {
      margin: 0 0 10px; font-size: 11px; color: #94a3b8;
      text-transform: uppercase; letter-spacing: .06em; font-weight: 800;
    }
    #ab-deploy-panel .ab-dp-actions { display: flex; gap: 8px; margin-bottom: 10px; }
    #ab-deploy-panel button.ab-dp-btn {
      flex: 1; border: none; border-radius: 7px; padding: 9px 6px;
      font-size: 11.5px; font-weight: 700; cursor: pointer; font-family: inherit;
    }
    #ab-deploy-panel button.ab-dp-btn:disabled { opacity: .5; cursor: default; }
    .ab-dp-full  { background: #1d4ed8; color: #fff; }
    .ab-dp-full:hover:not(:disabled)  { background: #1e40af; }
    .ab-dp-quick { background: #b45309; color: #fff; }
    .ab-dp-quick:hover:not(:disabled) { background: #92400e; }
    #ab-deploy-term {
      background: #000; color: #4ade80; font-family: 'Courier New', monospace; font-size: 10.5px;
      border-radius: 6px; padding: 8px; max-height: 160px; overflow-y: auto; white-space: pre-wrap;
      min-height: 36px; line-height: 1.4;
    }
    #ab-deploy-status { font-size: 11px; color: #94a3b8; margin-top: 8px; min-height: 14px; }
    /* --admin-bar-h é atualizado via JS com a altura real da barra — ela pode ocupar
       mais de uma linha em telas estreitas (muitos botões não cabem numa linha só).
       Só reserva o espaço no topo da página (padding-top do body): o header do site
       usa "position: sticky", mas o sticky não está realmente funcionando nesta página
       (algum ancestral com overflow não-visible quebra o contexto de scroll dele — o
       header já rola junto com a página normalmente para qualquer visitante, mesmo sem
       barra de admin). Forçar um "top" nele aqui apenas empurrava o header pra baixo do
       necessário no primeiro carregamento, sobrepondo a faixa de benefícios logo abaixo. */
    body.has-admin-bar { padding-top: var(--admin-bar-h, 44px) !important; }
    /* edit mode — activate card overlays */
    body.admin-edit-mode .olx-adcard { position: relative; overflow: visible !important; }
    body.admin-edit-mode .ae-overlay { display: flex !important; }
    body.admin-edit-mode .olx-adcard:hover .ae-overlay {
      background: rgba(59,130,246,.12); border-color: #3b82f6;
    }
    .ae-overlay {
      display: none;
      position: absolute; inset: -2px; z-index: 20;
      border: 2px dashed rgba(59,130,246,.35);
      border-radius: inherit;
      background: rgba(59,130,246,.05);
      pointer-events: none;
      transition: background .15s, border-color .15s;
      flex-wrap: wrap; align-items: flex-start;
      justify-content: flex-end; gap: 4px; padding: 6px;
    }
    .ae-overlay button {
      pointer-events: all; border: none; cursor: pointer;
      border-radius: 5px; padding: 4px 9px;
      font-size: 10px; font-weight: 700;
      display: inline-flex; align-items: center; gap: 3px;
      transition: all .12s; white-space: nowrap;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    .ae-btn-edit { background: #2563eb; color: #fff; }
    .ae-btn-edit:hover { background: #1d4ed8; }
    .ae-btn-dup { background: #fff; color: #374151; border: 1px solid #d1d5db !important; }
    .ae-btn-dup:hover { background: #f3f4f6; }
    .ae-btn-toggle { background: #fff; color: #374151; border: 1px solid #d1d5db !important; }
    .ae-btn-toggle:hover { background: #f3f4f6; }
    .ae-btn-del { background: #fff; color: #dc2626; border: 1px solid #fecaca !important; }
    .ae-btn-del:hover { background: #fef2f2; }
    .ae-archived-ribbon {
      position: absolute; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,.55); z-index: 15;
      display: flex; align-items: center; justify-content: center;
      color: #fca5a5; font-weight: 800; font-size: 13px; letter-spacing: 1px;
      border-radius: inherit;
    }
  `;

  const styleEl = document.createElement('style');
  styleEl.id = 'admin-bar-styles';
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  const firstName = session.nome ? session.nome.split(' ')[0] : (session.email || 'Admin');
  const isSuperAdmin = session.role === 'superadmin';

  const bar = document.createElement('div');
  bar.id = 'admin-bar';
  bar.innerHTML = `
    <span class="ab-badge">${isSuperAdmin ? '★' : '⚙'} ${isSuperAdmin ? 'SUPER ADMIN' : 'ADMIN'}</span>
    <span class="ab-user">${firstName}</span>
    <button class="ab-btn ab-deploy-btn" id="ab-deploy-btn" title="Atualizar o site (deploy)">🚀 Deploy</button>
    <span class="ab-spacer"></span>
    <button class="ab-edit-btn" id="ab-edit-btn" title="Ativar modo de edição inline nos produtos">✏ Modo Edição</button>
    <button class="ab-new-btn" id="ab-new-btn" title="Criar novo produto no catálogo">+ Novo Produto</button>
    <a href="/admin/produtos" class="ab-btn ab-devops-btn" title="Painel de Produtos">📦 Produtos</a>
    <a href="/devops" target="_blank" class="ab-btn ab-devops-btn" title="Painel DevOps">DevOps ↗</a>
    <button class="ab-logout-btn" id="ab-logout-btn">Sair</button>
  `;
  document.body.insertBefore(bar, document.body.firstChild);
  document.body.classList.add('has-admin-bar');

  // A barra pode quebrar em 2 linhas em telas estreitas (muitos botões) — mede a altura
  // real e ajusta o espaço reservado no topo da página, pra nada ficar coberto por ela.
  const syncBarHeight = () => {
    document.documentElement.style.setProperty('--admin-bar-h', bar.offsetHeight + 'px');
  };
  syncBarHeight();
  window.addEventListener('resize', syncBarHeight);
  window.addEventListener('orientationchange', syncBarHeight);
  if (window.ResizeObserver) new ResizeObserver(syncBarHeight).observe(bar);

  // Restore edit mode state from sessionStorage
  if (sessionStorage.getItem('admin-edit-mode') === '1') {
    document.body.classList.add('admin-edit-mode');
    document.getElementById('ab-edit-btn').classList.add('active');
    document.getElementById('ab-edit-btn').textContent = '✏ Edição: ON';
    if (window.adminEditAttach) window.adminEditAttach();
  }

  document.getElementById('ab-edit-btn').addEventListener('click', function () {
    const on = document.body.classList.toggle('admin-edit-mode');
    sessionStorage.setItem('admin-edit-mode', on ? '1' : '0');
    this.classList.toggle('active', on);
    this.textContent = on ? '✏ Edição: ON' : '✏ Modo Edição';
    if (on && window.adminEditAttach) window.adminEditAttach();
  });

  document.getElementById('ab-new-btn').addEventListener('click', function () {
    if (window.adminOpenNewProduct) window.adminOpenNewProduct();
  });

  document.getElementById('ab-logout-btn').addEventListener('click', async function () {
    const token = session.token;
    if (token) {
      try { await fetch('/api/auth/logout', { method: 'POST', headers: { 'X-Auth-Token': token } }); } catch {}
    }
    localStorage.removeItem('user-session');
    sessionStorage.removeItem('admin-edit-mode');
    location.reload();
  });

  // ── Deploy popover — mesmo endpoint que o botão "Deploy" do /devops usa ─────────
  let deployPanel = null;

  function buildDeployPanel() {
    const panel = document.createElement('div');
    panel.id = 'ab-deploy-panel';
    panel.innerHTML = `
      <h4>🚀 Deploy do site</h4>
      <div class="ab-dp-actions">
        <button class="ab-dp-btn ab-dp-full" id="ab-dp-full" title="Faz backup, atualiza e reinicia">Deploy Completo</button>
        <button class="ab-dp-btn ab-dp-quick" id="ab-dp-quick" title="Atualiza e reinicia sem backup">Deploy Rápido</button>
      </div>
      <div id="ab-deploy-term">Aguardando comando...</div>
      <div id="ab-deploy-status"></div>
    `;
    document.body.appendChild(panel);

    panel.querySelector('#ab-dp-full').addEventListener('click', () => {
      if (confirm('Isso vai fazer backup dos dados, baixar as atualizações mais recentes e reiniciar o site. Pode levar alguns minutos. Continuar?')) {
        runDeploy('full');
      }
    });
    panel.querySelector('#ab-dp-quick').addEventListener('click', () => {
      if (confirm('Isso vai atualizar e reiniciar o site SEM fazer backup antes. Use apenas se tiver certeza. Continuar?')) {
        runDeploy('quick');
      }
    });

    return panel;
  }

  function toggleDeployPanel() {
    if (!deployPanel) deployPanel = buildDeployPanel();
    const btn = document.getElementById('ab-deploy-btn');
    if (deployPanel.classList.contains('open')) {
      deployPanel.classList.remove('open');
      btn.classList.remove('active');
      return;
    }
    const rect = btn.getBoundingClientRect();
    const panelWidth = Math.min(340, window.innerWidth * 0.92);
    deployPanel.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - panelWidth - 8)) + 'px';
    deployPanel.classList.add('open');
    btn.classList.add('active');
  }

  document.getElementById('ab-deploy-btn').addEventListener('click', function (e) {
    e.stopPropagation();
    toggleDeployPanel();
  });

  document.addEventListener('click', (e) => {
    if (!deployPanel || !deployPanel.classList.contains('open')) return;
    if (deployPanel.contains(e.target)) return;
    deployPanel.classList.remove('open');
    document.getElementById('ab-deploy-btn').classList.remove('active');
  });

  async function runDeploy(mode) {
    const term = document.getElementById('ab-deploy-term');
    const status = document.getElementById('ab-deploy-status');
    const btnFull = document.getElementById('ab-dp-full');
    const btnQuick = document.getElementById('ab-dp-quick');
    btnFull.disabled = true; btnQuick.disabled = true;
    term.textContent = '';
    status.textContent = mode === 'quick' ? '⚡ Iniciando deploy rápido...' : '🚀 Iniciando deploy completo...';

    try {
      const resp = await fetch('/api/admin/system/deploy', {
        method: 'POST',
        headers: { 'X-Auth-Token': session.token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode })
      });
      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const ln of lines) {
          if (!ln.startsWith('data: ')) continue;
          try {
            const { type, data } = JSON.parse(ln.slice(6));
            term.textContent += data + '\n';
            term.scrollTop = term.scrollHeight;
            if (type === 'done')  status.textContent = '✓ ' + data;
            if (type === 'error') status.textContent = '✕ ' + data;
          } catch (parseErr) {}
        }
      }
    } catch (e) {
      term.textContent += 'Erro de conexão: ' + e.message + '\n';
      status.textContent = '✕ Falha ao conectar com o servidor.';
    }

    btnFull.disabled = false; btnQuick.disabled = false;
  }

  // Expose session for admin-edit.js
  window._adminSession = session;
})();
