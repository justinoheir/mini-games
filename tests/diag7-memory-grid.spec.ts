import { test, expect } from "@playwright/test"
import { GamePage } from "./pages/GamePage"

test("diag7 — check DOM structure", async ({ page }) => {
  const game = new GamePage(page, "/games/memory-grid", "#8b5cf6")
  await game.goto()
  await page.waitForTimeout(1000)
  
  const domInfo = await page.evaluate(() => {
    // Find CTA button
    const cta = document.querySelector("[data-testid=start-cta]")
    
    // Find all elements with listeners on them 
    const allBtns = Array.from(document.querySelectorAll("button")).map(b => ({
      testId: b.getAttribute("data-testid"),
      text: b.textContent?.trim().substring(0, 30),
      type: b.type,
      disabled: b.disabled
    }))
    
    // Check if React fiber exists on the CTA
    const ctaKeys = cta ? Object.keys(cta).filter(k => k.startsWith("__react")) : []
    
    return {
      cta: cta ? {
        testId: cta.getAttribute("data-testid"),
        text: cta.textContent?.trim(),
        disabled: (cta as HTMLButtonElement).disabled,
        type: (cta as HTMLButtonElement).type,
        reactKeys: ctaKeys,
        style: window.getComputedStyle(cta as Element).pointerEvents
      } : null,
      allBtns
    }
  })
  
  console.log("DOM:", JSON.stringify(domInfo, null, 2))
  
  // Try clicking via dispatchEvent
  await page.evaluate(() => {
    const cta = document.querySelector("[data-testid=start-cta]") as HTMLElement
    if (cta) {
      cta.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
      console.log("dispatched click event")
    }
  })
  
  await page.waitForTimeout(1000)
  const btnsAfter = await page.locator("button").allTextContents()
  console.log("Buttons after dispatchEvent:", btnsAfter)
  
  expect(true).toBe(true)
})
