use std::fs;
use std::path::{Path, PathBuf};

use crate::commands::FileInfo;

const SUPPORTED_EXTENSIONS: &[&str] = &[
    "psd", "psb", "tif", "tiff", "png", "jpg", "jpeg", "heic", "webp", "bmp",
];

pub fn collect_input_paths(paths: Vec<PathBuf>) -> Result<Vec<FileInfo>, String> {
    let mut files = Vec::new();

    for path in paths {
        collect_path(&path, &mut files)?;
    }

    files.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(files)
}

fn collect_path(path: &Path, files: &mut Vec<FileInfo>) -> Result<(), String> {
    let metadata =
        fs::metadata(path).map_err(|error| format!("读取路径失败 {}：{error}", path.display()))?;

    if metadata.is_dir() {
        for entry in fs::read_dir(path)
            .map_err(|error| format!("读取文件夹失败 {}：{error}", path.display()))?
        {
            let entry = entry.map_err(|error| format!("读取文件夹条目失败：{error}"))?;
            collect_path(&entry.path(), files)?;
        }
        return Ok(());
    }

    if !metadata.is_file() {
        return Ok(());
    }

    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    if !SUPPORTED_EXTENSIONS.contains(&extension.as_str()) {
        return Ok(());
    }

    files.push(FileInfo {
        path: path.to_string_lossy().to_string(),
        name: path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_string(),
        extension,
        size: metadata.len(),
        is_file: true,
    });

    Ok(())
}

pub fn output_path(input: &Path, output_dir: &Path, suffix: &str) -> PathBuf {
    let stem = input
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("converted");
    output_dir.join(format!("{stem}{suffix}.jpg"))
}
