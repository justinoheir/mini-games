$gamesDir = "C:\Users\justi\.openclaw\workspace\mini-games\app\games"
$games = Get-ChildItem $gamesDir -Directory | Where-Object { $_.Name -ne "__scaffold__" } | Sort-Object Name
$results = @()

foreach ($game in $games) {
    $pageFile = Join-Path $game.FullName "page.tsx"
    if (-not (Test-Path $pageFile)) {
        $results += @{
            game_id = $game.Name; stateMachine=0; timerCorrect=0; scoreTracking=0; audioSync=0
            haptics=0; accessibility=0; gameFeel=0; cleanup=0; personalBest=0
            weighted_score=0; verdict="BLOCKED"; notes="page.tsx missing"; missing_file=$true
        }
        continue
    }
    
    $content = Get-Content $pageFile -Raw
    
    $hasStart = $content -match "['`"](start|idle)['`"]|GameStartScreen|startPhase|phase.*start"
    $hasCountdown = $content -match "countdown|'counting'"
    $hasPlaying = $content -match "['`"](playing|active|game)['`"]"
    $hasDone = $content -match "['`"](done|end|finished|over)['`"]|EndScreen|endGame|gameOver"
    $phasesFound = @($hasStart,$hasCountdown,$hasPlaying,$hasDone) | Where-Object{$_} | Measure-Object | Select-Object -Exp Count
    $stateMachine = [int]([Math]::Min(10, $phasesFound * 2.5))
    
    $hasInterval = $content -match "setInterval|useInterval"
    $hasEndAtZero = $content -match "endGame|gameOver|setPhase.*done|timeLeft.*<=.*0|timer.*<=.*0|time.*===.*0"
    $timerCorrect = if ($hasInterval -and $hasEndAtZero) { 10 } elseif ($hasInterval -or $hasEndAtZero) { 5 } else { 0 }
    
    $hasScore = $content -match "setScore|score\s*\+|score\+\+|addScore|incrementScore"
    $scoreTracking = if ($hasScore) { 10 } else { 3 }
    
    $hasAudioSfx = $content -match "sfx\.|playSound|AudioContext|useAudio|sfx\("
    $audioSync = if ($hasAudioSfx) { 10 } else { 2 }
    
    $hasHaptics = $content -match "haptic|navigator\.vibrate|vibrate\("
    $haptics = if ($hasHaptics) { 10 } else { 2 }
    
    $hasAria = $content -match "aria-label|aria-live|role="
    $accessibility = if ($hasAria) { 10 } else { 2 }
    
    $hasCombo = $content -match "combo|streak|multiplier|consecutive"
    $gameFeel = if ($hasCombo) { 10 } else { 3 }
    
    $hasCleanup = $content -match "cancelAnimationFrame|clearInterval|clearTimeout"
    $cleanup = if ($hasCleanup) { 10 } else { 2 }
    
    $hasPB = $content -match "localStorage|personalBest|useGameStorage|gameStorage"
    $personalBest = if ($hasPB) { 10 } else { 2 }
    
    $total = $stateMachine + $timerCorrect + $scoreTracking + $audioSync + $haptics + $accessibility + $gameFeel + $cleanup + $personalBest
    $ws = [Math]::Round($total / 9.0, 1)
    
    $verdict = if ($ws -ge 9) { "SHIP" } elseif ($ws -ge 7.5) { "SHIP_WITH_NOTES" } elseif ($ws -ge 6) { "FIX_REQUIRED" } else { "BLOCKED" }
    
    $notes = @()
    if (-not $hasInterval) { $notes += "no-timer" }
    if (-not $hasScore) { $notes += "no-score" }
    if (-not $hasAudioSfx) { $notes += "no-audio" }
    if (-not $hasHaptics) { $notes += "no-haptics" }
    if (-not $hasAria) { $notes += "no-a11y" }
    if (-not $hasCombo) { $notes += "no-combo" }
    if (-not $hasCleanup) { $notes += "no-cleanup" }
    if (-not $hasPB) { $notes += "no-pb" }
    if ($phasesFound -lt 4) { $notes += "state($phasesFound/4)" }
    
    $results += @{
        game_id=$game.Name; stateMachine=$stateMachine; timerCorrect=$timerCorrect
        scoreTracking=$scoreTracking; audioSync=$audioSync; haptics=$haptics
        accessibility=$accessibility; gameFeel=$gameFeel; cleanup=$cleanup
        personalBest=$personalBest; weighted_score=$ws; verdict=$verdict
        notes=($notes -join ","); missing_file=$false
    }
}

$results | ConvertTo-Json -Depth 5 | Set-Content "C:\Users\justi\.openclaw\workspace\mini-games\tests\results\code-audit.json" -Encoding UTF8

$ship = ($results | Where-Object { $_["verdict"] -eq "SHIP" }).Count
$shipNotes = ($results | Where-Object { $_["verdict"] -eq "SHIP_WITH_NOTES" }).Count
$fix = ($results | Where-Object { $_["verdict"] -eq "FIX_REQUIRED" }).Count
$blocked = ($results | Where-Object { $_["verdict"] -eq "BLOCKED" }).Count
Write-Output "AUDIT COMPLETE: SHIP=$ship SHIP_WITH_NOTES=$shipNotes FIX=$fix BLOCKED=$blocked TOTAL=$($results.Count)"
