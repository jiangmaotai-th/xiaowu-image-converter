use std::fs;
use std::path::Path;
use std::process::Command;

#[derive(Debug, Clone)]
pub struct ValidationResult {
    pub size: u64,
    pub width: u32,
    pub height: u32,
    pub under_target: bool,
}

pub fn validate_jpeg(path: &Path, target_bytes: u64) -> Result<ValidationResult, String> {
    let metadata = fs::metadata(path).map_err(|error| format!("输出文件不存在：{error}"))?;
    if metadata.len() == 0 {
        return Err("输出文件大小为 0".to_string());
    }

    let output = Command::new("sips")
        .arg("-g")
        .arg("pixelWidth")
        .arg("-g")
        .arg("pixelHeight")
        .arg(path)
        .output()
        .map_err(|error| format!("系统无法读取输出 JPEG：{error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("输出 JPEG 无法被系统读取：{}", stderr.trim()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let width = read_sips_value(&stdout, "pixelWidth").ok_or("无法读取 JPEG 宽度")?;
    let height = read_sips_value(&stdout, "pixelHeight").ok_or("无法读取 JPEG 高度")?;

    if width == 0 || height == 0 {
        return Err("输出 JPEG 宽高异常".to_string());
    }

    Ok(ValidationResult {
        size: metadata.len(),
        width,
        height,
        under_target: metadata.len() <= target_bytes,
    })
}

fn read_sips_value(text: &str, key: &str) -> Option<u32> {
    text.lines().find_map(|line| {
        let line = line.trim();
        line.strip_prefix(key)
            .and_then(|value| value.trim_start_matches(':').trim().parse::<u32>().ok())
    })
}
