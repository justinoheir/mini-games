import { test, expect } from "@playwright/test"
import { GamePage } from "./pages/GamePage"

test("diag5 — direct dispatch click", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", e => errors.push(e.message))
  
  const game = new GamePage(page, "/games/memory-grid", "#8b5cf6")
  await game.goto()
  await page.waitForTimeout(1000)
  
  // Check initial buttons
  const btnsBefore = await page.locator("button").allTextContents()
  console.log("Buttons before:", btnsBefore)
  
  // Try clicking without force
  try {
    await page.locator("[data-testid=start-cta]").click({ timeout: 5000 })
  } catch (e) {
    console.log("Normal click error:", e)
  }
  await page.waitForTimeout(2000)
  
  const btnsAfter = await page.locator("button").allTextContents()
  console.log("Buttons after:", btnsAfter)
  console.log("pageerrors:", errors)
  expect(true).toBe(true)
})
