"use strict";

/* ambient-engine.js
   The single ambient-sound engine, shared by two hosts:
   - offscreen.html (the real home: playback continues while the user browses)
   - newtab.html    (direct-HTML preview fallback only, when the extension
                     runtime is unavailable)

   Design notes:
   - The source files are short seamless-source candidates (~6–15 s). We never
     rely on `audio.loop = true`; instead overlapping AudioBufferSourceNodes
     crossfade tail-into-head with equal-power (sin/cos) gain curves, so any
     seam mismatch in the recording is blended away.
   - The crossfade adapts to track length: min 1.5 s, max 3 s, never more than
     ~45% of the track.
   - Exactly one scheduler loop can run: every (re)start increments `token`,
     and the loop exits when its token goes stale.
   - Pause uses AudioContext.suspend(): the audio clock freezes, so a timed
     session keeps its remaining time with no bookkeeping.
   - A timed session ends with a 2 s fade, then reports through onEnded.
*/

function createAmbientEngine(resolveUrl) {
  let ctx = null;
  let master = null;
  let voices = [];
  let nextStart = 0;
  let schedulerTimer = 0;
  let token = 0;
  let current = null; // { key, label, src, buffer, fade, period }
  let volume = 0.28;
  let duckFactor = 1;
  let endsAt = null;
  let fadingOut = false;
  let paused = false;
  let endedCallback = null;
  const buffers = new Map();

  const LOOKAHEAD_SECONDS = 1.2;
  const TICK_MS = 250;

  function clamp01(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0;
  }

  function ensureContext() {
    if (ctx) return;
    const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContextClass) throw new Error("Web Audio is unavailable");
    ctx = new AudioContextClass();
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);

    // Safari and iOS interrupt the audio context on a phone call, an alarm, or
    // the browser being backgrounded, and do not restore it on their own. If a
    // sound is playing and the person did not choose to pause, bring it back.
    // A deliberate pause sets `paused`, and stopping clears `current`, so
    // neither is ever overridden here.
    const recover = () => {
      if (!ctx || !current || paused) return;
      if (ctx.state === "running") return;
      ctx.resume().catch(() => {});
    };
    ctx.addEventListener("statechange", recover);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") recover();
    });
  }

  function rampMaster(target, ms) {
    if (!ctx || !master) return;
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(clamp01(target), now + ms / 1000);
  }

  // Equal-power curves: gainIn² + gainOut² = 1 at every point, so the summed
  // loudness through the overlap stays constant - no click, no dip.
  function equalPowerCurve(direction) {
    const length = 64;
    const curve = new Float32Array(length);
    for (let index = 0; index < length; index += 1) {
      const position = index / (length - 1);
      curve[index] = direction === "in"
        ? Math.sin((position * Math.PI) / 2)
        : Math.cos((position * Math.PI) / 2);
    }
    return curve;
  }

  // Longer overlaps hide level mismatches better; short tracks cap at ~45%.
  function adaptiveFade(duration) {
    return Math.min(3, Math.max(1.5, duration / 4), duration / 2.2);
  }

  async function loadBuffer(src) {
    const url = resolveUrl(src);
    if (buffers.has(url)) return buffers.get(url);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not load ${url}`);
    const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
    buffers.set(url, buffer);
    return buffer;
  }

  function stopVoices() {
    voices.forEach(voice => {
      try { voice.source.stop(); } catch {}
      voice.source.disconnect();
      voice.gain.disconnect();
    });
    voices = [];
  }

  function scheduleVoiceAt(startTime) {
    const { buffer, fade } = current;
    const duration = buffer.duration;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.setValueCurveAtTime(equalPowerCurve("in"), startTime, fade);
    gain.gain.setValueAtTime(1, startTime + fade);
    gain.gain.setValueCurveAtTime(equalPowerCurve("out"), startTime + duration - fade, fade);
    source.connect(gain).connect(master);
    source.start(startTime);
    source.stop(startTime + duration + 0.05);

    const voice = { source, gain };
    voices.push(voice);
    source.addEventListener("ended", () => {
      source.disconnect();
      gain.disconnect();
      voices = voices.filter(item => item !== voice);
    }, { once: true });
  }

  function beginTimedEnd(myToken) {
    if (fadingOut) return;
    fadingOut = true;
    rampMaster(0, 2000);
    setTimeout(() => {
      if (token !== myToken) return;
      hardStop();
      endedCallback?.();
    }, 2100);
  }

  function runScheduler(myToken) {
    clearTimeout(schedulerTimer);
    const tick = () => {
      if (token !== myToken || !current) { schedulerTimer = 0; return; }
      if (ctx.state === "running" && !fadingOut) {
        // A stalled tick (throttling, jank) must skip ahead, never
        // burst-schedule voices for the missed interval.
        if (nextStart < ctx.currentTime) nextStart = ctx.currentTime + 0.06;
        while (nextStart < ctx.currentTime + LOOKAHEAD_SECONDS) {
          scheduleVoiceAt(nextStart);
          nextStart += current.period;
        }
        if (endsAt !== null && ctx.currentTime >= endsAt - 2) beginTimedEnd(myToken);
      }
      schedulerTimer = window.setTimeout(tick, TICK_MS);
    };
    tick();
  }

  function hardStop() {
    clearTimeout(schedulerTimer);
    schedulerTimer = 0;
    stopVoices();
    current = null;
    endsAt = null;
    fadingOut = false;
    paused = false;
  }

  function getState() {
    return {
      active: !!current,
      playing: !!current && !paused && !fadingOut,
      paused: !!current && paused,
      sound: current ? current.key : null,
      label: current ? current.label : null,
      src: current ? current.src : null,
      volume,
      remaining: current && endsAt !== null && ctx
        ? Math.max(0, Math.round(endsAt - ctx.currentTime))
        : null,
      voiceCount: voices.length,
    };
  }

  async function play({ key, label, src, volume: newVolume, minutes }) {
    // Same sound already playing: update volume/duration only. This is what
    // makes "opening another tab" and re-pressing Play safe - no restart,
    // no doubling.
    if (current && current.key === key && !fadingOut) {
      if (paused) await resume();
      if (newVolume !== undefined && newVolume !== null) setVolume(newVolume);
      setDuration(minutes === undefined ? null : minutes);
      return getState();
    }

    const myToken = ++token;
    ensureContext();
    if (ctx.state === "suspended") {
      // resume() can pend forever under autoplay policy (it never rejects).
      // Race it with a short timeout and check the real state afterwards so
      // a blocked context reports failure instead of hanging the caller.
      await Promise.race([
        ctx.resume().catch(() => {}),
        new Promise(resolve => setTimeout(resolve, 800)),
      ]);
      if (ctx.state !== "running") {
        token += 1; // invalidate anything scheduled meanwhile
        return { active: false, error: "audio-blocked" };
      }
    }
    paused = false;

    if (current) {
      rampMaster(0, 300);
      await new Promise(resolve => setTimeout(resolve, 320));
      if (token !== myToken) return getState();
      stopVoices();
      current = null;
    }

    const buffer = await loadBuffer(src);
    if (token !== myToken) return getState();

    const fade = adaptiveFade(buffer.duration);
    current = { key, label, src, buffer, fade, period: buffer.duration - fade };
    if (newVolume !== undefined && newVolume !== null) volume = clamp01(newVolume);
    fadingOut = false;
    endsAt = minutes ? ctx.currentTime + minutes * 60 : null;

    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(0, now);
    master.gain.linearRampToValueAtTime(volume * duckFactor, now + 0.9);

    nextStart = now + 0.06;
    runScheduler(myToken);
    if (ctx.state !== "running") {
      // The context fell back to suspended after starting - report honestly
      // rather than pretending sound is playing.
      hardStop();
      return { active: false, error: "audio-blocked" };
    }
    return getState();
  }

  function pause() {
    if (!current || paused || fadingOut) return getState();
    paused = true;
    ctx.suspend(); // audio clock freezes; remaining time is preserved for free
    return getState();
  }

  async function resume() {
    if (!current || !paused) return getState();
    paused = false;
    await ctx.resume();
    return getState();
  }

  function stop(fadeMs = 700) {
    token += 1;
    clearTimeout(schedulerTimer);
    schedulerTimer = 0;
    if (!ctx || !current) { hardStop(); return getState(); }
    if (paused) {
      // Suspended context is already silent - stop immediately.
      hardStop();
      ctx.resume().catch(() => {});
      return getState();
    }
    const stopping = voices;
    voices = [];
    current = null;
    endsAt = null;
    fadingOut = false;
    rampMaster(0, fadeMs);
    setTimeout(() => {
      stopping.forEach(voice => {
        try { voice.source.stop(); } catch {}
        voice.source.disconnect();
        voice.gain.disconnect();
      });
    }, fadeMs + 60);
    return getState();
  }

  function setVolume(value) {
    volume = clamp01(value);
    if (current && !fadingOut) rampMaster(volume * duckFactor, 200);
    return getState();
  }

  function setDuration(minutes) {
    if (current && ctx) {
      endsAt = minutes ? ctx.currentTime + minutes * 60 : null;
      fadingOut = false;
    }
    return getState();
  }

  // Voice guidance temporarily lowers the ambient bed, then restores it
  // gradually - the loop itself never restarts.
  function duck() {
    duckFactor = 0.42;
    if (current && !fadingOut) rampMaster(volume * duckFactor, 260);
    return getState();
  }

  function unduck() {
    duckFactor = 1;
    if (current && !fadingOut) rampMaster(volume, 700);
    return getState();
  }

  function onEnded(fn) { endedCallback = fn; }

  return { play, pause, resume, stop, setVolume, setDuration, duck, unduck, getState, onEnded };
}
