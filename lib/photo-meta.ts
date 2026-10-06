// Метаданные фото для проверки «снимок свежий и не повторяет старый» (ТЗ 6.3.1).
// Считаются на телефоне до сжатия: дата съёмки из EXIF и перцептивный хэш dHash (64 бита).

/** Дата съёмки из EXIF (DateTimeOriginal, иначе DateTime) или null. Только JPEG. */
export async function readExifDate(file: Blob): Promise<string | null> {
  try {
    const buf = await file.slice(0, 256 * 1024).arrayBuffer();
    const v = new DataView(buf);
    if (v.getUint16(0) !== 0xffd8) return null;
    let off = 2;
    while (off + 4 < v.byteLength) {
      const marker = v.getUint16(off);
      const size = v.getUint16(off + 2);
      if (marker === 0xffe1 && v.getUint32(off + 4) === 0x45786966) return parseTiff(v, off + 10);
      if ((marker & 0xff00) !== 0xff00) return null;
      off += 2 + size;
    }
  } catch {}
  return null;
}

function parseTiff(v: DataView, start: number): string | null {
  const little = v.getUint16(start) === 0x4949;
  const u16 = (o: number) => v.getUint16(start + o, little);
  const u32 = (o: number) => v.getUint32(start + o, little);
  const ascii = (o: number, n: number) => {
    let s = '';
    for (let i = 0; i < n - 1; i++) s += String.fromCharCode(v.getUint8(start + o + i));
    return s;
  };
  const readIfd = (ifd: number) => {
    const tags: Record<number, number> = {};
    const count = u16(ifd);
    for (let i = 0; i < count; i++) {
      const e = ifd + 2 + i * 12;
      tags[u16(e)] = e;
    }
    return tags;
  };
  const toIso = (raw: string) => {
    const m = raw.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
    if (!m) return null;
    // EXIF хранит локальное время устройства без пояса — трактуем как локальное время телефона.
    const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
  };
  const ifd0 = readIfd(u32(4));
  const exifPtr = ifd0[0x8769];
  if (exifPtr !== undefined) {
    const exif = readIfd(u32(exifPtr + 8));
    const e = exif[0x9003];
    if (e !== undefined) return toIso(ascii(u32(e + 8), u32(e + 4)));
  }
  const dt = ifd0[0x0132];
  return dt !== undefined ? toIso(ascii(u32(dt + 8), u32(dt + 4))) : null;
}

/** Перцептивный хэш: похожие снимки дают хэши с малым расстоянием Хэмминга. */
export function dHash(source: CanvasImageSource): string {
  const c = document.createElement('canvas');
  c.width = 9;
  c.height = 8;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0, 9, 8);
  const px = ctx.getImageData(0, 0, 9, 8).data;
  const gray = (x: number, y: number) => {
    const i = (y * 9 + x) * 4;
    return px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
  };
  let bits = '';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += gray(x, y) > gray(x + 1, y) ? '1' : '0';
  let hex = '';
  for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

export function hamming(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return 64;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}
