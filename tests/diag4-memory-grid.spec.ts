import { test, expect } from "@playwright/test"
import { GamePage } from "./pages/GamePage"

test("diag4 — what is covering the CTA", async ({ page }) => {
  const game = new GamePage(page, "/games/memory-grid", "#8b5cf6")
  await game.goto()
  await page.waitForTimeout(1000)
  
  const result = await page.evaluate(() => {
    const btn = document.querySelector("[data-testid=start-cta]") as HTMLElement
    if (!btn) return { error: "CTA not found" }
    
    const rect = btn.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    
    const topEl = document.elementFromPoint(cx, cy) as HTMLElement | null
    const topTestId = topEl?.getAttribute("data-testid") ?? topEl?.tagName ?? "unknown"
    const topZIndex = topEl ? window.getComputedStyle(topEl).zIndex : "?"
    const topClass = topEl?.className ?? "?"
    
    // Walk up the chain
    const chain: string[] = []
    let el: HTMLElement | null = topEl
    while (el && el !== document.body) {
      chain.push(`${el.tagName}[testid=${el.getAttribute("data-testid") ?? "none"}][z=${window.getComputedStyle(el).zIndex}][pos=${window.getComputedStyle(el).position}]`)
      el = el.parentElement
      if (chain.length > 8) break
    }
    
    return {
      btnRect: { x: cx, y: cy, w: rect.width, h: rect.height },
      topElement: topTestId,
      topZIndex,
      topClass: topClass.substring(0, 100),
      elementChain: chain.join(" > "),
      btnVisible: rect.width > 0 && rect.height > 0,
      btnInViewport: cy < window.innerHeight && cx < window.innerWidth
    }
  })
  
  console.log("RESULT:", JSON.stringify(result, null, 2))
  expect(true).toBe(true)
})
