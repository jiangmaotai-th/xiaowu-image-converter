use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhotoshopAppInfo {
    pub app_name: String,
    pub version: String,
    pub path: String,
}

#[derive(Debug, Clone)]
struct PhotoshopCandidate {
    app_name: String,
    path: PathBuf,
    version_number: Option<u32>,
    is_beta: bool,
}

pub fn detect_photoshop_app() -> Option<PhotoshopAppInfo> {
    let mut candidates = spotlight_candidates();
    if candidates.is_empty() {
        candidates = filesystem_candidates();
    }

    candidates.sort_by(|left, right| {
        left.is_beta
            .cmp(&right.is_beta)
            .then_with(|| right.version_number.cmp(&left.version_number))
            .then_with(|| left.app_name.cmp(&right.app_name))
    });

    for candidate in candidates {
        if let Ok(version) = photoshop_version(&candidate.app_name) {
            return Some(PhotoshopAppInfo {
                app_name: candidate.app_name,
                version,
                path: candidate.path.to_string_lossy().to_string(),
            });
        }
    }

    None
}

fn spotlight_candidates() -> Vec<PhotoshopCandidate> {
    let output = Command::new("mdfind")
        .arg("kMDItemCFBundleIdentifier == 'com.adobe.Photoshop'")
        .output();

    let Ok(output) = output else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    parse_candidate_paths(stdout.lines().map(PathBuf::from))
}

fn filesystem_candidates() -> Vec<PhotoshopCandidate> {
    let mut roots = vec![PathBuf::from("/Applications")];
    if let Ok(home) = std::env::var("HOME") {
        roots.push(PathBuf::from(home).join("Applications"));
    }

    let mut paths = Vec::new();
    for root in roots {
        collect_photoshop_apps(&root, &mut paths);
    }

    parse_candidate_paths(paths)
}

fn collect_photoshop_apps(root: &Path, found: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default();

        if path.is_dir() && name.ends_with(".app") {
            if name.contains("Adobe Photoshop") {
                found.push(path);
            }
            continue;
        }

        if path.is_dir() {
            collect_photoshop_apps(&path, found);
        }
    }
}

fn parse_candidate_paths(paths: impl IntoIterator<Item = PathBuf>) -> Vec<PhotoshopCandidate> {
    let mut seen = HashSet::new();
    let mut candidates = Vec::new();

    for path in paths {
        if path.extension().and_then(|value| value.to_str()) != Some("app") {
            continue;
        }

        let Some(app_name) = path.file_stem().and_then(|value| value.to_str()) else {
            continue;
        };
        if !app_name.contains("Adobe Photoshop") {
            continue;
        }

        let path_string = path.to_string_lossy().to_string();
        if !seen.insert(path_string) {
            continue;
        }

        candidates.push(PhotoshopCandidate {
            app_name: app_name.to_string(),
            version_number: extract_version_number(app_name),
            is_beta: app_name.to_ascii_lowercase().contains("beta"),
            path,
        });
    }

    candidates
}

fn extract_version_number(app_name: &str) -> Option<u32> {
    app_name
        .split(|character: char| !character.is_ascii_digit())
        .filter(|part| !part.is_empty())
        .filter_map(|part| part.parse::<u32>().ok())
        .max()
}

fn photoshop_version(app_name: &str) -> Result<String, String> {
    let result = Command::new("osascript")
        .arg("-e")
        .arg(format!(
            "tell application {} to version",
            applescript_string(app_name)
        ))
        .output()
        .map_err(|error| format!("调用 Photoshop 版本检测失败：{error}"))?;

    if result.status.success() {
        let version = String::from_utf8_lossy(&result.stdout).trim().to_string();
        if !version.is_empty() {
            return Ok(version);
        }
    }

    let stderr = String::from_utf8_lossy(&result.stderr);
    Err(format!("Photoshop 版本检测失败：{}", stderr.trim()))
}

pub fn export_jpeg(
    input: &Path,
    output: &Path,
    quality: u8,
    min_quality: u8,
    target_bytes: u64,
    allow_resize: bool,
) -> Result<(), String> {
    let app = detect_photoshop_app().ok_or("未检测到可用 Photoshop")?;
    let script = build_script(
        &app.app_name,
        input,
        output,
        quality,
        min_quality,
        target_bytes,
        allow_resize,
    );
    let result = Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
        .map_err(|error| format!("调用 Photoshop 失败：{error}"))?;

    if result.status.success() {
        if !output.exists() {
            return Err(format!("Photoshop 未生成输出文件：{}", output.display()));
        }
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&result.stderr);
    Err(format!("Photoshop 导出失败：{}", stderr.trim()))
}

fn build_script(
    app_name: &str,
    input: &Path,
    output: &Path,
    quality: u8,
    min_quality: u8,
    target_bytes: u64,
    allow_resize: bool,
) -> String {
    let jsx = build_jsx(
        input,
        output,
        quality,
        min_quality,
        target_bytes,
        allow_resize,
    );
    format!(
        r#"tell application {} to launch
try
  tell application "System Events" to set visible of process {} to false
end try
tell application {}
  do javascript {}
end tell
try
  tell application "System Events" to set visible of process {} to false
end try"#,
        applescript_string(app_name),
        applescript_string(app_name),
        applescript_string(app_name),
        applescript_string(&jsx),
        applescript_string(app_name)
    )
}

fn build_jsx(
    input: &Path,
    output: &Path,
    quality: u8,
    min_quality: u8,
    target_bytes: u64,
    allow_resize: bool,
) -> String {
    // Photoshop is the high-fidelity path: open the real PSD, preserve the visible
    // composite as Photoshop renders it, add a white background, then export JPEG.
    // Compression happens inside this one Photoshop session so the PSD is opened once.
    format!(
        r#"app.displayDialogs = DialogModes.NO;
var inputFile = new File({input});
var outputFile = new File({output});
var targetBytes = {target_bytes};
var startQuality = {quality};
var minQuality = {min_quality};
var allowResize = {allow_resize};
var doc = app.open(inputFile);
try {{
  if (doc.bitsPerChannel != BitsPerChannelType.EIGHT) {{
    doc.bitsPerChannel = BitsPerChannelType.EIGHT;
  }}
}} catch (e) {{}}
try {{
  doc.convertProfile("sRGB IEC61966-2.1", Intent.RELATIVECOLORIMETRIC, true, true);
}} catch (e) {{}}
var white = new SolidColor();
white.rgb.red = 255;
white.rgb.green = 255;
white.rgb.blue = 255;
var bg = doc.artLayers.add();
bg.name = "JPEG white background";
try {{
  bg.move(doc, ElementPlacement.PLACEATEND);
}} catch (e) {{}}
doc.selection.selectAll();
doc.selection.fill(white, ColorBlendMode.NORMAL, 100, false);
doc.selection.deselect();
doc.flatten();
for (var q = startQuality; q >= minQuality; q--) {{
  var options = new JPEGSaveOptions();
  options.quality = q;
  options.embedColorProfile = true;
  options.formatOptions = FormatOptions.STANDARDBASELINE;
  doc.saveAs(outputFile, options, true, Extension.LOWERCASE);
  outputFile = new File({output});
  if (outputFile.exists && outputFile.length > 0 && outputFile.length <= targetBytes) {{
    break;
  }}
}}
if (allowResize && outputFile.exists && outputFile.length > targetBytes) {{
  var percents = [95, 90, 85, 80, 75, 70, 65, 60, 55, 50, 45, 40];
  for (var i = 0; i < percents.length; i++) {{
    var nextWidth = Math.max(1, Math.round(doc.width.as("px") * (percents[i] / 100)));
    doc.resizeImage(UnitValue(nextWidth, "px"), null, null, ResampleMethod.BICUBIC);
    var resizeOptions = new JPEGSaveOptions();
    resizeOptions.quality = minQuality;
    resizeOptions.embedColorProfile = true;
    resizeOptions.formatOptions = FormatOptions.STANDARDBASELINE;
    doc.saveAs(outputFile, resizeOptions, true, Extension.LOWERCASE);
    outputFile = new File({output});
    if (outputFile.exists && outputFile.length > 0 && outputFile.length <= targetBytes) {{
      break;
    }}
  }}
}}
doc.close(SaveOptions.DONOTSAVECHANGES);"#,
        input = js_string(&input.to_string_lossy()),
        output = js_string(&output.to_string_lossy()),
        quality = quality.min(12),
        min_quality = min_quality.min(quality).max(1),
        target_bytes = target_bytes,
        allow_resize = if allow_resize { "true" } else { "false" }
    )
}

fn js_string(value: &str) -> String {
    format!("{:?}", value)
}

fn applescript_string(value: &str) -> String {
    format!("{:?}", value)
}

pub fn photoshop_quality(ui_quality: u8) -> u8 {
    let quality = ui_quality.clamp(65, 100);
    let scaled = 1.0 + ((quality - 65) as f32 / 35.0) * 11.0;
    let scaled = scaled.round() as u8;
    scaled.clamp(1, 12)
}
