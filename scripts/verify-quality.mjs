import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
const dir = mkdtempSync(join(tmpdir(), 'naryadai-quality-'));
try {
  await build({
    entryPoints: ['tests/quality_regression.mjs'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: join(dir, 'quality.mjs'),
  });
  execFileSync(process.execPath, [join(dir, 'quality.mjs')], {
    stdio: 'inherit',
    env: {
      ...process.env,
      QUALITY_XLSX: join(dir, 'report.xlsx'),
      QUALITY_LITERAL: join(dir, 'literal.xlsx'),
    },
  });
  execFileSync(
    'python3',
    [
      '-c',
      `import zipfile,xml.etree.ElementTree as E,sys
ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
with zipfile.ZipFile(sys.argv[1]) as z:
 assert z.testzip() is None
 root=E.fromstring(z.read('xl/workbook.xml'))
 assert len(root.findall('s:sheets/s:sheet',ns))==8
 for n in z.namelist():
  if n.endswith('.xml') or n.endswith('.rels'): E.fromstring(z.read(n))
with zipfile.ZipFile(sys.argv[2]) as z:
 assert b'<f>' not in z.read('xl/worksheets/sheet1.xml')
 assert b'inlineStr' in z.read('xl/worksheets/sheet1.xml')
print('PASS: XLSX CRC, eight-sheet XML/relationships, formula-like text stays literal.')`,
      join(dir, 'report.xlsx'),
      join(dir, 'literal.xlsx'),
    ],
    { stdio: 'inherit' },
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
