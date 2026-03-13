const { chromium } = require('playwright');

(async () => {
    console.log('🚀 Starting What-If Analysis Visual Density Check...');
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    
    page.on('console', msg => console.log('BROWSER LOG:', msg.text()));
    page.on('pageerror', err => console.error('BROWSER ERROR:', err.message));

    try {
        // Authenticate first
        console.log('Authenticating...');
        await page.goto('http://localhost:8081/login');
        await page.fill('input[name=login]', 'admin@pipeline.local');
        await page.fill('input[name=password]', 'Pipeline2026!');
        await page.click('input[type=submit][value=Login]');
        await page.waitForTimeout(2000);

        console.log('Navigating to http://localhost:8081/what-if ...');
        await page.goto('http://localhost:8081/what-if', { waitUntil: 'networkidle' });
        
        console.log('Waiting for Vis.js canvas to initialize...');
        await page.waitForSelector('#wiTopoContainer canvas', { timeout: 10000 });
        
        const canvasSize = await page.evaluate(() => {
            const canvas = document.querySelector('#wiTopoContainer canvas');
            if (!canvas) return null;
            return { width: canvas.clientWidth, height: canvas.clientHeight };
        });
        
        console.log('Canvas Dimensions:', canvasSize);
        if (canvasSize.width === 0 || canvasSize.height === 0) {
            throw new Error('❌ Canvas has zero dimensions. CSS layout failure.');
        } else {
            console.log('✅ Canvas has valid dimensions.');
        }

        console.log('Waiting for graph to stabilize...');
        await page.waitForFunction(() => {
            const status = document.getElementById('wi-status');
            return status && status.innerText.includes('Baseline');
        }, { timeout: 15000 });

        const nodeCount = await page.evaluate(() => {
            return window.wiVNodes ? window.wiVNodes.length : 0;
        });

        console.log('Loaded Node Count:', nodeCount);
        if (nodeCount > 0) {
            console.log('✅ Visual graph loaded successfully.');
        } else {
            throw new Error('❌ No nodes loaded in Vis.js DataSet.');
        }
        
    } catch (err) {
        console.error('Test Failed:', err.message);
        process.exit(1);
    } finally {
        await browser.close();
        console.log('Test completed.');
    }
})();
