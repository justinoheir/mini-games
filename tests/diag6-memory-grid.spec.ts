import { test, expect } from "@playwright/test"
import { GamePage } from "./pages/GamePage"

test("diag6 — check React errors and audio", async ({ page }) => {
  const allErrors: string[] = []
  const allLogs: string[] = []
  page.on("pageerror", e => allErrors.push("PAGEERROR: " + e.message))
  page.on("console", msg => {
    if (msg.type() === "error") allErrors.push("CONSOLERROR: " + msg.text())
    if (msg.type() === "warning") allLogs.push("WARN: " + msg.text())
    if (msg.type() === "log") allLogs.push("LOG: " + msg.text())
  })
  
  const game = new GamePage(page, "/games/memory-grid", "#8b5cf6")
  
  // Override console to catch React internal errors
  await page.addInitScript(() => {
    const origError = console.error
    console.error = (...args: unknown[]) => {
      ;(window as any).__reactErrors = (window as any).__reactErrors ?? []
      ;(window as any).__reactErrors.push(args.map(a => String(a)).join(" "))
      origError(...args)
    }
  })
  
  await game.goto()
  await page.waitForTimeout(1000)
  
  await page.locator("[data-testid=start-cta]").click()
  await page.waitForTimeout(2000)
  
  const reactErrors = await page.evaluate(() => (window as any).__reactErrors ?? [])
  
  console.log("ReactErrors:", JSON.stringify(reactErrors))
  console.log("AllErrors:", allErrors.slice(0, 5))
  console.log("AllLogs:", allLogs.slice(0, 10))
  
  expect(true).toBe(true)
})
