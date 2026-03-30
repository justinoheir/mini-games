import { test, expect } from "@playwright/test"
import { GamePage } from "./pages/GamePage"

test("diag8 — wait for React hydration", async ({ page }) => {
  const game = new GamePage(page, "/games/memory-grid", "#8b5cf6")
  await game.goto()
  
  // Wait for React to hydrate by checking for React fiber keys
  await page.waitForFunction(() => {
    const cta = document.querySelector("[data-testid=start-cta]")
    if (!cta) return false
    const keys = Object.keys(cta)
    return keys.some(k => k.startsWith("__reactFiber") || k.startsWith("__reactProps"))
  }, { timeout: 15000 })
  
  console.log("React hydrated!")
  
  const btns = await page.locator("button").allTextContents()
  console.log("Buttons before click:", btns)
  
  await page.locator("[data-testid=start-cta]").click()
  await page.waitForTimeout(2000)
  
  const btnsAfter = await page.locator("button").allTextContents()
  console.log("Buttons after click:", btnsAfter)
  
  expect(true).toBe(true)
})
