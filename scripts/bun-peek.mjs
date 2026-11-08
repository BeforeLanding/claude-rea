// Read-only peek at a PE .bun section: offsets trailer + module table records.
import fs from "node:fs";
const [file, rawptrS, sizeS] = process.argv.slice(2);
const fd = fs.openSync(file, "r");
const rd = (off, len) => { const b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, off); return b; };
const sec = Number(rawptrS), secSize = Number(sizeS);
const plen = Number(rd(sec, 8).readBigUInt64LE(0));
console.log("payload length prefix", plen);
const base = sec + 8;
const suffix = rd(base + plen - 48, 48);
console.log("trailer", JSON.stringify(suffix.subarray(32).toString("latin1")));
const o = suffix.subarray(0, 32);
const byteCount = Number(o.readBigUInt64LE(0));
const modOff = o.readUInt32LE(8), modLen = o.readUInt32LE(12), entry = o.readUInt32LE(16);
const argvOff = o.readUInt32LE(20), argvLen = o.readUInt32LE(24), flags = o.readUInt32LE(28);
console.log({ byteCount, modOff, modLen, entry, argvOff, argvLen, flags, rec52: modLen / 52, rec36: modLen / 36 });
console.log("execArgv", JSON.stringify(rd(base + argvOff, argvLen).toString("utf8")));
const tab = rd(base + modOff, modLen);
const R = Number(process.argv[5] || 52);
const n = modLen / R;
for (let i = 0; i < Math.min(n, Number(process.argv[6] || 1e9)); i++) {
  const r = tab.subarray(i * R, (i + 1) * R);
  const ptrs = []; for (let k = 0; k + 8 <= R; k += 8) ptrs.push([r.readUInt32LE(k), r.readUInt32LE(k + 4)]);
  const name = rd(base + ptrs[0][0], Math.min(ptrs[0][1], 200)).toString("utf8");
  console.log(i, name, JSON.stringify(ptrs.slice(1)), r.subarray(Math.floor(R / 8) * 8).toString("hex"));
}
