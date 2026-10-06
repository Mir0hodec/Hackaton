# Собирает архив для загрузки в ChatGPT Sites в том же формате, что и исходная поставка:
#   NaryadAI/<исходники>  +  START.html (берётся из папки уровнем выше, рядом с проектом)
# В архив попадают только файлы, которые git не игнорирует (секреты, node_modules, dist,
# .wrangler и .dev.vars исключены через .gitignore). Незакоммиченные изменения включаются.
#
# Запуск из папки проекта:  powershell -ExecutionPolicy Bypass -File scripts/pack-sites.ps1
param(
  [string]$OutDir = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem

$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
  $files = git -c core.quotepath=off ls-files --cached --others --exclude-standard
  if ($LASTEXITCODE -ne 0) { throw 'git ls-files завершился с ошибкой' }
} finally { Pop-Location }

$blocked = '(^|/)(\.dev\.vars|\.env(?!\.example$))|private_access|(^|/)node_modules/|(^|/)dist/|(^|/)\.wrangler/'
$stamp = Get-Date -Format 'yyyyMMdd-HHmm'
$zipPath = Join-Path $OutDir "NaryadAI_site_$stamp.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

$zip = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)
$count = 0
try {
  foreach ($file in $files) {
    if ($file -match $blocked) { throw "Попытка упаковать запрещённый файл: $file" }
    $full = Join-Path $root $file
    if (-not (Test-Path $full -PathType Leaf)) { continue }  # удалён в рабочей копии
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $full, "NaryadAI/$file", [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    $count++
  }
  $start = Join-Path (Split-Path -Parent $root) 'START.html'
  if (Test-Path $start) {
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $start, 'START.html', [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    $count++
  }
} finally { $zip.Dispose() }

$size = [math]::Round((Get-Item $zipPath).Length / 1KB)
Write-Output "Готово: $zipPath ($count файлов, $size КБ)"
