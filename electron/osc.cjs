// Minimal OSC 1.0 encoder for VRChat (strings, bools, ints, floats).
function pad4(buf) {
  const len = buf.length + 1; // null terminator
  const padded = Math.ceil(len / 4) * 4;
  const out = Buffer.alloc(padded);
  buf.copy(out);
  return out;
}
function oscString(s) { return pad4(Buffer.from(String(s), 'utf8')); }
function encode(address, args = []) {
  let tags = ',';
  const parts = [];
  for (const a of args) {
    if (typeof a === 'boolean') tags += a ? 'T' : 'F';
    else if (typeof a === 'number' && Number.isInteger(a)) { tags += 'i'; const b = Buffer.alloc(4); b.writeInt32BE(a); parts.push(b); }
    else if (typeof a === 'number') { tags += 'f'; const b = Buffer.alloc(4); b.writeFloatBE(a); parts.push(b); }
    else { tags += 's'; parts.push(oscString(a)); }
  }
  return Buffer.concat([oscString(address), oscString(tags), ...parts]);
}
module.exports = { encode };
