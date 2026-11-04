// Records landing page clips from a local run of the app.
//
//   node record.mjs <clip> [--no-reset] [--keep-raw]
//
// Each clip lives in clips/<clip>.mjs and exports `setup(page)` (get to the
// first frame, not recorded) and `play(page, ui)` (the recorded part). The
// output goes to site/media/<clip>.mp4, .webm and -poster.webp; the raw video
// stays in site/media/raw/.
import { mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ffmpeg from 'ffmpeg-static';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { APP, resetDemo, signInUrl } from './session.mjs';
import { installOverlay, ui } from './cursor.mjs';

const W = 1280;
const H = 800;
const media = (name) => fileURLToPath(new URL(`../media/${name}`, import.meta.url));

const [clipId, ...flags] = process.argv.slice(2);
if (!clipId) throw new Error('usage: node record.mjs <clip> [--no-reset] [--keep-raw]');
const clip = await import(`./clips/${clipId}.mjs`);

if (!flags.includes('--no-reset')) await resetDemo();

const browser = await chromium.launch();
const contextOptions = {
  viewport: { width: W, height: H },
  deviceScaleFactor: 1,
  colorScheme: 'light',
  locale: 'en-CA',
  timezoneId: 'America/Toronto',
};

// Sign in and warm the dev server up without recording.
const warm = await browser.newContext(contextOptions);
const warmPage = await warm.newPage();
await warmPage.goto(await signInUrl(clip.account ?? 'tester3'));
await warmPage.waitForURL(`${APP}/en`);
await clip.setup(warmPage);
const storageState = await warm.storageState();
await warm.close();

// The recorded context. Video starts when the page opens, so note the time
// the clip really begins and trim everything before it.
const rawDir = media('raw');
mkdirSync(rawDir, { recursive: true });
const context = await browser.newContext({
  ...contextOptions,
  storageState,
  recordVideo: { dir: rawDir, size: { width: W, height: H } },
});
await installOverlay(context);
const page = await context.newPage();
const videoStart = Date.now();
await page.goto(`${APP}/en`);
await clip.setup(page);
const pointer = ui(page);
await pointer.place(...(clip.pointer ?? [1000, 560]));
await page.waitForTimeout(400);
const start = (Date.now() - videoStart) / 1000;
await clip.play(page, pointer);
const end = (Date.now() - videoStart) / 1000;
await context.close();
const raw = `${rawDir}/${clipId}.webm`;
renameSync(await page.video().path(), raw);
await browser.close();

// Convert (same settings as media/RECORDING.md, cut to the clip).
const cut = ['-ss', start.toFixed(2), '-to', end.toFixed(2), '-i', raw, '-an'];
const run = (...args) => execFileSync(ffmpeg, ['-y', '-loglevel', 'error', ...args]);
run(...cut, '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-crf', clip.crf ?? '26',
  '-preset', 'slow', '-movflags', '+faststart', media(`${clipId}.mp4`));
run(...cut, '-vf', 'fps=30', '-c:v', 'libvpx-vp9', '-crf', '38', '-b:v', '0', media(`${clipId}.webm`));
const png = `${rawDir}/${clipId}-poster.png`;
run('-ss', (start + 0.2).toFixed(2), '-i', raw, '-frames:v', '1', png);
await sharp(png).webp({ quality: 80 }).toFile(media(`${clipId}-poster.webp`));
rmSync(png);
if (!flags.includes('--keep-raw')) rmSync(raw);

const kb = (name) => `${(statSync(media(name)).size / 1024).toFixed(0)} KB`;
console.log(`${clipId}: ${(end - start).toFixed(1)} s`,
  `mp4 ${kb(`${clipId}.mp4`)}, webm ${kb(`${clipId}.webm`)}, poster ${kb(`${clipId}-poster.webp`)}`);
