// Minimal standards-based XLSX writer: inline strings, numeric cells, uncompressed ZIP.
const enc = new TextEncoder();
const xml = (s: any) =>
  String(s ?? '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .replace(
      /[<>&"']/g,
      (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!,
    );
function crc(bytes: Uint8Array) {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function u16(n: number) {
  return [n & 255, (n >>> 8) & 255];
}
function u32(n: number) {
  return [...u16(n), ...u16(n >>> 16)];
}
function zip(files: Record<string, string>) {
  const parts: Uint8Array[] = [];
  const central: number[] = [];
  let offset = 0;
  for (const [path, content] of Object.entries(files)) {
    const name = enc.encode(path),
      data = enc.encode(content),
      sum = crc(data);
    const h = new Uint8Array([
      ...u32(0x04034b50),
      ...u16(20),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u16(33),
      ...u32(sum),
      ...u32(data.length),
      ...u32(data.length),
      ...u16(name.length),
      ...u16(0),
      ...name,
    ]);
    parts.push(h, data);
    central.push(
      ...u32(0x02014b50),
      ...u16(20),
      ...u16(20),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u16(33),
      ...u32(sum),
      ...u32(data.length),
      ...u32(data.length),
      ...u16(name.length),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(0),
      ...u32(offset),
      ...name,
    );
    offset += h.length + data.length;
  }
  const count = Object.keys(files).length;
  parts.push(
    new Uint8Array(central),
    new Uint8Array([
      ...u32(0x06054b50),
      ...u16(0),
      ...u16(0),
      ...u16(count),
      ...u16(count),
      ...u32(central.length),
      ...u32(offset),
      ...u16(0),
    ]),
  );
  return new Blob(parts as BlobPart[], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}
const col = (i: number) => {
  let s = '';
  for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
};

function sheetXml(rows: any[][]) {
  const body = rows
    .map(
      (row, r) =>
        `<row r="${r + 1}">${row.map((v, c) => (typeof v === 'number' && Number.isFinite(v) ? `<c r="${col(c)}${r + 1}"><v>${v}</v></c>` : `<c r="${col(c)}${r + 1}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`)).join('')}</row>`,
    )
    .join('');
  const width = Math.max(1, ...rows.map((r) => r.length));
  return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="1" width="14" customWidth="1"/><col min="2" max="4" width="34" customWidth="1"/><col min="5" max="${Math.max(5, width)}" width="20" customWidth="1"/></cols><sheetData>${body}</sheetData>${rows.length > 1 ? `<autoFilter ref="A1:${col(width - 1)}${rows.length}"/>` : ''}</worksheet>`;
}

/** Книга Excel из нескольких листов (имена листов — до 31 символа, без []:*?/\). */
export function createXlsxBook(sheets: { name: string; rows: any[][] }[]) {
  const list = sheets.filter((s) => s.rows.length);
  const forbidden = new Set(['[', ']', ':', '*', '?', '/', '\\']);
  const names = list.map(
    (s, i) =>
      [...s.name]
        .map((ch) => (forbidden.has(ch) ? ' ' : ch))
        .join('')
        .slice(0, 31) || `Лист${i + 1}`,
  );
  const files: Record<string, string> = {
    '[Content_Types].xml':
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      list
        .map(
          (_, i) =>
            `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
        )
        .join('') +
      '</Types>',
    '_rels/.rels':
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml':
      '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      names.map((n, i) => `<sheet name="${xml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
      '</sheets></workbook>',
    'xl/_rels/workbook.xml.rels':
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      list
        .map(
          (_, i) =>
            `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
        )
        .join('') +
      '</Relationships>',
  };
  list.forEach((s, i) => (files[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(s.rows)));
  return zip(files);
}

export function createXlsx(rows: any[][]) {
  return createXlsxBook([{ name: 'Наряды', rows }]);
}
