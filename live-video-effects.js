/* Outgoing portrait frames; no face analysis or camera-source ownership. */
window.LiveVideoEffects = (() => {
  const presets = { natural: 'none', clear: 'brightness(1.09) contrast(1.04) saturate(1.06)', warm: 'brightness(1.04) saturate(1.09) sepia(.12)' };
  const qualities = { economy: { width: 360, height: 640, frameRate: 20 }, standard: { width: 720, height: 1280, frameRate: 24 }, high: { width: 1080, height: 1920, frameRate: 30 } };
  function options(preset, beauty, quality = 'standard') {
    if (!Object.hasOwn(presets, preset) || !Object.hasOwn(qualities, quality)) throw new Error('Ajuste de imagen no disponible.');
    const amount = Number(beauty);
    if (!Number.isFinite(amount) || amount < 0 || amount > 60) throw new Error('Suavizado fuera de rango.');
    return { preset, beauty: amount, quality };
  }
  function portraitSize(width, height, quality, compatible = false) {
    const limit = compatible ? Math.min(480, qualities[quality].width) : qualities[quality].width;
    const w = Math.max(2, Math.floor(Math.min(width, height, limit) / 2) * 2);
    return { width: w, height: Math.round(w * 16 / 9 / 2) * 2 };
  }
  function containRect(sw, sh, dw, dh) {
    const scale = Math.min(dw / sw, dh / sh), width = sw * scale, height = sh * scale;
    return { x: (dw - width) / 2, y: (dh - height) / 2, width, height };
  }
  function colorPixels(data, preset) {
    if (preset === 'natural') return;
    for (let i = 0; i < data.length; i += 4) {
      let r = data[i], g = data[i + 1], b = data[i + 2];
      const luma = r * .2126 + g * .7152 + b * .0722;
      if (preset === 'clear') {
        r = ((luma + (r - luma) * 1.06 - 127.5) * 1.04 + 127.5) * 1.09;
        g = ((luma + (g - luma) * 1.06 - 127.5) * 1.04 + 127.5) * 1.09;
        b = ((luma + (b - luma) * 1.06 - 127.5) * 1.04 + 127.5) * 1.09;
      } else {
        const sr = r * .393 + g * .769 + b * .189, sg = r * .349 + g * .686 + b * .168, sb = r * .272 + g * .534 + b * .131;
        r = (.88 * (luma + (r - luma) * 1.09) + .12 * sr) * 1.04;
        g = (.88 * (luma + (g - luma) * 1.09) + .12 * sg) * 1.04;
        b = (.88 * (luma + (b - luma) * 1.09) + .12 * sb) * 1.04;
      }
      data[i] = r; data[i + 1] = g; data[i + 2] = b;
    }
  }
  function createProcessor(preset = 'natural', beauty = 0, quality = 'standard', { forceCompatibility = false } = {}) {
    let selected = options(preset, beauty, quality), video = null, canvas = null, small = null;
    let frame = null, processedTrack = null, stopped = true, serial = 0, nativeFilter = false;
    const processor = {
      name: 'koomodoo-color-and-softness',
      get processedTrack() { return processedTrack; },
      get compatibilityMode() { return !nativeFilter && selected.preset !== 'natural'; },
      setOptions(preset, beauty, quality = selected.quality) { selected = options(preset, beauty, quality); },
      async init({ track }) {
        await processor.destroy();
        const version = ++serial; stopped = false;
        video = document.createElement('video'); video.muted = true; video.defaultMuted = true; video.volume = 0; video.playsInline = true;
        video.style.cssText = 'position:fixed;left:-10000px;width:2px;height:2px;pointer-events:none';
        video.srcObject = new MediaStream([track]); document.body.append(video);
        canvas = document.createElement('canvas'); small = document.createElement('canvas');
        const context = canvas.getContext('2d', { alpha: false }), soft = small.getContext('2d', { alpha: false });
        if (!canvas.captureStream || !context || !soft) {
          await processor.destroy(); throw new Error('Este dispositivo no permite procesar la pista de video. PULSO puede continuar con la camara original.');
        }
        nativeFilter = !forceCompatibility && typeof context.filter === 'string';
        try {
          await video.play();
          if (version !== serial || stopped) throw new Error('Se cancelo el ajuste.');
          if (!video.videoWidth) await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('No se recibieron imagenes de la camara.')), 5000);
            video.addEventListener('loadeddata', () => { clearTimeout(timer); resolve(); }, { once: true });
          });
          if (version !== serial || stopped) throw new Error('Se cancelo el ajuste.');
          let lastDraw = -Infinity;
          function draw(time = performance.now()) {
            if (stopped || version !== serial) return;
            const compatible = !nativeFilter && selected.preset !== 'natural';
            if (video.readyState >= 2 && video.videoWidth && time - lastDraw >= 1000 / (compatible ? 15 : 24)) {
              lastDraw = time;
              const size = portraitSize(video.videoWidth, video.videoHeight, selected.quality, compatible);
              if (canvas.width !== size.width || canvas.height !== size.height) { canvas.width = size.width; canvas.height = size.height; }
              const rect = containRect(video.videoWidth, video.videoHeight, canvas.width, canvas.height);
              context.globalAlpha = 1; if (nativeFilter) context.filter = 'none';
              context.fillStyle = '#030807'; context.fillRect(0, 0, canvas.width, canvas.height);
              if (nativeFilter) context.filter = presets[selected.preset];
              context.drawImage(video, rect.x, rect.y, rect.width, rect.height);
              if (selected.beauty > 0) {
                const sw = Math.max(2, Math.round(rect.width * .3)), sh = Math.max(2, Math.round(rect.height * .3));
                if (small.width !== sw || small.height !== sh) { small.width = sw; small.height = sh; }
                soft.drawImage(video, 0, 0, small.width, small.height);
                context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
                context.globalAlpha = selected.beauty / 100 * .55;
                context.drawImage(small, rect.x, rect.y, rect.width, rect.height); context.globalAlpha = 1;
              }
              if (compatible) {
                const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
                colorPixels(pixels.data, selected.preset); context.putImageData(pixels, 0, 0);
              }
            }
            frame = requestAnimationFrame(draw);
          }
          draw(); processedTrack = canvas.captureStream(24).getVideoTracks()[0];
          if (!processedTrack) throw new Error('No se pudo generar la pista de PULSO.');
        } catch (error) { await processor.destroy(); throw error; }
      },
      async restart(opts) { await processor.init(opts); },
      async destroy() {
        stopped = true; serial++;
        if (frame !== null) cancelAnimationFrame(frame); frame = null;
        processedTrack?.stop(); processedTrack = null;
        if (video) { video.pause(); video.srcObject = null; video.remove(); }
        video = null; canvas = null; small = null;
      },
    };
    return processor;
  }
  return { createProcessor, options, qualities, portraitSize, containRect, colorPixels };
})();
