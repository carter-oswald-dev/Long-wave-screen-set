/*
 * flicker.js
 *
 * Turns a protocol's per-second pulse descriptors into a real-time
 * sequence of full-screen black/white flashes, synced to actual
 * wall-clock seconds so a nearby radio-controlled clock can read the
 * envelope. This revives the technique from the original 2003 dcf77.c
 * screen-flicker tool, extended to five protocols.
 *
 * Honesty note (surfaced in the UI, not just here): this works only on
 * displays whose backlight/pixels can respond fully within tens of
 * milliseconds and whose unintentional RF/optical leakage a receiver
 * can actually pick up at close range. Results vary a lot by monitor;
 * some modern LCD/OLED panels and phone screens work surprisingly well
 * held right against the clock's sensor window, others won't couple at
 * all. There is no universal guarantee.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TimeCodeFlicker = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * @param {HTMLCanvasElement} canvas   full-viewport canvas to flash
   * @param {Function} getFrameForDate   (Date) => protocol frame object
   *        (as returned by protocols.js encodeXXX functions)
   * @param {Function} onSecondTick      optional (frame, secondIndex) => void,
   *        called once per emitted second for UI status updates
   */
  function createFlickerEngine(canvas, getFrameForDate, onSecondTick) {
    const ctx = canvas.getContext('2d', { alpha: false });
    let running = false;
    let rafId = null;
    let currentFrame = null;
    let frameStartMs = null;   // performance.now() at the moment second 0 of currentFrame began
    let frameSecondIndex = -1; // which second-of-frame is currently being painted
    let lastPaintedLevel = null;

    function paint(level) {
      // level: 'black' | 'white'
      if (level === lastPaintedLevel) return;
      lastPaintedLevel = level;
      ctx.fillStyle = level === 'white' ? '#ffffff' : '#000000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    function resize() {
      canvas.width = window.innerWidth * (window.devicePixelRatio || 1);
      canvas.height = window.innerHeight * (window.devicePixelRatio || 1);
    }

    // Compute the paint level for a given pulse descriptor and elapsed ms
    // into the current second. Handles all pulse shapes emitted by
    // protocols.js: simple {lowMs,highMs}, MSF's {pattern:[...]}, and
    // JJY's {firstMs,firstLevel,secondMs,secondLevel}.
    function levelForPulse(pulse, elapsedMs) {
      if (pulse.pattern) {
        let acc = 0;
        for (const seg of pulse.pattern) {
          if (elapsedMs < acc + seg.ms) return seg.level === 'high' ? 'white' : 'black';
          acc += seg.ms;
        }
        return 'white';
      }
      if (typeof pulse.firstMs === 'number') {
        if (elapsedMs < pulse.firstMs) return pulse.firstLevel === 'high' ? 'white' : 'black';
        return pulse.secondLevel === 'high' ? 'white' : 'black';
      }
      // default shape: low (black) for lowMs, then high (white) for the rest
      return elapsedMs < pulse.lowMs ? 'black' : 'white';
    }

    function loop() {
      if (!running) return;
      const now = performance.now();

      if (currentFrame === null || frameSecondIndex >= currentFrame.pulses.length) {
        // Start a fresh frame aligned to the wall-clock second boundary so
        // pulses correspond to real seconds the receiving clock also sees.
        const nowDate = new Date();
        const msIntoSecond = nowDate.getMilliseconds();
        const alignedStart = new Date(nowDate.getTime() - msIntoSecond + 1000); // next whole second
        currentFrame = getFrameForDate(alignedStart);
        frameStartMs = now + (1000 - msIntoSecond);
        frameSecondIndex = -1;
      }

      const elapsedSinceFrameStart = now - frameStartMs;
      if (elapsedSinceFrameStart < 0) {
        // still waiting for the aligned second boundary; hold white (idle/high)
        paint('white');
        rafId = requestAnimationFrame(loop);
        return;
      }

      const secIdx = Math.floor(elapsedSinceFrameStart / 1000);
      if (secIdx !== frameSecondIndex) {
        frameSecondIndex = secIdx;
        if (onSecondTick && secIdx < currentFrame.pulses.length) {
          onSecondTick(currentFrame, secIdx);
        }
      }

      if (frameSecondIndex >= currentFrame.pulses.length) {
        // frame finished; next loop iteration will start a new one
        rafId = requestAnimationFrame(loop);
        return;
      }

      const pulse = currentFrame.pulses[frameSecondIndex];
      const elapsedIntoSecond = elapsedSinceFrameStart - frameSecondIndex * 1000;
      paint(levelForPulse(pulse, elapsedIntoSecond));

      rafId = requestAnimationFrame(loop);
    }

    function start() {
      if (running) return;
      running = true;
      resize();
      window.addEventListener('resize', resize);
      currentFrame = null;
      frameSecondIndex = -1;
      lastPaintedLevel = null;
      rafId = requestAnimationFrame(loop);
    }

    function stop() {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    return { start, stop, isRunning: () => running };
  }

  return { createFlickerEngine };
});
