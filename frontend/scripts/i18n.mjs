// Language pack tooling. Korean (ko) is the source of truth; every other pack
// mirrors its keys. See docs/I18N.md.
//
//   node scripts/i18n.mjs check              CI gate (also the default command)
//   node scripts/i18n.mjs status             translation coverage per locale
//   node scripts/i18n.mjs missing <code>     untranslated keys with ko/en source text
//   node scripts/i18n.mjs new <code> [--native <name>] [--label <name>] [--intl <tag>] [--short <text>]
//                                            register a locale and scaffold its packs
//
// check fails on:
//   - registry problems (frontend/i18n/locales.json vs backend/app/core/locales.json)
//   - keys in a pack that do not exist in ko, or a fallback (en) pack that is incomplete
//   - translations whose {placeholders} differ from ko, or that are not valid ICU messages
//   - incomplete packs for locales not marked beta
//   - Korean text hardcoded in app/, components/, lib/ or i18n/ (outside data modules)
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(frontendRoot, "..");
const registryPath = join(frontendRoot, "i18n", "locales.json");
const backendRegistryPath = join(repoRoot, "backend", "app", "core", "locales.json");

/** Pack directories: the web UI and the backend (emails). */
const PACK_SETS = [
  { name: "frontend", dir: join(frontendRoot, "messages") },
  { name: "backend", dir: join(repoRoot, "backend", "app", "locales") },
];

/** Modules that hold Korean data identifiers (stored values), not UI text. */
const HANGUL_ALLOWED_FILES = new Set(["lib/category-values.ts", "lib/banks.ts"]);
const HANGUL = /[\uac00-\ud7a3]/;
const LOCALE_CODE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

let icuParse = null;
try {
  ({ parse: icuParse } = await import("@formatjs/icu-messageformat-parser"));
} catch {
  // Falls back to a regex check when the parser (a next-intl dependency) is absent.
}

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const writeJson = (path, data) => writeFileSync(path, JSON.stringify(data, null, 2) + "\n");

function flatten(obj, prefix = "", out = {}) {
  for (const [key, value] of Object.entries(obj)) {
    if (value && typeof value === "object") flatten(value, `${prefix}${key}.`, out);
    else out[`${prefix}${key}`] = String(value);
  }
  return out;
}

function skeleton(obj) {
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    out[key] = value && typeof value === "object" ? skeleton(value) : "";
  }
  return out;
}

function argumentNames(elements, names = new Set()) {
  for (const el of elements) {
    // 1 argument, 2 number, 3 date, 4 time, 5 select, 6 plural, 8 tag
    if ([1, 2, 3, 4, 5, 6].includes(el.type)) names.add(el.value);
    if (el.options) for (const option of Object.values(el.options)) argumentNames(option.value, names);
    if (el.children) argumentNames(el.children, names);
  }
  return names;
}

/** Placeholder names in a message, or an Error when the message is not valid ICU. */
function placeholders(message) {
  if (icuParse) {
    try {
      return [...argumentNames(icuParse(message))].sort().join(",");
    } catch (err) {
      return new Error(err.message);
    }
  }
  return [...new Set([...message.matchAll(/\{\s*(\w+)\s*[,}]/g)].map((m) => m[1]))].sort().join(",");
}

function loadRegistry() {
  return readJson(registryPath);
}

function packsIn(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.replace(/\.json$/, ""));
}

function coverage(base, pack) {
  const total = Object.keys(base).length;
  const translated = Object.keys(base).filter((key) => (pack[key] ?? "") !== "").length;
  return { total, translated, percent: total ? Math.floor((translated / total) * 100) : 100 };
}

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, files);
    else if (/\.(tsx?|mjs|js)$/.test(name)) files.push(path);
  }
  return files;
}

function hangulLines(source) {
  const noBlockComments = source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ""));
  return noBlockComments
    .split("\n")
    .map((line, index) => ({ line: line.replace(/(^|\s)\/\/.*$/, ""), number: index + 1 }))
    .filter(({ line }) => HANGUL.test(line));
}

function check() {
  const errors = [];
  const warnings = [];
  const registry = loadRegistry();
  const codes = registry.locales.map((item) => item.code);
  const betaByCode = Object.fromEntries(registry.locales.map((item) => [item.code, item.beta]));

  // Registry
  const duplicates = codes.filter((code, index) => codes.indexOf(code) !== index);
  if (duplicates.length) errors.push(`locales.json: duplicate codes ${duplicates.join(", ")}`);
  for (const field of ["baseLocale", "fallbackLocale", "defaultLocale"]) {
    if (!codes.includes(registry[field])) errors.push(`locales.json: ${field} "${registry[field]}" is not registered`);
  }
  for (const item of registry.locales) {
    if (!LOCALE_CODE.test(item.code)) errors.push(`locales.json: invalid code "${item.code}"`);
    for (const field of ["label", "native", "short", "intl"]) {
      if (!item[field]) errors.push(`locales.json: ${item.code} is missing "${field}"`);
    }
    if (typeof item.beta !== "boolean") errors.push(`locales.json: ${item.code} needs "beta": true|false`);
    try {
      new Intl.DateTimeFormat(item.intl);
    } catch {
      errors.push(`locales.json: ${item.code} has an invalid intl tag "${item.intl}"`);
    }
  }
  if (existsSync(backendRegistryPath)) {
    const backendCodes = readJson(backendRegistryPath).map((item) => item.code);
    const missing = codes.filter((code) => !backendCodes.includes(code));
    const extra = backendCodes.filter((code) => !codes.includes(code));
    if (missing.length || extra.length) {
      errors.push(
        `backend/app/core/locales.json does not match frontend/i18n/locales.json` +
          (missing.length ? ` (missing ${missing.join(", ")})` : "") +
          (extra.length ? ` (extra ${extra.join(", ")})` : "")
      );
    }
  }

  // Packs
  for (const set of PACK_SETS) {
    if (!existsSync(set.dir)) continue;
    const basePath = join(set.dir, `${registry.baseLocale}.json`);
    if (!existsSync(basePath)) {
      errors.push(`${set.name}: missing base pack ${registry.baseLocale}.json`);
      continue;
    }
    const base = flatten(readJson(basePath));
    for (const [key, text] of Object.entries(base)) {
      if (text === "") errors.push(`${set.name}/${registry.baseLocale}.json: empty value for ${key}`);
      const own = placeholders(text);
      if (own instanceof Error) errors.push(`${set.name}/${registry.baseLocale}.json: ${key} is not valid ICU (${own.message})`);
    }
    for (const code of packsIn(set.dir)) {
      if (code === registry.baseLocale) continue;
      const file = `${set.name}/${code}.json`;
      if (!codes.includes(code)) {
        errors.push(`${file}: "${code}" is not in frontend/i18n/locales.json (use npm run i18n:new -- ${code})`);
        continue;
      }
      const pack = flatten(readJson(join(set.dir, `${code}.json`)));
      for (const key of Object.keys(pack)) {
        if (!(key in base)) errors.push(`${file}: ${key} does not exist in ${registry.baseLocale}.json`);
      }
      for (const [key, text] of Object.entries(base)) {
        const translated = pack[key] ?? "";
        if (translated === "") continue;
        const expected = placeholders(text);
        const actual = placeholders(translated);
        if (actual instanceof Error) errors.push(`${file}: ${key} is not valid ICU (${actual.message})`);
        else if (!(expected instanceof Error) && actual !== expected) {
          errors.push(`${file}: ${key} placeholders {${actual}} differ from ${registry.baseLocale} {${expected}}`);
        }
      }
      const { translated, total, percent } = coverage(base, pack);
      if (translated < total) {
        const message = `${file}: ${total - translated} of ${total} keys untranslated (${percent}%)`;
        if (code === registry.fallbackLocale || betaByCode[code] === false) {
          errors.push(`${message}; ${code} is ${code === registry.fallbackLocale ? "the fallback locale" : "not marked beta"}`);
        } else {
          warnings.push(message);
        }
      }
    }
    if (!packsIn(set.dir).includes(registry.fallbackLocale)) {
      errors.push(`${set.name}: missing fallback pack ${registry.fallbackLocale}.json`);
    }
  }

  // Hardcoded Korean outside the message packs
  for (const dir of ["app", "components", "lib", "i18n"]) {
    const abs = join(frontendRoot, dir);
    if (!existsSync(abs)) continue;
    for (const path of walk(abs)) {
      const file = relative(frontendRoot, path).split("\\").join("/");
      if (HANGUL_ALLOWED_FILES.has(file)) continue;
      for (const { number } of hangulLines(readFileSync(path, "utf8"))) {
        errors.push(`${file}:${number}: hardcoded Korean. Move the text to messages/ko.json (and en.json).`);
      }
    }
  }

  for (const warning of warnings) console.warn(`warning: ${warning}`);
  if (errors.length) {
    console.error(errors.join("\n"));
    console.error(`\ni18n check failed with ${errors.length} error(s).`);
    process.exit(1);
  }
  const keyCount = Object.keys(flatten(readJson(join(PACK_SETS[0].dir, `${registry.baseLocale}.json`)))).length;
  console.log(`i18n ok: ${keyCount} keys, ${codes.length} locales registered${icuParse ? "" : " (ICU parser unavailable, regex check used)"}`);
}

function status() {
  const registry = loadRegistry();
  for (const set of PACK_SETS) {
    if (!existsSync(set.dir)) continue;
    const base = flatten(readJson(join(set.dir, `${registry.baseLocale}.json`)));
    console.log(`\n${set.name} (${Object.keys(base).length} keys)`);
    for (const item of registry.locales) {
      const path = join(set.dir, `${item.code}.json`);
      const pack = existsSync(path) ? flatten(readJson(path)) : {};
      const { translated, total, percent } = coverage(base, pack);
      const note = existsSync(path) ? `${translated}/${total}` : "no pack, shows fallback";
      console.log(`  ${item.code.padEnd(8)} ${String(percent).padStart(3)}%  ${note}${item.beta ? "  (beta)" : ""}`);
    }
  }
}

function missing(code) {
  if (!code) throw new Error("usage: missing <code>");
  const registry = loadRegistry();
  for (const set of PACK_SETS) {
    if (!existsSync(set.dir)) continue;
    const base = flatten(readJson(join(set.dir, `${registry.baseLocale}.json`)));
    const fallbackPath = join(set.dir, `${registry.fallbackLocale}.json`);
    const fallback = existsSync(fallbackPath) ? flatten(readJson(fallbackPath)) : {};
    const path = join(set.dir, `${code}.json`);
    const pack = existsSync(path) ? flatten(readJson(path)) : {};
    const keys = Object.keys(base).filter((key) => (pack[key] ?? "") === "");
    console.log(`\n${set.name}/${code}.json: ${keys.length} untranslated`);
    for (const key of keys) {
      console.log(`${key}\n  ${registry.baseLocale}: ${base[key]}\n  ${registry.fallbackLocale}: ${fallback[key] ?? ""}`);
    }
  }
}

function option(args, name) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function scaffold(code, args) {
  if (!code || !LOCALE_CODE.test(code)) throw new Error("usage: new <code>, e.g. new ja or new zh-Hant");
  const registry = loadRegistry();
  let entry = registry.locales.find((item) => item.code === code);
  if (!entry) {
    const native = option(args, "native") ?? code;
    entry = {
      code,
      label: option(args, "label") ?? native,
      native,
      short: option(args, "short") ?? code.split("-")[0].toUpperCase(),
      intl: option(args, "intl") ?? code,
      beta: true,
    };
    registry.locales.push(entry);
    writeJson(registryPath, registry);
    console.log(`registered ${code} in frontend/i18n/locales.json`);
  }
  if (existsSync(backendRegistryPath)) {
    const backend = readJson(backendRegistryPath);
    if (!backend.some((item) => item.code === code)) {
      backend.push({ code, label: entry.label, native: entry.native, beta: entry.beta });
      writeJson(backendRegistryPath, backend);
      console.log(`registered ${code} in backend/app/core/locales.json`);
    }
  }
  for (const set of PACK_SETS) {
    if (!existsSync(set.dir)) continue;
    const path = join(set.dir, `${code}.json`);
    if (existsSync(path)) {
      console.log(`${set.name}/${code}.json already exists`);
      continue;
    }
    writeJson(path, skeleton(readJson(join(set.dir, `${registry.baseLocale}.json`))));
    console.log(`created ${relative(repoRoot, path).split("\\").join("/")} (empty values fall back to ${registry.fallbackLocale})`);
  }
  console.log(
    `\nNext: translate the empty values (npm run i18n:missing -- ${code} lists them with the ko/en source),\n` +
      `run npm run check:i18n, and set "beta": false for ${code} once it is complete.`
  );
}

const [command = "check", arg, ...rest] = process.argv.slice(2);
const commands = { check, status, missing: () => missing(arg), new: () => scaffold(arg, rest) };
if (!commands[command]) {
  console.error(`unknown command "${command}". Use check, status, missing <code> or new <code>.`);
  process.exit(1);
}
commands[command]();
