param([Parameter(Mandatory = $true)][string]$WebRoot)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($WebRoot)
if (!(Test-Path -LiteralPath (Join-Path $root 'index.html') -PathType Leaf)) { throw 'The public web entry point is missing.' }

# The hosted build contains viewing software and metadata; exam files stay local.
$files = @(Get-ChildItem -LiteralPath $root -Recurse -File)
foreach ($file in $files) {
    $relative = [IO.Path]::GetRelativePath($root, $file.FullName).Replace('\', '/')
    if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Symbolic links are not permitted in the public build: $relative" }
    if ($file.Extension.ToLowerInvariant() -in @('.pdf', '.webp', '.jpg', '.jpeg', '.gif', '.png', '.bmp', '.tif', '.tiff', '.zip', '.exe', '.dll') -or
        $relative -match '(^|/)(papers|questions|solutions|WebView2|profiles|node_modules)(/|$)') {
        throw "Exam content, user data or unrelated binaries cannot be published: $relative"
    }
    if ($file.Length -ge 5) {
        $input = [IO.File]::OpenRead($file.FullName)
        try { $signature = New-Object byte[] 5; [void]$input.Read($signature, 0, 5) } finally { $input.Dispose() }
        if ([Text.Encoding]::ASCII.GetString($signature) -eq '%PDF-') { throw "A renamed PDF cannot be published: $relative" }
    }
}

$data = Get-Content -LiteralPath (Join-Path $root 'data/questions.json') -Raw | ConvertFrom-Json
if (@($data.questions).Count -ne 360 -or @($data.papers).Count -ne 18) { throw 'The public metadata index is incomplete.' }
$questionFields = @('id', 'year', 'paper', 'number', 'paperId', 'topic', 'tags', 'options', 'answer', 'images', 'solutionImages', 'sourcePages', 'solutionPages')
$regionFields = @('pdf', 'page', 'rect', 'pageWidth', 'pageHeight')
foreach ($question in $data.questions) {
    foreach ($field in $question.PSObject.Properties.Name) {
        if ($field -notin $questionFields) { throw "Question metadata contains an unexpected field '$field'; full exam text must not be published." }
    }
    if ($question.topic.Length -gt 80 -or @($question.tags | Where-Object { $_ -isnot [string] -or $_.Length -gt 80 }).Count) { throw 'Question metadata contains unexpectedly long text.' }
    if ($question.answer -notmatch '^[A-Z]$' -or @($question.options | Where-Object { $_ -notmatch '^[A-Z]$' }).Count) { throw 'Answer metadata must contain single letters.' }
    foreach ($region in @($question.images) + @($question.solutionImages)) {
        if ($region -is [string]) { throw 'Rendered question or solution image paths must not be published.' }
        foreach ($field in $region.PSObject.Properties.Name) {
            if ($field -notin $regionFields) { throw "PDF region metadata contains an unexpected field '$field'." }
        }
        if ($region.pdf -notmatch '^https://papers\.tmua\.local/[A-Za-z0-9._-]+\.pdf$') { throw 'A question region has an unexpected source address.' }
    }
}
$javascript = Get-Content -LiteralPath (Join-Path $root 'data/questions.js') -Raw
if ($javascript -notmatch '^\s*window\.TMUA_DATA\s*=\s*([\s\S]+);\s*$') { throw 'The public JavaScript metadata wrapper is invalid.' }
$scriptData = $Matches[1] | ConvertFrom-Json
if (($scriptData | ConvertTo-Json -Depth 100 -Compress) -ne ($data | ConvertTo-Json -Depth 100 -Compress)) { throw 'The public JSON and JavaScript indexes differ.' }

# Project Pages is hosted under /tmua-study-tool/, so asset URLs must stay relative.
$html = Get-Content -LiteralPath (Join-Path $root 'index.html') -Raw
if ($html -match '(?i)(?:src|href)\s*=\s*["'']/[^/]') { throw 'A root-absolute asset URL would break GitHub project Pages.' }
Write-Output "Public bundle guard passed: $($files.Count) files, 360 questions, 18 papers; no exam files or extracted question fields."
