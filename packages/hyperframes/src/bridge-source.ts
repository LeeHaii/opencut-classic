/**
 * Injected into the sandboxed preview srcdoc. Duplicates minimal HyperFrames
 * semantics (data-start/data-duration visibility, window.__timelines seeking)
 * because the iframe runs without allow-same-origin and the parent can only
 * talk over postMessage.
 */
export const previewBridgeSource = String.raw`
(function () {
  var PARENT_SOURCE = "hf-parent";
  var SELF_SOURCE = "opencut-hf-preview";
  var MAX_TRIES = 80;
  var POLL_MS = 100;

  var root = null;
  var timeline = null;
  var compositionId = null;
  var duration = 0;
  var currentTime = 0;
  var playing = false;
  var playbackRate = 1;
  var lastTick = 0;
  var ready = false;

  function findComposition() {
    root = document.querySelector("[data-composition-id]");
    if (!root) return false;
    compositionId = root.getAttribute("data-composition-id");
    window.__timelines = window.__timelines || {};
    timeline = window.__timelines[compositionId] || null;
    if (!timeline) {
      var keys = Object.keys(window.__timelines);
      if (keys.length === 1) timeline = window.__timelines[keys[0]];
    }
    var attr = Number.parseFloat(root.getAttribute("data-duration"));
    if (Number.isFinite(attr) && attr > 0) {
      duration = attr;
    } else if (timeline && typeof timeline.duration === "number") {
      duration = timeline.duration;
    } else {
      return false;
    }
    return true;
  }

  function seekTimeline(time) {
    if (timeline && typeof timeline.seek === "function") {
      timeline.seek(Math.max(0, Math.min(time, timeline.duration || time)));
    }
  }

  function updateTimedElements() {
    var timed = document.querySelectorAll("[data-start]");
    for (var i = 0; i < timed.length; i++) {
      var el = timed[i];
      var start = Number.parseFloat(el.getAttribute("data-start")) || 0;
      var dur = Number.parseFloat(el.getAttribute("data-duration")) || 0;
      var end = dur > 0 ? start + dur : Number.POSITIVE_INFINITY;
      var visible = currentTime >= start - 1e-4 && currentTime < end;
      if (visible && el.style.display === "none") {
        el.style.display = "";
      } else if (!visible && el.style.display !== "none") {
        el.style.display = "none";
      }
      if (visible && el.tagName === "VIDEO") {
        var video = el;
        if (Number.isFinite(video.duration) && video.duration > 0) {
          var local = currentTime - start;
          var target = Math.min(local, video.duration - 0.05);
          if (Math.abs(video.currentTime - target) > 0.15 && !video.paused) {
            video.currentTime = Math.max(0, target);
          }
        }
      }
    }
  }

  function post(type, extra) {
    try {
      parent.postMessage(Object.assign({ source: SELF_SOURCE, type: type }, extra || {}), "*");
    } catch (e) { /* parent unreachable */ }
  }

  function announceState() {
    post(playing ? "play" : "pause", { currentTime: currentTime, duration: duration });
  }

  function setTime(time, opts) {
    currentTime = Math.max(0, Math.min(time, duration));
    seekTimeline(currentTime);
    updateTimedElements();
    if (!opts || !opts.silent) post("timeupdate", { currentTime: currentTime, duration: duration });
  }

  function tick(now) {
    if (!ready) return;
    if (playing) {
      var delta = (now - lastTick) / 1000;
      lastTick = now;
      setTime(currentTime + delta * playbackRate, { silent: true });
      post("timeupdate", { currentTime: currentTime, duration: duration });
      if (currentTime >= duration) {
        playing = false;
        post("ended", { currentTime: duration, duration: duration });
      }
    } else {
      lastTick = now;
    }
    requestAnimationFrame(tick);
  }

  window.addEventListener("message", function (event) {
    var data = event.data;
    if (!data || data.source !== PARENT_SOURCE || data.type !== "control") return;
    if (data.action === "play") {
      playing = true;
      lastTick = performance.now();
      announceState();
    } else if (data.action === "pause") {
      playing = false;
      announceState();
    } else if (data.action === "toggle") {
      playing = !playing;
      lastTick = performance.now();
      announceState();
    } else if (data.action === "seek") {
      var t = typeof data.timeSeconds === "number"
        ? data.timeSeconds
        : (typeof data.frame === "number" ? data.frame / (data.fps || 30) : currentTime);
      setTime(t);
    } else if (data.action === "set-playback-rate") {
      playbackRate = typeof data.rate === "number" && data.rate > 0 ? data.rate : 1;
    }
  });

  var tries = 0;
  var poller = setInterval(function () {
    tries += 1;
    if (findComposition()) {
      clearInterval(poller);
      ready = true;
      seekTimeline(0);
      updateTimedElements();
      post("ready", { duration: duration, currentTime: 0, compositionId: compositionId });
      requestAnimationFrame(tick);
    } else if (tries >= MAX_TRIES) {
      clearInterval(poller);
      post("error", { message: "No seekable window.__timelines composition was found." });
    }
  }, POLL_MS);
})();
`;
