const tauri = window.__TAURI__;

const state = {
  infoA: null,
  infoB: null,
  exportId: null,
  exportOutput: null,
};

const elements = {
  pathA: document.querySelector('[data-field="path-a"]'),
  pathB: document.querySelector('[data-field="path-b"]'),
  resultsA: document.querySelector('[data-results="a"]'),
  resultsB: document.querySelector('[data-results="b"]'),
  compareGrid: document.querySelector('#compare-grid'),
  previewA: document.querySelector('[data-field="preview-a"]'),
  previewB: document.querySelector('[data-field="preview-b"]'),
  outputPath: document.querySelector('[data-field="output-path"]'),
  exportMode: document.querySelector('[data-field="export-mode"]'),
  container: document.querySelector('[data-field="container"]'),
  codec: document.querySelector('[data-field="codec"]'),
  crf: document.querySelector('[data-field="crf"]'),
  resizeWidth: document.querySelector('[data-field="resize-width"]'),
  resizeHeight: document.querySelector('[data-field="resize-height"]'),
  keepAspect: document.querySelector('[data-field="keep-aspect"]'),
  fps: document.querySelector('[data-field="fps"]'),
  trimStartSec: document.querySelector('[data-field="trim-start-sec"]'),
  trimDurationSec: document.querySelector('[data-field="trim-duration-sec"]'),
  trimStartFrame: document.querySelector('[data-field="trim-start-frame"]'),
  trimFrameCount: document.querySelector('[data-field="trim-frame-count"]'),
  shortenFrames: document.querySelector('[data-field="shorten-frames"]'),
  audioCopy: document.querySelector('[data-field="audio-copy"]'),
  progress: document.querySelector('progress'),
  progressText: document.querySelector('[data-field="progress-text"]'),
  status: document.querySelector('[data-field="status"]'),
  cancelButton: document.querySelector('[data-action="cancel"]'),
  openOutputButton: document.querySelector('[data-action="open-output"]'),
};

function setStatus(message, isError = true) {
  elements.status.textContent = message;
  elements.status.style.color = isError ? '#f87171' : '#38bdf8';
}

function toVideoSrc(path) {
  if (!path) return '';
  if (tauri?.core?.convertFileSrc) {
    return tauri.core.convertFileSrc(path);
  }
  return `file://${path.replace(/\\/g, '/')}`;
}

function loadPreviews() {
  if (elements.pathA.value) {
    elements.previewA.src = toVideoSrc(elements.pathA.value);
    elements.previewA.load();
  }
  if (elements.pathB.value) {
    elements.previewB.src = toVideoSrc(elements.pathB.value);
    elements.previewB.load();
  }
}

function mediaElements() {
  return [elements.previewA, elements.previewB].filter((video) => video?.src);
}

async function playBoth() {
  const videos = mediaElements();
  if (videos.length === 0) {
    setStatus('Load previews first.');
    return;
  }
  const targetTime = Math.min(...videos.map((video) => video.currentTime || 0));
  for (const video of videos) {
    video.currentTime = targetTime;
  }
  await Promise.all(videos.map((video) => video.play().catch(() => null)));
}

function pauseBoth() {
  for (const video of mediaElements()) {
    video.pause();
  }
}

function resetBoth() {
  for (const video of mediaElements()) {
    video.pause();
    video.currentTime = 0;
  }
}

function formatMaybe(value, fallback = '—') {
  if (value === null || value === undefined || value === '') return fallback;
  return value;
}

function formatBitrate(value) {
  if (!value) return '—';
  const kbps = Number(value) / 1000;
  if (Number.isNaN(kbps)) return value;
  return `${kbps.toFixed(0)} kbps`;
}

function formatDuration(value) {
  if (!value && value !== 0) return '—';
  const seconds = Number(value);
  if (Number.isNaN(seconds)) return value;
  return `${seconds.toFixed(2)} s`;
}

function formatResolution(video) {
  if (!video?.width || !video?.height) return '—';
  return `${video.width}×${video.height}`;
}

function renderResults(container, info) {
  if (!info) {
    container.innerHTML = '<div class="placeholder">No probe results yet.</div>';
    return;
  }

  const rows = [
    ['File', info.file],
    ['Size', info.size_bytes ? `${info.size_bytes} bytes` : '—'],
    ['Container', formatMaybe(info.container.format_name)],
    ['Duration', formatDuration(info.container.duration_sec)],
    ['Bitrate', formatBitrate(info.container.bitrate)],
    ['Video Codec', formatMaybe(info.video?.codec_name)],
    ['Profile', formatMaybe(info.video?.profile)],
    ['Resolution', formatResolution(info.video)],
    ['Pixel Format', formatMaybe(info.video?.pix_fmt)],
    ['Color Space', formatMaybe(info.video?.color_space)],
    ['Frame Rate', info.video?.fps ? `${info.video.fps.toFixed(3)} fps` : '—'],
    ['Frame Count', formatMaybe(info.video?.frame_count)],
    ['Audio Codec', formatMaybe(info.audio?.codec_name)],
    ['Channels', formatMaybe(info.audio?.channels)],
    ['Sample Rate', info.audio?.sample_rate ? `${info.audio.sample_rate} Hz` : '—'],
    ['Audio Bitrate', formatBitrate(info.audio?.bit_rate)],
  ];

  container.innerHTML = `
    <table>
      <tbody>
        ${rows
          .map(
            ([label, value]) => `
              <tr>
                <td>${label}</td>
                <td>${value ?? '—'}</td>
              </tr>
            `,
          )
          .join('')}
      </tbody>
    </table>
  `;
}

function computeDiffs(infoA, infoB) {
  const fields = [
    ['Resolution', formatResolution(infoA.video), formatResolution(infoB.video)],
    ['FPS', infoA.video?.fps?.toFixed(3), infoB.video?.fps?.toFixed(3)],
    ['Duration', formatDuration(infoA.container.duration_sec), formatDuration(infoB.container.duration_sec)],
    ['Frame Count', infoA.video?.frame_count, infoB.video?.frame_count],
    ['Codec', infoA.video?.codec_name, infoB.video?.codec_name],
    ['Bitrate', formatBitrate(infoA.video?.bit_rate), formatBitrate(infoB.video?.bit_rate)],
    ['Pixel Format', infoA.video?.pix_fmt, infoB.video?.pix_fmt],
  ];

  return fields.map(([label, a, b]) => {
    const same = String(a ?? '') === String(b ?? '');
    return { label, a: a ?? '—', b: b ?? '—', same };
  });
}

function renderCompare() {
  if (!state.infoA || !state.infoB) {
    elements.compareGrid.innerHTML = '<div class="placeholder">Load Input A and B to compare.</div>';
    return;
  }

  const diffs = computeDiffs(state.infoA, state.infoB);
  const resolutionA = formatResolution(state.infoA.video);
  const resolutionB = formatResolution(state.infoB.video);
  const oddSize =
    (state.infoA.video?.height && state.infoA.video.height % 2 !== 0) ||
    (state.infoB.video?.height && state.infoB.video.height % 2 !== 0) ||
    (state.infoA.video?.width && state.infoA.video.width % 2 !== 0) ||
    (state.infoB.video?.width && state.infoB.video.width % 2 !== 0);

  const extra = oddSize ? ' (odd dimensions detected)' : '';

  elements.compareGrid.innerHTML = `
    <table>
      <tbody>
        <tr>
          <td>Field</td>
          <td>Input A</td>
          <td>Input B</td>
        </tr>
        <tr>
          <td>Resolution label</td>
          <td class="${resolutionA === resolutionB ? 'same' : 'diff'}">${resolutionA}${extra}</td>
          <td class="${resolutionA === resolutionB ? 'same' : 'diff'}">${resolutionB}${extra}</td>
        </tr>
        ${diffs
          .map(
            ({ label, a, b, same }) => `
              <tr>
                <td>${label}</td>
                <td class="${same ? 'same' : 'diff'}">${a}</td>
                <td class="${same ? 'same' : 'diff'}">${b}</td>
              </tr>
            `,
          )
          .join('')}
      </tbody>
    </table>
  `;
}

async function browseFile(target) {
  if (!tauri?.dialog) {
    setStatus('Tauri dialog API not available.');
    return;
  }
  const path = await tauri.dialog.open({
    multiple: false,
    filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'avi', 'webm'] }],
  });
  if (typeof path === 'string') {
    if (target === 'a') elements.pathA.value = path;
    if (target === 'b') elements.pathB.value = path;
    loadPreviews();
  }
}

async function probe(target) {
  const path = target === 'a' ? elements.pathA.value : elements.pathB.value;
  if (!path) {
    setStatus('Please select a video file first.');
    return;
  }
  if (!tauri?.core) {
    setStatus('Tauri invoke API not available.');
    return;
  }
  setStatus('');
  try {
    const info = await tauri.core.invoke('probe_video', { path });
    if (target === 'a') {
      state.infoA = info;
      renderResults(elements.resultsA, info);
    } else {
      state.infoB = info;
      renderResults(elements.resultsB, info);
    }
    renderCompare();
  } catch (error) {
    setStatus(String(error));
  }
}

function updateOutputPathExtension() {
  const ext = elements.container.value;
  const current = elements.outputPath.value.trim();
  if (!current) return;
  const withoutExt = current.replace(/\.[^/.]+$/, '');
  elements.outputPath.value = `${withoutExt}.${ext}`;
}

async function browseOutput() {
  if (!tauri?.dialog) {
    setStatus('Tauri dialog API not available.');
    return;
  }
  const path = await tauri.dialog.save({
    defaultPath: `output.${elements.container.value}`,
  });
  if (typeof path === 'string') {
    elements.outputPath.value = path;
  }
}

function numberValue(input) {
  const value = input.value.trim();
  if (!value) return null;
  const num = Number(value);
  return Number.isNaN(num) ? null : num;
}

function validateExport(inputPathA, inputPathB, outputPath, mode) {
  if (mode === 'input-a' && !inputPathA) return 'Select an Input A file.';
  if (mode === 'input-b' && !inputPathB) return 'Select an Input B file.';
  if (mode === 'side-by-side' && (!inputPathA || !inputPathB)) {
    return 'Side-by-side export needs both Input A and Input B.';
  }
  if (!outputPath) return 'Choose an output file.';
  if (inputPathA === outputPath || inputPathB === outputPath) return 'Output must be different from input.';
  return null;
}

async function startExport() {
  if (!tauri?.core) {
    setStatus('Tauri invoke API not available.');
    return;
  }

  const inputPathA = elements.pathA.value.trim();
  const inputPathB = elements.pathB.value.trim();
  const exportMode = elements.exportMode.value;
  const outputPath = elements.outputPath.value.trim();
  const error = validateExport(inputPathA, inputPathB, outputPath, exportMode);
  if (error) {
    setStatus(error);
    return;
  }

  const payload = {
    inputPathA,
    inputPathB,
    exportMode,
    outputPath,
    codec: elements.codec.value,
    crf: Number(elements.crf.value),
    resizeWidth: numberValue(elements.resizeWidth),
    resizeHeight: numberValue(elements.resizeHeight),
    keepAspect: elements.keepAspect.checked,
    fps: numberValue(elements.fps),
    trimStartSec: numberValue(elements.trimStartSec),
    trimDurationSec: numberValue(elements.trimDurationSec),
    trimStartFrame: numberValue(elements.trimStartFrame),
    trimFrameCount: numberValue(elements.trimFrameCount),
    shortenToFrames: numberValue(elements.shortenFrames),
    audioCopy: elements.audioCopy.checked,
  };

  if (payload.resizeWidth && payload.resizeWidth % 2 !== 0) {
    setStatus('Warning: width is odd; consider using an even number.', false);
  }
  if (payload.resizeHeight && payload.resizeHeight % 2 !== 0) {
    setStatus('Warning: height is odd; consider using an even number.', false);
  }

  try {
    elements.cancelButton.disabled = false;
    elements.openOutputButton.disabled = true;
    elements.progress.value = 0;
    elements.progressText.textContent = 'Starting export...';
    const result = await tauri.core.invoke('export_video', payload);
    state.exportId = result.export_id;
    state.exportOutput = result.output_path;
    setStatus('Export started.', false);
  } catch (err) {
    elements.cancelButton.disabled = true;
    setStatus(String(err));
  }
}

async function cancelExport() {
  if (!state.exportId || !tauri?.core) return;
  try {
    await tauri.core.invoke('cancel_export', { export_id: state.exportId });
    setStatus('Export cancelled.', false);
  } catch (err) {
    setStatus(String(err));
  } finally {
    elements.cancelButton.disabled = true;
  }
}

async function openOutputFolder() {
  if (!state.exportOutput || !tauri?.opener) return;
  const folder = state.exportOutput.replace(/[/\\][^/\\]+$/, '');
  await tauri.opener.open(folder);
}

function setupListeners() {
  document.querySelectorAll('[data-action="browse"]').forEach((button) => {
    button.addEventListener('click', () => browseFile(button.dataset.target));
  });

  document.querySelectorAll('[data-action="probe"]').forEach((button) => {
    button.addEventListener('click', () => probe(button.dataset.target));
  });

  document.querySelector('[data-action="compare"]').addEventListener('click', renderCompare);
  document.querySelector('[data-action="load-previews"]').addEventListener('click', loadPreviews);
  document.querySelector('[data-action="play-both"]').addEventListener('click', playBoth);
  document.querySelector('[data-action="pause-both"]').addEventListener('click', pauseBoth);
  document.querySelector('[data-action="reset-both"]').addEventListener('click', resetBoth);
  document.querySelector('[data-action="output-browse"]').addEventListener('click', browseOutput);
  document.querySelector('[data-action="export"]').addEventListener('click', startExport);
  elements.cancelButton.addEventListener('click', cancelExport);
  elements.openOutputButton.addEventListener('click', openOutputFolder);

  elements.container.addEventListener('change', updateOutputPathExtension);

  ['input-a', 'input-b'].forEach((id) => {
    const panel = document.getElementById(id);
    panel.addEventListener('dragover', (event) => {
      event.preventDefault();
      panel.classList.add('dragover');
    });
    panel.addEventListener('dragleave', () => panel.classList.remove('dragover'));
    panel.addEventListener('drop', (event) => {
      event.preventDefault();
      panel.classList.remove('dragover');
      const file = event.dataTransfer?.files?.[0];
      if (file?.path) {
        if (id === 'input-a') elements.pathA.value = file.path;
        if (id === 'input-b') elements.pathB.value = file.path;
        loadPreviews();
      }
    });
  });

  if (tauri?.event?.listen) {
    tauri.event.listen('export-progress', (event) => {
      const { export_id, progress, out_time_ms } = event.payload;
      if (export_id !== state.exportId) return;
      if (out_time_ms) {
        const seconds = out_time_ms / 1000000;
        elements.progressText.textContent = `Processed ${seconds.toFixed(1)}s`;
      }
      if (progress === 'end') {
        elements.progress.value = 100;
        elements.progressText.textContent = 'Done';
        elements.cancelButton.disabled = true;
        elements.openOutputButton.disabled = false;
      } else {
        const nextValue = Math.min(95, elements.progress.value + 1);
        elements.progress.value = nextValue;
      }
    });
  }
}

function init() {
  renderResults(elements.resultsA, null);
  renderResults(elements.resultsB, null);
  renderCompare();
  setupListeners();
}

init();
