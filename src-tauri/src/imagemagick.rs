use std::path::{Path, PathBuf};
use std::process::Command;

pub fn detect_magick() -> Option<PathBuf> {
    let candidates = [
        "/opt/homebrew/bin/magick",
        "/usr/local/bin/magick",
        "/usr/bin/magick",
        "magick",
    ];

    candidates.iter().map(PathBuf::from).find(|candidate| {
        Command::new(candidate)
            .arg("-version")
            .output()
            .map(|out| out.status.success())
            .unwrap_or(false)
    })
}

pub fn magick_version(binary: &Path) -> Result<String, String> {
    let output = Command::new(binary)
        .arg("-version")
        .output()
        .map_err(|error| format!("执行 magick -version 失败：{error}"))?;
    let text = String::from_utf8_lossy(&output.stdout);
    Ok(text.lines().next().unwrap_or("ImageMagick").to_string())
}

pub fn convert_to_jpeg(
    binary: &Path,
    input: &Path,
    output: &Path,
    quality: u8,
    resize_percent: Option<u8>,
) -> Result<(), String> {
    let mut command = Command::new(binary);
    command.arg(format!("{}[0]", input.display()));
    command
        .arg("-auto-orient")
        .arg("-colorspace")
        .arg("sRGB")
        .arg("-background")
        .arg("white")
        .arg("-alpha")
        .arg("remove")
        .arg("-alpha")
        .arg("off")
        .arg("-flatten");

    if let Some(percent) = resize_percent {
        command.arg("-resize").arg(format!("{percent}%"));
    }

    let output = command
        .arg("-quality")
        .arg(quality.to_string())
        .arg(output)
        .output()
        .map_err(|error| format!("执行 ImageMagick 失败：{error}"))?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    Err(format!("ImageMagick 转换失败：{}", stderr.trim()))
}

pub fn recompress_jpeg(
    binary: &Path,
    input: &Path,
    output: &Path,
    quality: u8,
    resize_percent: Option<u8>,
) -> Result<(), String> {
    let mut command = Command::new(binary);
    command
        .arg(input)
        .arg("-auto-orient")
        .arg("-colorspace")
        .arg("sRGB");

    if let Some(percent) = resize_percent {
        command.arg("-resize").arg(format!("{percent}%"));
    }

    let output_result = command
        .arg("-quality")
        .arg(quality.to_string())
        .arg(output)
        .output()
        .map_err(|error| format!("执行 ImageMagick 压缩失败：{error}"))?;

    if output_result.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output_result.stderr);
        Err(format!("ImageMagick 压缩失败：{}", stderr.trim()))
    }
}
