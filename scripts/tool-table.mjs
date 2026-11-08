// Build a table of built-in tool attributes from extracted (read-only) Claude Code modules.
import fs from "node:fs"; import path from "node:path";
const root = process.argv[2];
const files = fs.readdirSync(root, { recursive: true }).filter(f => /\.(js|mjs)$/.test(f) || f === "cli").map(f => path.join(root, f));
const src = files.map(f => [path.basename(f), fs.readFileSync(f, "utf8")]);
const names = process.argv.slice(3);
const rows = [];
for (const n of names) {
  const vars = new Set();
  for (const [, s] of src) for (const m of s.matchAll(new RegExp(String.raw`(?<![A-Za-z0-9_$])([A-Za-z0-9_$]{1,6})="` + n + `"`, "g"))) vars.add(m[1]);
  let hit = null;
  for (const v of vars) for (const [fn, s] of src) {
    const re = new RegExp(`name:${v.replace(/\$/g, "\$")},(?:searchHint|aliases|backgrounding|maxResultSizeChars|async description|strict|isMcp|userFacingName|get inputSchema)`, "g");
    const m = re.exec(s); if (m) { hit = { fn, body: s.slice(m.index, m.index + 6000) }; break; }
    if (hit) break;
  }
  if (!hit) { rows.push({ tool: n, found: false }); continue; }
  const b = hit.body;
  const g = (re) => (b.match(re) || [])[1] ?? "";
  rows.push({
    tool: n, chunk: hit.fn,
    searchHint: g(/searchHint:"([^"]*)"/),
    aliases: g(/aliases:\[([^\]]*)\]/),
    maxResultSizeChars: g(/maxResultSizeChars:([^,]+),/),
    userFacingName: g(/userFacingName\([^)]*\)\{return"([^"]*)"/),
    concurrencySafe: g(/isConcurrencySafe\([^)]*\)\{return([^}]{1,40})\}/),
    readOnly: g(/isReadOnly\([^)]*\)\{return([^}]{1,40})\}/),
    shouldDefer: g(/shouldDefer:([^,]+),/),
    alwaysLoad: g(/alwaysLoad:([^,]+),/),
    backgrounding: g(/backgrounding:"([^"]*)"/),
    remoteExecution: /remoteExecution:\{supported:!0\}/.test(b),
  });
}
console.log(JSON.stringify(rows, null, 1));
