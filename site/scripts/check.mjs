// Guards the site before deploy: pack parity, copy rules, media budget.
// Usage: node site/scripts/check.mjs
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const json = (p) => JSON.parse(readFileSync(join(root, p), "utf8"));
const locales = json("i18n/locales.json");
const clips = json("media/clips.json");
const errors = [];

const flat = (o, p = "") =>
  Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? flat(v, `${p}${k}.`) : [[`${p}${k}`, v]]));

const base = locales.find((l) => l.default);
const baseKeys = new Map(flat(json(`i18n/${base.code}.json`)));
for (const loc of locales) {
  const keys = new Map(flat(json(`i18n/${loc.code}.json`)));
  for (const k of baseKeys.keys()) if (!keys.has(k)) errors.push(`${loc.code}: missing key ${k}`);
  for (const k of keys.keys()) if (!baseKeys.has(k)) errors.push(`${loc.code}: extra key ${k}`);
  for (const [k, v] of keys) {
    if (typeof v === "string" && /—|–/.test(v)) errors.push(`${loc.code}: dash in ${k}`);
    if (typeof v === "string" && v.trim() === "") errors.push(`${loc.code}: empty ${k}`);
    if (typeof v === "string" && /\{n\}/.test(baseKeys.get(k) ?? "") !== /\{n\}/.test(v)) errors.push(`${loc.code}: placeholder mismatch in ${k}`);
  }
}

const links = json("config/links.json");
for (const k of ["repo", "app", "linkedin", "coffee", "siteUrl"]) if (!/^https:\/\//.test(links[k] || "")) errors.push(`links.${k} must be an https URL`);
if (links.portfolio && !/^https:\/\//.test(links.portfolio)) errors.push("links.portfolio must be empty or an https URL");

const KB = 1024;
for (const [id, c] of Object.entries(clips)) {
  const mp4 = join(root, "media", `${c.file}.mp4`);
  const poster = join(root, "media", `${c.file}-poster.webp`);
  if (existsSync(mp4)) {
    const max = (id === "toggle" ? 700 : 450) * KB;
    if (statSync(mp4).size > max && c.status === "done") errors.push(`media/${c.file}.mp4 is over ${max / KB} KB`);
    if (!existsSync(poster)) errors.push(`media/${c.file}-poster.webp is missing`);
  }
  if (existsSync(poster) && statSync(poster).size > 40 * KB) errors.push(`media/${c.file}-poster.webp is over 40 KB`);
}
for (const f of readdirSync(join(root, "src"))) {
  const text = readFileSync(join(root, "src", f), "utf8");
  if (/\.(html|css|js)$/.test(f) && /—/.test(text)) errors.push(`src/${f}: em dash`);
}

if (errors.length) {
  console.error(errors.map((e) => `error: ${e}`).join("\n"));
  process.exit(1);
}
console.log("site checks passed");
