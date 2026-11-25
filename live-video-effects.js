/* Outgoing portrait frames; no face analysis or camera-source ownership. */
window.LiveVideoEffects = (() => {
  const presets = { natural: 'none', clear: 'brightness(1.09) contrast(1.04) saturate(1.06)', warm: 'brightness(1.04) saturate(1.09) sepia(.12)' };
  const qualities = { economy: { width: 360, height: 640, aspectRatio: 9 / 16, frameRate: 20 }, standard: { width: 720, height: 1280, aspectRatio: 9 / 16, frameRate: 24 }, high: { width: 1080, height: 1920, aspectRatio: 9 / 16, frameRate: 30 } };
  function isAppleMobile(nav = globalThis.navigator) {
    return /iPhone|iPad|iPod/i.test(nav?.userAgent || '') || (/Mac/i.test(nav?.platform || '') && nav?.maxTouchPoints > 1);
  }
  function captureResolution(quality = 'standard', nav = globalThis.navigator) {
    const resolution = qualities[quality];
    if (!resolution) throw new Error('Calidad de captura no disponible.');
    // WebKit applies device orientation to sensor-native (landscape) requests.
    return isAppleMobile(nav) ? { ...resolution, width: resolution.height, height: resolution.width, aspectRatio: 16 / 9 } : { ...resolution };
  }
  async function configureCameraSource(track) {
    const caps = track.getCapabilities?.() || {};
    // Do not reapply portrait constraints to iOS after acquiring its sensor preset.
    const constraints = isAppleMobile() ? {} : { aspectRatio: { ideal: 9 / 16 } };
    if (caps.resizeMode?.includes('none')) constraints.resizeMode = 'none';
    if (caps.zoom && Number.isFinite(caps.zoom.min)) constraints.advanced = [{ zoom: caps.zoom.min }];
    try { if (Object.keys(constraints).length) await track.applyConstraints?.(constraints); }
    catch (error) { console.warn('[KMD camera constraints]', error); }
  }
  function firstCameraFrame(video, timeout = 5000) {
    let finish, frameId, timer, done = false;
    const promise = new Promise((resolve, reject) => {
      const loaded = () => { if (video.readyState >= 2 && video.videoWidth && video.videoHeight) finish(); };
      finish = error => {
        if (done) return;
        done = true; clearTimeout(timer);
        if (frameId !== undefined) video.cancelVideoFrameCallback?.(frameId);
        video.removeEventListener?.('loadeddata', loaded);
        if (error) reject(error); else resolve();
      };
      timer = setTimeout(() => finish(new Error('No se recibió una imagen de la cámara.')), timeout);
      if (video.requestVideoFrameCallback) frameId = video.requestVideoFrameCallback(() => finish());
      else { video.addEventListener?.('loadeddata', loaded); loaded(); }
    });
    return { promise, cancel: () => finish(new Error('Se canceló el ajuste de cámara.')) };
  }
  function paintedFrameSize(video, probe) {
    const reported = { width: video.videoWidth, height: video.videoHeight };
    if (!isAppleMobile() || !reported.width || !reported.height) return reported;
    try {
      probe.width = 16; probe.height = 16;
      const context = probe.getContext('2d', { willReadFrequently: true });
      context.clearRect(0, 0, 16, 16);
      const scale = 16 / Math.max(reported.width, reported.height);
      context.setTransform(scale, 0, 0, scale, 0, 0);
      context.drawImage(video, 0, 0);
      context.setTransform(1, 0, 0, 1, 0, 0);
      const pixels = context.getImageData(0, 0, 16, 16).data;
      let right = 0, bottom = 0;
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        if (pixels[(y * 16 + x) * 4 + 3] > 128) { right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1); }
      }
      // Alpha bounds test display orientation, never image content or faces.
      if (right && bottom && right !== bottom && (right > bottom) !== (reported.width > reported.height)) return { width: reported.height, height: reported.width };
    } catch (error) { console.warn('[KMD camera frame measurement]', error); }
    return reported;
  }
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
  function createProcessor(preset = 'natural', beauty = 0, quality = 'standard', { forceCompatibility = false, onFrameInfo } = {}) {
    let selected = options(preset, beauty, quality), video = null, canvas = null, small = null, probe = null;
    let frame = null, processedTrack = null, stopped = true, serial = 0, nativeFilter = false;
    let cancelFrameWait = null, frameInfo = null;
    const processor = {
      name: 'koomodoo-color-and-softness',
      get processedTrack() { return processedTrack; },
      get compatibilityMode() { return !nativeFilter && selected.preset !== 'natural'; },
      get frameInfo() { return frameInfo ? { ...frameInfo } : null; },
      setOptions(preset, beauty, quality = selected.quality) { selected = options(preset, beauty, quality); },
      async init({ track }) {
        await processor.destroy();
        const version = ++serial; stopped = false;
        await configureCameraSource(track);
        if (version !== serial || stopped) throw new Error('Se canceló el ajuste.');
        video = document.createElement('video'); video.muted = true; video.defaultMuted = true; video.volume = 0; video.playsInline = true;
        video.style.cssText = 'position:fixed;left:-10000px;width:2px;height:2px;pointer-events:none';
        video.srcObject = new MediaStream([track]); document.body.append(video);
        canvas = document.createElement('canvas'); small = document.createElement('canvas'); probe = document.createElement('canvas');
        const context = canvas.getContext('2d', { alpha: false }), soft = small.getContext('2d', { alpha: false });
        if (!canvas.captureStream || !context || !soft) {
          await processor.destroy(); throw new Error('Este dispositivo no permite procesar la pista de video. PULSO puede continuar con la cámara original.');
        }
        nativeFilter = !forceCompatibility && typeof context.filter === 'string';
        try {
          await video.play();
          if (version !== serial || stopped) throw new Error('Se canceló el ajuste.');
          const first = firstCameraFrame(video); cancelFrameWait = first.cancel;
          await first.promise; cancelFrameWait = null;
          if (version !== serial || stopped) throw new Error('Se canceló el ajuste.');
          let lastDraw = -Infinity;
          let source = null, sourceKey = '', dirty = true;
          video.addEventListener?.('resize', () => { dirty = true; });
          function draw(time = performance.now()) {
            if (stopped || version !== serial) return;
            const compatible = !nativeFilter && selected.preset !== 'natural';
            if (video.readyState >= 2 && video.videoWidth && video.videoHeight && time - lastDraw >= 1000 / (compatible ? 15 : 24)) {
              lastDraw = time;
              const key = video.videoWidth + 'x' + video.videoHeight;
              if (dirty || key !== sourceKey) { source = paintedFrameSize(video, probe); sourceKey = key; dirty = false; }
              const size = portraitSize(source.width, source.height, selected.quality, compatible);
              if (canvas.width !== size.width || canvas.height !== size.height) { canvas.width = size.width; canvas.height = size.height; }
              const rect = containRect(source.width, source.height, canvas.width, canvas.height);
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
              if (!frameInfo || frameInfo.sourceWidth !== source.width || frameInfo.sourceHeight !== source.height || frameInfo.outputWidth !== size.width || frameInfo.outputHeight !== size.height) {
                frameInfo = { sourceWidth: source.width, sourceHeight: source.height, outputWidth: size.width, outputHeight: size.height, appleMobile: isAppleMobile() };
                console.info('[KMD PULSO capture]', frameInfo);
                try { onFrameInfo?.({ ...frameInfo }); } catch (error) { console.warn('[KMD camera info]', error); }
              }
            }
            frame = requestAnimationFrame(draw);
          }
          draw(); processedTrack = canvas.captureStream(24).getVideoTracks()[0];
          if (!processedTrack) throw new Error('No se pudo generar la pista de PULSO.');
        } catch (error) { if (version === serial) await processor.destroy(); throw error; }
      },
      async restart(opts) { await processor.init(opts); },
      async destroy() {
        stopped = true; serial++;
        cancelFrameWait?.(); cancelFrameWait = null; frameInfo = null;
        if (frame !== null) cancelAnimationFrame(frame); frame = null;
        processedTrack?.stop(); processedTrack = null;
        if (video) { video.pause(); video.srcObject = null; video.remove(); }
        video = null; canvas = null; small = null; probe = null;
      },
    };
    return processor;
  }
  return { createProcessor, options, qualities, captureResolution, isAppleMobile, firstCameraFrame, paintedFrameSize, portraitSize, containRect, colorPixels, configureCameraSource };
})();
