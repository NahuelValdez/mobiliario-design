/*
  ambient-margins.js — Campo vectorial ambiental en los márgenes (solo desktop).

  Dibuja una trama de trazos cortos en las franjas de papel que flanquean la
  columna centrada de 1240px. Los trazos se orientan hacia el cursor con una
  leve inercia, dando la sensación de un sitio "vivo" sin sobrecargarlo.

  Reglas del runtime propietario (React que re-renderiza el DOM):
    - No cachear referencias al DOM: se re-consulta / re-crea el canvas en cada frame.
    - Reintentos escalonados para sobrevivir al montaje tardío.
    - setTimeout (no requestAnimationFrame) para no congelarse en pestañas sin foco.
    - No toca support.js.
*/
(function () {
  'use strict';

  // Solo desktop con mouse real. En táctil no se activa nada.
  var DESKTOP = window.matchMedia('(hover: hover) and (pointer: fine)');
  if (!DESKTOP.matches) return;

  var REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var CFG = {
    id: 'nv-ambient-margins',
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
    scrollFactor: 0.65, // 1 = scrollea 1:1 con la página; <1 = parallax más lento
    interval: 33        // ~30fps
  };

  var INK = '32,48,58';
  var ACCENT = '47,109,122';

  var mouse = { x: null, y: null, moved: false };
  var cur = { x: null, y: null };
  var running = false;

  window.addEventListener('mousemove', function (e) {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    mouse.moved = true;
  }, { passive: true });

  function ensureCanvas() {
    var c = document.getElementById(CFG.id);
    if (!c) {
      c = document.createElement('canvas');
      c.id = CFG.id;
      c.setAttribute('aria-hidden', 'true');
      c.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;' +
        'pointer-events:none;z-index:-1;';
      (document.body || document.documentElement).appendChild(c);
      c._w = c._h = c._dpr = 0;
    } else if (c.parentNode !== document.body && document.body) {
      document.body.appendChild(c);
    }
    return c;
  }

  function sizeCanvas(c) {
    var dpr = window.devicePixelRatio || 1;
    // clientWidth excluye la barra de scroll: mantiene ambos márgenes simétricos.
    var w = document.documentElement.clientWidth;
    var h = window.innerHeight;
    if (c._w !== w || c._h !== h || c._dpr !== dpr) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      c.style.width = w + 'px';
      c.style.height = h + 'px';
      var ctx = c.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      c._w = w; c._h = h; c._dpr = dpr;
    }
  }

  // Dibuja una franja. Las columnas parten del borde exterior y avanzan hacia
  // el centro con separación fija (CFG.spacing) hasta `reach`. El degradé
  // atenúa las columnas internas y deja nítidas las del borde.
  function drawBand(ctx, side, w, h, reach, active, off) {
    // Filas visibles ancladas al documento: solo se dibuja el rango en pantalla.
    var kStart = Math.ceil((off - CFG.rowGap / 2) / CFG.rowGap);
    var kEnd = Math.floor((off + h - CFG.rowGap / 2) / CFG.rowGap);

    for (var edgeDist = CFG.spacing / 2; edgeDist < reach; edgeDist += CFG.spacing) {
      var x = side === 'left' ? edgeDist : (w - edgeDist);
      var innerFactor = edgeDist / reach; // 0 en el borde, 1 hacia el centro
      var baseA = CFG.gradient
        ? CFG.edgeAlpha + (CFG.centerAlpha - CFG.edgeAlpha) * innerFactor
        : CFG.edgeAlpha;

      for (var k = kStart; k <= kEnd; k++) {
        var y = (k * CFG.rowGap + CFG.rowGap / 2) - off; // posición en pantalla
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
        var col = near > 0.1 ? ACCENT : INK;
        ctx.strokeStyle = 'rgba(' + col + ',' + alpha.toFixed(3) + ')';
        ctx.beginPath();
        ctx.moveTo(x - cx, y - cy);
        ctx.lineTo(x + cx, y + cy);
        ctx.stroke();
      }
    }
  }

  function draw() {
    var c = ensureCanvas();
    sizeCanvas(c);
    var ctx = c.getContext('2d');
    var w = c._w;
    var h = c._h;
    ctx.clearRect(0, 0, w, h);

    // Espacio muerto a cada lado de la columna centrada; el alcance se recorta
    // a ese espacio para no invadir nunca el contenido.
    var dead = Math.max(0, (w - CFG.column) / 2);
    var reach = Math.min(CFG.reach, dead);
    if (reach < CFG.minReach) return; // pantalla angosta: no hay lugar.

    // Objetivo del seguimiento: el mouse si ya se movió, si no el centro.
    var tx = mouse.moved ? mouse.x : w / 2;
    var ty = mouse.moved ? mouse.y : h / 2;
    if (cur.x === null) { cur.x = tx; cur.y = ty; }

    var active = mouse.moved && !REDUCED;
    if (active) {
      cur.x += (tx - cur.x) * CFG.ease;
      cur.y += (ty - cur.y) * CFG.ease;
    } else {
      cur.x = tx; cur.y = ty;
    }

    // Desplazamiento del patrón según el scroll (anclado al documento).
    var scrollY = window.pageYOffset || document.documentElement.scrollTop || 0;
    var off = scrollY * CFG.scrollFactor;

    ctx.lineWidth = 1;
    ctx.lineCap = 'round';
    drawBand(ctx, 'left', w, h, reach, active, off);
    drawBand(ctx, 'right', w, h, reach, active, off);
  }

  function loop() {
    if (!running) return;
    draw();
    setTimeout(loop, CFG.interval);
  }

  function start() {
    if (running) return;
    running = true;
    if (REDUCED) { draw(); return; } // estático, sin loop.
    loop();
  }

  // Reintentos escalonados: sobrevive al montaje tardío del runtime.
  [0, 100, 300, 700, 1500, 3000].forEach(function (ms) {
    setTimeout(function () { ensureCanvas(); start(); }, ms);
  });

  // Reafirma el canvas cada tanto por si un re-render lo quita.
  setInterval(ensureCanvas, 2000);

  window.addEventListener('resize', function () {
    var c = document.getElementById(CFG.id);
    if (c) c._w = 0; // fuerza re-dimensionado en el próximo frame.
  });
})();
