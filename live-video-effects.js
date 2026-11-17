/* LiveKit track processor: transforms outgoing frames, never analyses faces. */
window.LiveVideoEffects = (() => {
  const presets = {
    natural: 'none',
    clear: 'brightness(1.09) contrast(1.04) saturate(1.06)',
    warm: 'brightness(1.04) saturate(1.09) sepia(.12)',
  };
  const qualities = {
    economy: { width: 360, height: 640, frameRate: 20 },
    standard: { width: 720, height: 1280, frameRate: 24 },
    high: { width: 1080, height: 1920, frameRate: 30 },
  };
  function options(preset, beauty) {
    if (!Object.hasOwn(presets, preset)) throw new Error('Filtro no disponible.');
    const amount = Number(beauty);
    if (!Number.isFinite(amount) || amount < 0 || amount > 60) throw new Error('Suavizado fuera de rango.');
    return { preset, beauty: amount };
  }
  function createProcessor(preset = 'natural', beauty = 0) {
    let selected = options(preset, beauty), source = null, video = null, canvas = null;
    let frame = null, processedTrack = null, stopped = true, serial = 0;
    const processor = {
      name: 'koomodoo-color-and-softness',
      get processedTrack() { return processedTrack; },
      setOptions(preset, beauty) { selected = options(preset, beauty); },
      async init({ track }) {
        await processor.destroy();
        const version = ++serial;
        source = track; stopped = false;
        video = document.createElement('video'); video.muted = true; video.playsInline = true;
        video.style.cssText = 'position:fixed;left:-10000px;width:2px;height:2px;pointer-events:none';
        video.srcObject = new MediaStream([source]); document.body.append(video);
        canvas = document.createElement('canvas');
        const context = canvas.getContext('2d', { alpha: false });
        if (!canvas.captureStream || !context || !('filter' in context)) {
          await processor.destroy(); throw new Error('Este navegador no admite filtros de emision. Usa Natural o proba otro navegador.');
        }
        try {
          await video.play();
          if (version !== serial || stopped) throw new Error('Se cancelo el filtro.');
          if (!video.videoWidth) {
            await new Promise((resolve, reject) => {
              const timer = setTimeout(() => reject(new Error('No se recibieron imagenes de la camara.')), 5000);
              video.addEventListener('loadeddata', () => { clearTimeout(timer); resolve(); }, { once: true });
            });
          }
          if (version !== serial || stopped) throw new Error('Se cancelo el filtro.');
          let lastDraw = -Infinity;
          function draw(time = performance.now()) {
            if (stopped || version !== serial) return;
            if (video.readyState >= 2 && video.videoWidth && time - lastDraw >= 1000 / 24) {
              lastDraw = time;
              if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
                canvas.width = video.videoWidth; canvas.height = video.videoHeight;
              }
              context.filter = presets[selected.preset]; context.globalAlpha = 1;
              context.drawImage(video, 0, 0, canvas.width, canvas.height);
              if (selected.beauty > 0) {
                context.filter = `blur(1.5px) ${presets[selected.preset] === 'none' ? '' : presets[selected.preset]}`;
                context.globalAlpha = selected.beauty / 100 * 0.55;
                context.drawImage(video, 0, 0, canvas.width, canvas.height);
                context.globalAlpha = 1;
              }
            }
            frame = requestAnimationFrame(draw);
          }
          draw(); processedTrack = canvas.captureStream(24).getVideoTracks()[0];
          if (!processedTrack) throw new Error('No se pudo generar el video con filtro.');
        } catch (error) { await processor.destroy(); throw error; }
      },
      async restart(opts) { await processor.init(opts); },
      async destroy() {
        stopped = true; serial++;
        if (frame !== null) cancelAnimationFrame(frame); frame = null;
        processedTrack?.stop(); processedTrack = null;
        if (video) { video.pause(); video.srcObject = null; video.remove(); }
        video = null; canvas = null; source = null;
        // The original camera track belongs to LiveKit; never stop it here.
      },
    };
    return processor;
  }
  return { createProcessor, options, qualities };
})();
