// Renders site/src/index.template.html once per locale into site/dist.
// Usage: node site/scripts/build.mjs [--strict]
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync, rmSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const strict = process.argv.includes("--strict");
const read = (p) => readFileSync(join(root, p), "utf8");
const json = (p) => JSON.parse(read(p));

const locales = json("i18n/locales.json");
const links = json("config/links.json");
const clips = json("media/clips.json");
const template = read("src/index.template.html");
const siteUrl = links.siteUrl.replace(/\/?$/, "/");
const defaultLocale = locales.find((l) => l.default);
const warnings = [];

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const get = (obj, path) => path.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
const hasMedia = (c) => existsSync(join(root, "media", `${c.file}${c.kind === "image" ? "-poster.webp" : ".mp4"}`));
const pageUrl = (loc) => siteUrl + (loc.path ? `${loc.path}/` : "");
const depthBase = (loc) => (loc.path ? "../" : "");

if (/REPLACE_ME/.test(JSON.stringify(links))) {
  const msg = "config/links.json still has REPLACE_ME";
  if (strict) throw new Error(msg);
  warnings.push(msg);
}

const star = `<svg class="ico" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 2.5l2.9 6.1 6.6.9-4.8 4.6 1.2 6.6L12 17.5l-5.9 3.2 1.2-6.6L2.5 9.5l6.6-.9z"/></svg>`;

const coffee = `<svg class="ico" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M17 10h1.5a2.5 2.5 0 0 1 0 5H17"/><path d="M8 2v3M12 2v3"/></svg>`;

function media(id, loc, t, base, ctx) {
  const c = clips[id];
  if (!c) throw new Error(`Unknown clip "${id}"`);
  const info = t.clips[id];
  const ar = `style="--ar:${c.w}/${c.h}"`;
  if (!hasMedia(c)) {
    if (!ctx.seen.has(id)) warnings.push(`placeholder in use for clip "${id}" (${c.shot})`);
    return `<div class="ph" role="img" aria-label="${esc(info.alt)}" ${ar}><p class="ph-tag">${esc(t.placeholder)}</p><p class="ph-title">${esc(info.title)}</p><p class="ph-shot">${esc(c.shot)}</p><p class="ph-file">media/${esc(c.file)}.mp4 · ${c.w}x${c.h}</p></div>`;
  }
  if (c.kind === "image") {
    return `<img class="shot" src="${base}media/${c.file}-poster.webp" width="${c.w}" height="${c.h}" alt="${esc(info.alt)}" loading="lazy" ${ar}>`;
  }
  return `<video class="shot" muted loop playsinline preload="none" poster="${base}media/${c.file}-poster.webp" width="${c.w}" height="${c.h}" aria-label="${esc(info.alt)}" ${ar}><source src="${base}media/${c.file}.webm" type="video/webm"><source src="${base}media/${c.file}.mp4" type="video/mp4"></video>`;
}

function render(loc) {
  const t = json(`i18n/${loc.code}.json`);
  const base = depthBase(loc);
  const ctx = { seen: new Set() };
  const appUrl = `${links.app.replace(/\/$/, "")}/${loc.appPath}`;
  const ogImage = `${siteUrl}og-${loc.code}.png`;
  const others = locales.filter((l) => l.code !== loc.code);

  const switcherLinks = locales
    .map((l) => {
      const href = (base || "./") + (l.path ? `${l.path}/` : "");
      const cur = l.code === loc.code ? ' aria-current="true"' : "";
      return `<a href="${href}" lang="${l.code}" hreflang="${l.code}" data-lang="${l.code}"${cur}>${esc(l.short)}</a>`;
    })
    .join("");
  const switcher =
    locales.length > 3
      ? `<details class="langs"><summary aria-label="${esc(t.nav.language)}">${esc(loc.short)}</summary><div>${switcherLinks}</div></details>`
      : `<nav class="langs" aria-label="${esc(t.nav.language)}">${switcherLinks}</nav>`;

  const stage = Object.keys(clips)
    .map((id) => `    <figure data-clip="${id}">${media(id, loc, t, base, ctx)}<figcaption>${esc(t.clips[id].title)}</figcaption></figure>`)
    .join("\n");

  const dl = (rows, a, b) =>
    rows.map((r) => `      <div><dt>${esc(r[a])}</dt><dd>${esc(r[b])}</dd></div>`).join("\n");

  const portfolio = links.portfolio
    ? `<a href="${esc(links.portfolio)}" rel="noopener">${esc(t.footer.portfolio)}</a>`
    : `<span class="soon" aria-disabled="true">${esc(t.footer.portfolioSoon)}</span>`;

  const langscript = `<script>document.documentElement.className+=" js";${
    loc.default
      ? `(function(){try{var L=${JSON.stringify(locales.map((l) => ({ c: l.code, p: l.path })))},D=${JSON.stringify(defaultLocale.code)},s=localStorage.getItem("pp.lang"),w=s;if(!w){var n=navigator.languages||[navigator.language||""];for(var i=0;i<n.length&&!w;i++){var b=String(n[i]).toLowerCase().split("-")[0];for(var j=0;j<L.length;j++)if(L[j].c===b){w=b;break}}}if(w&&w!==D)for(var k=0;k<L.length;k++)if(L[k].c===w&&L[k].p)location.replace(L[k].p+"/"+location.hash)}catch(e){}})()`
      : ""
  }</script>`;

  const jsonld = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Pair Pocket",
    applicationCategory: "FinanceApplication",
    operatingSystem: "Web, installable PWA",
    description: t.meta.description,
    url: pageUrl(loc),
    offers: { "@type": "Offer", price: "0", priceCurrency: "CAD" },
    author: { "@type": "Person", name: links.ownerFull, sameAs: [links.linkedin] },
    inLanguage: loc.code,
  }).replace(/</g, "\\u003c");

  const vars = {
    lang: loc.code,
    base,
    canonical: pageUrl(loc),
    ogImage,
    ogLocale: loc.ogLocale,
    ogAlternates: others.map((l) => `<meta property="og:locale:alternate" content="${l.ogLocale}">`).join("\n"),
    hreflang:
      locales.map((l) => `<link rel="alternate" hreflang="${l.code}" href="${pageUrl(l)}">`).join("\n") +
      `\n<link rel="alternate" hreflang="x-default" href="${pageUrl(defaultLocale)}">`,
    appUrl,
    switcher,
    stage,
    langscript,
    jsonld,
    portfolio,
    year: new Date().getFullYear(),
    freeRows: dl(t.free.rows, "fig", "text"),
  };

  const out = template.replace(/\{\{([^}]+)\}\}/g, (m, key) => {
    key = key.trim();
    if (key.startsWith("t.")) {
      const v = get(t, key.slice(2));
      if (v == null) throw new Error(`[${loc.code}] missing text ${key}`);
      return esc(v);
    }
    if (key.startsWith("l.")) {
      const v = links[key.slice(2)];
      if (v == null) throw new Error(`missing link ${key}`);
      return esc(v);
    }
    if (key.startsWith("clip:")) {
      const id = key.slice(5);
      ctx.seen.add(id);
      return `      <div class="inline-clip">${media(id, loc, t, base, ctx)}</div>`;
    }
    if (key.startsWith("icon:")) return key.slice(5) === "coffee" ? coffee : star;
    if (key in vars) return String(vars[key]);
    throw new Error(`unknown placeholder ${m}`);
  });

  const dir = join(dist, loc.path);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), out);
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
for (const f of readdirSync(join(root, "src"))) if (f !== "index.template.html") cpSync(join(root, "src", f), join(dist, f), { recursive: true });
cpSync(join(root, "media"), join(dist, "media"), { recursive: true, filter: (p) => !p.endsWith("clips.json") && !p.endsWith(".md") });
if (existsSync(join(root, "og"))) for (const f of readdirSync(join(root, "og"))) cpSync(join(root, "og", f), join(dist, f));

for (const loc of locales) render(loc);

writeFileSync(
  join(dist, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${locales
    .map(
      (l) =>
        `  <url><loc>${pageUrl(l)}</loc>${locales.map((o) => `<xhtml:link rel="alternate" hreflang="${o.code}" href="${pageUrl(o)}"/>`).join("")}</url>`,
    )
    .join("\n")}\n</urlset>\n`,
);
writeFileSync(join(dist, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${siteUrl}sitemap.xml\n`);
writeFileSync(
  join(dist, "404.html"),
  `<!doctype html><meta charset="utf-8"><title>Pair Pocket</title><meta http-equiv="refresh" content="0; url=${siteUrl}"><link rel="canonical" href="${siteUrl}"><p><a href="${siteUrl}">Pair Pocket</a></p>\n`,
);

for (const w of [...new Set(warnings)]) console.warn(`warn: ${w}`);
console.log(`built ${locales.length} locale(s) into site/dist`);
