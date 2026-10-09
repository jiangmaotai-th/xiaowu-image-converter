# 小午的图片转换 Pro

## 网页版：TIFF / HEIC 转 JPG

公开地址：[小午的图片转换网页版](https://jiangmaotai-th.github.io/xiaowu-image-converter/)。网页和桌面版分别构建，浏览器页面不调用 Tauri API。所有解码、编码和下载都在本机完成。

网页版只接受 TIFF / TIF / HEIC / HEIF，支持批量选择、文件夹选择、拖拽文件、质量调节、目标大小和逐张 JPG 下载。默认质量 92，目标严格小于 10,000,000 字节。超过目标时自动降低质量，再逐步缩小尺寸。TIFF 只处理第一页，透明区域填白。

预览不是估算：每张图片会先在 Web Worker 中实际编码并校验 JPEG，然后将该 JPEG 暂存于浏览器 IndexedDB；列表显示其真实字节数，转换时读取同一文件并下载。预览缓存最多 512 MB，之后的图片会在转换时逐张生成并显示实际大小。下载后立即删除该图片的预览缓存，Worker 每张图片结束后销毁。浏览器存储空间不足时仍可逐张转换。文件数量没有人为设置上限，但极大图片会受设备内存和浏览器画布限制；超过 1.2 亿像素时会明确报错。

Chrome 可选择输出文件夹，网页会确认写入完成后显示已保存，并自动避开同名文件。Safari 等不支持目录写入的浏览器会逐张触发 JPG 下载；浏览器可能要求允许连续下载，网页会显示“已发起下载”，无法替浏览器确认用户是否最终保存。

开发网页版：

```bash
npm install
npm run dev:web
```

构建与本地验证：

```bash
npm run build:web
npm run test:web
```

`npm run test:web` 默认连接 `http://localhost:5180/`，请先运行 `npm run dev:web -- --port 5180`。测试包含实际 TIFF、HEIC 的预览与下载字节对比、质量/目标大小变化、损坏文件和 20 张批量列表；设置 `WEB_STRESS=1` 可额外测试大 TIFF 压缩。GitHub Pages 工作流发布 `dist-web/`，桌面版仍使用 `npm run tauri:dev` 和 `npm run tauri:build`。

浏览器端 HEIC 解码使用 [heic-to](https://github.com/hoppergee/heic-to)（LGPL-3.0），TIFF 解码使用 [UTIF.js](https://github.com/photopea/UTIF.js)（MIT）。部分特殊 TIFF 色彩配置可能无法与专业桌面软件完全一致，重要作品请检查最终图片。

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
