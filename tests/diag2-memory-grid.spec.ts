import { test, expect } from "@playwright/test"
import { GamePage } from "./pages/GamePage"

test("diag2 — start flow with longer waits", async ({ page }) => {
  const steps: string[] = []
  const game = new GamePage(page, "/games/memory-grid", "#8b5cf6")
  await game.goto()
  
  await page.waitForTimeout(1000)  // extra wait for all effects to settle
  
  const ctaVisible = await page.locator("[data-testid=start-cta]").isVisible()
  const instructionsVisible = await page.locator("text=Watch the pattern").isVisible().catch(() => false)
  steps.push(`CTA visible: ${ctaVisible}, instructions visible: ${instructionsVisible}`)
  
  // Check all button texts on page
  const buttons = await page.locator("button").allTextContents()
  steps.push(`Buttons on page: ${buttons.join(" | ")}`)
  
  await page.locator("[data-testid=start-cta]").click({ force: true })
  await page.waitForTimeout(1500)  // longer wait
  
  const continueVisible = await page.locator("[data-testid=reg-welcome-continue]").isVisible()
  const inputVisible = await page.locator("[data-testid=reg-input]").isVisible().catch(() => false)
  const buttons2 = await page.locator("button").allTextContents()
  steps.push(`After CTA click: continue=${continueVisible}, input=${inputVisible}`)
  steps.push(`Buttons after click: ${buttons2.join(" | ")}`)
  
  console.log("STEPS:", steps.join("\n"))
  expect(steps.join(" ")).toBeTruthy()
})
