const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  
  await page.addInitScript(() => {
    window.__DISABLE_AUDIO = true;
    localStorage.setItem('mg_user', JSON.stringify({
      name: 'Alex', avatar: '🎮', id: 'test-001', timestamp: Date.now(), consented: true
    }));
    localStorage.setItem('seen_memory-grid', '1');
  });
  
  await page.goto('http://localhost:3000/games/memory-grid', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  
  const info = await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="start-cta"]');
    if (!btn) return { error: 'button not found' };
    const cs = window.getComputedStyle(btn);
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--color-accent');
    return {
      btnBgColor: cs.backgroundColor,
      btnInlineStyle: btn.style.backgroundColor,
      cssVarAccent: accent.trim(),
      btnHtml: btn.outerHTML.substring(0, 300),
    };
  });
  console.log('Debug info:', JSON.stringify(info, null, 2));
  
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
