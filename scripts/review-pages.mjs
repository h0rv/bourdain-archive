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
const PAGES = [
  '/',
  '/archive/',
  '/writings/',
  '/works/kitchen-confidential/',
  '/tv/',
  '/tv/parts-unknown-show/',
  '/screen/',
  '/screen/tony-2026/',
  '/literature/the-gospel-according-to-anthony-bourdain/',
  '/sources/',
  '/sources/explore-parts-unknown/',
  '/places/',
  '/places/tokyo/',
  '/map/',
  '/events/born/',
  '/about/',
  '/404/',
];
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 960 },
  { name: 'mobile', width: 390, height: 844 },
];

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
  const context = await browser.newContext();
  const page = await context.newPage();

  // Collect image failures and page-level failures across the whole launch surface.
  const failures = [];
  const errors = [];
  page.on('pageerror', error => errors.push(`page error: ${error.message}`));
  page.on('requestfailed', req => {
    if (req.resourceType() === 'image') failures.push({ url: req.url(), error: req.failure()?.errorText });
  });
  page.on('response', res => {
    if (res.request().resourceType() === 'image' && res.status() >= 400) {
      failures.push({ url: res.url(), status: res.status() });
    }
  });

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    for (const p of PAGES) {
      const url = BASE + p;
      console.log(`\n== ${viewport.name} ${p} ==`);
      const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(250);
      if (!response?.ok() && p !== '/404/') errors.push(`${p}: HTTP ${response?.status() ?? 'no response'}`);
    // basic checks
      const title = await page.title();
      console.log(` title: ${title}`);
      const audit = await page.evaluate(() => ({
        images: document.images.length,
        brokenImages: [...document.images].filter(image => image.complete && image.naturalWidth === 0).map(image => image.currentSrc || image.src),
        missingAlt: document.querySelectorAll('img:not([alt])').length,
        withoutWidth: document.querySelectorAll('img:not([width]), img:not([height])').length,
        placeholders: document.querySelectorAll('img[src*="placeholder"], img[src*="placehold.co"]').length,
        undefinedLinks: [...document.querySelectorAll('a')].filter(link => !link.getAttribute('href') || link.getAttribute('href')?.includes('undefined')).length,
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      }));
      console.log(` imgs: ${audit.images}; broken: ${audit.brokenImages.length}; placeholders: ${audit.placeholders}; missing alt: ${audit.missingAlt}; incomplete dimensions: ${audit.withoutWidth}`);
      if (audit.brokenImages.length) errors.push(`${p}: ${audit.brokenImages.length} broken rendered images`);
      if (audit.placeholders) errors.push(`${p}: ${audit.placeholders} placeholder images`);
      if (audit.missingAlt) errors.push(`${p}: ${audit.missingAlt} images lack alt attributes`);
      if (audit.withoutWidth && p !== '/map/') errors.push(`${p}: ${audit.withoutWidth} images lack intrinsic dimensions`);
      if (audit.undefinedLinks) errors.push(`${p}: ${audit.undefinedLinks} missing or undefined links`);
      if (audit.horizontalOverflow) errors.push(`${viewport.name} ${p}: horizontal overflow`);
    // legibility / font check
      const styles = await page.evaluate(() => {
        const b = getComputedStyle(document.body);
        return { fontSize: b.fontSize, lineHeight: b.lineHeight, fontFamily: b.fontFamily.slice(0,60) };
      });
      console.log(` body style: ${styles.fontSize} / ${styles.lineHeight} ${styles.fontFamily}`);
    // a11y quick: check heading hierarchy, skip link, nav aria
      const h1 = await page.locator('main h1').count();
      const navAria = await page.locator('nav[aria-label]').count();
      console.log(` h1: ${h1} nav aria: ${navAria}`);
      if (h1 !== 1) errors.push(`${p}: expected one h1, found ${h1}`);
      if (navAria < 1) errors.push(`${p}: no labelled navigation`);

      const name = p === '/' ? 'index' : p.replaceAll('/', '_').replace(/^_+|_+$/g, '') || 'index';
      const shot = `tmp/review/${viewport.name}-${name}.png`;
      await page.screenshot({ path: shot, fullPage: false });
      console.log(` screenshot: ${shot}`);
    }
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
  if (errors.length) {
    console.error(`\n${errors.length} review failures:`);
    for (const error of [...new Set(errors)]) console.error(`  - ${error}`);
    process.exitCode = 1;
  } else {
    console.log('\n✓ route, responsive, image, link, and accessibility smoke checks passed');
  }
  console.log('\nDone. View tmp/review/*.png or open dist/*.html directly.');
}

run().catch(e => { console.error(e); process.exit(1); });
