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
  compareGrid: document.querySelector('#compare-grid'),
  previewA: document.querySelector('[data-field="preview-a"]'),
  previewB: document.querySelector('[data-field="preview-b"]'),
  previewFrameA: document.querySelector('[data-field="preview-frame-a"]'),
  previewFrameB: document.querySelector('[data-field="preview-frame-b"]'),
  filenameA: document.querySelector('[data-field="filename-a"]'),
  filenameB: document.querySelector('[data-field="filename-b"]'),
  outputPath: document.querySelector('[data-field="output-path"]'),
  exportMode: document.querySelector('[data-field="export-mode"]'),
  container: document.querySelector('[data-field="container"]'),
  codec: document.querySelector('[data-field="codec"]'),
  crf: document.querySelector('[data-field="crf"]'),
  resizeWidth: document.querySelector('[data-field="resize-width"]'),
  resizeHeight: document.querySelector('[data-field="resize-height"]'),
  keepAspect: document.querySelector('[data-field="keep-aspect"]'),
  fps: document.querySelector('[data-field="fps"]'),
  trimStartFrame: document.querySelector('[data-field="trim-start-frame"]'),
  trimEndFrame: document.querySelector('[data-field="trim-end-frame"]'),
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

function fileNameFromPath(path) {
  if (!path) return '';
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

function updateFileNames() {
  const nameA = fileNameFromPath(elements.pathA.value);
  const nameB = fileNameFromPath(elements.pathB.value);
  if (elements.filenameA) {
    elements.filenameA.textContent = nameA || 'Input A';
  }
  if (elements.filenameB) {
    elements.filenameB.textContent = nameB || 'Input B';
  }
  if (nameA && nameB && nameA === nameB) {
    if (elements.filenameA) elements.filenameA.textContent = `${nameA} (1)`;
    if (elements.filenameB) elements.filenameB.textContent = `${nameB} (2)`;
  }
}

function loadPreviews() {
  if (elements.pathA.value) {
    elements.previewA.src = toVideoSrc(elements.pathA.value);
    elements.previewA.dataset.sourcePath = elements.pathA.value;
    updateFileNames();
    elements.previewA.load();
    probe('a');
  }
  if (elements.pathB.value) {
    elements.previewB.src = toVideoSrc(elements.pathB.value);
    elements.previewB.dataset.sourcePath = elements.pathB.value;
    updateFileNames();
    elements.previewB.load();
    probe('b');
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

function formatMaybe(value, fallback = '-') {
  if (value === null || value === undefined || value === '') return fallback;
  return value;
}

function formatBitrate(value) {
  if (!value) return '-';
  const kbps = Number(value) / 1000;
  if (Number.isNaN(kbps)) return value;
  return `${kbps.toFixed(0)} kbps`;
}

function formatDuration(value) {
  if (!value && value !== 0) return '-';
  const seconds = Number(value);
  if (Number.isNaN(seconds)) return value;
  return `${seconds.toFixed(2)} s`;
}

function formatResolution(video) {
  if (!video?.width || !video?.height) return '-';
  return `${video.width}x${video.height}`;
}

function formatBytes(value) {
  if (value === null || value === undefined) return '-';
  const num = Number(value);
  if (Number.isNaN(num)) return value;
  if (num < 1024) return `${num} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = num;
  let unitIndex = -1;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

function setPreviewAspect(target, info) {
  if (target === 'a' && elements.previewFrameA) {
    elements.previewFrameA.dataset.hasInfo = info ? 'true' : 'false';
  }
  if (target === 'b' && elements.previewFrameB) {
    elements.previewFrameB.dataset.hasInfo = info ? 'true' : 'false';
  }
}

function renderCompare() {
  if (!state.infoA && !state.infoB) {
    elements.compareGrid.innerHTML = '<div class="placeholder">Load Input A and B to compare.</div>';
    return;
  }

  const infoA = state.infoA;
  const infoB = state.infoB;

  const rows = [
    ['File', fileNameFromPath(infoA?.file), fileNameFromPath(infoB?.file)],
    ['Size', formatBytes(infoA?.size_bytes), formatBytes(infoB?.size_bytes)],
    ['Container', formatMaybe(infoA?.container?.format_name), formatMaybe(infoB?.container?.format_name)],
    ['Duration', formatDuration(infoA?.container?.duration_sec), formatDuration(infoB?.container?.duration_sec)],
    ['Bitrate', formatBitrate(infoA?.container?.bitrate), formatBitrate(infoB?.container?.bitrate)],
    ['Video Codec', formatMaybe(infoA?.video?.codec_name), formatMaybe(infoB?.video?.codec_name)],
    ['Profile', formatMaybe(infoA?.video?.profile), formatMaybe(infoB?.video?.profile)],
    ['Resolution', formatResolution(infoA?.video), formatResolution(infoB?.video)],
    ['Pixel Format', formatMaybe(infoA?.video?.pix_fmt), formatMaybe(infoB?.video?.pix_fmt)],
    ['Color Space', formatMaybe(infoA?.video?.color_space), formatMaybe(infoB?.video?.color_space)],
    [
      'Frame Rate',
      infoA?.video?.fps ? `${infoA.video.fps.toFixed(3)} fps` : '-',
      infoB?.video?.fps ? `${infoB.video.fps.toFixed(3)} fps` : '-',
    ],
    ['Frame Count', formatMaybe(infoA?.video?.frame_count), formatMaybe(infoB?.video?.frame_count)],
    ['Audio Codec', formatMaybe(infoA?.audio?.codec_name), formatMaybe(infoB?.audio?.codec_name)],
    ['Channels', formatMaybe(infoA?.audio?.channels), formatMaybe(infoB?.audio?.channels)],
    [
      'Sample Rate',
      infoA?.audio?.sample_rate ? `${infoA.audio.sample_rate} Hz` : '-',
      infoB?.audio?.sample_rate ? `${infoB.audio.sample_rate} Hz` : '-',
    ],
    ['Audio Bitrate', formatBitrate(infoA?.audio?.bit_rate), formatBitrate(infoB?.audio?.bit_rate)],
  ];

  elements.compareGrid.innerHTML = `
    <table>
      <colgroup>
        <col style="width: 220px" />
        <col />
        <col />
      </colgroup>
      <tbody>
        <tr>
          <td>Field</td>
          <td>Input A</td>
          <td>Input B</td>
        </tr>
        ${rows
          .map(([label, a, b]) => {
            const same = String(a ?? '') === String(b ?? '');
            return `
              <tr>
                <td>${label}</td>
                <td class="${same ? 'same' : 'diff'}">${a ?? '-'}</td>
                <td class="${same ? 'same' : 'diff'}">${b ?? '-'}</td>
              </tr>
            `;
          })
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

function suggestOutputPath(inputPath) {
  if (!inputPath) return '';
  const ext = elements.container.value || 'mp4';
  const base = inputPath.replace(/\.[^/.]+$/, '');
  return `${base}_export.${ext}`;
}

function applyExportDefaultsFromInfo(info, target) {
  if (!info) return;
  const mode = elements.exportMode.value;
  if (mode === 'input-a' && target !== 'a') return;
  if (mode === 'input-b' && target !== 'b') return;

  if (!elements.outputPath.value.trim()) {
    elements.outputPath.value = suggestOutputPath(info.file);
  }

  if (info.video?.width) elements.resizeWidth.value = info.video.width;
  if (info.video?.height) elements.resizeHeight.value = info.video.height;
  if (info.video?.fps) elements.fps.value = info.video.fps.toFixed(3);
  if (elements.trimStartFrame.value.trim() === '') elements.trimStartFrame.value = '0';
  if (elements.trimEndFrame.value.trim() === '' && info.video?.frame_count) {
    elements.trimEndFrame.value = String(info.video.frame_count);
  }
}

function getActiveAspectRatio() {
  const mode = elements.exportMode.value;
  if (mode === 'input-a' && state.infoA?.video?.width && state.infoA?.video?.height) {
    return state.infoA.video.width / state.infoA.video.height;
  }
  if (mode === 'input-b' && state.infoB?.video?.width && state.infoB?.video?.height) {
    return state.infoB.video.width / state.infoB.video.height;
  }
  return null;
}

function updateLinkedResize(changed) {
  if (!elements.keepAspect.checked) return;
  const ratio = getActiveAspectRatio();
  if (!ratio) return;

  if (changed === 'width') {
    const width = numberValue(elements.resizeWidth);
    if (width) elements.resizeHeight.value = Math.max(1, Math.round(width / ratio));
  } else if (changed === 'height') {
    const height = numberValue(elements.resizeHeight);
    if (height) elements.resizeWidth.value = Math.max(1, Math.round(height * ratio));
  }
}

function updateExportModeUI() {
  const isSideBySide = elements.exportMode.value === 'side-by-side';
  const controls = [
    elements.resizeWidth,
    elements.resizeHeight,
    elements.keepAspect,
    elements.fps,
    elements.trimStartFrame,
    elements.trimEndFrame,
  ];
  for (const control of controls) {
    if (!control) continue;
    control.disabled = isSideBySide;
  }
  if (isSideBySide) {
    elements.resizeWidth.value = '';
    elements.resizeHeight.value = '';
    elements.fps.value = '';
    elements.trimStartFrame.value = '';
    elements.trimEndFrame.value = '';
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
    } else {
      state.infoB = info;
    }
    setPreviewAspect(target, info);
    applyExportDefaultsFromInfo(info, target);
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

function evenize(value) {
  if (!value) return value;
  return value % 2 === 0 ? value : value - 1;
}

function computeStackHeight() {
  const heightA = state.infoA?.video?.height ?? null;
  const heightB = state.infoB?.video?.height ?? null;
  if (!heightA || !heightB) return null;
  return evenize(Math.min(heightA, heightB));
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

  const isSideBySide = exportMode === 'side-by-side';

  const stackHeight = isSideBySide ? computeStackHeight() : null;
  if (isSideBySide) {
    if (!state.infoA || !state.infoB) {
      setStatus('Load both inputs before exporting side-by-side.');
      return;
    }
    if (!stackHeight) {
      setStatus('Unable to determine matching heights for side-by-side export.');
      return;
    }
  }

  const payload = {
    inputPathA,
    inputPathB,
    exportMode,
    outputPath,
    codec: elements.codec.value,
    crf: Number(elements.crf.value),
    resizeWidth: isSideBySide ? null : numberValue(elements.resizeWidth),
    resizeHeight: isSideBySide ? null : numberValue(elements.resizeHeight),
    keepAspect: elements.keepAspect.checked,
    fps: isSideBySide ? null : numberValue(elements.fps),
    trimStartFrame: isSideBySide ? null : numberValue(elements.trimStartFrame),
    trimEndFrame: isSideBySide ? null : numberValue(elements.trimEndFrame),
    audioCopy: elements.audioCopy.checked,
    stackHeight,
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
    const result = await tauri.core.invoke('export_video', { params: payload });
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
  if (!state.exportOutput) return;
  try {
    if (tauri?.opener?.open) {
      await tauri.opener.open(state.exportOutput);
      return;
    }
    if (tauri?.core?.invoke) {
      await tauri.core.invoke('plugin:opener|reveal_item_in_dir', { paths: [state.exportOutput] });
      return;
    }
    setStatus('Open folder is unavailable in this build.');
  } catch (err) {
    setStatus(`Failed to open output folder: ${String(err)}`);
  }
}

function setupListeners() {
  document.querySelectorAll('[data-action="browse"]').forEach((button) => {
    button.addEventListener('click', () => browseFile(button.dataset.target));
  });

  document.querySelector('[data-action="play-both"]').addEventListener('click', playBoth);
  document.querySelector('[data-action="pause-both"]').addEventListener('click', pauseBoth);
  document.querySelector('[data-action="reset-both"]').addEventListener('click', resetBoth);
  document.querySelector('[data-action="output-browse"]').addEventListener('click', browseOutput);
  document.querySelector('[data-action="export"]').addEventListener('click', startExport);
  elements.cancelButton.addEventListener('click', cancelExport);
  elements.openOutputButton.addEventListener('click', openOutputFolder);

  elements.container.addEventListener('change', updateOutputPathExtension);
  elements.exportMode.addEventListener('change', () => {
    updateExportModeUI();
    if (elements.exportMode.value === 'input-a' && state.infoA) {
      applyExportDefaultsFromInfo(state.infoA, 'a');
    }
    if (elements.exportMode.value === 'input-b' && state.infoB) {
      applyExportDefaultsFromInfo(state.infoB, 'b');
    }
  });

  elements.resizeWidth.addEventListener('input', () => updateLinkedResize('width'));
  elements.resizeHeight.addEventListener('input', () => updateLinkedResize('height'));

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

  elements.pathA.addEventListener('change', () => {
    updateFileNames();
    loadPreviews();
  });
  elements.pathB.addEventListener('change', () => {
    updateFileNames();
    loadPreviews();
  });

  [elements.previewA, elements.previewB].forEach((video) => {
    if (!video) return;
    video.addEventListener('error', () => {
      const src = video.dataset.sourcePath || video.currentSrc || video.src || 'unknown';
      const detail = video.error ? ` (code ${video.error.code})` : '';
      setStatus(`Preview failed to load: ${src}${detail}`);
    });
  });

  if (tauri?.event?.listen) {
    tauri.event.listen('export-progress', (event) => {
      const { export_id, progress, out_time_ms, message } = event.payload;
      if (export_id !== state.exportId) return;
      if (progress === 'error') {
        elements.progressText.textContent = 'Failed';
        elements.cancelButton.disabled = true;
        const detail = message ? `: ${message}` : '.';
        setStatus(`Export failed${detail}`);
        return;
      }
      if (out_time_ms) {
        const seconds = out_time_ms / 1000000;
        elements.progressText.textContent = `Processed ${seconds.toFixed(1)}s`;
      }
      if (progress === 'end') {
        elements.progress.value = 100;
        elements.progressText.textContent = 'Done';
        elements.cancelButton.disabled = true;
        elements.openOutputButton.disabled = false;
        setStatus('Export complete.', false);
      } else {
        const nextValue = Math.min(95, elements.progress.value + 1);
        elements.progress.value = nextValue;
      }
    });
  }
}

function init() {
  renderCompare();
  updateExportModeUI();
  setupListeners();
}

init();
