// Carrossel de banners da home — busca /api/banners e renderiza com autoplay,
// setas e dots. Se não houver banners cadastrados (ou a API falhar), cai para
// a imagem estática padrão, então o topo do site nunca fica vazio.
(function () {
  var AUTOPLAY_MS = 5000;
  var FALLBACK_BANNER = {
    id: 'fallback',
    image: '/assets/categories/hero-banner.jpg',
    link: '',
  };

  var root = document.getElementById('banner-carousel');
  if (!root) return;

  var banners = [];
  var current = 0;
  var timer = null;

  function escAttr(s) {
    return String(s || '').replace(/"/g, '&quot;');
  }

  function render() {
    var slidesHtml = banners.map(function (b, i) {
      var img = '<img src="' + escAttr(b.image) + '" alt="Promoção" loading="' + (i === 0 ? 'eager' : 'lazy') + '">';
      var inner = b.link
        ? '<a href="' + escAttr(b.link) + '" aria-label="Ver promoção">' + img + '</a>'
        : img;
      return '<div class="banner-carousel__slide' + (i === current ? ' active' : '') + '" data-index="' + i + '">' + inner + '</div>';
    }).join('');

    var showControls = banners.length > 1;
    var arrowsHtml = showControls
      ? '<button type="button" class="banner-carousel__arrow prev" aria-label="Banner anterior">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg></button>' +
        '<button type="button" class="banner-carousel__arrow next" aria-label="Próximo banner">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></button>'
      : '';
    var dotsHtml = showControls
      ? '<div class="banner-carousel__dots">' + banners.map(function (b, i) {
          return '<button type="button" class="banner-carousel__dot' + (i === current ? ' active' : '') + '" data-index="' + i + '" aria-label="Ir para banner ' + (i + 1) + '"></button>';
        }).join('') + '</div>'
      : '';

    root.innerHTML = slidesHtml + arrowsHtml + dotsHtml;

    var prevBtn = root.querySelector('.banner-carousel__arrow.prev');
    var nextBtn = root.querySelector('.banner-carousel__arrow.next');
    if (prevBtn) prevBtn.addEventListener('click', function () { goTo(current - 1); resetTimer(); });
    if (nextBtn) nextBtn.addEventListener('click', function () { goTo(current + 1); resetTimer(); });
    root.querySelectorAll('.banner-carousel__dot').forEach(function (dot) {
      dot.addEventListener('click', function () {
        goTo(Number(dot.dataset.index));
        resetTimer();
      });
    });
  }

  function goTo(index) {
    var total = banners.length;
    current = ((index % total) + total) % total;
    root.querySelectorAll('.banner-carousel__slide').forEach(function (el) {
      el.classList.toggle('active', Number(el.dataset.index) === current);
    });
    root.querySelectorAll('.banner-carousel__dot').forEach(function (el) {
      el.classList.toggle('active', Number(el.dataset.index) === current);
    });
  }

  function startTimer() {
    if (banners.length <= 1) return;
    timer = setInterval(function () { goTo(current + 1); }, AUTOPLAY_MS);
  }

  function resetTimer() {
    clearInterval(timer);
    startTimer();
  }

  root.addEventListener('mouseenter', function () { clearInterval(timer); });
  root.addEventListener('mouseleave', function () { startTimer(); });

  fetch('/api/banners')
    .then(function (r) { return r.ok ? r.json() : { banners: [] }; })
    .then(function (data) {
      banners = Array.isArray(data.banners) && data.banners.length ? data.banners : [FALLBACK_BANNER];
    })
    .catch(function () {
      banners = [FALLBACK_BANNER];
    })
    .then(function () {
      render();
      startTimer();
    });
})();
