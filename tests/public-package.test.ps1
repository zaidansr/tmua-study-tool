$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
$fixtureRoot = Join-Path $projectRoot ('.build/package-guard-tests-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixtureRoot -Force | Out-Null
Get-ChildItem -LiteralPath (Join-Path $projectRoot 'web') -Force | Copy-Item -Destination $fixtureRoot -Recurse -Force
$guard = Join-Path $projectRoot 'scripts/assert-public-web.ps1'
$assertions = 0
function Assert-Rejected([string]$Label, [string]$Expected) {
    $message = ''
    try { & $guard -WebRoot $fixtureRoot | Out-Null } catch { $message = $_.Exception.Message }
    if ($message -notmatch $Expected) { throw "Guard did not reject $Label as expected. Actual: $message" }
    $script:assertions++
    Write-Output "PASS $Label"
}
try {
    & $guard -WebRoot $fixtureRoot | Out-Null
    $assertions++
    Write-Output 'PASS clean public web bundle'

    $file = Join-Path $fixtureRoot 'accidental-paper.pdf'
    [IO.File]::WriteAllText($file, '%PDF-synthetic guard fixture')
    Assert-Rejected 'accidentally included PDF' 'cannot be published'
    Remove-Item -LiteralPath $file

    $file = Join-Path $fixtureRoot 'renamed-paper.dat'
    [IO.File]::WriteAllText($file, '%PDF-synthetic guard fixture')
    Assert-Rejected 'PDF renamed to another extension' 'renamed PDF'
    Remove-Item -LiteralPath $file

    $dataPath = Join-Path $fixtureRoot 'data/questions.json'
    $original = [IO.File]::ReadAllText($dataPath)
    $data = $original | ConvertFrom-Json
    $data.questions[0] | Add-Member -NotePropertyName text -NotePropertyValue 'Synthetic exam text must remain local.'
    $data | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $dataPath -Encoding utf8
    Assert-Rejected 'extracted question text in metadata' "unexpected field 'text'"
    [IO.File]::WriteAllText($dataPath, $original)

    $data = $original | ConvertFrom-Json
    $data.questions[0].images[0] = 'assets/questions/accidental.png'
    $data | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $dataPath -Encoding utf8
    Assert-Rejected 'pre-rendered question image reference' 'Rendered question or solution image paths'
    [IO.File]::WriteAllText($dataPath, $original)

    $htmlPath = Join-Path $fixtureRoot 'index.html'
    $html = [IO.File]::ReadAllText($htmlPath)
    [IO.File]::WriteAllText($htmlPath, $html.Replace('href="styles.css"', 'href="/styles.css"'))
    Assert-Rejected 'asset URL outside the GitHub project path' 'root-absolute asset URL'
    Write-Output "$assertions public packaging assertions passed."
}
finally {
    $resolved = [IO.Path]::GetFullPath($fixtureRoot)
    $expectedPrefix = [IO.Path]::GetFullPath((Join-Path $projectRoot '.build/package-guard-tests-'))
    if (!$resolved.StartsWith($expectedPrefix, [StringComparison]::Ordinal)) { throw 'The test cleanup path is outside the expected build folder.' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
