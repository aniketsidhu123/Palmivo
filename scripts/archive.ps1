$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$releaseRoot = Join-Path $projectRoot 'release'
$bundles = @(
    @{ Folder = 'SignToAST'; Archive = 'SignToAST-Windows.zip' },
    @{ Folder = 'SignToAST-Source'; Archive = 'SignToAST-Source.zip' }
)
foreach ($bundle in $bundles) {
    $bundleRoot = (Resolve-Path -LiteralPath (Join-Path $releaseRoot $bundle.Folder)).Path
    $archivePath = [IO.Path]::GetFullPath((Join-Path $releaseRoot $bundle.Archive))
    if (-not $archivePath.StartsWith($releaseRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Archive target must stay inside release.' }
    $stream = [IO.File]::Open($archivePath, [IO.FileMode]::Create)
    $archive = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($file in Get-ChildItem -LiteralPath $bundleRoot -Recurse -File -Force) {
            $entryName = [IO.Path]::GetRelativePath($releaseRoot, $file.FullName).Replace('\', '/')
            if ($entryName -match '(^|/)(\.git|\.agents|\.codex|node_modules|\.pnpm-store)(/|$)') { continue }
            if ($entryName -match '\.log$') { continue }
            [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file.FullName, $entryName, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
        }
    } finally { $archive.Dispose(); $stream.Dispose() }
    $check = [IO.Compression.ZipFile]::OpenRead($archivePath)
    try { if ($check.Entries.FullName -match '(^|/)\.git/') { throw 'Repository internals must not be archived.' } }
    finally { $check.Dispose() }
    Get-Item -LiteralPath $archivePath | Select-Object Name, Length
}
Get-FileHash -LiteralPath (Join-Path $releaseRoot 'SignToAST-Windows.zip'), (Join-Path $releaseRoot 'SignToAST-Source.zip') -Algorithm SHA256 |
    Select-Object Hash, Path | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $releaseRoot 'checksums.json')
