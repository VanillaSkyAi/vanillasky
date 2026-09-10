import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { posix, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const markdown = file => /\.md$/i.test(file);
const labelKey = label => label.trim().replace(/\s+/g, " ").toLowerCase();
const unescape = text => text.replace(/\\([\\`*{}[\]()#+.!_<>-])/g, "$1");
const entities = text => text.replace(/&(amp|lt|gt|quot|apos);/g, (_, name) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" })[name]);
const slug = text => entities(text.replace(/<[^>]*>/g, "")).replace(/!?\[([^\]]*)\](?:\([^)]*\)|\[[^\]]*\])/g, "$1")
  .toLowerCase().replace(/[\uFE00-\uFE0F]/g, "").replace(/[^\p{L}\p{M}\p{N}_ -]/gu, "").replace(/ /g, "-");

// Read a CommonMark destination, allowing escaped and balanced parentheses.
function destination(text, start, inline = false) {
  let index = start;
  while (/\s/.test(text[index] ?? "") && index < text.length) index++;
  if (text[index] === "<") {
    const end = text.indexOf(">", index + 1);
    return end < 0 ? null : { value: text.slice(index + 1, end), end: end + 1 };
  }
  const begin = index;
  let depth = 0;
  for (; index < text.length; index++) {
    const character = text[index];
    if (character === "\\") { index++; continue; }
    if (character === "(") depth++;
    else if (character === ")") { if (!depth) break; depth--; }
    else if (/\s/.test(character) && !depth) break;
  }
  if (depth || (inline && index === text.length)) return null;
  return { value: text.slice(begin, index), end: index };
}

function parse(file, source, errors) {
  const lines = source.replace(/<!--[^]*?-->/g, match => match.replace(/[^\n]/g, " ")).split(/\r?\n/);
  const visible = [], anchors = new Set(), counts = new Map(), links = [], definitions = new Map();
  const fail = (line, message) => errors.push({ file, line, message });
  const heading = text => {
    const base = slug(text);
    let id = base, index = counts.get(base) ?? 0;
    while (anchors.has(id)) id = `${base}-${++index}`;
    counts.set(base, index); anchors.add(id);
  };
  let fence;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].replace(/^(?: {0,3}> ?)+/, ""), marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (marker && marker[1][0] === fence.character && marker[1].length >= fence.length && !marker[2].trim()) fence = undefined;
      visible.push(""); continue;
    }
    if (marker) {
      fence = { character: marker[1][0], length: marker[1].length, line: index + 1 };
      visible.push(""); continue;
    }
    if (/^(<<<<<<< |=======\s*$|>>>>>>> )/.test(line)) fail(index + 1, "Unresolved merge conflict marker");
    if (/^( {4}|\t)/.test(line)) { visible.push(""); continue; }
    const atx = line.match(/^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (atx) heading(atx[1]);
    else if (/^ {0,3}(?:=+|-+)\s*$/.test(line) && visible.at(-1)?.trim()) heading(visible.at(-1).trim());
    for (const anchor of line.matchAll(/\b(?:id|name)\s*=\s*["']([^"']+)["']/g)) anchors.add(anchor[1]);
    visible.push(line.replace(/(`+)([^]*?)\1/g, match => " ".repeat(match.length)));
  }
  if (fence) fail(fence.line, "Unclosed code fence");
  for (let index = 0; index < visible.length; index++) {
    const definition = visible[index].match(/^ {0,3}\[([^\]]+)\]:\s*(.*)$/);
    if (!definition || definition[1].startsWith("^")) continue;
    const continuation = !definition[2].trim() && /^\s+\S/.test(lines[index + 1] ?? "");
    const target = destination(continuation ? lines[index + 1].trim() : definition[2], 0);
    if (continuation) visible[index + 1] = "";
    if (!target) fail(index + 1, "Invalid reference-link destination");
    else {
      definitions.set(labelKey(definition[1]), target.value);
      links.push({ target: target.value, line: index + 1 });
    }
    visible[index] = "";
  }
  for (let index = 0; index < visible.length; index++) {
    const line = visible[index];
    for (const match of line.matchAll(/<[a-z][^>]*?\b(?:href|src)\s*=\s*["']([^"']+)["'][^>]*>/gi)) links.push({ target: match[1], line: index + 1 });
    for (const match of line.matchAll(/(?<!\\)\]\(/g)) {
      const target = destination(line, match.index + 2, true);
      if (!target || !/^\s*(?:(?:"[^"]*"|'[^']*'|\([^)]*\))\s*)?\)/.test(line.slice(target.end))) fail(index + 1, "Unclosed inline-link destination");
      else links.push({ target: target.value, line: index + 1 });
    }
    for (const match of line.matchAll(/(?<!\\)\[([^\]]+)\](?:\[([^\]]*)\])?/g)) {
      if (line[match.index + match[0].length] === "(" || match[1].startsWith("![")) continue;
      const key = labelKey(match[2] || match[1]);
      if (key.startsWith("^")) continue;
      if (definitions.has(key)) links.push({ target: definitions.get(key), line: index + 1 });
      else if (match[2] !== undefined) fail(index + 1, `Undefined reference link [${key}]`);
    }
  }
  return { anchors, links };
}

/** Owner and repository from package.json, so links back to this repository resolve offline. */
function repositorySlug(root) {
  try {
    const { repository } = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
    const url = typeof repository === "string" ? repository : repository?.url ?? "";
    return /github\.com[/:]([^/]+\/[^/.]+)/.exec(url)?.[1] ?? null;
  } catch { return null; }
}

/** Validate tracked Markdown without dependencies, network access or generated files. */
export function checkDocs(root, trackedFiles) {
  const files = trackedFiles ?? execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
  const tracked = new Set(files), errors = [], documents = new Map();
  const slug = repositorySlug(root);
  const repositoryLink = slug && new RegExp(`^https?://(?:www\\.)?github\\.com/${slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/(?:blob|tree)/([^/]+)/([^#?]+)`, "i");
  const present = candidate => tracked.has(candidate)
    || candidate === "." || candidate === "./"
    || files.some(file => file.startsWith(`${candidate.replace(/\/$/, "")}/`));
  for (const file of files.filter(markdown)) {
    try { documents.set(file, parse(file, readFileSync(resolve(root, file), "utf8"), errors)); }
    catch { errors.push({ file, line: 1, message: "Cannot read tracked Markdown file" }); }
  }
  for (const [file, document] of documents) for (const { target, line } of document.links) {
    const value = entities(unescape(target));
    const fail = message => errors.push({ file, line, message });
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value)) {
      // Links into this repository on a branch must still exist; commit-pinned links reference history.
      const repository = repositoryLink && repositoryLink.exec(value);
      if (repository && !/^[\da-f]{7,40}$/i.test(repository[1])) {
        let candidate;
        try { candidate = posix.normalize(decodeURIComponent(repository[2])); }
        catch { fail(`Invalid URL encoding in ${target}`); continue; }
        if (!present(candidate)) fail(`Missing tracked repository target: ${target}`);
      }
      continue;
    }
    let path, fragment;
    try {
      const hash = value.indexOf("#");
      path = decodeURIComponent((hash < 0 ? value : value.slice(0, hash)).split("?")[0]);
      fragment = hash < 0 ? "" : decodeURIComponent(value.slice(hash + 1));
    } catch { fail(`Invalid URL encoding in ${target}`); continue; }
    const resolved = path ? posix.normalize(path.startsWith("/") ? path.slice(1) : posix.join(posix.dirname(file), path)) : file;
    if (!present(resolved)) { fail(`Missing tracked local target: ${target}`); continue; }
    if (fragment && markdown(resolved) && !documents.get(resolved)?.anchors.has(fragment)) fail(`Missing Markdown anchor: ${target}`);
  }
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const errors = checkDocs(root);
  for (const error of errors) console.error(`${error.file}:${error.line}: ${error.message}`);
  if (errors.length) process.exitCode = 1;
  else console.log("Tracked Markdown links and structure passed.");
}
