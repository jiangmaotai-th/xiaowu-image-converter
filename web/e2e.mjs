import assert from 'node:assert/strict';
import { randomFillSync } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { chromium, webkit } from 'playwright';
import UTIF from 'utif';

const address = process.env.WEB_TEST_URL || 'http://localhost:5180/';
const heicPath = process.env.WEB_TEST_HEIC || '/Users/jiangtianhong/Downloads/IMG_4929.HEIC';
const browser = process.env.WEB_TEST_BROWSER === 'webkit'
  ? await webkit.launch({ headless: true })
  : await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

const pixels = new Uint8Array(512 * 512 * 4);
for (let index = 0; index < pixels.length; index += 4) {
  pixels[index] = (index / 4) % 256;
  pixels[index + 1] = (index / 1024) % 256;
  pixels[index + 2] = 120;
  pixels[index + 3] = 255;
}
const tiff = Buffer.from(UTIF.encodeImage(pixels, 512, 512));

async function checkDownload(file, label) {
  await page.locator('input[type=file]').first().setInputFiles(file);
  const row = page.locator('.file-row').filter({ hasText: label });
  try { await row.getByText('可下载').waitFor({ timeout: 30000 }); }
  catch (error) {
    console.log('Current row:', await page.locator('.file-panel').innerText());
    console.log('Browser errors:', errors);
    throw error;
  }
  const displayed = Number((await row.locator('.preview-size small').innerText()).replace(/[^0-9]/g, ''));
  assert.ok(displayed > 0 && displayed < 10_000_000);
  const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
  await page.getByRole('button', { name: '转换并下载 JPG' }).click();
  const download = await downloadPromise;
  const path = await download.path();
  assert.equal(statSync(path).size, displayed, `${label} 预览大小必须等于下载文件大小`);
  await row.getByText('已发起下载').waitFor();
  console.log(`${label}: ${displayed} bytes, exact match`);
  await page.getByRole('button', { name: '清空列表' }).click();
}

try {
  await page.goto(address);
  await page.getByText('拖拽 TIFF、HEIC 图片到这里').waitFor();
  await checkDownload({ name: 'sample.tif', mimeType: 'image/tiff', buffer: tiff }, 'sample.tif');
  if (existsSync(heicPath)) await checkDownload(heicPath, 'IMG_4929.HEIC');

  await page.locator('input[type=file]').first().setInputFiles({ name: 'settings.tif', mimeType: 'image/tiff', buffer: tiff });
  const settingsRow = page.locator('.file-row').filter({ hasText: 'settings.tif' });
  await settingsRow.getByText('可下载').waitFor({ timeout: 30000 });
  const originalBytes = Number((await settingsRow.locator('.preview-size small').innerText()).replace(/[^0-9]/g, ''));
  await page.locator('.quality-slider').fill('40');
  await settingsRow.getByText('可下载').waitFor({ timeout: 30000 });
  const lowerQualityBytes = Number((await settingsRow.locator('.preview-size small').innerText()).replace(/[^0-9]/g, ''));
  assert.ok(lowerQualityBytes <= originalBytes, '调低质量不能使预览大小增加');
  await page.getByRole('spinbutton', { name: '目标大小，MB' }).fill('0.01');
  await settingsRow.getByText('可下载').waitFor({ timeout: 30000 });
  const limitedBytes = Number((await settingsRow.locator('.preview-size small').innerText()).replace(/[^0-9]/g, ''));
  assert.ok(limitedBytes < 10_000, '自定义目标大小必须严格生效');
  const settingsDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '转换并下载 JPG' }).click();
  assert.equal(statSync(await (await settingsDownload).path()).size, limitedBytes);
  await page.getByRole('button', { name: '清空列表' }).click();
  await page.locator('.quality-slider').fill('92');
  await page.getByRole('spinbutton', { name: '目标大小，MB' }).fill('10');
  console.log('Quality reduction, custom target, and exact download: passed');

  await page.locator('input[type=file]').first().setInputFiles({ name: 'bad.tif', mimeType: 'image/tiff', buffer: Buffer.from('invalid') });
  await page.locator('.file-row').getByText('失败').waitFor({ timeout: 30000 });
  assert.match(await page.locator('.file-row').innerText(), /失败/);
  await page.getByRole('button', { name: '清空列表' }).click();

  await page.locator('input[type=file]').first().setInputFiles(Array.from({ length: 20 }, (_, index) => ({ name: `batch-${index + 1}.tif`, mimeType: 'image/tiff', buffer: tiff })));
  await page.getByText('共 20 张', { exact: false }).first().waitFor();
  await page.locator('.file-row').first().getByText('可下载').waitFor({ timeout: 120000 });
  const batchDownloads = [];
  page.on('download', (download) => batchDownloads.push(download));
  await page.getByRole('button', { name: '转换并下载 JPG' }).click();
  try { await page.getByText('共 20 张，已完成 20 张').waitFor({ timeout: 30000 }); }
  catch (error) {
    console.log('Batch UI:', (await page.locator('body').innerText()).slice(-1200));
    console.log('Batch download events:', batchDownloads.length);
    console.log('Browser errors:', errors);
    throw error;
  }
  assert.equal(batchDownloads.length, 20, '批量转换应为每张照片发起下载');
  assert.equal(errors.length, 0, `浏览器异常：${errors.join('; ')}`);
  await page.screenshot({ path: '/tmp/xiaowu-web-test.png', fullPage: true });
  console.log('20-file batch list, invalid input, and browser runtime: passed');
  if (process.env.WEB_STRESS === '1') {
    await page.getByRole('button', { name: '清空列表' }).click();
    const noisy = new Uint8Array(3200 * 3200 * 4);
    randomFillSync(noisy);
    for (let index = 3; index < noisy.length; index += 4) noisy[index] = 255;
    const largeTiff = Buffer.from(UTIF.encodeImage(noisy, 3200, 3200));
    await page.locator('input[type=file]').first().setInputFiles({ name: 'large.tif', mimeType: 'image/tiff', buffer: largeTiff });
    const largeRow = page.locator('.file-row').filter({ hasText: 'large.tif' });
    await largeRow.getByText('可下载').waitFor({ timeout: 120000 });
    const largeBytes = Number((await largeRow.locator('.preview-size small').innerText()).replace(/[^0-9]/g, ''));
    assert.ok(largeBytes < 10_000_000);
    const largeDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: '转换并下载 JPG' }).click();
    assert.equal(statSync(await (await largeDownload).path()).size, largeBytes);
    console.log(`41MB TIFF -> ${largeBytes} bytes, exact and under 10MB`);
  }
} finally {
  await browser.close();
}
