use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::Ordering;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::converter;
use crate::file_utils;
use crate::imagemagick;
use crate::photoshop;
use crate::preview;
use crate::AppState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolStatus {
    pub photoshop_available: bool,
    pub photoshop_app_name: Option<String>,
    pub photoshop_version: Option<String>,
    pub photoshop_path: Option<String>,
    pub imagemagick_available: bool,
    pub imagemagick_version: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FileInfo {
    pub path: String,
    pub name: String,
    pub extension: String,
    pub size: u64,
    pub is_file: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertSettings {
    pub output_format: String,
    pub target_size_mb: f64,
    pub jpeg_quality: u8,
    pub min_quality: u8,
    pub mode: String,
    pub output_directory: String,
    pub filename_suffix: String,
    pub concurrency: usize,
    pub allow_resize: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertJobRequest {
    pub id: String,
    pub input_path: String,
    pub output_directory: String,
    pub suffix: String,
    pub settings: ConvertSettings,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ConvertBatchRequest {
    pub jobs: Vec<ConvertJobRequest>,
    pub settings: ConvertSettings,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertEvent {
    pub id: String,
    pub status: String,
    pub progress: u8,
    pub output_path: Option<String>,
    pub output_size: Option<u64>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertResult {
    pub id: String,
    pub input_path: String,
    pub output_path: Option<String>,
    pub output_size: Option<u64>,
    pub success: bool,
    pub error: Option<String>,
}

#[tauri::command]
pub fn detect_tools() -> ToolStatus {
    let photoshop_app = photoshop::detect_photoshop_app();
    let magick = imagemagick::detect_magick();

    ToolStatus {
        photoshop_available: photoshop_app.is_some(),
        photoshop_app_name: photoshop_app.as_ref().map(|app| app.app_name.clone()),
        photoshop_version: photoshop_app.as_ref().map(|app| app.version.clone()),
        photoshop_path: photoshop_app.as_ref().map(|app| app.path.clone()),
        imagemagick_available: magick.is_some(),
        imagemagick_version: magick
            .as_ref()
            .and_then(|binary| imagemagick::magick_version(binary).ok()),
    }
}

#[tauri::command]
pub async fn install_imagemagick() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(install_imagemagick_blocking)
        .await
        .map_err(|error| format!("安装线程异常：{error}"))?
}

fn install_imagemagick_blocking() -> Result<String, String> {
    if imagemagick::detect_magick().is_some() {
        return Ok("ImageMagick 已安装。".to_string());
    }

    let brew = find_brew().ok_or(
        "未检测到 Homebrew，无法一键安装。请先安装 Homebrew，或手动运行：brew install imagemagick",
    )?;

    let output = Command::new(brew)
        .arg("install")
        .arg("imagemagick")
        .output()
        .map_err(|error| format!("执行 brew install imagemagick 失败：{error}"))?;

    if output.status.success() && imagemagick::detect_magick().is_some() {
        return Ok("ImageMagick 安装完成。".to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    Err(format!(
        "brew install imagemagick 未完成。\n{}\n{}",
        stdout.trim(),
        stderr.trim()
    ))
}

fn find_brew() -> Option<String> {
    ["/opt/homebrew/bin/brew", "/usr/local/bin/brew", "brew"]
        .iter()
        .find(|candidate| {
            Command::new(candidate)
                .arg("--version")
                .output()
                .map(|output| output.status.success())
                .unwrap_or(false)
        })
        .map(|candidate| candidate.to_string())
}

#[tauri::command]
pub fn collect_input_paths(paths: Vec<String>) -> Result<Vec<FileInfo>, String> {
    file_utils::collect_input_paths(paths.into_iter().map(PathBuf::from).collect())
}

#[tauri::command]
pub async fn convert_batch(
    app: AppHandle,
    state: State<'_, AppState>,
    request: ConvertBatchRequest,
) -> Result<Vec<ConvertResult>, String> {
    state.cancel_requested.store(false, Ordering::SeqCst);

    let cancel_flag = state.cancel_requested.clone();
    tauri::async_runtime::spawn_blocking(move || {
        converter::convert_batch_blocking(app, request, cancel_flag)
    })
    .await
    .map_err(|error| format!("转换线程异常：{error}"))?
}

#[tauri::command]
pub async fn preview_sizes(
    requests: Vec<preview::PreviewRequest>,
) -> Result<Vec<preview::PreviewResult>, String> {
    tauri::async_runtime::spawn_blocking(move || preview::preview_sizes(requests))
        .await
        .map_err(|error| format!("预览线程异常：{error}"))
}

#[tauri::command]
pub fn cancel_conversion(state: State<'_, AppState>) {
    state.cancel_requested.store(true, Ordering::SeqCst);
}

#[tauri::command]
pub fn open_output_folder(path: String) -> Result<(), String> {
    Command::new("open")
        .arg(path)
        .status()
        .map_err(|error| format!("无法打开输出文件夹：{error}"))?;
    Ok(())
}

pub fn emit_progress(app: &AppHandle, event: ConvertEvent) {
    let _ = app.emit("convert-progress", event);
}
