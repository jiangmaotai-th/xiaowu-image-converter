use std::fs;
use std::path::Path;

use crate::commands::ConvertSettings;
use crate::imagemagick;
use crate::validation::{self, ValidationResult};

pub fn target_bytes(settings: &ConvertSettings) -> u64 {
    (settings.target_size_mb * 1024.0 * 1024.0).round().max(1.0) as u64
}

pub fn compression_target_bytes(settings: &ConvertSettings) -> u64 {
    ((target_bytes(settings) as f64) * 0.95).round().max(1.0) as u64
}

pub fn validate_or_compress_with_magick(
    magick: &Path,
    path: &Path,
    settings: &ConvertSettings,
) -> Result<ValidationResult, String> {
    let target = compression_target_bytes(settings);
    let mut validation = validation::validate_jpeg(path, target)?;
    if validation.under_target {
        return Ok(validation);
    }

    let min_quality = settings.min_quality.clamp(1, settings.jpeg_quality);
    let mut quality = settings.jpeg_quality;

    while quality > min_quality {
        quality = quality.saturating_sub(5).max(min_quality);
        recompress_atomically(magick, path, quality, None)?;
        validation = validation::validate_jpeg(path, target)?;
        if validation.under_target {
            return Ok(validation);
        }
    }

    if settings.allow_resize {
        for percent in [95, 90, 85, 80, 75, 70, 65, 60, 55, 50] {
            recompress_atomically(magick, path, min_quality, Some(percent))?;
            validation = validation::validate_jpeg(path, target)?;
            if validation.under_target {
                return Ok(validation);
            }
        }
    }

    Err("已降到最低质量仍超过目标大小；请允许缩小图片尺寸或提高目标大小".to_string())
}

fn recompress_atomically(
    magick: &Path,
    path: &Path,
    quality: u8,
    resize_percent: Option<u8>,
) -> Result<(), String> {
    let temp = path.with_extension("tmp.jpeg");
    imagemagick::recompress_jpeg(magick, path, &temp, quality, resize_percent)?;
    validation::validate_jpeg(&temp, u64::MAX)?;
    fs::rename(&temp, path).map_err(|error| format!("替换压缩结果失败：{error}"))?;
    Ok(())
}
