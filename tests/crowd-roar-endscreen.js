const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ 
    viewport: { width: 390, height: 844 },
  });
  await context.addInitScript(() => {
    localStorage.setItem('seen_crowd-roar', '1');
    localStorage.setItem('mg_user', JSON.stringify({ name: 'TestUser', avatar: '🎮' }));
    localStorage.setItem('mg_consented', '1');
    window.__DISABLE_AUDIO = true;
    navigator.mediaDevices.getUserMedia = async () => {
      return { getTracks: () => [{ stop: () => {} }], getAudioTracks: () => [] };
    };
    const origInterval = window.setInterval.bind(window);
    window.setInterval = (fn, ms, ...args) => {
      if (ms === 1000) return origInterval(fn, 100, ...args);
      return origInterval(fn, ms, ...args);
    };
  });
  
  const page = await context.newPage();
  await page.goto('http://localhost:3000/games/crowd-roar');
  await page.waitForTimeout(2500);
  
  // Navigate through all screens
  const clickText = async (texts) => {
    for (const text of texts) {
      const btns = await page.$$eval('button', els => els.map(e => ({ t: e.textContent.trim() })));
      const match = btns.find(b => texts.some(t => b.t.includes(t)));
      if (match) {
        await page.$$eval('button', (els, t) => {
          const b = els.find(e => e.textContent.includes(t));
          if (b) b.click();
        }, match.t.substring(0, 10));
        return match.t;
      }
    }
    return null;
  };
  
  await page.$$eval('button', (els) => { const b = els.find(e => e.textContent.includes('Allow Mic')); if (b) b.click(); });
  await page.waitForTimeout(800);
  await page.$$eval('button', (els) => { const b = els.find(e => e.textContent.trim() === 'Continue'); if (b) b.click(); });
  await page.waitForTimeout(800);
  await page.$$eval('button', (els) => { const b = els.find(e => e.textContent.includes('I Agree')); if (b) b.click(); });
  await page.waitForTimeout(800);
  await page.$$eval('button', (els) => { const b = els.find(e => e.textContent.includes('Allow') && e.textContent.includes('Start')); if (b) b.click(); });
  
  // Wait for countdown + full game run
  await page.waitForTimeout(10000);  
  await page.screenshot({ path: 'tests/screenshots/cr-endscreen-full.png', fullPage: false });
  console.log('End screen screenshot taken');
  
  const bodyHeight = await page.evaluate(() => document.body.scrollHeight);
  console.log('Body scroll height:', bodyHeight);
  
  await browser.close();
  console.log('Done');
})();
