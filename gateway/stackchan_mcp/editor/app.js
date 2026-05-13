"use strict";

const FACE_NAMES = [
  "idle",
  "happy",
  "thinking",
  "sad",
  "surprised",
  "embarrassed",
  "off",
];
const LED_COUNT = 12;
const DEFAULT_LED = [16, 20, 23];

const els = {
  name: document.querySelector("#template-name"),
  duration: document.querySelector("#duration-ms"),
  scrubber: document.querySelector("#scrubber"),
  currentTime: document.querySelector("#current-time-label"),
  playToggle: document.querySelector("#play-toggle"),
  stopPlayback: document.querySelector("#stop-playback"),
  deleteSelected: document.querySelector("#delete-selected"),
  timeAxis: document.querySelector("#time-axis"),
  playhead: document.querySelector("#playhead"),
  lanes: {
    avatar: document.querySelector("#avatar-lane"),
    leds: document.querySelector("#leds-lane"),
    servo: document.querySelector("#servo-lane"),
  },
  avatarFace: document.querySelector("#avatar-face"),
  avatarLabel: document.querySelector("#avatar-label"),
  ledStrip: document.querySelector("#led-strip"),
  draftLedStrip: document.querySelector("#draft-led-strip"),
  servoHead: document.querySelector("#servo-head"),
  servoLabel: document.querySelector("#servo-label"),
  avatarForm: document.querySelector("#avatar-form"),
  ledForm: document.querySelector("#led-form"),
  servoForm: document.querySelector("#servo-form"),
  paintColor: document.querySelector("#paint-color"),
  paintTarget: document.querySelector("#paint-target"),
  paintApply: document.querySelector("#paint-apply"),
  paintClear: document.querySelector("#paint-clear"),
  jsonOutput: document.querySelector("#json-output"),
  copyJson: document.querySelector("#copy-json"),
  downloadJson: document.querySelector("#download-json"),
  importJson: document.querySelector("#import-json"),
  status: document.querySelector("#status-line"),
};

let state = {
  schema: "stackchan.motion_template.v0",
  name: "happy_custom",
  duration_ms: 1200,
  tracks: {
    avatar: [
      { time_ms: 0, face: "happy" },
      { time_ms: 900, face: "idle" },
    ],
    leds: [
      { time_ms: 0, colors: fillColor([255, 176, 0]), transition_ms: 0 },
      { time_ms: 500, colors: chaseColor([20, 124, 115]), transition_ms: 80 },
      { time_ms: 1000, colors: fillColor(DEFAULT_LED), transition_ms: 100 },
    ],
    servo: [
      { time_ms: 0, yaw: 0, pitch: 10, duration_ms: 180, easing: "linear" },
      { time_ms: 220, yaw: 0, pitch: 22, duration_ms: 180, easing: "linear" },
      { time_ms: 460, yaw: 0, pitch: 10, duration_ms: 220, easing: "linear" },
    ],
  },
};
let draftLedColors = fillColor([255, 176, 0]);
let currentTime = 0;
let playbackTimer = null;
let playbackStartedAt = 0;
let playbackStartTime = 0;
let selectedEvent = null;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function fillColor(rgb) {
  return Array.from({ length: LED_COUNT }, () => [...rgb]);
}

function chaseColor(rgb) {
  return Array.from({ length: LED_COUNT }, (_, index) => {
    const scale = index % 3 === 0 ? 1 : 0.18;
    return rgb.map((channel) => Math.round(channel * scale));
  });
}

function hexToRgb(hex) {
  const clean = hex.replace("#", "");
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

function rgbToCss(rgb) {
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

function numberFromForm(form, name, fallback) {
  const value = Number(new FormData(form).get(name));
  return Number.isFinite(value) ? value : fallback;
}

function sortTracks() {
  for (const events of Object.values(state.tracks)) {
    events.sort((a, b) => a.time_ms - b.time_ms);
  }
}

function sanitizeName(name) {
  const clean = name.trim().replace(/[^a-zA-Z0-9_-]+/g, "_");
  return clean || "motion_template";
}

function eventAt(trackName, fallback) {
  const events = state.tracks[trackName];
  let selected = fallback;
  for (const event of events) {
    if (event.time_ms <= currentTime) {
      selected = event;
    } else {
      break;
    }
  }
  return selected;
}

function motionJson() {
  sortTracks();
  return {
    schema: state.schema,
    name: sanitizeName(els.name.value),
    duration_ms: clamp(Number(els.duration.value) || state.duration_ms, 100, 30000),
    tracks: {
      avatar: state.tracks.avatar.map((event) => ({
        time_ms: event.time_ms,
        face: event.face,
      })),
      leds: state.tracks.leds.map((event) => ({
        time_ms: event.time_ms,
        colors: event.colors.map((rgb) => rgb.map((channel) => clamp(Math.round(channel), 0, 255))),
        transition_ms: event.transition_ms ?? 0,
      })),
      servo: state.tracks.servo.map((event) => ({
        time_ms: event.time_ms,
        yaw: event.yaw,
        pitch: event.pitch,
        duration_ms: event.duration_ms,
        easing: event.easing || "linear",
      })),
    },
  };
}

function setStatus(message) {
  els.status.textContent = message;
}

function selectedEventExists() {
  if (!selectedEvent) {
    return false;
  }
  return state.tracks[selectedEvent.trackName]?.includes(selectedEvent.event) ?? false;
}

function selectEvent(trackName, index) {
  const event = state.tracks[trackName][index];
  selectedEvent = { trackName, event };
  setCurrentTime(event.time_ms);
  renderTimeline();
  setStatus(`Selected ${trackName} keyframe at ${event.time_ms} ms`);
}

function deleteSelectedEvent() {
  if (!selectedEventExists()) {
    selectedEvent = null;
    renderTimeline();
    setStatus("No keyframe selected");
    return;
  }
  const { trackName, event } = selectedEvent;
  const index = state.tracks[trackName].indexOf(event);
  state.tracks[trackName].splice(index, 1);
  selectedEvent = null;
  renderAll(`Removed ${trackName} keyframe`);
}

function setCurrentTime(nextTime) {
  const duration = Number(els.duration.value) || state.duration_ms;
  currentTime = clamp(nextTime, 0, duration);
  els.scrubber.value = String(currentTime);
  els.currentTime.textContent = `${Math.round(currentTime)} ms`;
  renderPreview();
  renderPlayhead();
}

function renderLedDots(container, colors, className) {
  container.innerHTML = "";
  colors.forEach((rgb, index) => {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = className;
    dot.style.background = rgbToCss(rgb);
    dot.title = `LED ${index}`;
    dot.setAttribute("aria-label", `LED ${index} ${rgbToCss(rgb)}`);
    if (className === "draft-led") {
      dot.addEventListener("click", () => {
        draftLedColors[index] = hexToRgb(els.paintColor.value);
        renderDraftLeds();
      });
    }
    container.append(dot);
  });
}

function renderDraftLeds() {
  renderLedDots(els.draftLedStrip, draftLedColors, "draft-led");
}

function renderPreview() {
  const avatar = eventAt("avatar", { face: "idle" });
  const leds = eventAt("leds", { colors: fillColor(DEFAULT_LED) });
  const servo = eventAt("servo", { yaw: 0, pitch: 10 });

  els.avatarFace.dataset.face = avatar.face;
  els.avatarLabel.value = avatar.face;
  renderLedDots(els.ledStrip, leds.colors, "led");

  const x = 50 + (clamp(servo.yaw, -90, 90) / 90) * 38;
  const y = 82 - (clamp(servo.pitch, 0, 88) / 88) * 64;
  els.servoHead.style.left = `${x}%`;
  els.servoHead.style.top = `${y}%`;
  els.servoLabel.value = `yaw ${servo.yaw}, pitch ${servo.pitch}`;
}

function renderAxis() {
  const duration = Number(els.duration.value) || state.duration_ms;
  els.timeAxis.innerHTML = "";
  for (let index = 0; index <= 4; index += 1) {
    const tick = document.createElement("span");
    tick.className = "tick-label";
    tick.style.left = `${index * 25}%`;
    tick.textContent = `${Math.round((duration * index) / 4)} ms`;
    els.timeAxis.append(tick);
  }
}

function renderPlayhead() {
  const duration = Number(els.duration.value) || state.duration_ms;
  els.playhead.style.left = `${(currentTime / duration) * 100}%`;
}

function chipLabel(trackName, event) {
  if (trackName === "avatar") {
    return `${event.time_ms} ${event.face}`;
  }
  if (trackName === "leds") {
    return `${event.time_ms} LEDs`;
  }
  return `${event.time_ms} yaw ${event.yaw} pitch ${event.pitch}`;
}

function renderTimeline() {
  const duration = Number(els.duration.value) || state.duration_ms;
  for (const [trackName, lane] of Object.entries(els.lanes)) {
    lane.innerHTML = "";
    state.tracks[trackName].forEach((event, index) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = `event-chip ${trackName}`;
      if (selectedEvent?.trackName === trackName && selectedEvent.event === event) {
        chip.classList.add("selected");
        chip.setAttribute("aria-pressed", "true");
      } else {
        chip.setAttribute("aria-pressed", "false");
      }
      chip.textContent = chipLabel(trackName, event);
      chip.title = "Click to select, double click to delete";
      chip.style.left = `${clamp((event.time_ms / duration) * 100, 0, 96)}%`;
      chip.addEventListener("click", () => selectEvent(trackName, index));
      chip.addEventListener("dblclick", () => {
        state.tracks[trackName].splice(index, 1);
        selectedEvent = null;
        renderAll(`Removed ${trackName} keyframe`);
      });
      lane.append(chip);
    });
  }
  els.deleteSelected.disabled = !selectedEventExists();
}

function renderJson() {
  els.jsonOutput.value = JSON.stringify(motionJson(), null, 2);
}

function renderAll(statusMessage) {
  const duration = clamp(Number(els.duration.value) || state.duration_ms, 100, 30000);
  els.duration.value = String(duration);
  state.duration_ms = duration;
  state.name = sanitizeName(els.name.value);
  els.scrubber.max = String(duration);
  sortTracks();
  renderAxis();
  renderTimeline();
  renderPreview();
  renderPlayhead();
  renderJson();
  if (statusMessage) {
    setStatus(statusMessage);
  }
}

function addAvatarEvent(event) {
  event.preventDefault();
  const data = new FormData(els.avatarForm);
  const duration = Number(els.duration.value) || state.duration_ms;
  const time = clamp(Number(data.get("time_ms")) || 0, 0, duration);
  const face = String(data.get("face"));
  if (!FACE_NAMES.includes(face)) {
    setStatus("Unknown avatar face");
    return;
  }
  const eventToAdd = { time_ms: time, face };
  state.tracks.avatar.push(eventToAdd);
  selectedEvent = { trackName: "avatar", event: eventToAdd };
  setCurrentTime(time);
  renderAll("Avatar keyframe added");
}

function paintDraft() {
  const rgb = hexToRgb(els.paintColor.value);
  const target = els.paintTarget.value;
  if (target === "all") {
    draftLedColors = fillColor(rgb);
  } else {
    draftLedColors[Number(target)] = rgb;
  }
  renderDraftLeds();
}

function addLedFrame(event) {
  event.preventDefault();
  const duration = Number(els.duration.value) || state.duration_ms;
  const time = clamp(numberFromForm(els.ledForm, "time_ms", 0), 0, duration);
  const eventToAdd = {
    time_ms: time,
    colors: draftLedColors.map((rgb) => [...rgb]),
    transition_ms: 0,
  };
  state.tracks.leds.push(eventToAdd);
  selectedEvent = { trackName: "leds", event: eventToAdd };
  setCurrentTime(time);
  renderAll("LED frame added");
}

function addServoEvent(event) {
  event.preventDefault();
  const duration = Number(els.duration.value) || state.duration_ms;
  const time = clamp(numberFromForm(els.servoForm, "time_ms", 0), 0, duration);
  const yaw = clamp(Math.round(numberFromForm(els.servoForm, "yaw", 0)), -90, 90);
  const pitch = clamp(Math.round(numberFromForm(els.servoForm, "pitch", 10)), 0, 88);
  const moveDuration = clamp(Math.round(numberFromForm(els.servoForm, "duration_ms", 240)), 10, 10000);
  const eventToAdd = {
    time_ms: time,
    yaw,
    pitch,
    duration_ms: moveDuration,
    easing: "linear",
  };
  state.tracks.servo.push(eventToAdd);
  selectedEvent = { trackName: "servo", event: eventToAdd };
  setCurrentTime(time);
  renderAll("Servo keyframe added");
}

function startPlayback() {
  if (playbackTimer) {
    stopPlayback(false);
    return;
  }
  playbackStartedAt = performance.now();
  playbackStartTime = currentTime;
  els.playToggle.textContent = "Pause";
  playbackTimer = window.setInterval(() => {
    const elapsed = performance.now() - playbackStartedAt;
    const nextTime = playbackStartTime + elapsed;
    const duration = Number(els.duration.value) || state.duration_ms;
    if (nextTime >= duration) {
      setCurrentTime(duration);
      stopPlayback(false);
      return;
    }
    setCurrentTime(nextTime);
  }, 33);
}

function stopPlayback(resetToStart) {
  if (playbackTimer) {
    window.clearInterval(playbackTimer);
    playbackTimer = null;
  }
  els.playToggle.textContent = "Play";
  if (resetToStart) {
    setCurrentTime(0);
  }
}

function downloadJson() {
  const json = JSON.stringify(motionJson(), null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${sanitizeName(els.name.value)}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setStatus("JSON exported");
}

async function copyJson() {
  try {
    await navigator.clipboard.writeText(JSON.stringify(motionJson(), null, 2));
    setStatus("JSON copied");
  } catch (error) {
    els.jsonOutput.select();
    setStatus("Clipboard unavailable; JSON selected");
  }
}

function normalizeImportedTrack(trackName, events) {
  if (!Array.isArray(events)) {
    return [];
  }
  if (trackName === "avatar") {
    return events
      .filter((event) => FACE_NAMES.includes(event.face))
      .map((event) => ({
        time_ms: clamp(Number(event.time_ms) || 0, 0, 30000),
        face: event.face,
      }));
  }
  if (trackName === "leds") {
    return events
      .filter((event) => Array.isArray(event.colors))
      .map((event) => ({
        time_ms: clamp(Number(event.time_ms) || 0, 0, 30000),
        colors: event.colors.slice(0, LED_COUNT).map((rgb) => {
          if (!Array.isArray(rgb) || rgb.length !== 3) {
            return [...DEFAULT_LED];
          }
          return rgb.map((channel) => clamp(Math.round(Number(channel) || 0), 0, 255));
        }),
        transition_ms: clamp(Number(event.transition_ms) || 0, 0, 10000),
      }))
      .map((event) => ({
        ...event,
        colors: event.colors.length === LED_COUNT
          ? event.colors
          : event.colors.concat(fillColor(DEFAULT_LED).slice(event.colors.length)),
      }));
  }
  return events.map((event) => ({
    time_ms: clamp(Number(event.time_ms) || 0, 0, 30000),
    yaw: clamp(Math.round(Number(event.yaw) || 0), -90, 90),
    pitch: clamp(Math.round(Number(event.pitch) || 0), 0, 88),
    duration_ms: clamp(Math.round(Number(event.duration_ms) || 240), 10, 10000),
    easing: "linear",
  }));
}

function importJson(file) {
  if (!file) {
    return;
  }
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    try {
      const parsed = JSON.parse(String(reader.result));
      state = {
        schema: parsed.schema || "stackchan.motion_template.v0",
        name: sanitizeName(parsed.name || "motion_template"),
        duration_ms: clamp(Number(parsed.duration_ms) || 1200, 100, 30000),
        tracks: {
          avatar: normalizeImportedTrack("avatar", parsed.tracks?.avatar),
          leds: normalizeImportedTrack("leds", parsed.tracks?.leds),
          servo: normalizeImportedTrack("servo", parsed.tracks?.servo),
        },
      };
      els.name.value = state.name;
      els.duration.value = String(state.duration_ms);
      selectedEvent = null;
      if (state.tracks.leds[0]) {
        draftLedColors = state.tracks.leds[0].colors.map((rgb) => [...rgb]);
      }
      setCurrentTime(0);
      renderDraftLeds();
      renderAll("JSON imported");
    } catch (error) {
      setStatus("Could not import JSON");
    }
  });
  reader.readAsText(file);
}

function bindEvents() {
  els.name.addEventListener("input", () => renderAll());
  els.duration.addEventListener("change", () => {
    setCurrentTime(currentTime);
    renderAll("Duration updated");
  });
  els.scrubber.addEventListener("input", () => setCurrentTime(Number(els.scrubber.value)));
  els.playToggle.addEventListener("click", startPlayback);
  els.stopPlayback.addEventListener("click", () => stopPlayback(true));
  els.deleteSelected.addEventListener("click", deleteSelectedEvent);
  els.avatarForm.addEventListener("submit", addAvatarEvent);
  els.ledForm.addEventListener("submit", addLedFrame);
  els.servoForm.addEventListener("submit", addServoEvent);
  els.paintApply.addEventListener("click", paintDraft);
  els.paintClear.addEventListener("click", () => {
    draftLedColors = fillColor(DEFAULT_LED);
    renderDraftLeds();
  });
  els.copyJson.addEventListener("click", copyJson);
  els.downloadJson.addEventListener("click", downloadJson);
  els.importJson.addEventListener("change", (event) => importJson(event.target.files[0]));
}

bindEvents();
renderDraftLeds();
setCurrentTime(0);
renderAll();
