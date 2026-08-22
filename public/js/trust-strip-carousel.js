// Carrossel automático da faixa de benefícios (.trust-strip) — desliza os itens da
// direita pra esquerda em loop infinito, sem alterar layout/visual. O usuário pode
// arrastar manualmente (toque/swipe no celular, wheel/trackpad no desktop); isso
// pausa o autoplay temporariamente e retoma sozinho depois de alguns segundos.
(function () {
  var AUTO_INTERVAL_MS = 3000;
  var STEP_DURATION_MS = 650;
  var RESUME_DELAY_MS = 2500;

  var track = document.querySelector('.trust-strip-inner');
  if (!track) return;

  var originalItems = Array.prototype.slice.call(track.children);
  if (originalItems.length < 2) return;

  // Duplica os itens uma vez: dá conteúdo suficiente pra "rolar" sem nunca acabar,
  // criando a ilusão de loop contínuo — ao alcançar o fim do 1º conjunto, a posição
  // volta pro início instantaneamente; como os dois conjuntos são idênticos, não dá
  // pra perceber o "salto".
  originalItems.forEach(function (el) { track.appendChild(el.cloneNode(true)); });

  var itemWidths = [];
  var setWidth = 0;
  var currentIndex = 0;
  var autoTimer = null;
  var resumeTimer = null;
  var userInteracting = false;
  var rafId = null;

  function measure() {
    itemWidths = [];
    setWidth = 0;
    for (var i = 0; i < originalItems.length; i++) {
      var w = track.children[i].getBoundingClientRect().width;
      itemWidths.push(w);
      setWidth += w;
    }
  }

  function animateScrollBy(delta, duration) {
    if (rafId) cancelAnimationFrame(rafId);
    var start = track.scrollLeft;
    var startTime = null;

    function frame(ts) {
      if (!startTime) startTime = ts;
      var t = Math.min(1, (ts - startTime) / duration);
      // ease-in-out cúbica — aceleração e freada suaves, sem parecer um "corte"
      var eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      track.scrollLeft = start + delta * eased;
      if (t < 1) {
        rafId = requestAnimationFrame(frame);
      } else {
        rafId = null;
        if (setWidth && track.scrollLeft >= setWidth) track.scrollLeft -= setWidth;
      }
    }
    rafId = requestAnimationFrame(frame);
  }

  function step() {
    if (userInteracting || !itemWidths.length) return;
    var delta = itemWidths[currentIndex % itemWidths.length];
    currentIndex++;
    animateScrollBy(delta, STEP_DURATION_MS);
  }

  function startAuto() {
    stopAuto();
    autoTimer = setInterval(step, AUTO_INTERVAL_MS);
  }
  function stopAuto() {
    if (autoTimer) clearInterval(autoTimer);
  }

  // Depois de um arraste manual, recalcula de qual item "lógico" partir, pra o
  // próximo passo automático continuar alinhado certinho na borda de um item.
  function resyncIndex() {
    if (!setWidth) return;
    var pos = ((track.scrollLeft % setWidth) + setWidth) % setWidth;
    var acc = 0;
    for (var i = 0; i < itemWidths.length; i++) {
      acc += itemWidths[i];
      if (acc > pos + 1) { currentIndex = i + 1; return; }
    }
    currentIndex = 0;
  }

  function onInteractStart() {
    userInteracting = true;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    clearTimeout(resumeTimer);
  }
  function onInteractEnd() {
    clearTimeout(resumeTimer);
    resumeTimer = setTimeout(function () {
      if (setWidth && track.scrollLeft >= setWidth) track.scrollLeft -= setWidth;
      resyncIndex();
      userInteracting = false;
    }, RESUME_DELAY_MS);
  }

  track.addEventListener('touchstart', onInteractStart, { passive: true });
  track.addEventListener('touchend', onInteractEnd, { passive: true });
  track.addEventListener('wheel', function () { onInteractStart(); onInteractEnd(); }, { passive: true });

  window.addEventListener('resize', measure);

  measure();
  startAuto();
})();
