const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ 
    viewport: { width: 390, height: 844 },
  });
  await context.addInitScript(() => {
    localStorage.setItem('seen_crowd-roar', '1');
    localStorage.setItem('mg_user', JSON.stringify({ name: 'TestUser', avatar: '🎮' }));
    // Pre-consent so PlayerNameInput skips directly to onReady
    localStorage.setItem('mg_consented', '1');
    window.__DISABLE_AUDIO = true;
    navigator.mediaDevices.getUserMedia = async () => {
      return { getTracks: () => [{ stop: () => {} }], getAudioTracks: () => [] };
    };
    // Speed up timer 10x
    const origInterval = window.setInterval.bind(window);
    window.setInterval = (fn, ms, ...args) => {
      if (ms === 1000) return origInterval(fn, 100, ...args);
      return origInterval(fn, ms, ...args);
    };
  });
  
  const page = await context.newPage();
  await page.goto('http://localhost:3000/games/crowd-roar');
  await page.waitForTimeout(2500);
  
  // Helper: click button by text match
  const clickBtn = async (matchFn) => {
    const clicked = await page.$$eval('button', (els, fn) => {
      const btn = els.find(e => fn(e.textContent.trim()));
      if (btn) { btn.click(); return btn.textContent.trim(); }
      return null;
    }, matchFn.toString());
    return clicked;
  };
  
  // Step 1: Click CTA
  await page.$$eval('button', (els) => {
    const b = els.find(e => e.textContent.includes('Allow Mic'));
    if (b) b.click();
  });
  await page.waitForTimeout(800);
  
  // Step 2-N: Keep clicking through any overlay buttons until we reach countdown
  for (let i = 0; i < 6; i++) {
    const btns = await page.$$eval('button', els => els.map(e => e.textContent.trim()));
    console.log(`Step ${i} buttons:`, btns.slice(0, 8));
    
    // Check if we're on a screen we should advance past
    const hasPlay = btns.some(b => b.includes('I Agree') || b.includes('Play'));
    const hasContinue = btns.some(b => b === 'Continue');
    const hasAllowStart = btns.some(b => b.includes('Allow') && b.includes('Start'));
    
    if (hasContinue) {
      await page.$$eval('button', els => { const b = els.find(e => e.textContent.trim() === 'Continue'); if (b) b.click(); });
      console.log('Clicked Continue');
    } else if (hasPlay) {
      await page.$$eval('button', els => { const b = els.find(e => e.textContent.includes('Agree') || e.textContent.includes('Play ')); if (b) b.click(); });
      console.log('Clicked I Agree/Play');
    } else if (hasAllowStart) {
      await page.$$eval('button', els => { const b = els.find(e => e.textContent.includes('Allow')); if (b) b.click(); });
      console.log('Clicked Allow');
    } else {
      break;
    }
    await page.waitForTimeout(1000);
    
    const btns2 = await page.$$eval('button', els => els.map(e => e.textContent.trim()));
    // Check if countdown started or playing
    const countdownEl = await page.$('[data-testid="countdown-display"]').catch(() => null);
    const canvas = await page.$('canvas').catch(() => null);
    if (countdownEl || canvas) {
      console.log('Game started!');
      break;
    }
  }
  
  await page.waitForTimeout(4000);  // let countdown + game start
  await page.screenshot({ path: 'tests/screenshots/cr-gameplay.png' });
  console.log('Gameplay screenshot taken');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'tests/screenshots/cr-gameplay2.png' });
  
  // Wait for end screen
  try {
    await page.waitForSelector('button:has-text("Play Again")', { timeout: 12000 });
    console.log('End screen reached');
  } catch(e) { console.log('End screen not reached'); }
  await page.screenshot({ path: 'tests/screenshots/cr-endscreen.png' });
  
  await browser.close();
  console.log('Done');
})();
