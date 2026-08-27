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
  var editorEnabled = false;
  var selectedElement = null;
  var selectionOverlay = null;
  var selectionLabel = null;

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
      var rawDuration = typeof timeline.duration === "function"
        ? timeline.duration()
        : timeline.duration;
      var maxTime = Number.isFinite(rawDuration) && rawDuration > 0
        ? rawDuration
        : duration;
      timeline.seek(Math.max(0, Math.min(time, maxTime)));
    }
  }

  function updateTimedElements() {
    var timed = document.querySelectorAll("[data-start]");
    for (var i = 0; i < timed.length; i++) {
      var el = timed[i];
      var start = Number.parseFloat(el.getAttribute("data-start")) || 0;
      var dur = Number.parseFloat(el.getAttribute("data-duration")) || 0;
      var end = dur > 0 ? start + dur : Number.POSITIVE_INFINITY;
      var authoredHidden = el.getAttribute("data-hidden");
      var visible = authoredHidden !== "true" && authoredHidden !== "1" && currentTime >= start - 1e-4 && currentTime < end;
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
    updateSelectionOverlay();
  }

  function post(type, extra) {
    try {
      parent.postMessage(Object.assign({ source: SELF_SOURCE, type: type }, extra || {}), "*");
    } catch (e) { /* parent unreachable */ }
  }

  function escapeSelectorValue(value) {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(value);
    }
    return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  function selectorForElement(element) {
    if (!element || element.nodeType !== 1) return "";
    if (element.id) return "#" + escapeSelectorValue(element.id);
    var hfId = element.getAttribute("data-hf-id");
    if (hfId) return '[data-hf-id="' + escapeSelectorValue(hfId) + '"]';
    var parts = [];
    var current = element;
    while (current && current !== document.documentElement) {
      var part = current.tagName.toLowerCase();
      if (current.parentElement) {
        var siblings = Array.prototype.filter.call(current.parentElement.children, function (candidate) {
          return candidate.tagName === current.tagName;
        });
        if (siblings.length > 1) part += ":nth-of-type(" + (siblings.indexOf(current) + 1) + ")";
      }
      parts.unshift(part);
      current = current.parentElement;
    }
    return parts.join(" > ");
  }

  function readComputedStyleSubset(element) {
    var result = {};
    var computed = window.getComputedStyle(element);
    var properties = [
      "position", "top", "left", "right", "bottom", "width", "height",
      "font-size", "font-weight", "font-family", "color", "background-color",
      "opacity", "border-radius", "transform", "z-index", "object-fit"
    ];
    for (var i = 0; i < properties.length; i++) {
      result[properties[i]] = computed.getPropertyValue(properties[i]);
    }
    return result;
  }

  function readDataAttributes(element) {
    var result = {};
    for (var i = 0; i < element.attributes.length; i++) {
      var attribute = element.attributes[i];
      if (attribute.name.indexOf("data-") === 0) {
        result[attribute.name.slice(5)] = attribute.value;
      }
    }
    return result;
  }

  function selectionInfo(element) {
    var selector = selectorForElement(element);
    var rect = element.getBoundingClientRect();
    var text = (element.textContent || "").trim().replace(/\s+/g, " ");
    var id = element.id || null;
    var hfId = element.getAttribute("data-hf-id");
    return {
      key: id || hfId || selector,
      id: id,
      hfId: hfId,
      selector: selector,
      label: element.getAttribute("data-label") || element.getAttribute("aria-label") || id || text.slice(0, 40) || element.tagName.toLowerCase(),
      tagName: element.tagName.toLowerCase(),
      textContent: text.slice(0, 500),
      dataAttributes: readDataAttributes(element),
      computedStyles: readComputedStyleSubset(element),
      boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    };
  }

  function runtimeTargetKeys(target) {
    if (!target || target.nodeType !== 1) return [];
    var keys = [];
    if (target.id) keys.push(target.id);
    var hfId = target.getAttribute("data-hf-id");
    if (hfId) keys.push(hfId);
    var selector = selectorForElement(target);
    if (selector) keys.push(selector);
    return keys;
  }

  function runtimeProperties(vars) {
    var properties = {};
    var ignored = {
      duration: 1, delay: 1, ease: 1, stagger: 1, keyframes: 1,
      paused: 1, overwrite: 1, immediateRender: 1, runBackwards: 1,
      startAt: 1, parent: 1, callbackScope: 1, repeat: 1,
      repeatDelay: 1, yoyo: 1, id: 1, data: 1
    };
    Object.keys(vars || {}).forEach(function (property) {
      if (ignored[property] || property.indexOf("on") === 0) return;
      var value = vars[property];
      if (typeof value === "number" || typeof value === "string") {
        properties[property] = value;
      }
    });
    return properties;
  }

  function runtimePropertyGroup(properties) {
    var keys = Object.keys(properties);
    if (keys.some(function (key) { return key === "x" || key === "y" || key === "xPercent" || key === "yPercent"; })) return "position";
    if (keys.some(function (key) { return key === "scale" || key === "scaleX" || key === "scaleY"; })) return "scale";
    if (keys.some(function (key) { return key === "rotation" || key === "rotationX" || key === "rotationY"; })) return "rotation";
    if (keys.some(function (key) { return key === "width" || key === "height"; })) return "size";
    if (keys.some(function (key) { return key === "opacity" || key === "autoAlpha"; })) return "visual";
    return "animation";
  }

  function sanitizeRuntimeKeyframe(entry, percentage) {
    if (!entry || typeof entry !== "object") return null;
    var properties = runtimeProperties(entry);
    return {
      percentage: percentage,
      properties: properties,
      ease: typeof entry.ease === "string" ? entry.ease : undefined
    };
  }

  function runtimeKeyframes(vars, properties) {
    var source = vars && vars.keyframes;
    var result = [];
    if (Array.isArray(source)) {
      for (var i = 0; i < source.length; i++) {
        var percentage = source.length > 1 ? (i / (source.length - 1)) * 100 : 0;
        var row = sanitizeRuntimeKeyframe(source[i], percentage);
        if (row) result.push(row);
      }
    } else if (source && typeof source === "object") {
      Object.keys(source).forEach(function (key) {
        var match = /^(\d+(?:\.\d+)?)%$/.exec(key);
        if (!match) return;
        var row = sanitizeRuntimeKeyframe(source[key], Number.parseFloat(match[1]));
        if (row) result.push(row);
      });
    }
    if (result.length > 0) {
      return result.sort(function (a, b) { return a.percentage - b.percentage; });
    }
    return [
      { percentage: 0, properties: {} },
      { percentage: 100, properties: properties, ease: typeof vars.ease === "string" ? vars.ease : undefined }
    ];
  }

  function scanRuntimeMotion() {
    if (!timeline || typeof timeline.getChildren !== "function") return;
    var children;
    try {
      children = timeline.getChildren(true, true, false) || [];
    } catch (error) {
      return;
    }
    var rootStart = typeof timeline.globalTime === "function" ? timeline.globalTime(0) : 0;
    var animations = [];
    for (var i = 0; i < children.length; i++) {
      var child = children[i];
      if (!child || typeof child.targets !== "function") continue;
      var targets;
      try { targets = child.targets() || []; } catch (error) { targets = []; }
      var targetKeys = [];
      for (var targetIndex = 0; targetIndex < targets.length; targetIndex++) {
        var keys = runtimeTargetKeys(targets[targetIndex]);
        for (var keyIndex = 0; keyIndex < keys.length; keyIndex++) {
          if (targetKeys.indexOf(keys[keyIndex]) < 0) targetKeys.push(keys[keyIndex]);
        }
      }
      if (targetKeys.length === 0) continue;
      var vars = child.vars || {};
      var properties = runtimeProperties(vars);
      var childStart = typeof child.globalTime === "function"
        ? child.globalTime(0) - rootStart
        : (typeof child.startTime === "function" ? child.startTime() : 0);
      var childDuration = typeof child.duration === "function" ? child.duration() : Number(vars.duration) || 0;
      if (!Number.isFinite(childStart)) childStart = 0;
      if (!Number.isFinite(childDuration) || childDuration < 0) childDuration = 0;
	  if (childDuration === 0) continue;
      animations.push({
        id: "runtime:" + i + ":" + targetKeys[0],
        targetKeys: targetKeys,
        targetSelector: targetKeys[0],
        start: childStart,
        duration: childDuration,
        propertyGroup: runtimePropertyGroup(properties),
        properties: properties,
        keyframes: runtimeKeyframes(vars, properties)
      });
    }
    post("motion-snapshot", {
      motion: { compositionId: compositionId || "", animations: animations }
    });
  }

  function ensureSelectionOverlay() {
    if (selectionOverlay || !document.body) return;
    selectionOverlay = document.createElement("div");
    selectionOverlay.setAttribute("data-opencut-studio-selection", "1");
    selectionOverlay.style.cssText = "position:fixed;pointer-events:none;border:2px solid #38bdf8;box-shadow:0 0 0 1px rgba(2,6,23,.7);z-index:2147483646;display:none";
    selectionLabel = document.createElement("div");
    selectionLabel.style.cssText = "position:absolute;left:-2px;bottom:100%;max-width:240px;padding:3px 6px;background:#0284c7;color:white;font:600 11px/1.2 system-ui,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-radius:3px 3px 0 0";
    selectionOverlay.appendChild(selectionLabel);
    document.body.appendChild(selectionOverlay);
  }

  function updateSelectionOverlay() {
    ensureSelectionOverlay();
    if (!selectionOverlay) return;
    if (!editorEnabled || !selectedElement || !selectedElement.isConnected) {
      selectionOverlay.style.display = "none";
      return;
    }
    var rect = selectedElement.getBoundingClientRect();
    selectionOverlay.style.display = "block";
    selectionOverlay.style.left = rect.left + "px";
    selectionOverlay.style.top = rect.top + "px";
    selectionOverlay.style.width = Math.max(0, rect.width) + "px";
    selectionOverlay.style.height = Math.max(0, rect.height) + "px";
    if (selectionLabel) selectionLabel.textContent = selectionInfo(selectedElement).label;
  }

  function selectEditorElement(element, announce) {
    if (!element || element === document.body || element === document.documentElement) {
      element = root;
    }
    selectedElement = element || null;
    updateSelectionOverlay();
    if (announce && selectedElement) {
      post("element-selected", { element: selectionInfo(selectedElement) });
    }
  }

  function findEditableElement(target) {
    if (!target || target.nodeType !== 1) return root;
    if (target.closest && target.closest("[data-opencut-studio-selection]")) return null;
    return target;
  }

  function handleEditorClick(event) {
    if (!editorEnabled) return;
    var candidate = findEditableElement(event.target);
    if (!candidate) return;
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
    selectEditorElement(candidate, true);
  }

  function handleEditorKeydown(event) {
    if (!editorEnabled || event.key !== "Escape") return;
    selectedElement = null;
    updateSelectionOverlay();
    post("element-selection-cleared");
  }

  function applyEditorAction(data) {
    if (data.action === "set-editor-enabled" || data.action === "enable-pick-mode") {
      editorEnabled = data.action === "enable-pick-mode" ? true : data.enabled !== false;
      document.documentElement.style.cursor = editorEnabled ? "crosshair" : "";
      updateSelectionOverlay();
      return true;
    }
    if (data.action === "disable-pick-mode") {
      editorEnabled = false;
      document.documentElement.style.cursor = "";
      updateSelectionOverlay();
      return true;
    }
    if (data.action === "select-element") {
	  if (!data.selector) {
	    selectedElement = null;
	    updateSelectionOverlay();
	    return true;
	  }
      try {
		selectEditorElement(
		  document.querySelector(String(data.selector || "")),
		  data.announce === true
		);
      } catch (error) {
        selectEditorElement(null, false);
      }
      return true;
    }
    if (!selectedElement || !selectedElement.isConnected) return false;
    if (data.selector) {
      try {
        selectedElement = document.querySelector(String(data.selector)) || selectedElement;
      } catch (error) { /* invalid selector */ }
    }
    if (data.action === "patch-style") {
      selectedElement.style.setProperty(String(data.property || ""), String(data.value || ""));
    } else if (data.action === "patch-attribute") {
      var attr = String(data.property || "");
      if (attr.indexOf("data-") !== 0) attr = "data-" + attr;
      if (data.value === null) selectedElement.removeAttribute(attr);
      else selectedElement.setAttribute(attr, String(data.value));
	  duration = readDuration();
	  updateTimedElements();
    } else if (data.action === "patch-text") {
      selectedElement.textContent = String(data.value || "");
    } else {
      return false;
    }
    updateSelectionOverlay();
    post("element-preview-updated", { element: selectionInfo(selectedElement) });
    return true;
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

  function serializeSnapshot() {
    var clone = document.documentElement.cloneNode(true);
    clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
	var unsafe = clone.querySelectorAll("script,iframe,object,embed,meta[http-equiv],[data-opencut-studio-selection]");
    for (var i = 0; i < unsafe.length; i++) unsafe[i].remove();

    var originalVideos = document.querySelectorAll("video");
    var clonedVideos = clone.querySelectorAll("video");
    for (var videoIndex = 0; videoIndex < clonedVideos.length; videoIndex++) {
      var originalVideo = originalVideos[videoIndex];
      var clonedVideo = clonedVideos[videoIndex];
      var replacement = clone.ownerDocument.createElement("div");
      replacement.setAttribute("style", clonedVideo.getAttribute("style") || "");
      replacement.setAttribute("class", clonedVideo.getAttribute("class") || "");
      if (originalVideo && originalVideo.poster) {
        var poster = clone.ownerDocument.createElement("img");
        poster.setAttribute("src", originalVideo.poster);
        poster.setAttribute("style", (clonedVideo.getAttribute("style") || "") + ";width:100%;height:100%;object-fit:cover");
        replacement.appendChild(poster);
      } else {
        replacement.setAttribute("data-opencut-video-placeholder", "1");
        replacement.style.background = "#000";
      }
      clonedVideo.replaceWith(replacement);
    }

    var base = clone.ownerDocument.createElement("base");
    base.setAttribute("href", document.baseURI);
    var head = clone.querySelector("head");
    if (head) head.insertBefore(base, head.firstChild);
    return new XMLSerializer().serializeToString(clone);
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
    if (applyEditorAction(data)) {
      return;
    } else if (data.action === "play") {
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
    } else if (data.action === "snapshot") {
      var snapshotTime = typeof data.timeSeconds === "number"
        ? data.timeSeconds
        : currentTime;
      setTime(snapshotTime, { silent: true });
      try {
        post("snapshot", {
          requestId: data.requestId,
          currentTime: currentTime,
          xhtml: serializeSnapshot()
        });
      } catch (snapshotError) {
        post("snapshot-error", {
          requestId: data.requestId,
          message: snapshotError && snapshotError.message
            ? snapshotError.message
            : String(snapshotError)
        });
      }
	} else if (data.action === "scan-motion") {
	  scanRuntimeMotion();
    } else if (data.action === "set-playback-rate") {
      playbackRate = typeof data.rate === "number" && data.rate > 0 ? data.rate : 1;
    }
  });

  document.addEventListener("click", handleEditorClick, true);
  document.addEventListener("keydown", handleEditorKeydown, true);
  window.addEventListener("resize", updateSelectionOverlay);
  window.addEventListener("scroll", updateSelectionOverlay, true);

  var tries = 0;
  var poller = setInterval(function () {
    tries += 1;
    if (findComposition()) {
      clearInterval(poller);
      ready = true;
      seekTimeline(0);
      updateTimedElements();
      ensureSelectionOverlay();
      post("ready", { duration: duration, currentTime: 0, compositionId: compositionId });
	  scanRuntimeMotion();
      requestAnimationFrame(tick);
    } else if (tries >= MAX_TRIES) {
      clearInterval(poller);
      post("error", { message: "No seekable window.__timelines composition was found." });
    }
  }, POLL_MS);
})();
`;
