/**
 * Genera apple-touch-icon.png (180×180), icon-192.png, icon-512.png
 * nella cartella public/ — zero dipendenze npm, solo moduli Node built-in.
 * Design ricalcato dal favicon.svg del progetto.
 */
import zlib from 'zlib'
import fs   from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC    = path.join(__dirname, '..', 'public')

// ── Helpers colore ──────────────────────────────────────────────
function hex(h) {
  h = h.replace('#', '')
  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)]
}

// ── PNG encoder (puro Node) ─────────────────────────────────────
function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) {
    c ^= b
    for (let i = 0; i < 8; i++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
  }
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const t   = Buffer.from(type, 'ascii')
  const d   = Buffer.isBuffer(data) ? data : Buffer.from(data)
  const len = Buffer.allocUnsafe(4)
  len.writeUInt32BE(d.length)
  const crcBuf = Buffer.allocUnsafe(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([t, d])))
  return Buffer.concat([len, t, d, crcBuf])
}

function encodePNG(W, H, px) {
  // px = Float32Array or array of [r,g,b] triplets, row-major
  const rows = []
  for (let y = 0; y < H; y++) {
    rows.push(0) // filter: None
    for (let x = 0; x < W; x++) {
      const [r,g,b] = px[y*W+x]
      rows.push(r, g, b)
    }
  }
  const raw        = Buffer.from(rows)
  const compressed = zlib.deflateSync(raw, { level: 9 })
  const ihdr = Buffer.allocUnsafe(13)
  ihdr.writeUInt32BE(W, 0)
  ihdr.writeUInt32BE(H, 4)
  ihdr[8]  = 8   // bit depth
  ihdr[9]  = 2   // color type: RGB
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0

  return Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]), // PNG signature
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

// ── Disegna icona ───────────────────────────────────────────────
function makeIcon(size) {
  const W = size, H = size
  const s = size / 64            // scala dal design 64×64 dell'SVG

  const BG  = hex('#1c2818')     // sfondo scuro olivastro
  const HDR = hex('#2563eb')     // header calendario (blu SVG)
  const CAL = hex('#ffffff')     // corpo calendario
  const CL  = hex('#93c5fd')     // celle griglia chiare
  const CVL = hex('#dbeafe')     // celle griglia molto chiare
  const RED = hex('#ef4444')     // croce medica
  const WHI = hex('#ffffff')

  const px = Array.from({ length: W * H }, () => [...BG])

  function setp(x, y, c) {
    if (x >= 0 && x < W && y >= 0 && y < H) px[Math.round(y)*W + Math.round(x)] = c
  }
  function rect(x0, y0, x1, y1, c) {
    for (let y = Math.max(0, Math.round(y0)); y < Math.min(H, Math.round(y1)); y++)
      for (let x = Math.max(0, Math.round(x0)); x < Math.min(W, Math.round(x1)); x++)
        px[y*W+x] = c
  }
  function circle(cx, cy, r, c) {
    cx = Math.round(cx); cy = Math.round(cy); r = Math.round(r)
    const r2 = r*r
    for (let y = Math.max(0,cy-r); y < Math.min(H,cy+r+1); y++)
      for (let x = Math.max(0,cx-r); x < Math.min(W,cx+r+1); x++)
        if ((x-cx)**2+(y-cy)**2 <= r2) px[y*W+x] = c
  }
  function rrect(x0,y0,x1,y1,rx,c) {
    rx = Math.round(rx)
    rect(x0+rx, y0,   x1-rx, y1,   c)
    rect(x0,    y0+rx,x1,    y1-rx,c)
    circle(x0+rx, y0+rx, rx, c)
    circle(x1-rx, y0+rx, rx, c)
    circle(x0+rx, y1-rx, rx, c)
    circle(x1-rx, y1-rx, rx, c)
  }
  const sc = v => v * s

  // Sfondo (pieno — l'OS applica la maschera arrotondata sull'icona)
  rect(0, 0, W, H, BG)

  // Corpo calendario
  rect(sc(10), sc(16), sc(54), sc(52), CAL)

  // Header calendario (blu)
  rect(sc(10), sc(16), sc(54), sc(29), HDR)

  // Ganci superiori
  rrect(sc(20), sc(11), sc(25), sc(21), sc(2.5), WHI)
  rrect(sc(39), sc(11), sc(44), sc(21), sc(2.5), WHI)

  // Griglia — riga 1
  rrect(sc(16), sc(36), sc(22), sc(41), sc(1.5), CL)
  rrect(sc(26), sc(36), sc(32), sc(41), sc(1.5), CL)
  rrect(sc(36), sc(36), sc(42), sc(41), sc(1.5), CVL)
  rrect(sc(46), sc(36), sc(52), sc(41), sc(1.5), CL)

  // Griglia — riga 2
  rrect(sc(16), sc(44), sc(22), sc(49), sc(1.5), CVL)
  rrect(sc(26), sc(44), sc(32), sc(49), sc(1.5), CL)
  rrect(sc(36), sc(44), sc(42), sc(49), sc(1.5), CL)
  rrect(sc(46), sc(44), sc(52), sc(49), sc(1.5), CVL)

  // Cerchio rosso (croce medica)
  circle(sc(46), sc(26), sc(7), RED)

  // Croce bianca
  rect(sc(43.5), sc(22),   sc(48.5), sc(30),   WHI)  // verticale
  rect(sc(42),   sc(23.5), sc(54),   sc(28.5), WHI)  // orizzontale

  return encodePNG(W, H, px)
}

// ── Genera i file ───────────────────────────────────────────────
const icons = [
  [180, 'apple-touch-icon.png'],
  [192, 'icon-192.png'],
  [512, 'icon-512.png'],
]

for (const [size, name] of icons) {
  const buf  = makeIcon(size)
  const dest = path.join(PUBLIC, name)
  fs.writeFileSync(dest, buf)
  console.log(`✓  ${name}  (${size}×${size},  ${(buf.length/1024).toFixed(1)} KB)`)
}
