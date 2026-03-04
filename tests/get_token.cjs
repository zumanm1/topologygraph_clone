const { chromium } = require('playwright');
(async () => {
  const br = await chromium.launch({ headless: true });
  const page = await br.newPage();

  // ── Step 1: Register ──
  await page.goto('http://localhost:8081/register');
  await page.waitForTimeout(1000);
  await page.fill('#validationEmail', 'admin@pipeline.local');
  await page.fill('#validationPassword', 'Pipeline2026!');
  await page.click('button[type=submit]');
  await page.waitForTimeout(3000);
  console.log('After register:', page.url());

  // ── Step 2: If registration failed (existing user), login directly ──
  if (page.url().includes('register') || page.url().includes('login')) {
    await page.goto('http://localhost:8081/login');
    await page.waitForTimeout(1000);
    // Login form: name="login", name="password"
    await page.fill('input[name=login]', 'admin@pipeline.local');
    await page.fill('input[name=password]', 'Pipeline2026!');
    await page.click('input[type=submit][value=Login]');
    await page.waitForTimeout(3000);
    console.log('After login:', page.url());
  }

  const finalUrl = page.url();
  console.log('Current:', finalUrl);
  if (finalUrl.includes('login') || finalUrl.includes('register')) {
    console.log('NOT LOGGED IN — aborting');
    const t = await page.innerText('body');
    console.log(t.slice(0,300));
    await br.close(); return;
  }

  // ── Step 3: Navigate to Token Management ──
  await page.goto('http://localhost:8081/token_management/my_tokens');
  await page.waitForTimeout(2000);
  console.log('Token mgmt page:', page.url());
  const tok1 = await page.innerText('body');
  console.log('Tokens page:', tok1.slice(0, 500));

  // ── Step 4: Create a token ──
  await page.goto('http://localhost:8081/token_management/create_token');
  await page.waitForTimeout(2000);
  const html = await page.content();
  const text = await page.innerText('body');
  console.log('\nCreate token page:', text.slice(0, 600));

  // Extract any token value from page
  const matches = html.match(/[a-f0-9]{40,}/g) || [];
  const tokens = matches.filter(x => !/sha|bootstrap|jquery|static/.test(x));
  if (tokens.length) {
    console.log('\n🔑 TOKEN:', tokens[0]);
  }

  await page.screenshot({ path: 'screenshots/token-page.png' });
  await br.close();
})().catch(e => console.error('ERR:', e.message));
