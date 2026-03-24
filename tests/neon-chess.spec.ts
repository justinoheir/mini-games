import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { GamePage } from './pages/GamePage';

const GAME_ID = 'neon-chess';
const GAME_PATH = '/games/neon-chess';
const ACCENT = '#00ffff';
const DURATION_MS = 60000;


test('1.1 page loads without errors', async({page})=>{
  const errs: string[]=[];
  page.on('pageerror',e=>errs.push(e.message));
  const gp=new GamePage(page,GAME_PATH,ACCENT);
  await gp.goto();
  expect(errs).toHaveLength(0);
});
test('2.1 start screen visible', async({page})=>{
  const gp=new GamePage(page,GAME_PATH,ACCENT);
  await gp.goto();
  await expect(gp.ctaButton).toBeVisible({timeout:4000});
});
test('2.2 name input visible', async({page})=>{
  const gp=new GamePage(page,GAME_PATH,ACCENT);
  await gp.goto({skipUser:true});
  await expect(gp.nameInput).toBeVisible({timeout:4000});
});
test('2.3 CTA touch target =44px', async({page})=>{
  const gp=new GamePage(page,GAME_PATH,ACCENT);
  await gp.goto();
  await gp.expectTouchTargetSize(gp.ctaButton,44,'CTA');
});
test('2.4 back button touch target =44px', async({page})=>{
  const gp=new GamePage(page,GAME_PATH,ACCENT);
  await gp.goto();
  await gp.expectTouchTargetSize(gp.backButton,44,'back');
});
test('3.1 countdown after start', async({page})=>{
  const gp=new GamePage(page,GAME_PATH,ACCENT);
  await gp.goto();
  await gp.start();
  await gp.waitForCountdown();
});
test('4.1 timer visible during play', async({page})=>{
  const gp=new GamePage(page,GAME_PATH,ACCENT);
  await gp.goto();
  await gp.start();
  await gp.waitForPlaying();
  await expect(gp.timerEl).toBeVisible({timeout:3000});
});
test('4.2 timer decreases', async({page})=>{
  const gp=new GamePage(page,GAME_PATH,ACCENT);
  await gp.goto();
  await gp.start();
  await gp.waitForPlaying();
  await gp.expectTimerDecreasing(3000);
});
test('4.3 no crash during 10s', async({page})=>{
  const errs: string[]=[];
  page.on('pageerror',e=>errs.push(e.message));
  const gp=new GamePage(page,GAME_PATH,ACCENT);
  await gp.goto();
  await gp.start();
  await gp.waitForPlaying();
  await page.waitForTimeout(10000);
  expect(errs).toHaveLength(0);
});
test('5.1 score starts at 0', async({page})=>{
  const gp=new GamePage(page,GAME_PATH,ACCENT);
  await gp.goto();
  await gp.start();
  await gp.waitForPlaying();
  const t=await gp.scoreEl.textContent().catch(()=>'0');
  expect(parseInt(t??'0')).toBe(0);
});
test('5.2 game ends at timeout', async({page})=>{
  await page.addInitScript(()=>{const o=window.setInterval.bind(window);(window as any).setInterval=(fn:()=>void,ms:number,...a:unknown[])=>{if(ms===1000)return o(fn,100,...a);return o(fn,ms,...a);};});
  const gp=new GamePage(page,GAME_PATH,ACCENT);
  await gp.goto();
  await gp.start();
  await page.waitForSelector('button:has-text("Play Again")',{timeout:Math.ceil(DURATION_MS/10)+6000});
  await expect(gp.playAgainButton).toBeVisible();
});
test('6.1 end screen play-again visible', async({page})=>{
  await page.addInitScript(()=>{const o=window.setInterval.bind(window);(window as any).setInterval=(fn:()=>void,ms:number,...a:unknown[])=>{if(ms===1000)return o(fn,100,...a);return o(fn,ms,...a);};});
  const gp=new GamePage(page,GAME_PATH,ACCENT);
  await gp.goto();
  await gp.start();
  await gp.waitForEnd(DURATION_MS/10+5000);
  await expect(gp.playAgainButton).toBeVisible();
});
test('7.1 no horizontal scroll 375px', async({page})=>{
  await page.setViewportSize({width:375,height:667});
  const gp=new GamePage(page,GAME_PATH,ACCENT);
  await gp.goto();
  await gp.expectNoHorizontalScroll();
});
test('9.1 axe-core scan', async({page})=>{
  const gp=new GamePage(page,GAME_PATH,ACCENT);
  await gp.goto();
  const r=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).exclude('canvas').analyze();
  const crit=r.violations.filter(v=>v.impact==='critical'||v.impact==='serious');
  expect(crit).toHaveLength(0);
});
