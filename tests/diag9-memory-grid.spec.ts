import { test, expect } from "@playwright/test"
import { GamePage } from "./pages/GamePage"

test("diag9 — find 404 resource", async ({ page }) => {
  const failed404s: string[] = []
  const allRequests: string[] = []
  
  page.on("requestfailed", req => {
    failed404s.push(`FAIL: ${req.url()} — ${req.failure()?.errorText}`)
  })
  page.on("response", resp => {
    if (resp.status() === 404) {
      failed404s.push(`404: ${resp.url()}`)
    }
    if (resp.url().includes("_next")) {
      allRequests.push(`${resp.status()}: ${resp.url().split("/").slice(-2).join("/")}`)
    }
  })
  
  const game = new GamePage(page, "/games/memory-grid", "#8b5cf6")
  await game.goto()
  await page.waitForTimeout(3000)
  
  console.log("404s:", JSON.stringify(failed404s, null, 2))
  console.log("Next.js requests:", allRequests.slice(0, 20))
  
  expect(true).toBe(true)
})
