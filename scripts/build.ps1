param(
    [string]$Dotnet = 'dotnet',
    [string]$OutputDirectory = '',
    [switch]$NoRestore
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$buildRoot = Join-Path $projectRoot '.build'
if (!$OutputDirectory) { $OutputDirectory = Join-Path $projectRoot 'publish' }
New-Item -ItemType Directory -Path $buildRoot -Force | Out-Null

# Mozilla PDF.js is an app dependency. No exam material is downloaded by this build.
$dependencyRoot = Join-Path $projectRoot 'web/vendor/pdfjs'
& {
    $archive = Join-Path $buildRoot 'pdfjs-dist-5.4.624.tgz'
    if (!(Test-Path -LiteralPath $archive)) {
        Invoke-WebRequest -Uri 'https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-5.4.624.tgz' -OutFile $archive
    }
    $expectedHash = '5c387457cd03cc2e7b9c9b1ed642e8148d1ba44c3b8e5b5b771526feb24b61b9'
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedHash) {
        throw 'PDF.js package integrity check failed.'
    }
    $unpackRoot = Join-Path $buildRoot 'pdfjs-unpacked'
    New-Item -ItemType Directory -Path $unpackRoot -Force | Out-Null
    & tar -xzf $archive -C $unpackRoot
    if ($LASTEXITCODE -ne 0) { throw 'Unable to extract the PDF.js package with Windows tar.' }
    New-Item -ItemType Directory -Path $dependencyRoot -Force | Out-Null
    foreach ($name in @('pdf.mjs','pdf.worker.mjs')) {
        Copy-Item -LiteralPath (Join-Path $unpackRoot "package/build/$name") -Destination (Join-Path $dependencyRoot $name) -Force
    }
    foreach ($name in @('LICENSE','package.json','cmaps','standard_fonts','wasm')) {
        Copy-Item -LiteralPath (Join-Path $unpackRoot "package/$name") -Destination $dependencyRoot -Recurse -Force
    }
}

$webRoot = Join-Path $projectRoot 'web'
$forbidden = Get-ChildItem -LiteralPath $webRoot -Recurse -File | Where-Object {
    $_.Extension -in @('.pdf','.webp') -or $_.FullName -match '[\\/]assets[\\/](questions|solutions)[\\/]'
}
if ($forbidden) { throw 'Public web bundle must not contain exam PDFs or question/solution images.' }
$webArchive = Join-Path $buildRoot 'web.zip'
if (Test-Path -LiteralPath $webArchive) { Remove-Item -LiteralPath $webArchive }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($webRoot, $webArchive, [IO.Compression.CompressionLevel]::Optimal, $false)
$buildArgs = @('publish', (Join-Path $projectRoot 'TmuaDesktop.csproj'), '-c', 'Release', '-r', 'win-x64', '--self-contained', 'true', '-o', $OutputDirectory, "-p:SiteArchive=$webArchive", '--nologo')
if ($NoRestore) { $buildArgs += '--no-restore' }
& $Dotnet @buildArgs
if ($LASTEXITCODE -ne 0) { throw 'The .NET publish step failed.' }
Write-Output "Built $(Join-Path $OutputDirectory 'TMUA-Study-Tool.exe')"
