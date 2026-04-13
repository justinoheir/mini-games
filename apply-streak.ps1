# apply-streak.ps1 - Add streak state and aria-label to all games
param([string]$GamePath)

$content = Get-Content $GamePath -Raw -Encoding UTF8

# 1. Add streak state after score display state declaration
# Handle different naming: setScoreDisplay, setScore, setScoreDisp, setGoalsDisplay
$patterns = @(
  'const \[scoreDisplay, setScoreDisplay\] = useState\(0\);',
  'const \[scoreDisp, setScoreDisp\] = useState\(0\);',
  'const \[scoreDisplay,setScore\] = useState\(0\);'
)

$added = $false
foreach ($pat in $patterns) {
  if ($content -match $pat -and $content -notmatch 'const \[streak, setStreak\]') {
    $match = [regex]::Match($content, $pat)
    $content = $content.Insert($match.Index + $match.Length, "`n  const [streak, setStreak] = useState(0);")
    $added = $true
    break
  }
}

if (-not $added -and $content -notmatch 'const \[streak, setStreak\]') {
  Write-Host "WARNING: Could not find score state pattern in $GamePath"
}

# 2. Add streak: 0 to stateRef (after "running: false")
# Look for "running: false" in stateRef context
if ($content -notmatch 'streak: 0') {
  $content = $content -replace '(running: false,)', '$1 streak: 0,'
}

# 3. Add setStreak(0) where setScoreDisplay(0) is called (in startLoop & handlePlayAgain)
$content = $content -replace '(setScoreDisplay\(0\);)(?!\s*setStreak)', '$1 setStreak(0);'
$content = $content -replace '(setScoreDisp\(0\);)(?!\s*setStreak)', '$1 setStreak(0);'
$content = $content -replace '(setScore\(0\);)(?!\s*setStreak)', '$1 setStreak(0);'

# 4. Add aria-label to mountRef div (first occurrence)
$ariaAdded = $false
if ($content -notmatch 'ref={mountRef}[^>]*aria') {
  # Try to add role and aria-label to mountRef div
  $content = $content -replace '(<div\s+ref=\{mountRef\}\s+style=\{)', '<div ref={mountRef} role="application" aria-label="Game play area" style={', 1
  $ariaAdded = $true
}

Set-Content $GamePath -Value $content -Encoding UTF8 -NoNewline
Write-Host "Processed: $GamePath (streak=$added, aria=$ariaAdded)"
