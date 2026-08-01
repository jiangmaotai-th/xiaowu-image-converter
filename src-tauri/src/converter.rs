use std::collections::VecDeque;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc, Arc, Mutex,
};
use std::thread;

use tauri::AppHandle;

use crate::commands::{
    emit_progress, ConvertBatchRequest, ConvertEvent, ConvertJobRequest, ConvertResult,
};
use crate::compress;
use crate::file_utils;
use crate::imagemagick;
use crate::logger;
use crate::photoshop;
use crate::validation;

struct FinalizeResult {
    validation: validation::ValidationResult,
    warning: Option<String>,
}

pub fn convert_batch_blocking(
    app: AppHandle,
    request: ConvertBatchRequest,
    cancel_requested: Arc<AtomicBool>,
) -> Result<Vec<ConvertResult>, String> {
    if request.settings.output_format != "JPEG" {
        return Err("第一版仅支持输出 JPEG".to_string());
    }

    fs::create_dir_all(&request.settings.output_directory)
        .map_err(|error| format!("无法创建输出目录：{error}"))?;

    let concurrency = request.settings.concurrency.clamp(1, 4);
    let default_suffix = request.settings.filename_suffix.clone();
    let jobs = request
        .jobs
        .into_iter()
        .map(|mut job| {
            if job.suffix.is_empty() {
                job.suffix = default_suffix.clone();
            }
            job
        })
        .collect::<Vec<_>>();
    let queue = Arc::new(Mutex::new(VecDeque::from(jobs)));
    let (sender, receiver) = mpsc::channel();
    let mut workers = Vec::new();

    for _ in 0..concurrency {
        let app = app.clone();
        let queue = queue.clone();
        let sender = sender.clone();
        let cancel_requested = cancel_requested.clone();

        workers.push(thread::spawn(move || loop {
            if cancel_requested.load(Ordering::SeqCst) {
                break;
            }

            let job = {
                let mut queue = queue.lock().expect("queue poisoned");
                queue.pop_front()
            };

            let Some(job) = job else {
                break;
            };

            let result = convert_one(&app, job, &cancel_requested);
            if sender.send(result).is_err() {
                break;
            }
        }));
    }

    drop(sender);

    let mut results = Vec::new();
    for result in receiver {
        results.push(result);
    }

    for worker in workers {
        let _ = worker.join();
    }

    Ok(results)
}

fn convert_one(
    app: &AppHandle,
    job: ConvertJobRequest,
    cancel_requested: &Arc<AtomicBool>,
) -> ConvertResult {
    let input = PathBuf::from(&job.input_path);
    let output_dir = PathBuf::from(&job.output_directory);
    let output = file_utils::output_path(&input, &output_dir, &job.suffix);

    emit_progress(app, event(&job.id, "converting", 8, None, None, None));

    if cancel_requested.load(Ordering::SeqCst) {
        emit_progress(app, event(&job.id, "cancelled", 0, None, None, None));
        return cancelled_result(job);
    }

    let _ = fs::remove_file(&output);
    let conversion_result = run_conversion(&job, &input, &output);
    if let Err(error) = conversion_result {
        logger::log(&format!("{} failed: {}", input.display(), error));
        emit_progress(
            app,
            event(&job.id, "failed", 0, None, None, Some(error.clone())),
        );
        return failed_result(job, error);
    }

    if cancel_requested.load(Ordering::SeqCst) {
        let _ = fs::remove_file(&output);
        emit_progress(app, event(&job.id, "cancelled", 0, None, None, None));
        return cancelled_result(job);
    }

    emit_progress(
        app,
        event(&job.id, "compressing", 72, Some(&output), None, None),
    );

    let finalized = match finalize_output(&job, &output) {
        Ok(finalized) => finalized,
        Err(error) => {
            logger::log(&format!(
                "{} validation failed: {}",
                output.display(),
                error
            ));
            emit_progress(
                app,
                event(
                    &job.id,
                    "failed",
                    0,
                    Some(&output),
                    None,
                    Some(error.clone()),
                ),
            );
            return failed_result(job, error);
        }
    };

    emit_progress(
        app,
        event(
            &job.id,
            "success",
            100,
            Some(&output),
            Some(finalized.validation.size),
            finalized.warning.clone(),
        ),
    );
    logger::log(&format!(
        "{} -> {} ({} bytes, {}x{})",
        input.display(),
        output.display(),
        finalized.validation.size,
        finalized.validation.width,
        finalized.validation.height
    ));

    ConvertResult {
        id: job.id,
        input_path: job.input_path,
        output_path: Some(output.to_string_lossy().to_string()),
        output_size: Some(finalized.validation.size),
        success: true,
        error: finalized.warning,
    }
}

fn run_conversion(job: &ConvertJobRequest, input: &Path, output: &Path) -> Result<(), String> {
    let extension = input
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let is_psd = extension == "psd" || extension == "psb";
    let magick = imagemagick::detect_magick();

    match job.settings.mode.as_str() {
        "photoshop" => {
            if !is_psd {
                return Err(
                    "Photoshop 高保真模式仅用于 PSD/PSB，请使用自动或 ImageMagick 模式转换其他格式"
                        .to_string(),
                );
            }
            photoshop::export_jpeg(
                input,
                output,
                photoshop::photoshop_quality(job.settings.jpeg_quality),
                photoshop::photoshop_quality(job.settings.min_quality),
                compress::compression_target_bytes(&job.settings),
                job.settings.allow_resize,
            )
        }
        "imagemagick" => {
            let binary = magick
                .as_deref()
                .ok_or("未检测到 ImageMagick。请安装：brew install imagemagick")?;
            imagemagick::convert_to_jpeg(binary, input, output, job.settings.jpeg_quality, None)
        }
        _ => {
            if is_psd {
                match photoshop::export_jpeg(
                    input,
                    output,
                    photoshop::photoshop_quality(job.settings.jpeg_quality),
                    photoshop::photoshop_quality(job.settings.min_quality),
                    compress::compression_target_bytes(&job.settings),
                    job.settings.allow_resize,
                ) {
                    Ok(()) => Ok(()),
                    Err(photoshop_error) => {
                        let binary = magick.as_deref().ok_or_else(|| {
                            format!("PSD 稳定转换需要 Photoshop 或 ImageMagick。Photoshop 错误：{photoshop_error}")
                        })?;
                        imagemagick::convert_to_jpeg(
                            binary,
                            input,
                            output,
                            job.settings.jpeg_quality,
                            None,
                        )
                    }
                }
            } else {
                let binary = magick.as_deref().ok_or("未检测到 ImageMagick。TIFF/PNG/JPG/HEIC/WebP/BMP 转换需要安装：brew install imagemagick")?;
                imagemagick::convert_to_jpeg(binary, input, output, job.settings.jpeg_quality, None)
            }
        }
    }
}

fn finalize_output(job: &ConvertJobRequest, output: &Path) -> Result<FinalizeResult, String> {
    let target = compress::target_bytes(&job.settings);
    let validation = validation::validate_jpeg(output, target)?;
    if validation.under_target {
        return Ok(FinalizeResult {
            validation,
            warning: None,
        });
    }

    if let Some(binary) = imagemagick::detect_magick() {
        let validation =
            compress::validate_or_compress_with_magick(&binary, output, &job.settings)?;
        return Ok(FinalizeResult {
            validation,
            warning: None,
        });
    }

    Ok(FinalizeResult {
        validation,
        warning: Some("已成功导出，但超过目标大小；安装 ImageMagick 后可自动继续压缩".to_string()),
    })
}

fn event(
    id: &str,
    status: &str,
    progress: u8,
    output: Option<&Path>,
    size: Option<u64>,
    error: Option<String>,
) -> ConvertEvent {
    ConvertEvent {
        id: id.to_string(),
        status: status.to_string(),
        progress,
        output_path: output.map(|path| path.to_string_lossy().to_string()),
        output_size: size,
        error,
    }
}

fn failed_result(job: ConvertJobRequest, error: String) -> ConvertResult {
    ConvertResult {
        id: job.id,
        input_path: job.input_path,
        output_path: None,
        output_size: None,
        success: false,
        error: Some(error),
    }
}

fn cancelled_result(job: ConvertJobRequest) -> ConvertResult {
    ConvertResult {
        id: job.id,
        input_path: job.input_path,
        output_path: None,
        output_size: None,
        success: false,
        error: Some("已取消".to_string()),
    }
}
