# 小午的图片转换 Pro

小午的图片转换 Pro 是一个 macOS 桌面版批量图片转换工具。它使用 Tauri 2、React、TypeScript 和 Rust 开发，所有文件都在用户本机处理，不上传服务器，不需要登录，也没有收费系统。

第一版输出格式固定为 JPEG，支持把 PSD / PSB / TIFF / PNG / JPG / HEIC / WebP / BMP 批量转换为 JPEG，并尽量压缩到指定大小以下，默认 10MB。

## 安装依赖

需要先安装：

- Node.js
- Rust
- Xcode Command Line Tools
- 可选：Adobe Photoshop
- 可选：ImageMagick

安装前端依赖：

```bash
npm install
```

安装 ImageMagick：

```bash
brew install imagemagick
```

## 开发运行

```bash
npm run tauri:dev
```

普通网页调试也可以运行：

```bash
npm run dev
```

## 打包 .app

```bash
npm run tauri:build
```

打包完成后，`.app` 会出现在：

```text
src-tauri/target/release/bundle/macos/
```

## 打包 .dmg

同样使用：

```bash
npm run tauri:build
```

`.dmg` 会出现在：

```text
src-tauri/target/release/bundle/dmg/
```

## Photoshop 模式说明

PSD / PSB 在“自动”模式下会优先尝试 Photoshop 高保真转换。程序会通过 `osascript` 调用 Photoshop，打开 PSD，按 Photoshop 当前可见合成效果导出 JPEG，透明区域填充白色，转换完成后关闭文档并且不保存原文件。

这个模式更适合复杂 PSD：

- 复杂图层
- 调整图层
- 智能对象
- ICC 色彩配置
- 8bit / 16bit PSD

## ImageMagick 模式说明

如果没有 Photoshop，或用户选择 ImageMagick 快速转换，会调用本机 `magick` 命令转换。

参考命令逻辑：

```bash
magick input.psd[0] -auto-orient -colorspace sRGB -background white -alpha remove -alpha off -flatten -quality 92 output.jpeg
```

ImageMagick 也负责 TIFF / PNG / JPG / HEIC / WebP / BMP 的转换，以及转换后的二次压缩和缩放。

## 如何安装 ImageMagick

推荐使用 Homebrew：

```bash
brew install imagemagick
```

安装后重启 App。如果仍然检测不到，请确认以下路径之一存在：

```text
/opt/homebrew/bin/magick
/usr/local/bin/magick
```

## 为什么网页版 PSD 转换不稳定

PSD 不是普通图片格式，它包含图层、调整图层、智能对象、蒙版、混合模式、ICC 色彩配置等复杂信息。浏览器端 JavaScript 库通常只能读取一部分 PSD 数据，遇到复杂文件时容易出现偏色、灰图、图层合成错误或导出损坏。

桌面版改为优先使用 Photoshop 渲染 PSD；没有 Photoshop 时再用 ImageMagick 兜底，因此稳定性比网页版方案更高。

## JPEG 是有损格式

JPEG 是有损压缩格式，不是真正无损。质量越低，文件越小，但画质可能下降。默认质量为 92，自动压缩最低降到 65。

## 常见问题

### PSD 转换失败怎么办？

优先安装 Photoshop。没有 Photoshop 时请安装 ImageMagick：

```bash
brew install imagemagick
```

### TIFF 转换失败怎么办？

TIFF 第一版通过 ImageMagick 转换，只导出第一页。请确认已安装 ImageMagick。

### HEIC 转换失败怎么办？

HEIC 依赖 ImageMagick 的 HEIC 支持和 macOS 可用解码能力。如果失败，可以先在“照片”或“预览”中导出为 JPG。

### 文件超过目标大小怎么办？

程序会先降低 JPEG 质量，最低降到 65。如果仍超过目标大小，可以勾选“允许缩小尺寸以压到目标大小”。

### 输出文件会覆盖原文件吗？

不会。默认会追加 `_converted` 后缀并输出到用户选择的文件夹。

## 后续计划

- 内置 ImageMagick，减少外部安装步骤
- 支持 PNG / WebP 输出
- 支持 TIFF 多页导出
- 支持保存转换预设
- 支持更详细的日志查看窗口
