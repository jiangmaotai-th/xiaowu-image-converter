mod commands;
mod compress;
mod converter;
mod file_utils;
mod imagemagick;
mod logger;
mod photoshop;
mod preview;
mod validation;

use std::sync::{atomic::AtomicBool, Arc};

pub struct AppState {
    pub cancel_requested: Arc<AtomicBool>,
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            cancel_requested: Arc::new(AtomicBool::new(false)),
        })
        .invoke_handler(tauri::generate_handler![
            commands::detect_tools,
            commands::install_imagemagick,
            commands::collect_input_paths,
            commands::convert_batch,
            commands::preview_sizes,
            commands::cancel_conversion,
            commands::open_output_folder,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run 小午的图片转换 Pro");
}
