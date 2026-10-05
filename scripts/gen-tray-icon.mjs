/**
 * Generates the menu-bar tray icon (monochrome PNG, used as a macOS template image).
 * Usage: npm run gen:icons  ->  resources/tray.png (+ @2x)
 * Minimal dependency-free PNG encoder (zlib + CRC32).
 */
import { deflateSync } from 'zlib'
import { writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const here = dirname(fileURLToPath(import.meta.url))

/* ---------- tiny PNG encoder ---------- */

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

/** alphaAt: (x, y) => alpha 0..255 ; drawn in black (template image) */
function encodePng(size, alphaAt) {
  const raw = Buffer.alloc(size * (size * 4 + 1))
  let o = 0
  for (let y = 0; y < size; y++) {
    raw[o++] = 0 // filter: none
    for (let x = 0; x < size; x++) {
      const a = Math.max(0, Math.min(255, Math.round(alphaAt(x, y))))
      raw[o++] = 0 // R
      raw[o++] = 0 // G
      raw[o++] = 0 // B
      raw[o++] = a // A
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/* ---------- glyph: three rising bars over a baseline (usage chart) ---------- */

function glyph(size) {
  const u = size / 18 // design grid of 18 units
  const bars = [
    { x: 3, h: 6 },
    { x: 8, h: 10 },
    { x: 13, h: 14 }
  ]
  const barW = 3
  const baseY = 15.5
  return (px, py) => {
    const x = px / u
    const y = py / u
    // baseline
    if (y >= baseY && y < baseY + 1.6 && x >= 2.5 && x <= 16.5) return 255
    for (const b of bars) {
      const top = baseY - b.h
      if (x >= b.x && x < b.x + barW && y >= top && y < baseY - 0.8) return 255
    }
    return 0
  }
}

const outDir = join(here, '..', 'resources')
mkdirSync(outDir, { recursive: true })
// macOS menu bar template icons are 18pt: 18px @1x, 36px @2x
writeFileSync(join(outDir, 'tray.png'), encodePng(18, glyph(18)))
writeFileSync(join(outDir, 'tray@2x.png'), encodePng(36, glyph(36)))
console.log('tray icons written to resources/')
