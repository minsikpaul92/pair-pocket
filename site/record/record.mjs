// Records landing page clips from a local run of the app.
//
//   node record.mjs <clip> [--no-reset] [--keep-raw]
//
// Each clip lives in clips/<clip>.mjs and exports `setup(page)` (get to the
// first frame, not recorded) and `play(page, ui)` (the recorded part). The
// output goes to site/media/<clip>.mp4, .webm and -poster.webp.
//
// Frames are screenshots taken back to back at 2x pixel density (CDP
// captureScreenshot with an explicit scale), saved as high quality JPEGs and
// encoded once (phone: 780x1688, desktop: 1280x800). Neither Playwright's own
// recorder nor the CDP screencast work here: headless Chromium sends their
// frames at 1x whatever the pixel density, so text came out soft.
// `--keep-raw` keeps the frames in site/media/raw/<clip>-frames/.
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ffmpeg from 'ffmpeg-static';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { APP, resetDemo, signInUrl } from './session.mjs';
import { installOverlay, ui } from './cursor.mjs';

// Clips are recorded on a phone by default: they fit the tall stage on the
// landing page and the text reads larger. `layout = 'desktop'` opts out.
// `capture` is the screenshot density; the output is scaled to `out`.
// `poster` is the webp quality, `crf` / `webmCrf` the default video quality
// that keeps a clip in its budget (see scripts/check.mjs); a clip can override.
const LAYOUTS = {
  phone: { width: 390, height: 844, capture: 2, out: [780, 1688], touch: true, poster: 70, crf: '28', webmCrf: '40' },
  desktop: { width: 1280, height: 800, capture: 2, out: [1280, 800], touch: false, poster: 80, crf: '24', webmCrf: '34' },
};
const media = (name) => fileURLToPath(new URL(`../media/${name}`, import.meta.url));

const [clipId, ...flags] = process.argv.slice(2);
if (!clipId) throw new Error('usage: node record.mjs <clip> [--no-reset] [--keep-raw]');
const clip = await import(`./clips/${clipId}.mjs`);
const layout = LAYOUTS[clip.layout ?? 'phone'];
const [W, H] = layout.out;

if (!flags.includes('--no-reset')) await resetDemo();

const browser = await chromium.launch();
const contextOptions = {
  viewport: { width: layout.width, height: layout.height },
  deviceScaleFactor: layout.capture,
  isMobile: layout.touch,
  hasTouch: layout.touch,
  colorScheme: 'light',
  locale: 'en-CA',
  timezoneId: 'America/Toronto',
};

// Sign in and warm the server up without recording.
const warm = await browser.newContext(contextOptions);
const warmPage = await warm.newPage();
await warmPage.goto(await signInUrl(clip.account ?? 'tester3'));
await warmPage.waitForURL(`${APP}/en`);
await clip.setup(warmPage);
const storageState = await warm.storageState();
await warm.close();

// The recorded context.
const rawDir = media('raw');
const frameDir = `${rawDir}/${clipId}-frames`;
rmSync(frameDir, { recursive: true, force: true });
mkdirSync(frameDir, { recursive: true });
const context = await browser.newContext({ ...contextOptions, storageState });
await installOverlay(context, { touch: layout.touch });
const page = await context.newPage();
await page.goto(`${APP}/en`);
await clip.setup(page);

// Screenshots back to back while the clip plays. Each frame keeps the time it
// was taken, so the video runs at the same pace as it did live.
const frames = [];
const cdp = await context.newCDPSession(page);
let capturing = true;
const capture = (async () => {
  while (capturing) {
    // The clip is in page coordinates, so follow the scroll position.
    const { cssVisualViewport: v } = await cdp.send('Page.getLayoutMetrics');
    const t = Date.now() / 1000;
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'jpeg', quality: 92, optimizeForSpeed: true,
      clip: { x: v.pageX, y: v.pageY, width: layout.width, height: layout.height, scale: layout.capture },
    });
    const file = `${frameDir}/${String(frames.length).padStart(5, '0')}.jpg`;
    writeFileSync(file, Buffer.from(data, 'base64'));
    frames.push({ file, t });
  }
})();

const pointer = ui(page, { touch: layout.touch });
await pointer.place(...(clip.pointer ?? [layout.width - 10, layout.height / 2]));
await page.waitForTimeout(600);
const start = Date.now() / 1000;
await clip.play(page, pointer);
const end = Date.now() / 1000;
await page.waitForTimeout(200);
capturing = false;
await capture;
await context.close();
await browser.close();

// Frames inside [start, end], plus the one on screen when the clip began.
const first = Math.max(0, frames.findLastIndex((f) => f.t <= start));
const used = frames.slice(first).filter((f, i) => i === 0 || f.t < end);
if (!used.length) throw new Error('no frames captured');
// A clip may play faster than it was recorded (`speed`), e.g. a long form.
const speed = Number(clip.speed ?? 1);
const lines = ['ffconcat version 1.0'];
used.forEach((f, i) => {
  const from = Math.max(f.t, start);
  const to = i + 1 < used.length ? used[i + 1].t : end;
  lines.push(`file '${f.file.replaceAll('\\', '/')}'`, `duration ${Math.max((to - from) / speed, 0.001).toFixed(4)}`);
});
lines.push(`file '${used.at(-1).file.replaceAll('\\', '/')}'`); // concat needs the last frame twice
const list = `${frameDir}/list.ffconcat`;
writeFileSync(list, lines.join('\n'));

const scale = `scale=${W}:${H}:flags=lanczos`;
const input = ['-f', 'concat', '-safe', '0', '-i', list, '-an'];
const run = (...args) => execFileSync(ffmpeg, ['-y', '-loglevel', 'error', ...args]);
run(...input, '-vf', `fps=30,${scale},format=yuv420p`, '-c:v', 'libx264', '-crf', clip.crf ?? layout.crf,
  '-preset', 'veryslow', '-tune', 'animation', '-movflags', '+faststart', media(`${clipId}.mp4`));
run(...input, '-vf', `fps=30,${scale}`, '-c:v', 'libvpx-vp9', '-crf', clip.webmCrf ?? layout.webmCrf, '-b:v', '0',
  '-row-mt', '1', media(`${clipId}.webm`));
// Pass a buffer: sharp keeps a file it opened by path locked on Windows.
await sharp(readFileSync(used[0].file)).resize(W, H, { kernel: 'lanczos3' }).webp({ quality: layout.poster })
  .toFile(media(`${clipId}-poster.webp`));
if (!flags.includes('--keep-raw')) rmSync(frameDir, { recursive: true, force: true });

const kb = (name) => `${(statSync(media(name)).size / 1024).toFixed(0)} KB`;
console.log(`${clipId}: ${((end - start) / speed).toFixed(1)} s, ${used.length} frames,`,
  `mp4 ${kb(`${clipId}.mp4`)}, webm ${kb(`${clipId}.webm`)}, poster ${kb(`${clipId}-poster.webp`)}`);
