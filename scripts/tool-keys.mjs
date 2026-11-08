// Count property names that appear across built-in tool definition objects (approximate, top-level heuristic).
import fs from "node:fs"; import path from "node:path";
const root = process.argv[2];
const files = fs.readdirSync(root, { recursive: true }).filter(f => /\.(js|mjs)$/.test(f) || f === "cli");
const src = files.map(f => fs.readFileSync(path.join(root, f), "utf8"));
const counts = new Map(); let tools = 0;
for (const s of src) for (const m of s.matchAll(/name:[A-Za-z0-9_$]{1,6},(?=(?:[a-zA-Z]+:|async |get )[^]{0,400}?(?:inputSchema|maxResultSizeChars))/g)) {
  // walk until matching brace depth returns below 0
  let i = m.index, depth = 0, keys = new Set();
  for (let j = i; j < Math.min(s.length, i + 60000); j++) {
    const c = s[j];
    if (c === "{" || c === "(" || c === "[") depth++;
    else if (c === "}" || c === ")" || c === "]") { if (depth === 0) break; depth--; }
    else if (depth === 0 && (c === "," || j === i)) {
      const k = s.slice(j === i ? j : j + 1, j + 60).match(/^(?:async |get |\*)?([a-zA-Z][a-zA-Z0-9]*)\s*[:(]/);
      if (k) keys.add(k[1]);
    } else if (c === '"' || c === "'" || c === "`") { const q = c; j++; while (j < s.length && s[j] !== q) { if (s[j] === "\\") j++; j++; } }
  }
  if (keys.has("inputSchema") || keys.has("maxResultSizeChars")) { tools++; for (const k of keys) counts.set(k, (counts.get(k) || 0) + 1); }
}
console.log("tool-like objects:", tools);
console.log([...counts].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v}\t${k}`).join("\n"));
