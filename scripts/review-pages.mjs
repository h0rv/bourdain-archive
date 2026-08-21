#!/usr/bin/env node
// Feedback loop: render html or view all pages via Playwright
// Works with `npm run review` (node) or `uvx --from playwright python -m playwright` alternative (see review:uv)
// Checks: thumbnails present, page renders, no 400 image errors, basic a11y, LCP-ish

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { setTimeout as wait } from 'node:timers/promises';

const PORT = process.env.PORT ? Number(process.env.PORT) : 4321;
const BASE = process.env.BASE_URL ?? `http://localhost:${PORT}`;
const PAGES = ['/', '/writings/', '/tv/', '/map/', '/about/'];

// ensure dist exists
async function ensureBuilt() {
  const { existsSync } = await import('node:fs');
  if (!existsSync('dist/index.html')) {
    console.log('dist missing, run npm run build first');
    process.exit(1);
  }
}

async function startPreview() {
  // try to fetch base, if fails spawn astro preview
  try {
    const r = await fetch(BASE + '/', { signal: AbortSignal.timeout(1500) });
    if (r.ok) {
      console.log(`preview already running at ${BASE}`);
      return null;
    }
  } catch {}
  console.log(`starting astro preview on :${PORT} ...`);
  const proc = spawn('npx', ['astro', 'preview', '--port', String(PORT), '--host', '127.0.0.1'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });
  proc.stdout.on('data', d => process.stdout.write(d));
  proc.stderr.on('data', d => process.stderr.write(d));
  // wait for ready
  for (let i = 0; i < 30; i++) {
    await wait(500);
    try {
      const r = await fetch(BASE + '/', { signal: AbortSignal.timeout(1000) });
      if (r.ok) break;
    } catch {}
  }
  return proc;
}

async function run() {
  await ensureBuilt();
  const preview = await startPreview();
  mkdirSync('tmp/review', { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  // collect 40x image errors via console/request failed
  const failures = [];
  page.on('requestfailed', req => {
    if (req.resourceType() === 'image') failures.push({ url: req.url(), error: req.failure()?.errorText });
  });
  page.on('response', res => {
    if (res.request().resourceType() === 'image' && res.status() >= 400) {
      failures.push({ url: res.url(), status: res.status() });
    }
  });

  for (const p of PAGES) {
    const url = BASE + p;
    console.log(`\n== ${p} ==`);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    // basic checks
    const title = await page.title();
    console.log(` title: ${title}`);
    const imgs = await page.locator('img').count();
    const missingAlt = await page.locator('img:not([alt])').count();
    const withoutWidth = await page.evaluate(() => document.querySelectorAll('img:not([width])').length);
    const placeholders = await page.locator('img[src*="placeholder.svg"]').count();
    const placeholdCo = await page.locator('img[src*="placehold.co"]').count();
    console.log(` imgs: ${imgs} (placeholder.svg: ${placeholders}, placehold.co: ${placeholdCo}) missing alt attr: ${missingAlt} without width: ${withoutWidth}`);
    // legibility / font check
    const styles = await page.evaluate(() => {
      const b = getComputedStyle(document.body);
      return { fontSize: b.fontSize, lineHeight: b.lineHeight, fontFamily: b.fontFamily.slice(0,60) };
    });
    console.log(` body style: ${styles.fontSize} / ${styles.lineHeight} ${styles.fontFamily}`);
    // a11y quick: check heading hierarchy, skip link, nav aria
    const h1 = await page.locator('h1').count();
    const navAria = await page.locator('nav[aria-label]').count();
    console.log(` h1: ${h1} nav aria: ${navAria}`);
    // CLS-ish: check if any img without dimensions would cause shift already reported via withoutWidth
    if (withoutWidth > 0) console.warn(`  ⚠ ${withoutWidth} imgs without width/height → CLS risk`);
    if (missingAlt > 0) console.warn(`  ⚠ ${missingAlt} imgs missing alt attr`);
    // screenshot
    const name = p === '/' ? 'index' : p.replaceAll('/', '_').replace(/^_+|_+$/g, '') || 'index';
    const shot = `tmp/review/${name}.png`;
    await page.screenshot({ path: shot, fullPage: false });
    console.log(` screenshot: ${shot}`);
  }

  if (failures.length) {
    console.log(`\n⚠ ${failures.length} image requests failed:`);
    for (const f of failures.slice(0,20)) console.log(`  - ${f.status ?? ''} ${f.url} ${f.error ?? ''}`);
  } else {
    console.log(`\n✓ no image 40x failures detected`);
  }

  await browser.close();
  if (preview) {
    preview.kill();
    console.log('preview stopped');
  }
  console.log('\nDone. View tmp/review/*.png or open dist/*.html directly.');
}

run().catch(e => { console.error(e); process.exit(1); });
