param([string]$gameName, [string]$scoreVar = "scoreDisplay", [string]$pbScore = "finalSig.score")

$file = "app/games/$gameName/page.tsx"
$content = Get-Content $file -Raw

# 1. Add haptics/audio imports
if ($content -notmatch "hapticScore, hapticFail, hapticVictory") {
    $content = $content -replace "(import \{ initAudio.*from '@/lib/audio';)", "`$1`nimport { playScoreHit, playVictoryFanfare, playNearMiss } from '@/lib/audio';`nimport { hapticScore, hapticFail, hapticVictory } from '@/lib/haptics';"
}

# 2. Add PB_KEY after GAME_ID
if ($content -notmatch "PB_KEY") {
    $content = $content -replace "(const GAME_ID\s+=\s+'[^']+';)", "`$1`nconst PB_KEY       = 'pb_$gameName';"
}

# 3. Add streak + isNewBest state after useScorePop
if ($content -notmatch "const \[streak, setStreak\]") {
    $content = $content -replace "(const \{ pops, triggerPop \} = useScorePop\(\);)", "`$1`n  const prevScoreRef2 = useRef(0);`n  void prevScoreRef2;`n  const [streak, setStreak] = useState(0);`n  const [isNewBest, setIsNewBest] = useState(false);"
    # Remove the duplicate prevScoreRef pattern if already exists
    $content = $content -replace "const prevScoreRef2 = useRef\(0\);\s*void prevScoreRef2;\s*\n\s*const prevScoreRef = useRef\(0\);", "const prevScoreRef = useRef(0);"
}

# 4. Update useEffect to set streak
if ($content -match "prevScoreRef\.current = numScore;" -and $content -notmatch "setStreak\(") {
    $content = $content -replace "(triggerPop\(`+\$\{numScore - prevScoreRef\.current\}`.*?\);)", "`$1`n      hapticScore();`n      playScoreHit('default', numScore - prevScoreRef.current);`n      setStreak(Math.floor(numScore / 5));"
}

# 5. Replace haptic victory call in endGame
$content = $content -replace "sfx\.success\(\);\s*\n\s*haptic\(\[30, 50, 30, 50, 100\]\);", "sfx.success();`n    hapticVictory();`n    playVictoryFanfare();"

# 6. Add PB check before setPhase/setGameState done
if ($content -notmatch "localStorage\.setItem\(PB_KEY") {
    $pbLine = "    // Personal best tracking`n    try {`n      const _pbPrev = parseInt(localStorage.getItem(PB_KEY) || '0', 10);`n      const _pbCur = parseInt(String($pbScore), 10);`n      if (!isNaN(_pbCur) && _pbCur > _pbPrev) {`n        localStorage.setItem(PB_KEY, String(_pbCur));`n        setIsNewBest(true);`n      }`n    } catch { /* ignore */ }`n"
    $content = $content -replace "(setFinalSig\(\{)", "$pbLine`n    setFinalSig({")
    if ($content -notmatch "localStorage\.setItem\(PB_KEY") {
        $content = $content -replace "(setBehavior\(bData\);)", "$pbLine`n    setBehavior(bData);"
    }
}

# 7. Fix StreakBadge streak={0}
$content = $content -replace "<StreakBadge streak=\{0\}", "<StreakBadge streak={streak}"

# 8. Add new best banner before EndScreen
if ($content -notmatch "New Best!" -and $content -match "EndScreen") {
    $banner = @"
      {/* New best banner */}
      <AnimatePresence>
        {isNewBest && (phase === 'done' || gameState === 'done') && (
          <motion.div
            key="new-best"
            initial={{ opacity: 0, y: -20, scale: 0.8 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.4, delay: 0.5 }}
            style={{
              position: 'fixed', top: '10%', left: '50%', transform: 'translateX(-50%)',
              zIndex: 90, pointerEvents: 'none',
              background: 'linear-gradient(135deg, #fbbf24, #f59e0b)',
              borderRadius: 20, padding: '8px 20px', fontSize: 20,
              fontWeight: 900, color: '#000', whiteSpace: 'nowrap',
              boxShadow: '0 4px 20px rgba(251,191,36,0.5)',
            }}
          >
            🏆 New Best!
          </motion.div>
        )}
      </AnimatePresence>

"@
    # Insert banner before the first EndScreen usage
    $content = $content -replace "(\{\/\* ── End Screen)", "$banner`$1"
    if ($content -notmatch "New Best!") {
        # Try alternative pattern
        $content = $content -replace "(\{phase === 'done' && finalSig && \()", "$banner`$1"
        if ($content -notmatch "New Best!") {
            $content = $content -replace "(\{gameState === 'done' && behavior && \()", "$banner`$1"
        }
    }
}

Set-Content $file $content -NoNewline
Write-Host "Patched $gameName"
