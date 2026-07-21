/*
  ambient-margins.js — Campo vectorial ambiental, acotado a secciones puntuales
  (solo desktop).

  Antes vivía en un canvas global fijo detrás de todo el sitio (z-index:-1).
  Eso lo hacía invisible en cualquier sección con fondo propio a todo el
  ancho (ej. "Capacidades técnicas" #E0DACB, "Contacto" #1C2C33), porque esas
  secciones pintan su fondo por encima del canvas en el orden de stacking.

  Ahora se inyecta un <canvas> como PRIMER hijo de cada sección habilitada.
  Al ser el primer hijo (no posicionado vs. hermanos con position:relative),
  queda pintado entre el fondo de la sección y su contenido, sin usar
  z-index. Cada sección define su propia paleta (clara u oscura) según su
  fondo real.

  Reglas del runtime propietario (React que re-renderiza el DOM):
    - No cachear referencias al DOM: se re-consulta la sección y el canvas
      cada frame (ensureCanvas se corre en el loop, no una sola vez).
    - Reintentos escalonados para sobrevivir al montaje tardío.
    - setTimeout (no requestAnimationFrame) para no congelarse en pestañas
      sin foco.
    - No toca support.js.
*/
(function () {
  'use strict';

  // Solo desktop con mouse real. En táctil no se activa nada.
  var DESKTOP = window.matchMedia('(hover: hover) and (pointer: fine)');
  if (!DESKTOP.matches) return;

  var REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var CFG = {
    spacing: 32,        // separación horizontal entre columnas (fija)
    rowGap: 32,         // separación vertical entre trazos
    reach: 280,         // hasta dónde se estiran las columnas hacia el centro
    ease: 0.16,         // inercia del seguimiento (0..1)
    radius: 110,        // radio (px) donde el trazo se acentúa hacia el cursor
    gradient: true,     // atenuar hacia el centro / nítido en el borde
    edgeAlpha: 0.32,    // opacidad de la columna más externa
    centerAlpha: 0.04,  // opacidad de la columna más interna
    minReach: 40,       // margen muerto mínimo por lado para mostrar la trama
    column: 1240,       // ancho de la columna centrada del sitio
    segLen: 4.3,        // media-longitud del trazo
    interval: 33        // ~30fps
  };

  // Secciones habilitadas, cada una con su propia paleta (ink/accent en "r,g,b").
  var SECTIONS = [
    { id: 'capacidades', ink: '32,48,58', accent: '47,109,122' },   // fondo claro #E0DACB
    { id: 'contacto', ink: '236,231,221', accent: '127,176,184' }   // fondo oscuro #1C2C33
  ];

  var mouse = { x: null, y: null, moved: false };
  var running = false;

  window.addEventListener('mousemove', function (e) {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    mouse.moved = true;
  }, { passive: true });

  function makeInstance(spec) {
    return { spec: spec, cur: { x: null, y: null }, canvasId: 'nv-ambient-' + spec.id };
  }

  function ensureCanvas(inst) {
    var section = document.getElementById(inst.spec.id);
    if (!section) return null;
    var c = document.getElementById(inst.canvasId);
    if (!c) {
      c = document.createElement('canvas');
      c.id = inst.canvasId;
      c.setAttribute('aria-hidden', 'true');
      c.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;' +
        'width:100%;height:100%;pointer-events:none;display:block;';
      section.insertBefore(c, section.firstChild);
      c._w = c._h = c._dpr = 0;
    } else if (c.parentNode !== section) {
      // El runtime recreó la sección: reinsertar como primer hijo.
      section.insertBefore(c, section.firstChild);
    } else if (section.firstChild !== c) {
      // Algo se insertó antes: garantizar que el canvas siga siendo el primero.
      section.insertBefore(c, section.firstChild);
    }
    return c;
  }

  function sizeCanvas(c) {
    var rect = c.parentNode.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    var w = Math.round(rect.width);
    var h = Math.round(rect.height);
    if (c._w !== w || c._h !== h || c._dpr !== dpr) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      var ctx = c.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      c._w = w; c._h = h; c._dpr = dpr;
    }
  }

  function drawBand(ctx, side, w, h, reach, active, cur, ink, accent) {
    for (var edgeDist = CFG.spacing / 2; edgeDist < reach; edgeDist += CFG.spacing) {
      var x = side === 'left' ? edgeDist : (w - edgeDist);
      var innerFactor = edgeDist / reach; // 0 en el borde, 1 hacia el centro
      var baseA = CFG.gradient
        ? CFG.edgeAlpha + (CFG.centerAlpha - CFG.edgeAlpha) * innerFactor
        : CFG.edgeAlpha;

      for (var y = CFG.rowGap / 2; y < h; y += CFG.rowGap) {
        var dx = x - cur.x;
        var dy = y - cur.y;
        var angle = Math.atan2(dy, dx);
        var near = 0;
        if (active) {
          var dist = Math.sqrt(dx * dx + dy * dy);
          near = Math.max(0, 1 - dist / CFG.radius);
        }
        var cx = Math.cos(angle) * CFG.segLen;
        var cy = Math.sin(angle) * CFG.segLen;
        var alpha = Math.min(0.95, baseA + near * 0.7);
        var col = near > 0.1 ? accent : ink;
        ctx.strokeStyle = 'rgba(' + col + ',' + alpha.toFixed(3) + ')';
        ctx.beginPath();
        ctx.moveTo(x - cx, y - cy);
        ctx.lineTo(x + cx, y + cy);
        ctx.stroke();
      }
    }
  }

  function drawInstance(inst) {
    var c = ensureCanvas(inst);
    if (!c) return;
    sizeCanvas(c);
    var ctx = c.getContext('2d');
    var w = c._w, h = c._h;
    ctx.clearRect(0, 0, w, h);

    var dead = Math.max(0, (w - CFG.column) / 2);
    var reach = Math.min(CFG.reach, dead);
    if (reach < CFG.minReach) return;

    var rect = c.getBoundingClientRect();
    var localX = mouse.moved ? mouse.x - rect.left : w / 2;
    var localY = mouse.moved ? mouse.y - rect.top : h / 2;

    var cur = inst.cur;
    if (cur.x === null) { cur.x = localX; cur.y = localY; }

    // Activo solo si el cursor realmente está sobre esta franja (con margen).
    var withinX = localX > -CFG.radius && localX < w + CFG.radius;
    var withinY = localY > -CFG.radius && localY < h + CFG.radius;
    var active = mouse.moved && withinX && withinY && !REDUCED;

    if (active) {
      cur.x += (localX - cur.x) * CFG.ease;
      cur.y += (localY - cur.y) * CFG.ease;
    } else {
      cur.x = localX; cur.y = localY;
    }

    ctx.lineWidth = 1;
    ctx.lineCap = 'round';
    drawBand(ctx, 'left', w, h, reach, active, cur, inst.spec.ink, inst.spec.accent);
    drawBand(ctx, 'right', w, h, reach, active, cur, inst.spec.ink, inst.spec.accent);
  }

  var instances = SECTIONS.map(makeInstance);

  function loop() {
    if (!running) return;
    instances.forEach(drawInstance);
    setTimeout(loop, CFG.interval);
  }

  function start() {
    if (running) return;
    running = true;
    if (REDUCED) { instances.forEach(drawInstance); return; } // estático, sin loop.
    loop();
  }

  // Reintentos escalonados: sobrevive al montaje tardío del runtime.
  [0, 100, 300, 700, 1500, 3000].forEach(function (ms) {
    setTimeout(function () { instances.forEach(ensureCanvas); start(); }, ms);
  });

  // Reafirma los canvases cada tanto por si un re-render los quita/reordena.
  setInterval(function () { instances.forEach(ensureCanvas); }, 2000);
})();
