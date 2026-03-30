import { test, expect } from "@playwright/test"
import { GamePage } from "./pages/GamePage"

test("diag3 — intercept CTA click", async ({ page }) => {
  const errors: string[] = []
  const consoleErrors: string[] = []
  page.on("pageerror", e => errors.push(e.message))
  page.on("console", msg => { if (msg.type() === "error") consoleErrors.push(msg.text()) })
  
  const game = new GamePage(page, "/games/memory-grid", "#8b5cf6")
  await game.goto()
  await page.waitForTimeout(1000)
  
  // Inject a click interceptor
  await page.evaluate(() => {
    const btn = document.querySelector("[data-testid=start-cta]") as HTMLButtonElement
    if (btn) {
      const orig = btn.onclick
      ;(window as any).__ctaClickFired = false
      btn.addEventListener("click", () => {
        ;(window as any).__ctaClickFired = true
        console.log("CTA CLICK FIRED")
      })
    } else {
      console.log("CTA NOT FOUND IN DOM")
    }
  })
  
  // Check for any errors
  await page.locator("[data-testid=start-cta]").click({ force: true })
  await page.waitForTimeout(2000)
  
  const clickFired = await page.evaluate(() => (window as any).__ctaClickFired)
  const regInputVisible = await page.locator("[data-testid=reg-welcome-continue], [data-testid=reg-input]").isVisible().catch(() => false)
  const bodyHTML = await page.evaluate(() => {
    const playerInput = document.querySelector("[data-testid=reg-welcome-continue]")
    return playerInput ? "FOUND_CONTINUE" : "NOT_FOUND_CONTINUE"
  })
  
  console.log("clickFired:", clickFired)
  console.log("regInputVisible:", regInputVisible)
  console.log("bodyHTML:", bodyHTML)
  console.log("pageerrors:", errors)
  console.log("consoleErrors:", consoleErrors)
  
  expect(true).toBe(true)
})
