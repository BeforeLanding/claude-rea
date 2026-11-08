// Diff two facts.json files produced by facts.mjs.
import fs from "node:fs";
const [a, b] = process.argv.slice(2).map((p) => JSON.parse(fs.readFileSync(p, "utf8")));
const keysOf = (x) => (Array.isArray(x) ? x : Object.keys(x ?? {}));
const out = {};
for (const k of ["hookEvents", "permissionModes", "hookTypes", "toolNameConstants", "toolDefs", "agentTypes", "querySources", "tenguEvents", "envVars", "betas", "contextEdits", "mcpMetaKeys", "modelIds", "assets", "skills"]) {
  const A = new Set(keysOf(a[k])), B = new Set(keysOf(b[k]));
  out[k] = { before: A.size, after: B.size, added: [...B].filter((x) => !A.has(x)).sort(), removed: [...A].filter((x) => !B.has(x)).sort() };
}
// attribute changes for tools present in both
out.toolAttrChanges = {};
for (const t of Object.keys(b.toolDefs)) if (a.toolDefs[t] && JSON.stringify(a.toolDefs[t]) !== JSON.stringify(b.toolDefs[t])) out.toolAttrChanges[t] = { before: a.toolDefs[t], after: b.toolDefs[t] };
for (const k of ["moduleCount", "codeModules", "codeBytes", "versionHeader"]) out[k] = [a[k], b[k]];
console.log(JSON.stringify(out, null, 1));
