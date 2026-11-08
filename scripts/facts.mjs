// Extract comparable fact sets from an unpacked Claude Code module tree (read-only).
// Usage: node facts.mjs <named-dir> > facts.json
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const root = process.argv[2];
const all = fs.readdirSync(root, { recursive: true }).filter((f) => fs.statSync(path.join(root, f)).isFile());
const isCode = (f) => /\.(js|mjs)$/.test(f) || f === "cli";
const code = all.filter(isCode).map((f) => fs.readFileSync(path.join(root, f), "utf8"));
const text = code.join("\n");

const count = (re, group = 1) => {
  const m = new Map();
  for (const x of text.matchAll(re)) m.set(x[group], (m.get(x[group]) || 0) + 1);
  return Object.fromEntries([...m].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
};
const firstArray = (re) => {
  // longest matching array literal wins (shorter subsets exist elsewhere)
  let best = null;
  for (const m of text.matchAll(new RegExp(re.source, "g"))) if (!best || m[0].length > best.length) best = m[0];
  return best ? JSON.parse(best) : null;
};

// Built-in tool names: string constants assigned to short minified identifiers.
const TOOL_CANDIDATES = /(?<![A-Za-z0-9_$])[A-Za-z0-9_$]{1,6}="([A-Z][A-Za-z]{1,30})"/g;
const toolDefs = {};
for (const s of code) {
  for (const m of s.matchAll(/name:([A-Za-z0-9_$]{1,6}),((?:[a-zA-Z]+:|async |get )[^]{0,1500}?)(?:create\(|async call\()/g)) {
    const body = m[2];
    const hint = (body.match(/searchHint:"([^"]*)"/) || [])[1];
    if (!hint) continue;
    const v = m[1].replace(/[$]/g, "\\$");
    const nm = (s.match(new RegExp(`(?<![A-Za-z0-9_$])${v}="([A-Za-z]+)"`)) || [])[1];
    const key = nm ?? `?${hint}`;
    toolDefs[key] = {
      searchHint: hint,
      maxResultSizeChars: (body.match(/maxResultSizeChars:([^,]+),/) || [])[1] ?? null,
      shouldDefer: (body.match(/shouldDefer:(!0|!1)/) || [])[1] ?? null,
      backgrounding: (body.match(/backgrounding:"([^"]*)"/) || [])[1] ?? null,
    };
  }
}

const assets = all
  .filter((f) => !isCode(f))
  .map((f) => f.replace(/\\/g, "/").replace(/-[a-z0-9]{8}(\.[A-Za-z0-9]+)(\.(?:txt|zst|asset))*$/, "$1$2"))
  .sort();

const skills = {};
for (const f of all.filter((f) => /(^|[\\/])SKILL-.*\.md(\.zst)?$/.test(f))) {
  let b = fs.readFileSync(path.join(root, f));
  if (f.endsWith(".zst")) b = zlib.zstdDecompressSync(b);
  const t = b.toString("utf8");
  const name = (t.match(/^name:\s*"?([^"\n]+)"?$/m) || [])[1] ?? "(unnamed)";
  const desc = ((t.match(/^description:\s*"?(.+?)"?$/m) || [])[1] ?? "").slice(0, 80);
  skills[`${name} | ${desc}`] = true;
}

const facts = {
  moduleCount: all.length,
  codeModules: code.length,
  codeBytes: code.reduce((a, s) => a + s.length, 0),
  versionHeader: (code.find((s) => /\/\/ Version: /.test(s)) || "").match(/\/\/ Version: (\S+)/)?.[1] ?? null,
  hookEvents: firstArray(/\["PreToolUse","PostToolUse","PostToolUseFailure"[^\]]*\]/),
  permissionModes: firstArray(/\["dontAsk"[^\]]*"bypassPermissions"[^\]]*\]|\["default","acceptEdits","plan"[^\]]*\]/),
  hookTypes: firstArray(/\["prompt","agent","http"[^\]]*\]/),
  toolNameConstants: count(TOOL_CANDIDATES),
  toolDefs,
  agentTypes: count(/agentType:"([A-Za-z-]+)"/g),
  querySources: count(/querySource:"([a-z_:]+)"/g),
  tenguEvents: count(/\b(tengu_[a-z0-9_]+)/g),
  envVars: count(/\b((?:CLAUDE_CODE|ANTHROPIC|CLAUDE|MCP|BASH|DISABLE|ENABLE)_[A-Z0-9_]+)\b/g),
  betas: count(/"([a-z-]+-20[0-9]{2}-[0-9]{2}-[0-9]{2})"/g),
  contextEdits: count(/"((?:clear_tool_uses|clear_thinking|compact)_[0-9]{8})"/g),
  mcpMetaKeys: count(/"(anthropic\/[a-zA-Z]+)"/g),
  modelIds: count(/"(claude-(?:opus|sonnet|haiku|fable)-[0-9a-z-]+)"/g),
  assets,
  skills: Object.keys(skills).sort(),
};
console.log(JSON.stringify(facts, null, 1));
