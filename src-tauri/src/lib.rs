use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;

#[derive(Default)]
struct ExportManager {
    children: Arc<Mutex<HashMap<String, Child>>>,
}

#[derive(Serialize)]
struct ContainerInfo {
    format_name: Option<String>,
    duration_sec: Option<f64>,
    bitrate: Option<u64>,
}

#[derive(Serialize)]
struct VideoStreamInfo {
    codec_name: Option<String>,
    profile: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    pix_fmt: Option<String>,
    color_space: Option<String>,
    color_range: Option<String>,
    color_transfer: Option<String>,
    color_primaries: Option<String>,
    bit_rate: Option<u64>,
    avg_frame_rate: Option<String>,
    r_frame_rate: Option<String>,
    fps: Option<f64>,
    frame_count: Option<u64>,
}

#[derive(Serialize)]
struct AudioStreamInfo {
    codec_name: Option<String>,
    channels: Option<u32>,
    sample_rate: Option<u32>,
    bit_rate: Option<u64>,
}

#[derive(Serialize)]
struct VideoInfo {
    file: String,
    size_bytes: Option<u64>,
    container: ContainerInfo,
    video: Option<VideoStreamInfo>,
    audio: Option<AudioStreamInfo>,
}

#[derive(Serialize)]
struct ExportStarted {
    export_id: String,
    command: String,
    output_path: String,
}

#[derive(Serialize, Clone)]
struct ExportProgress {
    export_id: String,
    progress: String,
    out_time_ms: Option<u64>,
    message: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportParams {
    input_path_a: Option<String>,
    input_path_b: Option<String>,
    export_mode: String,
    output_path: String,
    codec: String,
    crf: u8,
    resize_width: Option<u32>,
    resize_height: Option<u32>,
    keep_aspect: bool,
    fps: Option<f64>,
    trim_start_frame: Option<u64>,
    trim_end_frame: Option<u64>,
    label_a: Option<String>,
    label_b: Option<String>,
    audio_copy: bool,
    stack_height: Option<u32>,
}

const CREATE_NO_WINDOW: u32 = 0x08000000;

fn escape_drawtext(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace(':', "\\:")
        .replace('%', "\\%")
        .replace('\'', "\\'")
}

fn label_filters(label: &str) -> Vec<String> {
    let trimmed = label.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }

    let text = escape_drawtext(trimmed);
    let mut drawtext = String::new();
    drawtext.push_str("font='Segoe UI':");
    drawtext.push_str(&format!(
        "text='{text}':fontcolor=white:fontsize=h*0.055:x=(w-text_w)/2:y=h-(text_h*1.6)"
    ));

    vec![
        "drawbox=x=0:y=ih*0.86:w=iw:h=ih*0.14:color=black@0.45:t=fill".to_string(),
        format!("drawtext={drawtext}"),
    ]
}

fn resolve_bundled_binary(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    let dev_path = PathBuf::from("binaries").join(name);
    let repo_dev_path = PathBuf::from("src-tauri").join("binaries").join(name);
    if dev_path.exists() {
        return Ok(dev_path);
    }
    if repo_dev_path.exists() {
        return Ok(repo_dev_path);
    }

    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to resolve resource_dir: {}", e))?;
    let prod_path = resource_dir.join("binaries").join(name);

    if prod_path.exists() {
        return Ok(prod_path);
    }

    Err(format!(
    "Bundled binary not found: {} (looked in {:?}, {:?}, and {:?}). Run scripts/setup-ffmpeg.ps1 to install.",
    name, dev_path, repo_dev_path, prod_path
  ))
}

fn parse_u64(value: &serde_json::Value) -> Option<u64> {
    match value {
        serde_json::Value::String(text) => text.parse::<u64>().ok(),
        serde_json::Value::Number(num) => num.as_u64(),
        _ => None,
    }
}

fn parse_f64(value: &serde_json::Value) -> Option<f64> {
    match value {
        serde_json::Value::String(text) => text.parse::<f64>().ok(),
        serde_json::Value::Number(num) => num.as_f64(),
        _ => None,
    }
}

fn parse_fraction(value: &str) -> Option<f64> {
    if value == "0/0" {
        return None;
    }
    let mut parts = value.split('/');
    let num = parts.next()?.parse::<f64>().ok()?;
    let den = parts.next()?.parse::<f64>().ok()?;
    if den == 0.0 {
        return None;
    }
    Some(num / den)
}

fn build_command_string(executable: &PathBuf, args: &[String]) -> String {
    let mut parts = Vec::new();
    parts.push(format_arg(executable.to_string_lossy().as_ref()));
    for arg in args {
        parts.push(format_arg(arg));
    }
    parts.join(" ")
}

fn format_arg(value: &str) -> String {
    if value.contains(' ') {
        format!("\"{}\"", value.replace('"', "\\\""))
    } else {
        value.to_string()
    }
}

fn unique_output_path(path: &str) -> String {
    let candidate = Path::new(path);
    if !candidate.exists() {
        return path.to_string();
    }

    let parent = candidate.parent().unwrap_or_else(|| Path::new(""));
    let stem = candidate
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("output");
    let ext = candidate.extension().and_then(|e| e.to_str());

    for index in 1..1000 {
        let file_name = if let Some(ext) = ext {
            format!("{stem} ({index}).{ext}")
        } else {
            format!("{stem} ({index})")
        };
        let next = parent.join(file_name);
        if !next.exists() {
            return next.to_string_lossy().to_string();
        }
    }

    path.to_string()
}

#[tauri::command]
fn probe_video(app: AppHandle, path: String) -> Result<VideoInfo, String> {
    let ffprobe = resolve_bundled_binary(&app, "ffprobe.exe")?;

    let output = Command::new(ffprobe)
        .args([
            "-hide_banner",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            &path,
        ])
        .output()
        .map_err(|e| format!("Failed to run ffprobe: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(format!("ffprobe error:\n{}", stderr));
    }

    let json: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Failed to parse ffprobe output: {}", e))?;
    let format = json.get("format").cloned().unwrap_or_default();
    let streams = json
        .get("streams")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let video_stream = streams
        .iter()
        .find(|s| s.get("codec_type").and_then(|v| v.as_str()) == Some("video"));
    let audio_stream = streams
        .iter()
        .find(|s| s.get("codec_type").and_then(|v| v.as_str()) == Some("audio"));

    let avg_frame_rate = video_stream
        .and_then(|s| s.get("avg_frame_rate"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let r_frame_rate = video_stream
        .and_then(|s| s.get("r_frame_rate"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let fps = avg_frame_rate
        .as_deref()
        .and_then(parse_fraction)
        .or_else(|| r_frame_rate.as_deref().and_then(parse_fraction));

    let duration_sec = format.get("duration").and_then(parse_f64);

    let frame_count = video_stream
        .and_then(|s| s.get("nb_frames"))
        .and_then(parse_u64)
        .or_else(|| {
            if let (Some(duration), Some(fps_value)) = (duration_sec, fps) {
                Some((duration * fps_value).round() as u64)
            } else {
                None
            }
        });

    let size_bytes = format
        .get("size")
        .and_then(parse_u64)
        .or_else(|| fs::metadata(&path).map(|m| m.len()).ok());

    let container = ContainerInfo {
        format_name: format
            .get("format_name")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        duration_sec,
        bitrate: format.get("bit_rate").and_then(parse_u64),
    };

    let video = video_stream.map(|stream| VideoStreamInfo {
        codec_name: stream
            .get("codec_name")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        profile: stream
            .get("profile")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        width: stream
            .get("width")
            .and_then(|v| v.as_u64())
            .map(|v| v as u32),
        height: stream
            .get("height")
            .and_then(|v| v.as_u64())
            .map(|v| v as u32),
        pix_fmt: stream
            .get("pix_fmt")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        color_space: stream
            .get("color_space")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        color_range: stream
            .get("color_range")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        color_transfer: stream
            .get("color_transfer")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        color_primaries: stream
            .get("color_primaries")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        bit_rate: stream.get("bit_rate").and_then(parse_u64),
        avg_frame_rate,
        r_frame_rate,
        fps,
        frame_count,
    });

    let audio = audio_stream.map(|stream| AudioStreamInfo {
        codec_name: stream
            .get("codec_name")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        channels: stream
            .get("channels")
            .and_then(|v| v.as_u64())
            .map(|v| v as u32),
        sample_rate: stream
            .get("sample_rate")
            .and_then(|v| v.as_str())
            .and_then(|v| v.parse::<u32>().ok()),
        bit_rate: stream.get("bit_rate").and_then(parse_u64),
    });

    Ok(VideoInfo {
        file: path,
        size_bytes,
        container,
        video,
        audio,
    })
}

#[tauri::command]
fn export_video(
    app: AppHandle,
    export_manager: State<'_, ExportManager>,
    params: ExportParams,
) -> Result<ExportStarted, String> {
    let ffmpeg = resolve_bundled_binary(&app, "ffmpeg.exe")?;
    let export_mode = params.export_mode.as_str();
    let input_a = params.input_path_a.as_ref().filter(|path| !path.is_empty());
    let input_b = params.input_path_b.as_ref().filter(|path| !path.is_empty());

    let primary_input = match export_mode {
        "input-b" => input_b.ok_or_else(|| "Input B is required.".to_string())?,
        "side-by-side" | "input-a" => input_a.ok_or_else(|| "Input A is required.".to_string())?,
        _ => return Err("Unknown export mode.".to_string()),
    };

    let output_path = unique_output_path(&params.output_path);
    let mut args: Vec<String> = Vec::new();

    args.push("-i".to_string());
    args.push(primary_input.to_string());

    if export_mode == "side-by-side" {
        let second =
            input_b.ok_or_else(|| "Input B is required for side-by-side export.".to_string())?;
        args.push("-i".to_string());
        args.push(second.to_string());
    }

    let mut filters: Vec<String> = Vec::new();
    let mut uses_select = false;

    if let Some(end) = params.trim_end_frame {
        let start = params.trim_start_frame.unwrap_or(0);
        let end = end.max(start);
        filters.push(format!(
            "select=between(n\\,{start}\\,{end}),setpts=N/FRAME_RATE/TB"
        ));
        uses_select = true;
    }

    if let Some(fps) = params.fps {
        filters.push(format!("fps=fps={fps}"));
    }

    if params.resize_width.is_some() || params.resize_height.is_some() {
        let width = params
            .resize_width
            .map(|v| v.to_string())
            .unwrap_or_else(|| "-1".into());
        let height = params
            .resize_height
            .map(|v| v.to_string())
            .unwrap_or_else(|| "-1".into());
        let mut scale = format!("scale={width}:{height}:flags=lanczos");
        if params.keep_aspect {
            scale.push_str(":force_original_aspect_ratio=decrease");
        }
        filters.push(scale);
    }

    if export_mode == "side-by-side" {
        let mut left_filters: Vec<String> = Vec::new();
        let mut right_filters: Vec<String> = Vec::new();

        if !filters.is_empty() {
            left_filters.extend(filters.clone());
            right_filters.extend(filters.clone());
        }

        if let Some(height) = params.stack_height {
            // Use -2 to force even width for encoders like libx264.
            left_filters.push(format!("scale=-2:{height}:flags=lanczos"));
            right_filters.push(format!("scale=-2:{height}:flags=lanczos"));
        }

        if let Some(label) = params.label_a.as_deref() {
            left_filters.extend(label_filters(label));
        }
        if let Some(label) = params.label_b.as_deref() {
            right_filters.extend(label_filters(label));
        }

        let mut complex_filter = String::new();
        if !left_filters.is_empty() {
            complex_filter.push_str(&format!("[0:v]{}[left];", left_filters.join(",")));
        } else {
            complex_filter.push_str("[0:v]null[left];");
        }
        if !right_filters.is_empty() {
            complex_filter.push_str(&format!("[1:v]{}[right];", right_filters.join(",")));
        } else {
            complex_filter.push_str("[1:v]null[right];");
        }
        complex_filter.push_str("[left][right]hstack=inputs=2[vout]");
        args.push("-filter_complex".to_string());
        args.push(complex_filter);
        args.push("-map".to_string());
        args.push("[vout]".to_string());
        if params.audio_copy {
            args.push("-map".to_string());
            args.push("0:a?".to_string());
        }
    } else {
        let label = if export_mode == "input-b" {
            params.label_b.as_deref()
        } else {
            params.label_a.as_deref()
        };
        if let Some(label) = label {
            filters.extend(label_filters(label));
        }
        if !filters.is_empty() {
            args.push("-vf".to_string());
            args.push(filters.join(","));
        }
    }

    if uses_select {
        args.push("-vsync".to_string());
        args.push("vfr".to_string());
    }

    match params.codec.as_str() {
        "h265" => {
            args.push("-c:v".to_string());
            args.push("libx265".to_string());
        }
        _ => {
            args.push("-c:v".to_string());
            args.push("libx264".to_string());
        }
    }

    args.push("-crf".to_string());
    args.push(params.crf.to_string());

    if params.audio_copy {
        args.push("-c:a".to_string());
        args.push("copy".to_string());
    } else {
        args.push("-c:a".to_string());
        args.push("aac".to_string());
    }

    args.push("-y".to_string());
    args.push("-progress".to_string());
    args.push("pipe:1".to_string());
    args.push("-nostats".to_string());
    args.push(output_path.clone());

    let command_string = build_command_string(&ffmpeg, &args);

    let mut child = Command::new(ffmpeg)
        .args(&args)
        .creation_flags(CREATE_NO_WINDOW)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start ffmpeg: {}", e))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture ffmpeg stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to capture ffmpeg stderr".to_string())?;

    let export_id = Uuid::new_v4().to_string();
    {
        let mut children = export_manager.children.lock().map_err(|_| "Lock error")?;
        children.insert(export_id.clone(), child);
    }

    let app_handle = app.clone();

    let export_id_for_thread = export_id.clone();
    let children = export_manager.children.clone();
    let stderr_buffer = Arc::new(Mutex::new(String::new()));
    let stderr_clone = stderr_buffer.clone();
    thread::spawn(move || {
        let mut reader = BufReader::new(stderr);
        let mut buffer = String::new();
        let _ = reader.read_to_string(&mut buffer);
        if let Ok(mut slot) = stderr_clone.lock() {
            *slot = buffer;
        }
    });

    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        let mut out_time_ms: Option<u64> = None;

        for line in reader.lines().flatten() {
            if let Some((key, value)) = line.split_once('=') {
                if key == "out_time_ms" {
                    out_time_ms = value.parse::<u64>().ok();
                }
                if key == "progress" {
                    let payload = ExportProgress {
                        export_id: export_id_for_thread.clone(),
                        progress: value.to_string(),
                        out_time_ms,
                        message: None,
                    };
                    let _ = app_handle.emit("export-progress", payload);
                }
            }
        }

        if let Ok(mut map) = children.lock() {
            if let Some(mut child) = map.remove(&export_id_for_thread) {
                let status = child.wait();
                if let Ok(status) = status {
                    if !status.success() {
                        let message = stderr_buffer.lock().ok().and_then(|data| {
                            let trimmed = data.trim();
                            if trimmed.is_empty() {
                                None
                            } else {
                                let lines: Vec<&str> = trimmed.lines().collect();
                                let start = lines.len().saturating_sub(8);
                                Some(lines[start..].join("\n"))
                            }
                        });
                        let payload = ExportProgress {
                            export_id: export_id_for_thread.clone(),
                            progress: "error".to_string(),
                            out_time_ms: None,
                            message,
                        };
                        let _ = app_handle.emit("export-progress", payload);
                    }
                }
            }
        }
    });

    Ok(ExportStarted {
        export_id,
        command: command_string,
        output_path,
    })
}

#[tauri::command]
fn cancel_export(
    export_manager: State<'_, ExportManager>,
    export_id: String,
) -> Result<(), String> {
    let mut children = export_manager.children.lock().map_err(|_| "Lock error")?;
    if let Some(child) = children.get_mut(&export_id) {
        child
            .kill()
            .map_err(|e| format!("Failed to cancel export: {}", e))?;
    }
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(ExportManager::default())
        .invoke_handler(tauri::generate_handler![
            probe_video,
            export_video,
            cancel_export
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
