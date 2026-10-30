param()
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
$buildRoot = Join-Path $projectRoot '.build'
New-Item -ItemType Directory -Path $buildRoot -Force | Out-Null

# Fetch the same pinned Mozilla dependency as the desktop build, without .NET.
$archive = Join-Path $buildRoot 'pdfjs-dist-5.4.624.tgz'
if (!(Test-Path -LiteralPath $archive)) {
    Invoke-WebRequest -Uri 'https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-5.4.624.tgz' -OutFile $archive
}
$expectedHash = '5c387457cd03cc2e7b9c9b1ed642e8148d1ba44c3b8e5b5b771526feb24b61b9'
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedHash) { throw 'PDF.js package integrity check failed.' }
$unpackRoot = Join-Path $buildRoot 'pdfjs-unpacked'
New-Item -ItemType Directory -Path $unpackRoot -Force | Out-Null
& tar -xzf $archive -C $unpackRoot
if ($LASTEXITCODE -ne 0) { throw 'Unable to extract the pinned PDF.js package.' }
$dependencyRoot = Join-Path $projectRoot 'web/vendor/pdfjs'
New-Item -ItemType Directory -Path $dependencyRoot -Force | Out-Null
foreach ($name in @('pdf.mjs', 'pdf.worker.mjs')) {
    Copy-Item -LiteralPath (Join-Path $unpackRoot "package/build/$name") -Destination (Join-Path $dependencyRoot $name) -Force
}
foreach ($name in @('LICENSE', 'package.json', 'cmaps', 'standard_fonts', 'wasm')) {
    Copy-Item -LiteralPath (Join-Path $unpackRoot "package/$name") -Destination $dependencyRoot -Recurse -Force
}

$webRoot = Join-Path $projectRoot 'web'
& (Join-Path $PSScriptRoot 'assert-public-web.ps1') -WebRoot $webRoot
$output = [IO.Path]::GetFullPath((Join-Path $buildRoot 'pages'))
if ($output -ne [IO.Path]::GetFullPath((Join-Path $projectRoot '.build/pages'))) { throw 'The Pages output path is outside the expected build folder.' }
if (Test-Path -LiteralPath $output) {
    if ((Get-Item -LiteralPath $output).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'The Pages output directory must not be a symbolic link.' }
    Remove-Item -LiteralPath $output -Recurse -Force
}
New-Item -ItemType Directory -Path $output -Force | Out-Null
Get-ChildItem -LiteralPath $webRoot -Force | Copy-Item -Destination $output -Recurse -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'licenses') -Destination $output -Recurse -Force
foreach ($name in @('LICENSE', 'THIRD_PARTY_NOTICES.md', 'README.md', 'VERIFICATION.md')) {
    Copy-Item -LiteralPath (Join-Path $projectRoot $name) -Destination $output -Force
}
New-Item -ItemType File -Path (Join-Path $output '.nojekyll') -Force | Out-Null
& (Join-Path $PSScriptRoot 'assert-public-web.ps1') -WebRoot $output
Write-Output "GitHub Pages artifact: $output"
