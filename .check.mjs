import { chromium } from 'playwright';
const OUT = '/tmp/claude-501/-Users-nichar-Brain-Projects-stocklana-hackathon/0ca290a6-5a6a-410f-87b1-f008c6618f94/scratchpad/shots';
const b = await chromium.launch();
for (const w of [1440, 1180, 900]) {
  const page = await (await b.newContext({ viewport: { width: w, height: 1000 }, deviceScaleFactor: 2 })).newPage();
  await page.goto('http://127.0.0.1:3031/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  console.log(w, JSON.stringify(await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.lp-hero-actions > *')].map((b) => b.getBoundingClientRect());
    const meta = document.querySelector('.lp-meta').getBoundingClientRect();
    const tops = [...document.querySelectorAll('.lp-meta li')].map((l) => Math.round(l.getBoundingClientRect().top));
    return {
      buttonsRight: Math.round(Math.max(...btns.map((b) => b.right))),
      metaRight: Math.round(meta.right),
      overhang: Math.round(meta.right - Math.max(...btns.map((b) => b.right))),
      lines: new Set(tops).size,
      docOverflow: document.documentElement.scrollWidth > innerWidth,
    };
  })));
  if (w === 1440) await page.locator('.lp-hero-cta').screenshot({ path: `${OUT}/cta.png` });
  await page.close();
}
await b.close();
