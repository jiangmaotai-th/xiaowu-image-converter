use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::commands::ConvertSettings;
use crate::compress;
use crate::imagemagick;
use crate::photoshop;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewRequest {
    pub id: String,
    pub input_path: String,
    pub settings: ConvertSettings,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewResult {
    pub id: String,
    pub preview_size: Option<u64>,
    pub success: bool,
    pub error: Option<String>,
    pub warning: Option<String>,
}

pub fn preview_sizes(requests: Vec<PreviewRequest>) -> Vec<PreviewResult> {
    requests.into_iter().map(preview_one).collect()
}

fn preview_one(request: PreviewRequest) -> PreviewResult {
    match preview_size(&request.input_path, &request.settings) {
        Ok(estimate) => PreviewResult {
            id: request.id,
            preview_size: Some(estimate.size),
            success: true,
            error: None,
            warning: estimate.warning,
        },
        Err(error) => PreviewResult {
            id: request.id,
            preview_size: None,
            success: false,
            error: Some(error),
            warning: None,
        },
    }
}

struct PreviewEstimate {
    size: u64,
    warning: Option<String>,
}

struct TempPreviewFile {
    path: PathBuf,
}

impl TempPreviewFile {
    fn new(input: &Path) -> Self {
        Self {
            path: preview_temp_path(input),
        }
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TempPreviewFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

fn preview_size(input_path: &str, settings: &ConvertSettings) -> Result<PreviewEstimate, String> {
    let input = PathBuf::from(input_path);
    let output = TempPreviewFile::new(&input);
    let target = compress::compression_target_bytes(settings);
    let uses_photoshop_output = is_psd_like(&input) && settings.mode != "imagemagick";
    let min_quality = preview_quality(settings.min_quality, uses_photoshop_output).clamp(
        1,
        preview_quality(settings.jpeg_quality, uses_photoshop_output),
    );
    let mut quality = preview_quality(settings.jpeg_quality, uses_photoshop_output);
    let mut best_size: Option<u64> = None;

    loop {
        sips_convert(&input, output.path(), quality)?;
        let size = fs::metadata(output.path())
            .map_err(|error| format!("读取预览文件失败：{error}"))?
            .len();
        best_size = Some(best_size.map_or(size, |best| best.min(size)));

        if size <= target {
            return Ok(PreviewEstimate {
                size,
                warning: None,
            });
        }

        if quality <= min_quality {
            let best_size = best_size.unwrap_or(size);
            let (final_size, warning) =
                final_preview_size(&input, output.path(), settings, best_size, target)?;
            return Ok(PreviewEstimate {
                size: final_size,
                warning,
            });
        }

        quality = quality.saturating_sub(5).max(min_quality);
    }
}

fn final_preview_size(
    input: &Path,
    output: &Path,
    settings: &ConvertSettings,
    best_size: u64,
    target: u64,
) -> Result<(u64, Option<String>), String> {
    if best_size <= target {
        return Ok((best_size, None));
    }

    if let Ok(size) = try_magick_preview_compress(output, settings) {
        if size <= target {
            return Ok((size, None));
        }
    }

    if settings.allow_resize {
        if let Some(size) = try_sips_resize_preview(input, output, settings, target)? {
            return Ok((size, None));
        }
    }

    Ok((
        best_size,
        Some("最低质量仍超目标；请勾选允许缩小尺寸".to_string()),
    ))
}

fn sips_convert(input: &Path, output: &Path, quality: u8) -> Result<(), String> {
    sips_convert_with_width(input, output, quality, None)
}

fn sips_convert_with_width(
    input: &Path,
    output: &Path,
    quality: u8,
    width: Option<u32>,
) -> Result<(), String> {
    let mut command = Command::new("sips");
    command
        .arg("-s")
        .arg("format")
        .arg("jpeg")
        .arg("-s")
        .arg("formatOptions")
        .arg(quality.to_string());

    if let Some(width) = width {
        command.arg("--resampleWidth").arg(width.to_string());
    }

    let result = command
        .arg(input)
        .arg("--out")
        .arg(output)
        .output()
        .map_err(|error| format!("系统预览转换失败：{error}"))?;

    if result.status.success() && output.exists() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&result.stderr);
    Err(format!("系统预览转换失败：{}", stderr.trim()))
}

fn try_sips_resize_preview(
    input: &Path,
    output: &Path,
    settings: &ConvertSettings,
    target: u64,
) -> Result<Option<u64>, String> {
    let Some(width) = read_sips_dimension(input, "pixelWidth")? else {
        return Ok(None);
    };
    let uses_photoshop_output = is_psd_like(input) && settings.mode != "imagemagick";
    let quality = preview_quality(settings.min_quality, uses_photoshop_output).clamp(
        1,
        preview_quality(settings.jpeg_quality, uses_photoshop_output),
    );
    let mut best_size: Option<u64> = None;

    for percent in [95_u32, 90, 85, 80, 75, 70, 65, 60, 55, 50, 45, 40] {
        let next_width = ((width as f64) * (percent as f64 / 100.0)).round().max(1.0) as u32;
        sips_convert_with_width(input, output, quality, Some(next_width))?;
        let size = fs::metadata(output)
            .map_err(|error| format!("读取缩小预览失败：{error}"))?
            .len();
        best_size = Some(best_size.map_or(size, |best| best.min(size)));
        if size <= target {
            return Ok(Some(size));
        }
    }

    Ok(best_size)
}

fn preview_quality(ui_quality: u8, uses_photoshop_output: bool) -> u8 {
    if !uses_photoshop_output {
        return ui_quality.clamp(1, 100);
    }

    let photoshop_quality = photoshop::photoshop_quality(ui_quality);
    ((photoshop_quality as f32 / 12.0) * 100.0)
        .round()
        .clamp(1.0, 100.0) as u8
}

fn is_psd_like(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase())
            .as_deref(),
        Some("psd" | "psb")
    )
}

fn read_sips_dimension(input: &Path, key: &str) -> Result<Option<u32>, String> {
    let output = Command::new("sips")
        .arg("-g")
        .arg(key)
        .arg(input)
        .output()
        .map_err(|error| format!("读取图片尺寸失败：{error}"))?;

    if !output.status.success() {
        return Ok(None);
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(stdout.lines().find_map(|line| {
        line.trim()
            .strip_prefix(key)
            .and_then(|value| value.trim_start_matches(':').trim().parse::<u32>().ok())
    }))
}

fn try_magick_preview_compress(path: &Path, settings: &ConvertSettings) -> Result<u64, String> {
    let Some(binary) = imagemagick::detect_magick() else {
        return fs::metadata(path)
            .map(|metadata| metadata.len())
            .map_err(|error| format!("读取预览文件失败：{error}"));
    };

    let validation = compress::validate_or_compress_with_magick(&binary, path, settings)?;
    Ok(validation.size)
}

fn preview_temp_path(input: &Path) -> PathBuf {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or_default();
    let stem = input
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("preview");

    std::env::temp_dir().join(format!("xiaowu-preview-{stem}-{timestamp}.jpg"))
}
