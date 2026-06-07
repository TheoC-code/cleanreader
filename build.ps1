$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$out  = Join-Path $here "reader.xpi"
$tmp  = Join-Path $here "reader.zip"
if (Test-Path $out) { Remove-Item $out }
if (Test-Path $tmp) { Remove-Item $tmp }

$files = @("manifest.json","popup.html","popup.js","extractor.js","importers.js",
           "reader.html","reader.js","reader.css")
foreach ($f in $files) {
  if (-not (Test-Path (Join-Path $here $f))) { throw "Missing $f" }
}

Push-Location $here
try {
  Compress-Archive -Path $files -DestinationPath $tmp -Force
  Rename-Item -Path $tmp -NewName "reader.xpi"
} finally { Pop-Location }

Write-Host "Built: $out"
