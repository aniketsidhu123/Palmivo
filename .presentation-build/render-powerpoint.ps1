$ErrorActionPreference = 'Stop'
$inputPath = 'F:\SignToAST\.presentation-build\preserved-candidate.pptx'
$renderPath = 'F:\SignToAST\.presentation-build\powerpoint'
New-Item -ItemType Directory -Path $renderPath -Force | Out-Null
$previouslyRunning = @(Get-Process -Name POWERPNT -ErrorAction SilentlyContinue).Count -gt 0
$powerPoint = $null
$document = $null
try {
    $powerPoint = New-Object -ComObject PowerPoint.Application
    $document = $powerPoint.Presentations.Open($inputPath, -1, 0, 0)
    $document.Export($renderPath, 'PNG', 1280, 720)
    $findings = @()
    foreach ($slide in $document.Slides) {
        foreach ($shape in $slide.Shapes) {
            if ($shape.HasTextFrame -eq -1 -and $shape.TextFrame.HasText -eq -1) {
                $bounds = $shape.TextFrame2.TextRange
                $available = $shape.Height - $shape.TextFrame2.MarginTop - $shape.TextFrame2.MarginBottom
                if ($bounds.BoundHeight -gt $available + 1) {
                    $findings += @{Slide=$slide.SlideIndex;Shape=$shape.Name;TextHeight=$bounds.BoundHeight;Available=$available}
                }
            }
            if ($shape.HasTable -eq -1) {
                $heights = @()
                for ($row=1; $row -le $shape.Table.Rows.Count; $row++) { $heights += $shape.Table.Rows.Item($row).Height }
                @{Slide=$slide.SlideIndex;TableTop=$shape.Top;TableHeight=$shape.Height;RowHeights=$heights} | ConvertTo-Json -Depth 5 | Write-Output
            }
        }
    }
    $findings | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath 'F:\SignToAST\.presentation-build\powerpoint-text-bounds.json'
    "PowerPoint exported $($document.Slides.Count) slides. Text-bound findings: $($findings.Count)."
} finally {
    if ($null -ne $document) { $document.Close() }
    if ($null -ne $powerPoint -and -not $previouslyRunning) { $powerPoint.Quit() }
    if ($null -ne $document) { [Runtime.InteropServices.Marshal]::ReleaseComObject($document) | Out-Null }
    if ($null -ne $powerPoint) { [Runtime.InteropServices.Marshal]::ReleaseComObject($powerPoint) | Out-Null }
}
