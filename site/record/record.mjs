// Records landing page clips from a local run of the app.
//
//   node record.mjs <clip> [--no-reset] [--keep-raw]
//
// Each clip lives in clips/<clip>.mjs and exports `setup(page)` (get to the
// first frame, not recorded) and `play(page, ui)` (the recorded part). The
// output goes to site/media/<clip>.mp4, .webm and -poster.webp.
//
// Frames are captured straight from Chrome (CDP screencast) at high pixel
// density as high quality JPEGs, then scaled down (phone: 780x1688, desktop:
// 1280x800) and encoded once. Playwright's own recorder encodes at about 1 Mbps first, which blurs
// text whenever the screen moves. `--keep-raw` keeps the frames in
// site/media/raw/<clip>-frames/.
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
// `scale` is the capture density; the output is scaled down to `out`.
// `poster` is the webp quality that keeps the poster under its 40 KB budget.
const LAYOUTS = {
  phone: { width: 390, height: 844, scale: 3, out: [780, 1688], touch: true, poster: 70 },
  desktop: { width: 1280, height: 800, scale: 2, out: [1280, 800], touch: false, poster: 80 },
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
  deviceScaleFactor: layout.scale,
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

// Chrome sends a frame only when the screen changes; each frame keeps its
// timestamp so still moments last exactly as long as they did live.
const frames = [];
const cdp = await context.newCDPSession(page);
cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
  cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  const file = `${frameDir}/${String(frames.length).padStart(5, '0')}.jpg`;
  writeFileSync(file, Buffer.from(data, 'base64'));
  frames.push({ file, t: metadata.timestamp });
});
await cdp.send('Page.startScreencast', {
  format: 'jpeg', quality: 95, everyNthFrame: 1,
  maxWidth: layout.width * layout.scale, maxHeight: layout.height * layout.scale,
});

const pointer = ui(page, { touch: layout.touch });
await pointer.place(...(clip.pointer ?? [layout.width - 10, layout.height / 2]));
await page.waitForTimeout(600);
const start = Date.now() / 1000;
await clip.play(page, pointer);
const end = Date.now() / 1000;
await page.waitForTimeout(200);
await cdp.send('Page.stopScreencast');
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
run(...input, '-vf', `fps=30,${scale},format=yuv420p`, '-c:v', 'libx264', '-crf', clip.crf ?? '24',
  '-preset', 'veryslow', '-tune', 'animation', '-movflags', '+faststart', media(`${clipId}.mp4`));
run(...input, '-vf', `fps=30,${scale}`, '-c:v', 'libvpx-vp9', '-crf', clip.webmCrf ?? '34', '-b:v', '0',
  '-row-mt', '1', media(`${clipId}.webm`));
// Pass a buffer: sharp keeps a file it opened by path locked on Windows.
await sharp(readFileSync(used[0].file)).resize(W, H, { kernel: 'lanczos3' }).webp({ quality: layout.poster })
  .toFile(media(`${clipId}-poster.webp`));
if (!flags.includes('--keep-raw')) rmSync(frameDir, { recursive: true, force: true });

const kb = (name) => `${(statSync(media(name)).size / 1024).toFixed(0)} KB`;
console.log(`${clipId}: ${((end - start) / speed).toFixed(1)} s, ${used.length} frames,`,
  `mp4 ${kb(`${clipId}.mp4`)}, webm ${kb(`${clipId}.webm`)}, poster ${kb(`${clipId}-poster.webp`)}`);
