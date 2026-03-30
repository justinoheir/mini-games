$env:PLAYWRIGHT_BASE_URL = "http://localhost:3000"
cd C:\Users\justi\.openclaw\workspace\mini-games
npx playwright test tests/stack-drop.spec.ts --reporter=line --timeout=60000 2>&1
