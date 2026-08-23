/* admin-edit.js — Visual inline product editing for admin users. */
(function () {
  'use strict';

  if (!window._adminSession) return;

  const TOKEN = window._adminSession.token;
  // DevOps master token (set when user logged into /devops)
  const DEVOPS_TOKEN = localStorage.getItem('devops_token') || null;
  const CATALOGS = {
    loja: 'Loja'
  };

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const api = (method, url, body) => {
    const headers = { 'Content-Type': 'application/json', 'X-Auth-Token': TOKEN };
    if (DEVOPS_TOKEN) headers['X-Admin-Token'] = DEVOPS_TOKEN;
    return fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined }).then(r => r.json());
  };

  const showToast = (msg, err) => {
    const t = document.createElement('div');
    t.style.cssText = `
      position:fixed;bottom:90px;left:50%;transform:translateX(-50%);
      background:${err ? '#991b1b' : '#065f46'};color:#fff;
      padding:11px 20px;border-radius:8px;z-index:200000;
      font-size:13px;font-weight:600;font-family:inherit;
      box-shadow:0 4px 20px rgba(0,0,0,.3);max-width:92vw;text-align:center;
      white-space:pre-wrap;animation:aeToastIn .22s ease;
    `;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3500);
  };

  const injectKF = () => {
    if (document.getElementById('ae-kf')) return;
    const s = document.createElement('style');
    s.id = 'ae-kf';
    s.textContent = `
      @keyframes aeToastIn{from{opacity:0;transform:translateX(-50%) translateY(8px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
      @keyframes aeSlide{from{transform:translateX(100%)}to{transform:translateX(0)}}
    `;
    document.head.appendChild(s);
  };
  injectKF();

  const f = (extra) => `width:100%;padding:8px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;font-family:inherit;box-sizing:border-box;outline:none;${extra || ''}`;
  const btn = (bg, color, extra) => `background:${bg};color:${color};border:1px solid transparent;padding:7px 14px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:700;font-family:inherit;display:inline-flex;align-items:center;gap:5px;transition:opacity .15s;${extra || ''}`;
  const lbl = (text) => `<span style="font-size:11px;font-weight:700;color:#64748b;display:block;margin-bottom:4px;">${text}</span>`;

  // Redimensiona/comprime a foto no canvas antes de enviar — evita que uma foto de celular
  // (6-12MB) vire o arquivo que o site carrega. Se der erro (ex: formato que o navegador não
  // decodifica), cai de volta pro arquivo original em vez de travar o upload.
  const compressImageFile = (file, maxDim, quality) => {
    maxDim = maxDim || 1600;
    quality = quality || 0.82;
    return new Promise(resolve => {
      const reader = new FileReader();
      reader.onerror = () => resolve(null);
      reader.onload = () => {
        const originalDataUrl = reader.result;
        const img = new Image();
        img.onload = () => {
          try {
            const w = img.naturalWidth, h = img.naturalHeight;
            const scale = Math.min(1, maxDim / Math.max(w, h));
            const cw = Math.max(1, Math.round(w * scale));
            const ch = Math.max(1, Math.round(h * scale));
            const canvas = document.createElement('canvas');
            canvas.width = cw; canvas.height = ch;
            canvas.getContext('2d').drawImage(img, 0, 0, cw, ch);
            const out = canvas.toDataURL('image/jpeg', quality);
            resolve(out && out.length > 100 ? out : originalDataUrl);
          } catch (e) { resolve(originalDataUrl); }
        };
        img.onerror = () => resolve(originalDataUrl);
        img.src = originalDataUrl;
      };
      reader.readAsDataURL(file);
    });
  };

  // ── Card overlay attachment ───────────────────────────────────────────────────

  const attached = new WeakSet();

  window.adminEditAttach = function () {
    document.querySelectorAll('.olx-adcard[data-product-id]').forEach(card => {
      if (attached.has(card)) return;
      attached.add(card);
      const pid = String(card.getAttribute('data-product-id'));

      const ov = document.createElement('div');
      ov.className = 'ae-overlay';
      ov.innerHTML = `
        <button class="ae-btn-edit" title="Editar">✏ Editar</button>
        <button class="ae-btn-dup"  title="Duplicar">⧉</button>
        <button class="ae-btn-del"  title="Arquivar">🗑</button>
      `;
      card.style.position = 'relative';
      card.appendChild(ov);

      ov.querySelector('.ae-btn-edit').onclick = e => { e.stopPropagation(); openEditDrawer(pid); };
      ov.querySelector('.ae-btn-dup').onclick  = e => { e.stopPropagation(); duplicateProd(pid); };
      ov.querySelector('.ae-btn-del').onclick  = e => { e.stopPropagation(); archiveProd(pid, card); };
    });
  };

  new MutationObserver(() => {
    if (document.body.classList.contains('admin-edit-mode')) window.adminEditAttach();
  }).observe(document.body, { childList: true, subtree: true });

  // ── Quick actions ─────────────────────────────────────────────────────────────

  async function duplicateProd(pid) {
    const info = await api('GET', `/api/catalog/product/${pid}`).catch(() => null);
    if (!info?.catalogKey) return showToast('Produto não encontrado.', true);
    const r = await api('POST', `/api/admin/catalog/${info.catalogKey}/${pid}/duplicate`);
    r.success ? showToast(`Duplicado: "${r.product.name}"`) : showToast(r.error || 'Erro.', true);
  }

  async function archiveProd(pid, card) {
    if (!confirm('Arquivar este produto? Ele ficará oculto mas pode ser restaurado.')) return;
    const info = await api('GET', `/api/catalog/product/${pid}`).catch(() => null);
    if (!info?.catalogKey) return showToast('Produto não encontrado.', true);
    const r = await api('PATCH', `/api/admin/catalog/${info.catalogKey}/${pid}`, { archived: true });
    if (r.success) {
      showToast('Produto arquivado.');
      card.style.opacity = '0.4';
    } else showToast(r.error || 'Erro.', true);
  }

  // ── Edit Drawer ───────────────────────────────────────────────────────────────

  let drawer = null;
  let productData = null;
  let catalogKey = null;
  let aeCvState = []; // [{name,hex,images,stock,sku}] — drawer de edição
  let aeCvDefault = '';
  let aeCvUploadTarget = -1;
  let aeCvMState = []; // mesma coisa, mas pro modal "+ Novo Produto" (IDs diferentes, evita colisão)
  let aeCvMDefault = '';
  let aeCvMUploadTarget = -1;

  function createDrawer() {
    const el = document.createElement('div');
    el.id = 'ae-drawer';
    el.style.cssText = `
      position:fixed;top:0;right:0;bottom:0;width:min(500px,100vw);
      background:#fff;z-index:199999;
      box-shadow:-4px 0 32px rgba(0,0,0,.2);
      display:flex;flex-direction:column;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
      transform:translateX(100%);transition:transform .28s cubic-bezier(.4,0,.2,1);
    `;

    const catalogOpts = Object.entries(CATALOGS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');

    el.innerHTML = `
      <!-- Header + Tabs -->
      <div style="background:#0f172a;color:#fff;padding:0;flex-shrink:0;">
        <div style="display:flex;align-items:center;gap:10px;padding:14px 18px 0;">
          <span id="ae-d-title" style="font-size:15px;font-weight:700;flex:1;">✏ Editar Produto</span>
          <button id="ae-d-close" style="${btn('rgba(255,255,255,.12)','#fff','padding:4px 10px;font-size:15px;line-height:1;')}">✕</button>
        </div>
        <div style="display:flex;gap:0;padding:10px 18px 0;border-bottom:1px solid rgba(255,255,255,.1);">
          <button data-tab="edit"    class="ae-tab-btn ae-tab-active" style="background:transparent;border:none;color:#fff;padding:6px 14px;font-size:12px;font-weight:700;cursor:pointer;border-bottom:2px solid #3b82f6;font-family:inherit;">Campos</button>
          <button data-tab="images"  class="ae-tab-btn" style="background:transparent;border:none;color:rgba(255,255,255,.6);padding:6px 14px;font-size:12px;font-weight:700;cursor:pointer;border-bottom:2px solid transparent;font-family:inherit;">Imagens</button>
          <button data-tab="colors"  class="ae-tab-btn" style="background:transparent;border:none;color:rgba(255,255,255,.6);padding:6px 14px;font-size:12px;font-weight:700;cursor:pointer;border-bottom:2px solid transparent;font-family:inherit;">Cores</button>
          <button data-tab="history" class="ae-tab-btn" style="background:transparent;border:none;color:rgba(255,255,255,.6);padding:6px 14px;font-size:12px;font-weight:700;cursor:pointer;border-bottom:2px solid transparent;font-family:inherit;">Histórico</button>
        </div>
      </div>

      <!-- Loading overlay -->
      <div id="ae-d-loading" style="position:absolute;inset:0;background:rgba(255,255,255,.85);z-index:10;display:none;align-items:center;justify-content:center;font-size:14px;color:#64748b;">Carregando...</div>

      <!-- Body -->
      <div id="ae-d-body" style="flex:1;overflow-y:auto;padding:18px;">

        <!-- FIELDS TAB -->
        <div id="ae-tab-edit">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <label style="grid-column:1/-1;">${lbl('NOME DO PRODUTO')}<input id="ae-f-name" style="${f()}" placeholder="Nome do produto"></label>
            <label>${lbl('PREÇO (R$)')}<input id="ae-f-price" type="number" step="0.01" style="${f()}" placeholder="0.00"></label>
            <label>${lbl('PREÇO ORIGINAL (R$)')}<input id="ae-f-priceOrig" type="number" step="0.01" style="${f()}" placeholder="0.00"></label>
            <label>${lbl('MODELO')}<input id="ae-f-model" style="${f()}" placeholder="Conjunto Renda"></label>
            <label>${lbl('COR')}<input id="ae-f-color" style="${f()}" placeholder="Preto"></label>
            <label>${lbl('TAMANHO')}<input id="ae-f-storage" style="${f()}" placeholder="P / M / G / GG"></label>
            <label>${lbl('ESTOQUE')}
              <div style="display:flex;gap:4px;">
                <input id="ae-f-stock" type="number" style="${f()}" placeholder="1">
                <button type="button" title="Marcar esgotado" onclick="document.getElementById('ae-f-stock').value=0" style="${btn('#fee2e2', '#991b1b', 'padding:6px 8px;font-size:11px;white-space:nowrap;')}">Esgotado</button>
                <button type="button" title="Repor 1 unidade" onclick="document.getElementById('ae-f-stock').value=1" style="${btn('#dcfce7', '#166534', 'padding:6px 8px;font-size:11px;white-space:nowrap;')}">Repor</button>
              </div>
            </label>
            <label>${lbl('CONDIÇÃO')}<select id="ae-f-condition" style="${f()}"><option>Novo</option><option>Seminovo</option><option>Usado</option></select></label>
            <label>${lbl('VENDEDOR')}<input id="ae-f-seller" style="${f()}" placeholder="Loja Oficial"></label>
            <label>${lbl('AVALIAÇÃO (0–5)')}<input id="ae-f-rating" type="number" step="0.1" min="0" max="5" style="${f()}" placeholder="5.0"></label>
            <label>${lbl('BADGE PROMO')}<input id="ae-f-badge" style="${f()}" placeholder="Oferta do Dia"></label>
            <label>${lbl('% DESCONTO')}<input id="ae-f-discount" type="number" min="0" max="100" style="${f()}" placeholder="0"></label>
            <label style="grid-column:1/-1;">${lbl('URL MERCADO LIVRE')}<input id="ae-f-mlurl" style="${f()}" placeholder="https://..."></label>
            <label style="grid-column:1/-1;">${lbl('DESCRIÇÃO')}<textarea id="ae-f-desc" rows="3" style="${f('resize:vertical;')}"></textarea></label>
          </div>
          <div style="display:flex;gap:16px;margin-top:10px;flex-wrap:wrap;">
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px;"><input type="checkbox" id="ae-f-promo" style="width:15px;height:15px;cursor:pointer;"> Em Promoção</label>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px;"><input type="checkbox" id="ae-f-archived" style="width:15px;height:15px;cursor:pointer;"> Arquivado</label>
          </div>
        </div>

        <!-- IMAGES TAB -->
        <div id="ae-tab-images" style="display:none;">
          <p style="font-size:12px;color:#64748b;margin:0 0 8px;">Gerencie as imagens. A primeira da lista é a <strong>imagem principal</strong> exibida no catálogo e na página do produto.</p>
          <!-- Preview da imagem principal -->
          <div id="ae-img-preview" style="display:none;margin-bottom:12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px;text-align:center;">
            <div style="font-size:10px;font-weight:700;color:#64748b;margin-bottom:6px;text-transform:uppercase;letter-spacing:.05em;">Pré-visualização — Imagem Principal</div>
            <img id="ae-img-preview-img" src="" alt="" style="max-width:120px;max-height:120px;object-fit:contain;border-radius:6px;border:1px solid #e2e8f0;">
          </div>
          <div id="ae-img-list" style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px;"></div>
          <div style="display:flex;gap:8px;margin-bottom:10px;">
            <input id="ae-img-url" style="${f('flex:1;')}" placeholder="Colar URL de imagem...">
            <button id="ae-img-add" style="${btn('#1d4ed8','#fff')}">+ URL</button>
          </div>
          <label id="ae-img-drop" style="display:block;border:2px dashed #cbd5e1;border-radius:8px;padding:14px;text-align:center;cursor:pointer;color:#64748b;font-size:12px;transition:border-color .15s;">
            📁 Clique aqui ou arraste uma imagem<br>
            <small style="color:#94a3b8;">PNG, JPG, WebP • a foto é comprimida automaticamente</small>
            <input type="file" id="ae-img-file" accept="image/*" style="display:none;">
          </label>
          <div id="ae-img-prog" style="font-size:12px;color:#64748b;min-height:18px;margin-top:6px;"></div>
        </div>

        <!-- COLORS TAB -->
        <div id="ae-tab-colors" style="display:none;">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px;font-weight:700;margin-bottom:10px;">
            <input type="checkbox" id="ae-f-has-colors" style="width:15px;height:15px;cursor:pointer;"> Este produto tem variações de cor?
          </label>
          <div id="ae-cv-body" style="display:none;">
            <div id="ae-cv-list"></div>
            <button type="button" id="ae-cv-add-btn" style="${btn('#1d4ed8','#fff','width:100%;justify-content:center;margin-top:4px;')}">+ Adicionar cor</button>
            <p style="font-size:11px;color:#94a3b8;margin:8px 0 0;">A primeira foto de cada cor é a principal. Marque uma cor como "Padrão".</p>
          </div>
        </div>

        <!-- HISTORY TAB -->
        <div id="ae-tab-history" style="display:none;">
          <p style="font-size:12px;color:#64748b;margin:0 0 12px;">Últimas 50 alterações registradas.</p>
          <div id="ae-hist-list"></div>
        </div>

      </div>

      <!-- Footer -->
      <div style="border-top:1px solid #e2e8f0;padding:12px 18px;display:flex;gap:8px;flex-wrap:wrap;background:#f8fafc;flex-shrink:0;">
        <button id="ae-save" style="${btn('#1d4ed8','#fff','flex:1;justify-content:center;')}">💾 Salvar</button>
        <button id="ae-cancel" style="${btn('#e2e8f0','#374151')}">Cancelar</button>
        <button id="ae-dup" style="${btn('#f0fdf4','#15803d')}" title="Duplicar produto">⧉</button>
        <button id="ae-del" style="${btn('#fef2f2','#dc2626')}" title="Arquivar/restaurar">🗑 Arquivar</button>
      </div>
      <!-- Danger Zone -->
      <div style="border-top:2px dashed #fecaca;padding:12px 18px;background:#fff8f8;flex-shrink:0;">
        <div style="font-size:10px;font-weight:800;color:#b91c1c;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px;">⚠ Zona de Perigo</div>
        <button id="ae-delete-btn" style="${btn('#fee2e2','#b91c1c','width:100%;justify-content:center;border:1.5px solid #fca5a5;font-size:13px;padding:9px 14px;')}">🗑 Excluir Produto</button>
      </div>
    `;

    document.body.appendChild(el);

    // Tab switching
    el.querySelectorAll('.ae-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const name = btn.dataset.tab;
        el.querySelectorAll('.ae-tab-btn').forEach(b => {
          b.style.color = b.dataset.tab === name ? '#fff' : 'rgba(255,255,255,.6)';
          b.style.borderBottomColor = b.dataset.tab === name ? '#3b82f6' : 'transparent';
        });
        ['edit','images','colors','history'].forEach(t => {
          document.getElementById(`ae-tab-${t}`).style.display = t === name ? 'block' : 'none';
        });
        if (name === 'images' && productData) renderImages(productData.images || []);
        if (name === 'colors') renderAeCv();
        if (name === 'history' && productData) renderHistory(productData._history || []);
      });
    });

    el.querySelector('#ae-d-close').addEventListener('click', closeDrawer);
    el.querySelector('#ae-cancel').addEventListener('click', closeDrawer);
    el.querySelector('#ae-save').addEventListener('click', saveProduct);
    el.querySelector('#ae-dup').addEventListener('click', async () => {
      if (!productData || !catalogKey) return;
      const r = await api('POST', `/api/admin/catalog/${catalogKey}/${productData.id}/duplicate`);
      r.success ? (showToast(`Duplicado: "${r.product.name}"`), closeDrawer()) : showToast(r.error || 'Erro.', true);
    });
    el.querySelector('#ae-del').addEventListener('click', () => {
      if (!productData) return;
      const willArchive = !document.getElementById('ae-f-archived').checked;
      document.getElementById('ae-f-archived').checked = willArchive;
      el.querySelector('#ae-del').textContent = willArchive ? '↩ Restaurar' : '🗑 Arquivar';
    });

    el.querySelector('#ae-delete-btn').addEventListener('click', () => {
      if (!productData) return;
      openDeleteModal();
    });

    // Image URL add
    el.querySelector('#ae-img-add').addEventListener('click', () => {
      const url = document.getElementById('ae-img-url').value.trim();
      if (!url || !productData) return;
      productData.images = productData.images || [];
      productData.images.push(url);
      document.getElementById('ae-img-url').value = '';
      renderImages(productData.images);
    });

    // File upload
    const drop = el.querySelector('#ae-img-drop');
    const fileIn = el.querySelector('#ae-img-file');
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.style.borderColor = '#3b82f6'; });
    drop.addEventListener('dragleave', () => { drop.style.borderColor = '#cbd5e1'; });
    drop.addEventListener('drop', e => { e.preventDefault(); drop.style.borderColor = '#cbd5e1'; uploadFile(e.dataTransfer.files[0]); });
    fileIn.addEventListener('change', e => uploadFile(e.target.files[0]));

    // Variações de cor
    el.querySelector('#ae-f-has-colors').addEventListener('change', toggleAeCvBody);
    el.querySelector('#ae-cv-add-btn').addEventListener('click', addAeCv);

    window.addEventListener('keydown', e => { if (e.key === 'Escape' && drawer) closeDrawer(); });
    return el;
  }

  function toggleAeCvBody() {
    const on = document.getElementById('ae-f-has-colors').checked;
    document.getElementById('ae-cv-body').style.display = on ? 'block' : 'none';
    if (on && aeCvState.length === 0) addAeCv();
  }

  function addAeCv() {
    aeCvState.push({ name: '', hex: '', images: [], stock: 0, sku: '' });
    renderAeCv();
  }

  function removeAeCv(i) {
    const removed = aeCvState[i];
    aeCvState.splice(i, 1);
    if (removed && removed.name === aeCvDefault) aeCvDefault = aeCvState[0] ? aeCvState[0].name : '';
    renderAeCv();
  }

  function moveAeCv(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= aeCvState.length) return;
    const tmp = aeCvState[i]; aeCvState[i] = aeCvState[j]; aeCvState[j] = tmp;
    renderAeCv();
  }

  function renderAeCv() {
    const list = document.getElementById('ae-cv-list');
    if (!list) return;
    list.innerHTML = aeCvState.map((v, i) => {
      const isDefault = v.name && v.name === aeCvDefault;
      const photos = (v.images || []).map((url, pi) => `
        <div style="position:relative;width:52px;">
          ${pi === 0 ? `<span style="position:absolute;top:-5px;left:-5px;background:#f59e0b;color:#fff;font-size:8px;font-weight:800;padding:1px 4px;border-radius:4px;z-index:1;">★</span>` : ''}
          <button type="button" data-cv-photo-rm="${i}_${pi}" style="position:absolute;top:-5px;right:-5px;background:#dc2626;color:#fff;border:2px solid #fff;width:16px;height:16px;border-radius:50%;font-size:9px;cursor:pointer;line-height:1;">✕</button>
          <img src="${url}" style="width:52px;height:52px;object-fit:cover;border-radius:6px;border:2px solid ${pi===0?'#f59e0b':'#e2e8f0'};">
        </div>`).join('');
      return `
      <div style="border:1px solid #e2e8f0;border-radius:8px;padding:10px;margin-bottom:8px;background:#f8fafc;">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">
          ${v.hex ? `<span style="width:15px;height:15px;border-radius:50%;background:${v.hex};border:1px solid #e2e8f0;flex-shrink:0;"></span>` : ''}
          <label style="display:flex;align-items:center;gap:4px;font-size:10px;font-weight:700;color:${isDefault?'#b45309':'#94a3b8'};cursor:pointer;">
            <input type="radio" name="ae-cv-default-radio" data-cv-default="${i}" ${isDefault?'checked':''}> ${isDefault?'★ Padrão':'Padrão'}
          </label>
          <span style="flex:1;"></span>
          <button type="button" data-cv-up="${i}" style="${btn('#f1f5f9','#374151','padding:3px 7px;font-size:10px;')}" ${i===0?'disabled':''}>↑</button>
          <button type="button" data-cv-dn="${i}" style="${btn('#f1f5f9','#374151','padding:3px 7px;font-size:10px;')}" ${i===aeCvState.length-1?'disabled':''}>↓</button>
          <button type="button" data-cv-rm="${i}" style="${btn('#fef2f2','#dc2626','padding:3px 7px;font-size:10px;')}">🗑</button>
        </div>
        <div style="display:grid;grid-template-columns:1fr 60px;gap:6px;margin-bottom:8px;">
          <input data-cv-field="name" data-cv-idx="${i}" value="${(v.name||'').replace(/"/g,'&quot;')}" style="${f()}" placeholder="Nome da cor (ex: Rosa)">
          <input type="color" data-cv-field="hex" data-cv-idx="${i}" value="${v.hex||'#e8518a'}" style="${f('padding:2px;height:34px;')}">
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px;">${photos}
          <button type="button" data-cv-addphoto="${i}" style="width:52px;height:52px;border-radius:6px;border:2px dashed #cbd5e1;background:#fff;color:#94a3b8;font-size:16px;cursor:pointer;">+</button>
        </div>
        <div data-cv-progress="${i}" style="font-size:10px;color:#64748b;min-height:13px;margin-bottom:6px;"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
          <input type="number" min="0" data-cv-field="stock" data-cv-idx="${i}" value="${v.stock??0}" style="${f()}" placeholder="Estoque">
          <input data-cv-field="sku" data-cv-idx="${i}" value="${(v.sku||'').replace(/"/g,'&quot;')}" style="${f()}" placeholder="SKU (opcional)">
        </div>
      </div>`;
    }).join('');

    list.querySelectorAll('[data-cv-field]').forEach(el => {
      el.addEventListener('input', () => {
        const i = +el.getAttribute('data-cv-idx');
        const field = el.getAttribute('data-cv-field');
        const v = aeCvState[i]; if (!v) return;
        const wasDefault = v.name && v.name === aeCvDefault;
        v[field] = field === 'stock' ? (parseInt(el.value, 10) || 0) : el.value;
        if (wasDefault) aeCvDefault = v.name;
      });
    });
    list.querySelectorAll('[data-cv-default]').forEach(el => el.addEventListener('change', () => {
      const i = +el.getAttribute('data-cv-default');
      aeCvDefault = aeCvState[i] ? aeCvState[i].name : '';
      renderAeCv();
    }));
    list.querySelectorAll('[data-cv-up]').forEach(el => el.addEventListener('click', () => moveAeCv(+el.getAttribute('data-cv-up'), -1)));
    list.querySelectorAll('[data-cv-dn]').forEach(el => el.addEventListener('click', () => moveAeCv(+el.getAttribute('data-cv-dn'), 1)));
    list.querySelectorAll('[data-cv-rm]').forEach(el => el.addEventListener('click', () => removeAeCv(+el.getAttribute('data-cv-rm'))));
    list.querySelectorAll('[data-cv-addphoto]').forEach(el => el.addEventListener('click', () => {
      aeCvUploadTarget = +el.getAttribute('data-cv-addphoto');
      aeCvFileInput.value = '';
      aeCvFileInput.click();
    }));
    list.querySelectorAll('[data-cv-photo-rm]').forEach(el => el.addEventListener('click', () => {
      const [vi, pi] = el.getAttribute('data-cv-photo-rm').split('_').map(Number);
      if (aeCvState[vi]) { aeCvState[vi].images.splice(pi, 1); renderAeCv(); }
    }));
  }

  const aeCvFileInput = document.createElement('input');
  aeCvFileInput.type = 'file'; aeCvFileInput.accept = 'image/*'; aeCvFileInput.multiple = true; aeCvFileInput.style.display = 'none';
  document.body.appendChild(aeCvFileInput);
  aeCvFileInput.addEventListener('change', e => {
    const files = Array.prototype.filter.call(e.target.files, f => f.type.indexOf('image/') === 0);
    if (!files.length || aeCvUploadTarget < 0) return;
    uploadAeCvPhotos(files, aeCvUploadTarget, 0, files.length);
  });

  async function uploadAeCvPhotos(files, targetIndex, index, total) {
    const progEl = document.querySelector(`[data-cv-progress="${targetIndex}"]`);
    if (index >= total) {
      if (progEl) { progEl.textContent = 'Fotos adicionadas!'; setTimeout(() => { if (progEl) progEl.textContent = ''; }, 2000); }
      return;
    }
    const file = files[index];
    if (progEl) progEl.textContent = `Enviando... ${index} de ${total}`;
    if (file.size > 18 * 1024 * 1024) { uploadAeCvPhotos(files, targetIndex, index + 1, total); return; }
    const dataUrl = await compressImageFile(file);
    const r = await api('POST', '/api/admin/upload', { dataUrl, filename: file.name });
    if (r.success && aeCvState[targetIndex]) {
      aeCvState[targetIndex].images.push(r.url);
      renderAeCv();
    }
    uploadAeCvPhotos(files, targetIndex, index + 1, total);
  }

  function renderImages(images) {
    const list = document.getElementById('ae-img-list');
    if (!list) return;
    list.innerHTML = '';

    // Atualiza pré-visualização da imagem principal
    const preview    = document.getElementById('ae-img-preview');
    const previewImg = document.getElementById('ae-img-preview-img');
    if (images && images.length > 0) {
      if (preview)    preview.style.display = 'block';
      if (previewImg) { previewImg.src = images[0]; previewImg.alt = 'Imagem principal'; }
    } else {
      if (preview) preview.style.display = 'none';
    }

    (images || []).forEach((url, i) => {
      const isMain = i === 0;
      const row = document.createElement('div');
      row.style.cssText = `display:flex;align-items:center;gap:7px;border-radius:7px;padding:5px 8px;${isMain ? 'background:#eff6ff;border:1.5px solid #3b82f6;' : 'background:#f8fafc;border:1px solid #e2e8f0;'}`;
      row.innerHTML = `
        <div style="position:relative;flex-shrink:0;">
          <img src="${url}" style="width:38px;height:38px;object-fit:cover;border-radius:4px;" onerror="this.src='';this.style.background='#e2e8f0'">
          ${isMain ? `<span style="position:absolute;top:-5px;left:-5px;background:#f59e0b;color:#fff;font-size:9px;font-weight:800;border-radius:3px;padding:1px 3px;line-height:1.2;">⭐ MAIN</span>` : ''}
        </div>
        <span style="flex:1;font-size:10px;color:#64748b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${url}">${url.length > 45 ? '…' + url.slice(-38) : url}</span>
        ${!isMain ? `<button data-i="${i}" style="${btn('#dbeafe','#1d4ed8','padding:2px 5px;font-size:10px;')}" class="ai-main" title="Definir como principal">⭐</button>` : ''}
        <button data-i="${i}" style="${btn('#f1f5f9','#374151','padding:3px 6px;font-size:11px;')}${i === 0 ? 'opacity:.35;cursor:default;' : ''}" class="ai-up" title="Para cima"${i === 0 ? ' disabled' : ''}>↑</button>
        <button data-i="${i}" style="${btn('#f1f5f9','#374151','padding:3px 6px;font-size:11px;')}${i >= (images.length - 1) ? 'opacity:.35;cursor:default;' : ''}" class="ai-dn" title="Para baixo"${i >= (images.length - 1) ? ' disabled' : ''}>↓</button>
        <button data-i="${i}" style="${btn('#fef2f2','#dc2626','padding:3px 6px;font-size:11px;')}" class="ai-rm" title="Remover">✕</button>
      `;
      list.appendChild(row);
    });

    list.querySelectorAll('.ai-rm').forEach(b => b.addEventListener('click', () => {
      productData.images.splice(+b.dataset.i, 1);
      renderImages(productData.images);
    }));
    list.querySelectorAll('.ai-up').forEach(b => b.addEventListener('click', () => {
      const i = +b.dataset.i; if (i === 0) return;
      [productData.images[i-1], productData.images[i]] = [productData.images[i], productData.images[i-1]];
      renderImages(productData.images);
    }));
    list.querySelectorAll('.ai-dn').forEach(b => b.addEventListener('click', () => {
      const i = +b.dataset.i; if (i >= productData.images.length - 1) return;
      [productData.images[i], productData.images[i+1]] = [productData.images[i+1], productData.images[i]];
      renderImages(productData.images);
    }));
    list.querySelectorAll('.ai-main').forEach(b => b.addEventListener('click', () => {
      const i = +b.dataset.i; if (i === 0) return;
      const [item] = productData.images.splice(i, 1);
      productData.images.unshift(item);
      renderImages(productData.images);
    }));
  }

  async function uploadFile(file) {
    if (!file || !productData) return;
    if (file.size > 18 * 1024 * 1024) return showToast('Arquivo muito grande (máx 18MB).', true);
    const prog = document.getElementById('ae-img-prog');
    if (prog) prog.textContent = '⏳ Comprimindo e enviando...';
    const dataUrl = await compressImageFile(file);
    const r = await api('POST', '/api/admin/upload', { dataUrl, filename: file.name });
    if (r.success) {
      productData.images = productData.images || [];
      productData.images.unshift(r.url); // nova imagem vai para a frente como principal
      renderImages(productData.images);
      if (prog) { prog.textContent = '✓ Imagem adicionada como principal!'; setTimeout(() => { if (prog) prog.textContent = ''; }, 2500); }
    } else {
      if (prog) prog.textContent = '✕ Não foi possível enviar esta foto. Tentar novamente';
      showToast(r.error || 'Erro ao fazer upload.', true);
    }
  }

  function renderHistory(history) {
    const el = document.getElementById('ae-hist-list');
    if (!el) return;
    if (!history?.length) { el.innerHTML = '<p style="color:#94a3b8;font-size:12px;">Nenhuma alteração registrada.</p>'; return; }
    el.innerHTML = history.map(h => {
      const diffs = Object.entries(h.changes || {}).map(([k, v]) =>
        `<div style="font-size:11px;margin:2px 0;"><b style="color:#374151;">${k}:</b> <span style="color:#ef4444;">${JSON.stringify(v.from)}</span> → <span style="color:#16a34a;">${JSON.stringify(v.to)}</span></div>`
      ).join('') || '<span style="font-size:11px;color:#94a3b8;">Sem detalhes</span>';
      return `<div style="border:1px solid #e2e8f0;border-radius:7px;padding:9px 12px;margin-bottom:8px;">
        <div style="display:flex;justify-content:space-between;margin-bottom:5px;">
          <b style="font-size:11px;color:#0f172a;">${h.by || 'Desconhecido'}</b>
          <span style="font-size:10px;color:#94a3b8;">${new Date(h.at).toLocaleString('pt-BR')}</span>
        </div>${diffs}</div>`;
    }).join('');
  }

  function fillForm(p) {
    const v = (id, val) => { const el = document.getElementById(id); if (!el) return; el.type === 'checkbox' ? (el.checked = !!val) : (el.value = val ?? ''); };
    v('ae-f-name', p.name);         v('ae-f-price', p.price);
    v('ae-f-priceOrig', p.priceOriginal ?? p.price);
    v('ae-f-model', p.model);       v('ae-f-color', p.color);
    v('ae-f-storage', p.storage);   v('ae-f-stock', p.stock);
    v('ae-f-condition', p.condition || 'Novo');
    v('ae-f-seller', p.seller);     v('ae-f-rating', p.rating);
    v('ae-f-badge', p.promoBadge);  v('ae-f-discount', p.promoPercent || 0);
    v('ae-f-mlurl', p.mlUrl);       v('ae-f-desc', p.description);
    v('ae-f-promo', p.isPromo);     v('ae-f-archived', p.archived);
    const delBtn = document.getElementById('ae-del');
    if (delBtn) delBtn.textContent = p.archived ? '↩ Restaurar' : '🗑 Arquivar';

    aeCvState = Array.isArray(p.colorVariants)
      ? p.colorVariants.map(cv => ({ name: cv.name || '', hex: cv.hex || '', images: Array.isArray(cv.images) ? cv.images.slice() : [], stock: cv.stock ?? 0, sku: cv.sku || '' }))
      : [];
    aeCvDefault = p.defaultColor || (aeCvState[0] ? aeCvState[0].name : '');
    v('ae-f-has-colors', aeCvState.length > 0);
    toggleAeCvBody();
    renderAeCv();
  }

  async function openEditDrawer(pid) {
    if (!drawer) drawer = createDrawer();

    // Show loading
    const loading = document.getElementById('ae-d-loading');
    if (loading) loading.style.display = 'flex';
    drawer.style.transform = 'translateX(0)';

    const data = await api('GET', `/api/catalog/product/${pid}`).catch(() => null);
    if (loading) loading.style.display = 'none';

    if (!data?.product) {
      showToast('Produto não encontrado no catálogo.', true);
      drawer.style.transform = 'translateX(100%)';
      return;
    }

    productData = { ...data.product };
    catalogKey = data.catalogKey;

    fillForm(productData);

    // Reset to fields tab
    const fieldsTab = document.getElementById('ae-tab-edit');
    const imagesTab = document.getElementById('ae-tab-images');
    const colorsTab = document.getElementById('ae-tab-colors');
    const histTab   = document.getElementById('ae-tab-history');
    if (fieldsTab) fieldsTab.style.display = 'block';
    if (imagesTab) imagesTab.style.display = 'none';
    if (colorsTab) colorsTab.style.display = 'none';
    if (histTab)   histTab.style.display   = 'none';
    drawer.querySelectorAll('.ae-tab-btn').forEach(b => {
      b.style.color = b.dataset.tab === 'edit' ? '#fff' : 'rgba(255,255,255,.6)';
      b.style.borderBottomColor = b.dataset.tab === 'edit' ? '#3b82f6' : 'transparent';
    });
  }

  function closeDrawer() {
    if (drawer) drawer.style.transform = 'translateX(100%)';
    productData = null;
    catalogKey = null;
  }

  async function saveProduct() {
    if (!productData || !catalogKey) return;
    const g = id => { const el = document.getElementById(id); return el ? (el.type === 'checkbox' ? el.checked : el.value) : undefined; };
    const payload = {
      name: g('ae-f-name'), price: +g('ae-f-price') || 0,
      priceOriginal: +g('ae-f-priceOrig') || 0,
      model: g('ae-f-model'), color: g('ae-f-color'),
      storage: g('ae-f-storage'), stock: +g('ae-f-stock') || 0,
      condition: g('ae-f-condition'), seller: g('ae-f-seller'),
      rating: +g('ae-f-rating') || 0, promoBadge: g('ae-f-badge'),
      promoPercent: +g('ae-f-discount') || 0,
      mlUrl: g('ae-f-mlurl'), description: g('ae-f-desc'),
      isPromo: g('ae-f-promo'), archived: g('ae-f-archived'),
      images: productData.images || []
    };

    if (g('ae-f-has-colors')) {
      const named = aeCvState.filter(v => v.name.trim());
      if (!named.length) { showToast('Adicione pelo menos uma cor na aba "Cores", ou desmarque "Este produto tem variações de cor?".', true); return; }
      payload.colorVariants = named;
      payload.defaultColor = named.some(v => v.name === aeCvDefault) ? aeCvDefault : named[0].name;
    } else {
      payload.colorVariants = [];
      payload.defaultColor = '';
    }

    const saveBtn = document.getElementById('ae-save');
    if (saveBtn) { saveBtn.textContent = '⏳ Salvando...'; saveBtn.disabled = true; }

    const r = await api('PATCH', `/api/admin/catalog/${catalogKey}/${productData.id}`, payload);
    if (saveBtn) { saveBtn.textContent = '💾 Salvar'; saveBtn.disabled = false; }

    if (r.success) {
      showToast('Produto salvo com sucesso!');
      productData = r.product;
      // Live-update card in DOM (título, preço e imagem principal)
      const card = document.querySelector(`.olx-adcard[data-product-id="${productData.id}"]`);
      if (card) {
        const title = card.querySelector('.olx-adcard__title');
        if (title) title.textContent = r.product.name;
        const price = card.querySelector('.olx-adcard__price');
        if (price) price.textContent = 'R$ ' + Number(r.product.price).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
        // Atualiza imagem principal — aceita http:// e /uploads/
        const newMain = (r.product.images || []).find(s => typeof s === 'string' && s.length > 4 && (s.startsWith('http') || s.startsWith('/uploads/')));
        if (newMain) {
          const imgEl = card.querySelector('.olx-adcard__media img');
          if (imgEl) {
            imgEl.src = newMain;
          } else {
            // Cria o <img> se não existia (produto sem imagem anterior)
            const media = card.querySelector('.olx-adcard__media');
            if (media) {
              const img = document.createElement('img');
              img.src = newMain; img.alt = r.product.name;
              img.loading = 'lazy'; img.decoding = 'async';
              media.appendChild(img);
            }
          }
        }
      }
      // Recarrega catálogo completo para refletir nova ordem das imagens
      if (window.fetchProducts) window.fetchProducts();
      closeDrawer();
    } else {
      showToast(r.error || 'Erro ao salvar.', true);
    }
  }

  // ── Delete Confirmation Modal ─────────────────────────────────────────────────

  function openDeleteModal() {
    const existing = document.getElementById('ae-delete-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'ae-delete-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:299999;background:rgba(15,23,42,.8);display:flex;align-items:center;justify-content:center;padding:16px;';

    const prodName = (productData && (productData.name || productData.id)) || '?';

    modal.innerHTML = `
      <div style="background:#fff;border-radius:14px;width:min(460px,100%);box-shadow:0 24px 64px rgba(0,0,0,.4);overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
        <div style="background:#7f1d1d;color:#fff;padding:16px 20px;display:flex;align-items:center;gap:10px;">
          <span style="font-size:22px;">🗑</span>
          <div>
            <div style="font-size:14px;font-weight:800;">Excluir Produto</div>
            <div style="font-size:11px;opacity:.75;margin-top:1px;">Esta ação moverá o produto para a lixeira</div>
          </div>
        </div>
        <div style="padding:20px;">
          <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#0f172a;">Tem certeza que deseja excluir este produto?</p>
          <p style="margin:0 0 16px;font-size:13px;color:#475569;line-height:1.5;">
            O produto <strong style="color:#0f172a;">${prodName.replace(/</g,'&lt;')}</strong> será movido para a
            <strong>lixeira</strong> e ficará disponível para restauração por <strong>30 dias</strong>.
            Após esse prazo é excluído permanentemente.
          </p>
          <div style="background:#fef2f2;border:1.5px solid #fecaca;border-radius:8px;padding:14px;margin-bottom:14px;">
            <p style="margin:0 0 8px;font-size:12px;font-weight:700;color:#dc2626;">Para confirmar, digite <code style="background:#fee2e2;padding:1px 5px;border-radius:3px;font-size:12px;">EXCLUIR</code> abaixo:</p>
            <input id="ae-del-typed" style="width:100%;padding:9px 11px;border:2px solid #fca5a5;border-radius:6px;font-size:15px;font-family:monospace;font-weight:700;box-sizing:border-box;outline:none;letter-spacing:.08em;text-align:center;" placeholder="EXCLUIR" autocomplete="off" spellcheck="false">
          </div>
          <div style="margin-bottom:16px;">
            <div style="font-size:11px;font-weight:700;color:#64748b;margin-bottom:4px;">MOTIVO (OPCIONAL)</div>
            <input id="ae-del-reason-input" style="width:100%;padding:7px 10px;border:1px solid #e2e8f0;border-radius:6px;font-size:12px;font-family:inherit;box-sizing:border-box;outline:none;" placeholder="Ex: Produto descontinuado, duplicado, etc.">
          </div>
          <div style="display:flex;gap:10px;">
            <button id="ae-del-cancel-btn" style="${btn('#f1f5f9','#374151','flex:1;justify-content:center;')}">Cancelar</button>
            <button id="ae-del-confirm-btn" style="background:#dc2626;color:#fff;border:none;padding:9px 14px;border-radius:6px;cursor:not-allowed;font-size:13px;font-weight:700;font-family:inherit;flex:1;display:inline-flex;align-items:center;justify-content:center;gap:5px;opacity:.4;transition:opacity .15s;" disabled>🗑 Excluir Produto</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const input     = modal.querySelector('#ae-del-typed');
    const confirmBtn = modal.querySelector('#ae-del-confirm-btn');

    input.addEventListener('input', () => {
      const ok = input.value.toUpperCase() === 'EXCLUIR';
      confirmBtn.disabled = !ok;
      confirmBtn.style.opacity    = ok ? '1'       : '0.4';
      confirmBtn.style.cursor     = ok ? 'pointer'  : 'not-allowed';
    });

    modal.querySelector('#ae-del-cancel-btn').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

    confirmBtn.addEventListener('click', async () => {
      if (confirmBtn.disabled) return;
      const reason = (modal.querySelector('#ae-del-reason-input')?.value || '').trim();
      confirmBtn.textContent = '⏳ Excluindo...';
      confirmBtn.disabled = true;
      confirmBtn.style.opacity = '0.6';

      const r = await api('DELETE', `/api/admin/catalog/${catalogKey}/${productData.id}`, { reason });

      if (r.success) {
        modal.remove();
        // Animação de saída na card do catálogo
        const card = document.querySelector(`.olx-adcard[data-product-id="${productData.id}"]`);
        if (card) {
          card.style.transition = 'opacity .3s,transform .3s';
          card.style.opacity = '0';
          card.style.transform = 'scale(.95)';
          setTimeout(() => card.remove(), 320);
        }
        closeDrawer();
        showToast(`🗑 Produto movido para a lixeira. Restaure em até 30 dias.`);
      } else {
        showToast(r.error || 'Erro ao excluir produto.', true);
        confirmBtn.textContent = '🗑 Excluir Produto';
        confirmBtn.disabled = false;
        confirmBtn.style.opacity = '1';
      }
    });

    setTimeout(() => input.focus(), 60);
  }

  // ── New Product Modal ─────────────────────────────────────────────────────────

  let modal = null;
  let newProductUploadedUrl = null;

  window.adminOpenNewProduct = function () {
    if (!modal) modal = buildNewModal();
    // Reset form
    modal.querySelectorAll('input,textarea,select').forEach(el => {
      if (el.type === 'checkbox') el.checked = false;
      else if (el.tagName === 'SELECT') el.selectedIndex = 0;
      else el.value = '';
      delete el._dirty;
    });
    newProductUploadedUrl = null;
    const preview = modal.querySelector('#ae-m-img-preview');
    const prog = modal.querySelector('#ae-m-img-prog');
    if (preview) preview.style.display = 'none';
    if (prog) prog.textContent = '';
    aeCvMState = [];
    aeCvMDefault = '';
    document.getElementById('ae-m-cv-body').style.display = 'none';
    renderAeCvM();
    modal.style.display = 'flex';
  };

  function buildNewModal() {
    const el = document.createElement('div');
    el.id = 'ae-modal';
    el.style.cssText = 'position:fixed;inset:0;z-index:200000;background:rgba(0,0,0,.6);display:none;align-items:center;justify-content:center;padding:16px;';

    const catalogOpts = Object.entries(CATALOGS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
    el.innerHTML = `
      <div style="background:#fff;border-radius:12px;width:min(560px,100%);max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.3);">
        <div style="background:#0f172a;color:#fff;padding:16px 20px;border-radius:12px 12px 0 0;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
          <span style="font-size:15px;font-weight:700;">+ Novo Produto</span>
          <button id="ae-m-close" style="${btn('rgba(255,255,255,.12)','#fff','padding:4px 10px;font-size:15px;')}">✕</button>
        </div>
        <div style="padding:18px;">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <label style="grid-column:1/-1;">${lbl('CATÁLOGO')}<select id="ae-m-catalog" style="${f()}">${catalogOpts}</select></label>
            <label style="grid-column:1/-1;">${lbl('NOME DO PRODUTO *')}<input id="ae-m-name" style="${f()}" placeholder="Nome do produto" required></label>
            <label>${lbl('ID ÚNICO *')}<input id="ae-m-id" style="${f()}" placeholder="ex: conjunto-renda-preto-m"></label>
            <label>${lbl('PREÇO (R$) *')}<input id="ae-m-price" type="number" step="0.01" style="${f()}" placeholder="0.00"></label>
            <label>${lbl('MODELO')}<input id="ae-m-model" style="${f()}" placeholder="Conjunto Renda"></label>
            <label>${lbl('COR')}<input id="ae-m-color" style="${f()}" placeholder="Preto Titânio"></label>
            <label>${lbl('TAMANHO')}<input id="ae-m-storage" style="${f()}" placeholder="P / M / G / GG"></label>
            <label>${lbl('ESTOQUE')}<input id="ae-m-stock" type="number" style="${f()}" placeholder="1"></label>
            <label>${lbl('CONDIÇÃO')}<select id="ae-m-condition" style="${f()}"><option>Novo</option><option>Seminovo</option><option>Usado</option></select></label>
            <div style="grid-column:1/-1;">${lbl('FOTO PRINCIPAL')}
              <div id="ae-m-img-preview" style="display:none;margin-bottom:8px;">
                <img id="ae-m-img-preview-img" style="width:56px;height:56px;object-fit:cover;border-radius:6px;border:1px solid #e2e8f0;" alt="">
              </div>
              <label id="ae-m-img-drop" style="display:block;border:2px dashed #cbd5e1;border-radius:8px;padding:12px;text-align:center;cursor:pointer;color:#64748b;font-size:12px;transition:border-color .15s;">
                📁 Clique aqui ou arraste uma foto<br><small style="color:#94a3b8;">Enviada e comprimida automaticamente</small>
                <input type="file" id="ae-m-img-file" accept="image/*" style="display:none;">
              </label>
              <div id="ae-m-img-prog" style="font-size:11px;color:#64748b;min-height:16px;margin-top:4px;"></div>
              <input id="ae-m-img" style="${f('margin-top:6px;')}" placeholder="...ou cole uma URL de imagem existente">
            </div>
            <label style="grid-column:1/-1;">${lbl('DESCRIÇÃO')}<textarea id="ae-m-desc" rows="3" style="${f('resize:vertical;')}" placeholder="Descrição..."></textarea></label>
          </div>

          <div style="border-top:1px solid #e2e8f0;margin-top:14px;padding-top:12px;">
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px;font-weight:700;margin-bottom:8px;">
              <input type="checkbox" id="ae-m-f-has-colors" style="width:15px;height:15px;cursor:pointer;"> Este produto tem variações de cor?
            </label>
            <div id="ae-m-cv-body" style="display:none;">
              <div id="ae-m-cv-list"></div>
              <button type="button" id="ae-m-cv-add-btn" style="${btn('#1d4ed8','#fff','width:100%;justify-content:center;margin-top:4px;')}">+ Adicionar cor</button>
            </div>
          </div>

          <div style="display:flex;gap:8px;margin-top:16px;">
            <button id="ae-m-save" style="${btn('#1d4ed8','#fff','flex:1;justify-content:center;')}">💾 Criar Produto</button>
            <button id="ae-m-cancel" style="${btn('#e2e8f0','#374151')}">Cancelar</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(el);

    el.addEventListener('click', e => { if (e.target === el) el.style.display = 'none'; });
    el.querySelector('#ae-m-close').addEventListener('click', () => { el.style.display = 'none'; });
    el.querySelector('#ae-m-cancel').addEventListener('click', () => { el.style.display = 'none'; });
    el.querySelector('#ae-m-save').addEventListener('click', () => createProduct(el));

    // Foto principal: upload com compressão (arrasta ou clica) — vira link, não pesa o site
    const imgDrop = el.querySelector('#ae-m-img-drop');
    const imgFileIn = el.querySelector('#ae-m-img-file');
    const imgProg = el.querySelector('#ae-m-img-prog');
    const imgPreview = el.querySelector('#ae-m-img-preview');
    const imgPreviewImg = el.querySelector('#ae-m-img-preview-img');

    async function handleNewProductImage(file) {
      if (!file) return;
      if (file.size > 18 * 1024 * 1024) return showToast('Arquivo muito grande (máx 18MB).', true);
      imgProg.textContent = '⏳ Comprimindo e enviando...';
      const dataUrl = await compressImageFile(file);
      const r = await api('POST', '/api/admin/upload', { dataUrl, filename: file.name });
      if (r.success) {
        newProductUploadedUrl = r.url;
        imgPreview.style.display = 'block';
        imgPreviewImg.src = r.url;
        imgProg.textContent = '✓ Foto enviada!';
        setTimeout(() => { if (imgProg.textContent === '✓ Foto enviada!') imgProg.textContent = ''; }, 2000);
      } else {
        imgProg.textContent = '✕ Não foi possível enviar esta foto. Tentar novamente';
        showToast(r.error || 'Erro ao enviar imagem.', true);
      }
    }
    imgDrop.addEventListener('dragover', e => { e.preventDefault(); imgDrop.style.borderColor = '#3b82f6'; });
    imgDrop.addEventListener('dragleave', () => { imgDrop.style.borderColor = '#cbd5e1'; });
    imgDrop.addEventListener('drop', e => { e.preventDefault(); imgDrop.style.borderColor = '#cbd5e1'; handleNewProductImage(e.dataTransfer.files[0]); });
    imgFileIn.addEventListener('change', e => handleNewProductImage(e.target.files[0]));

    // Auto-generate ID from name
    el.querySelector('#ae-m-name').addEventListener('input', function () {
      const idEl = el.querySelector('#ae-m-id');
      if (!idEl._dirty) {
        idEl.value = this.value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'').slice(0,55) + '-' + Date.now().toString().slice(-5);
      }
    });
    el.querySelector('#ae-m-id').addEventListener('input', function () { this._dirty = true; });

    // Variações de cor
    el.querySelector('#ae-m-f-has-colors').addEventListener('change', () => {
      const on = document.getElementById('ae-m-f-has-colors').checked;
      document.getElementById('ae-m-cv-body').style.display = on ? 'block' : 'none';
      if (on && aeCvMState.length === 0) addAeCvM();
    });
    el.querySelector('#ae-m-cv-add-btn').addEventListener('click', addAeCvM);

    return el;
  }

  function addAeCvM() {
    aeCvMState.push({ name: '', hex: '', images: [], stock: 0, sku: '' });
    renderAeCvM();
  }

  function removeAeCvM(i) {
    const removed = aeCvMState[i];
    aeCvMState.splice(i, 1);
    if (removed && removed.name === aeCvMDefault) aeCvMDefault = aeCvMState[0] ? aeCvMState[0].name : '';
    renderAeCvM();
  }

  function moveAeCvM(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= aeCvMState.length) return;
    const tmp = aeCvMState[i]; aeCvMState[i] = aeCvMState[j]; aeCvMState[j] = tmp;
    renderAeCvM();
  }

  function renderAeCvM() {
    const list = document.getElementById('ae-m-cv-list');
    if (!list) return;
    list.innerHTML = aeCvMState.map((v, i) => {
      const isDefault = v.name && v.name === aeCvMDefault;
      const photos = (v.images || []).map((url, pi) => `
        <div style="position:relative;width:52px;">
          ${pi === 0 ? `<span style="position:absolute;top:-5px;left:-5px;background:#f59e0b;color:#fff;font-size:8px;font-weight:800;padding:1px 4px;border-radius:4px;z-index:1;">★</span>` : ''}
          <button type="button" data-mcv-photo-rm="${i}_${pi}" style="position:absolute;top:-5px;right:-5px;background:#dc2626;color:#fff;border:2px solid #fff;width:16px;height:16px;border-radius:50%;font-size:9px;cursor:pointer;line-height:1;">✕</button>
          <img src="${url}" style="width:52px;height:52px;object-fit:cover;border-radius:6px;border:2px solid ${pi===0?'#f59e0b':'#e2e8f0'};">
        </div>`).join('');
      return `
      <div style="border:1px solid #e2e8f0;border-radius:8px;padding:10px;margin-bottom:8px;background:#f8fafc;">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">
          ${v.hex ? `<span style="width:15px;height:15px;border-radius:50%;background:${v.hex};border:1px solid #e2e8f0;flex-shrink:0;"></span>` : ''}
          <label style="display:flex;align-items:center;gap:4px;font-size:10px;font-weight:700;color:${isDefault?'#b45309':'#94a3b8'};cursor:pointer;">
            <input type="radio" name="ae-m-cv-default-radio" data-mcv-default="${i}" ${isDefault?'checked':''}> ${isDefault?'★ Padrão':'Padrão'}
          </label>
          <span style="flex:1;"></span>
          <button type="button" data-mcv-up="${i}" style="${btn('#f1f5f9','#374151','padding:3px 7px;font-size:10px;')}" ${i===0?'disabled':''}>↑</button>
          <button type="button" data-mcv-dn="${i}" style="${btn('#f1f5f9','#374151','padding:3px 7px;font-size:10px;')}" ${i===aeCvMState.length-1?'disabled':''}>↓</button>
          <button type="button" data-mcv-rm="${i}" style="${btn('#fef2f2','#dc2626','padding:3px 7px;font-size:10px;')}">🗑</button>
        </div>
        <div style="display:grid;grid-template-columns:1fr 60px;gap:6px;margin-bottom:8px;">
          <input data-mcv-field="name" data-mcv-idx="${i}" value="${(v.name||'').replace(/"/g,'&quot;')}" style="${f()}" placeholder="Nome da cor (ex: Rosa)">
          <input type="color" data-mcv-field="hex" data-mcv-idx="${i}" value="${v.hex||'#e8518a'}" style="${f('padding:2px;height:34px;')}">
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px;">${photos}
          <button type="button" data-mcv-addphoto="${i}" style="width:52px;height:52px;border-radius:6px;border:2px dashed #cbd5e1;background:#fff;color:#94a3b8;font-size:16px;cursor:pointer;">+</button>
        </div>
        <div data-mcv-progress="${i}" style="font-size:10px;color:#64748b;min-height:13px;margin-bottom:6px;"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
          <input type="number" min="0" data-mcv-field="stock" data-mcv-idx="${i}" value="${v.stock??0}" style="${f()}" placeholder="Estoque">
          <input data-mcv-field="sku" data-mcv-idx="${i}" value="${(v.sku||'').replace(/"/g,'&quot;')}" style="${f()}" placeholder="SKU (opcional)">
        </div>
      </div>`;
    }).join('');

    list.querySelectorAll('[data-mcv-field]').forEach(el => {
      el.addEventListener('input', () => {
        const i = +el.getAttribute('data-mcv-idx');
        const field = el.getAttribute('data-mcv-field');
        const v = aeCvMState[i]; if (!v) return;
        const wasDefault = v.name && v.name === aeCvMDefault;
        v[field] = field === 'stock' ? (parseInt(el.value, 10) || 0) : el.value;
        if (wasDefault) aeCvMDefault = v.name;
      });
    });
    list.querySelectorAll('[data-mcv-default]').forEach(el => el.addEventListener('change', () => {
      const i = +el.getAttribute('data-mcv-default');
      aeCvMDefault = aeCvMState[i] ? aeCvMState[i].name : '';
      renderAeCvM();
    }));
    list.querySelectorAll('[data-mcv-up]').forEach(el => el.addEventListener('click', () => moveAeCvM(+el.getAttribute('data-mcv-up'), -1)));
    list.querySelectorAll('[data-mcv-dn]').forEach(el => el.addEventListener('click', () => moveAeCvM(+el.getAttribute('data-mcv-dn'), 1)));
    list.querySelectorAll('[data-mcv-rm]').forEach(el => el.addEventListener('click', () => removeAeCvM(+el.getAttribute('data-mcv-rm'))));
    list.querySelectorAll('[data-mcv-addphoto]').forEach(el => el.addEventListener('click', () => {
      aeCvMUploadTarget = +el.getAttribute('data-mcv-addphoto');
      aeCvMFileInput.value = '';
      aeCvMFileInput.click();
    }));
    list.querySelectorAll('[data-mcv-photo-rm]').forEach(el => el.addEventListener('click', () => {
      const [vi, pi] = el.getAttribute('data-mcv-photo-rm').split('_').map(Number);
      if (aeCvMState[vi]) { aeCvMState[vi].images.splice(pi, 1); renderAeCvM(); }
    }));
  }

  const aeCvMFileInput = document.createElement('input');
  aeCvMFileInput.type = 'file'; aeCvMFileInput.accept = 'image/*'; aeCvMFileInput.multiple = true; aeCvMFileInput.style.display = 'none';
  document.body.appendChild(aeCvMFileInput);
  aeCvMFileInput.addEventListener('change', e => {
    const files = Array.prototype.filter.call(e.target.files, f => f.type.indexOf('image/') === 0);
    if (!files.length || aeCvMUploadTarget < 0) return;
    uploadAeCvMPhotos(files, aeCvMUploadTarget, 0, files.length);
  });

  async function uploadAeCvMPhotos(files, targetIndex, index, total) {
    const progEl = document.querySelector(`[data-mcv-progress="${targetIndex}"]`);
    if (index >= total) {
      if (progEl) { progEl.textContent = 'Fotos adicionadas!'; setTimeout(() => { if (progEl) progEl.textContent = ''; }, 2000); }
      return;
    }
    const file = files[index];
    if (progEl) progEl.textContent = `Enviando... ${index} de ${total}`;
    if (file.size > 18 * 1024 * 1024) { uploadAeCvMPhotos(files, targetIndex, index + 1, total); return; }
    const dataUrl = await compressImageFile(file);
    const r = await api('POST', '/api/admin/upload', { dataUrl, filename: file.name });
    if (r.success && aeCvMState[targetIndex]) {
      aeCvMState[targetIndex].images.push(r.url);
      renderAeCvM();
    }
    uploadAeCvMPhotos(files, targetIndex, index + 1, total);
  }

  async function createProduct(el) {
    const g = id => el.querySelector(`#${id}`)?.value?.trim();
    const catalog = g('ae-m-catalog');
    const id = g('ae-m-id');
    const name = g('ae-m-name');
    const price = parseFloat(g('ae-m-price')) || 0;
    if (!name) return showToast('Nome é obrigatório.', true);
    if (!id)   return showToast('ID é obrigatório.', true);

    if (el.querySelector('#ae-m-f-has-colors').checked && !aeCvMState.some(v => v.name.trim())) {
      return showToast('Adicione pelo menos uma cor, ou desmarque "Este produto tem variações de cor?".', true);
    }

    const saveBtn = el.querySelector('#ae-m-save');
    saveBtn.textContent = '⏳ Criando...'; saveBtn.disabled = true;

    const payload = {
      id, name, price, priceOriginal: price,
      model: g('ae-m-model'), color: g('ae-m-color'),
      storage: g('ae-m-storage'), stock: parseInt(g('ae-m-stock')) || 1,
      condition: g('ae-m-condition'), description: g('ae-m-desc'),
      images: newProductUploadedUrl ? [newProductUploadedUrl] : (g('ae-m-img') ? [g('ae-m-img')] : []),
      isNew: g('ae-m-condition') === 'Novo', rating: 5.0, reviews: 0
    };
    if (el.querySelector('#ae-m-f-has-colors').checked) {
      const named = aeCvMState.filter(v => v.name.trim());
      payload.colorVariants = named;
      payload.defaultColor = named.some(v => v.name === aeCvMDefault) ? aeCvMDefault : named[0].name;
    }

    const r = await api('POST', `/api/admin/catalog/${catalog}`, payload);

    saveBtn.textContent = '💾 Criar Produto'; saveBtn.disabled = false;

    if (r.success) {
      showToast(`✓ "${r.product.name}" criado em ${CATALOGS[catalog]}!`);
      newProductUploadedUrl = null;
      el.style.display = 'none';
    } else {
      showToast(r.error || 'Erro ao criar produto.', true);
    }
  }

  // Auto-attach if edit mode is already active on load
  if (document.body.classList.contains('admin-edit-mode')) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', window.adminEditAttach);
    else window.adminEditAttach();
  }

})();
