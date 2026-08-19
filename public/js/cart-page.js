document.addEventListener('DOMContentLoaded', () => {
  const cartItemsEl = document.getElementById('cart-items');
  const emptyCartEl = document.getElementById('empty-cart');
  const subtotalEl = document.getElementById('summary-subtotal');
  const totalCountEl = document.getElementById('summary-count');
  const totalEl = document.getElementById('summary-total');
  const clearCartBtn = document.getElementById('clear-cart');
  const checkoutBtn = document.getElementById('checkout-cart');

  const render = () => {
    const items = cart.items || [];
    const hasItems = items.length > 0;

    cartItemsEl.innerHTML = '';
    emptyCartEl.style.display = hasItems ? 'none' : 'block';
    checkoutBtn.disabled = !hasItems;

    if (!hasItems) {
      subtotalEl.textContent = 'R$ 0,00';
      totalCountEl.textContent = '0';
      totalEl.textContent = 'R$ 0,00';
      return;
    }

    // [LOJA OFICIAL] Subtotal já usa preço com desconto (preco = precoFinal no item normalizado)
    const subtotal = items.reduce((sum, item) => sum + item.preco * item.quantidade, 0);
    const totalCount = items.reduce((sum, item) => sum + item.quantidade, 0);

    items.forEach((item, index) => {
      // [LOJA OFICIAL] Monta exibição de preço com desconto riscado
      const precoUnitDisplay = item.precoOriginal
        ? `<s style="color:#94A3B8;font-size:12px">${formatBRL(item.precoOriginal)}</s> <span style="color:#16A34A;font-weight:700">${formatBRL(item.preco)}</span>`
        : formatBRL(item.preco);
      const subtotalItem = item.preco * item.quantidade;
      const subtotalOrigItem = (item.precoOriginal || item.preco) * item.quantidade;
      const subtotalDisplay = item.precoOriginal
        ? `<s style="color:#94A3B8;font-size:11px;display:block">${formatBRL(subtotalOrigItem)}</s><strong style="color:#16A34A">${formatBRL(subtotalItem)}</strong>`
        : formatBRL(subtotalItem);

      const itemNode = document.createElement('div');
      itemNode.className = 'cart-item';
      itemNode.innerHTML = `
        <img src="${item.imagem}" alt="${item.nome}" />
        <div class="item-details">
          <h2>${item.nome}</h2>
          ${item.tamanho ? `<p style="color:#6B7280;font-size:12px;">Tamanho: <strong>${item.tamanho}</strong></p>` : ''}
          ${Number(item.descontoHoje || 0) > 0 ? `<p style="background:#FFF3CD;color:#92400E;padding:2px 7px;border-radius:3px;font-size:11px;font-weight:700;display:inline-flex;align-items:center;gap:3px;margin-bottom:4px"><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> ${item.descontoHoje}% OFF hoje</p>` : ''}
          <p>Preço un: ${precoUnitDisplay}</p>
          <div class="quantity-controls">
            <button type="button" data-action="decrease" data-idx="${index}">−</button>
            <span>${item.quantidade}</span>
            <button type="button" data-action="increase" data-idx="${index}">+</button>
          </div>
        </div>
        <div class="item-actions">
          <div class="item-subtotal">${subtotalDisplay}</div>
          <button type="button" data-action="remove" data-idx="${index}">Remover</button>
        </div>
      `;

      itemNode.addEventListener('click', (event) => {
        const button = event.target.closest('button');
        if (!button) return;
        const action = button.dataset.action;
        const current = cart.items[Number(button.dataset.idx)];
        if (!current) return;

        if (action === 'decrease') {
          cart.updateQuantity(current.id, current.quantidade - 1, current.tamanho);
        }
        if (action === 'increase') {
          cart.updateQuantity(current.id, current.quantidade + 1, current.tamanho);
        }
        if (action === 'remove') {
          cart.removeItem(current.id, current.tamanho);
        }
        render();
      });

      cartItemsEl.appendChild(itemNode);
    });

    subtotalEl.textContent = formatBRL(subtotal);
    totalCountEl.textContent = totalCount;
    totalEl.textContent = formatBRL(subtotal);
  };

  clearCartBtn.addEventListener('click', () => {
    cart.clear();
    render();
  });

  checkoutBtn.addEventListener('click', () => {
    if (!cart.items.length) {
      if (typeof showCartToast === 'function') showCartToast('Carrinho vazio! Adicione produtos antes de finalizar.', 'warning');
      return;
    }
    if (window.Auth && !window.Auth.isLoggedIn()) {
      window.location.href = 'login.html?redirect=' + encodeURIComponent('checkout.html?source=cart');
      return;
    }
    cart.saveCart();
    window.location.href = '/checkout.html?source=cart';
  });

  render();
});

function formatBRL(value) {
  return value == null
    ? 'R$ 0,00'
    : value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
