import { test, expect } from "@playwright/test"
import { GamePage } from "./pages/GamePage"

test("diag — check game start flow", async ({ page }) => {
  const steps: string[] = []
  const game = new GamePage(page, "/games/memory-grid", "#8b5cf6")
  await game.goto()
  
  // Check what is on page before start
  const ctaVisible = await page.locator("[data-testid=start-cta]").isVisible()
  steps.push(`CTA visible: ${ctaVisible}`)
  
  await page.locator("[data-testid=start-cta]").click({ force: true })
  await page.waitForTimeout(500)
  
  const continueVisible = await page.locator("[data-testid=reg-welcome-continue]").isVisible()
  steps.push(`Continue visible: ${continueVisible}`)
  
  if (continueVisible) {
    await page.locator("[data-testid=reg-welcome-continue]").click({ force: true })
    await page.waitForTimeout(300)
  }
  
  await page.waitForTimeout(800)
  
  // What phase are we in now?
  const countdownVisible = await page.locator("[data-testid=countdown-display]").isVisible().catch(() => false)
  const timerVisible = await page.locator("[data-testid=timer]").isVisible().catch(() => false)
  const ctaStillVisible = await page.locator("[data-testid=start-cta]").isVisible().catch(() => false)
  const overlayVisible = await page.locator("[data-testid=reg-welcome-continue]").isVisible().catch(() => false)
  
  steps.push(`After start: countdown=${countdownVisible}, timer=${timerVisible}, CTA=${ctaStillVisible}, overlay=${overlayVisible}`)
  
  // Wait for timer to appear
  await page.waitForTimeout(3000)
  const timerVisible2 = await page.locator("[data-testid=timer]").isVisible().catch(() => false)
  const levelText = await page.locator("[data-testid=score]").textContent().catch(() => "?")
  steps.push(`After 3s wait: timer=${timerVisible2}, level text=${levelText}`)
  
  console.log("STEPS:", steps.join(" | "))
  expect(steps.join(" ")).toBeTruthy()
})
