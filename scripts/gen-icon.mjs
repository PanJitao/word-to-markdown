// 生成一张 1024x1024 的渐变色 PNG 作为应用图标源文件（无第三方依赖）
// 之后用 `npx @tauri-apps/cli icon` 派生 .ico / .icns / 各尺寸 png
import zlib from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const SIZE = 1024
const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, '..', 'app-icon.png')

// 极简 CRC32
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
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
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}

// 像素：橙色渐变 + 圆角 + 居中 "Md" 字样（用简单像素方块绘制）
const raw = Buffer.alloc(SIZE * (1 + SIZE * 4))
const cx = SIZE / 2
const cy = SIZE / 2
const radius = SIZE * 0.46

for (let y = 0; y < SIZE; y++) {
  raw[y * (1 + SIZE * 4)] = 0 // 滤镜字节
  for (let x = 0; x < SIZE; x++) {
    // 圆角遮罩：圆外的像素设为透明
    const dx = x - cx
    const dy = y - cy
    const inside = dx * dx + dy * dy <= radius * radius
    const off = y * (1 + SIZE * 4) + 1 + x * 4
    // 渐变色（左上橙黄 -> 右下深橙）
    const t = (x + y) / (2 * SIZE)
    const r = Math.round(240 - t * 110)
    const g = Math.round(150 - t * 90)
    const b = Math.round(60 - t * 20)
    raw[off] = inside ? r : 0
    raw[off + 1] = inside ? g : 0
    raw[off + 2] = inside ? b : 0
    raw[off + 3] = inside ? 255 : 0
  }
}

// 叠加一个简化的白色 "M" 像素图案，让人一眼认出是 Markdown 工具
const white = [255, 250, 243]
function plot(px, py, w, h) {
  for (let y = Math.floor(py); y < Math.floor(py + h); y++) {
    for (let x = Math.floor(px); x < Math.floor(px + w); x++) {
      if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) continue
      const dx = x - cx
      const dy = y - cy
      if (dx * dx + dy * dy > radius * radius) continue
      const off = y * (1 + SIZE * 4) + 1 + x * 4
      raw[off] = white[0]
      raw[off + 1] = white[1]
      raw[off + 2] = white[2]
      raw[off + 3] = 255
    }
  }
}

// "M" 形：两条竖线 + 中间 V
const u = SIZE / 1024 // 单位缩放
const top = 360 * u
const bottom = 660 * u
const leftX = 360 * u
const rightX = 664 * u
const thick = 60 * u
plot(leftX, top, thick, bottom - top) // 左竖
plot(rightX - thick, top, thick, bottom - top) // 右竖
plot(leftX, top, thick, thick) // 左上横段
// 中间斜线 V
for (let i = 0; i < 1; i += 1 / 100) {
  const xx = leftX + thick + i * (rightX - thick - (leftX + thick))
  const yy = top + i * (90 * u)
  plot(xx, yy, thick, thick)
  const xx2 = rightX - thick - i * (rightX - thick - (leftX + thick))
  plot(xx2, yy, thick, thick)
}

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8 // 位深
ihdr[9] = 6 // 颜色类型 RGBA
ihdr[10] = 0
ihdr[11] = 0
ihdr[12] = 0

const idat = zlib.deflateSync(raw, { level: 9 })
const png = Buffer.concat([
  signature,
  chunk('IHDR', ihdr),
  chunk('IDAT', idat),
  chunk('IEND', Buffer.alloc(0)),
])

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, png)
console.log(`已生成图标源文件：${OUT} (${(png.length / 1024).toFixed(1)} KB)`)
