#!/usr/bin/env node

import { createReadStream } from "node:fs";
import { access, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, relative, resolve, sep } from "node:path";
import { chromium } from "playwright";

const ROOT = process.cwd();
const DIST = resolve(ROOT, process.env.AUDIT_DIST ?? "dist");
const OUTPUT = resolve(ROOT, process.env.AUDIT_OUTPUT ?? "tmp/visual-audit");
const CONCURRENCY = clampNumber(process.env.AUDIT_CONCURRENCY, 8, 1, 20);
const PAGE_TIMEOUT_MS = clampNumber(
  process.env.AUDIT_PAGE_TIMEOUT_MS,
  15_000,
  2_000,
  60_000,
);
const MEDIA_MODE =
  process.argv.includes("--full") || process.env.AUDIT_MEDIA_MODE === "full"
    ? "full"
    : "viewport";
const IMAGE_WAIT_MS = clampNumber(
  process.env.AUDIT_IMAGE_WAIT_MS,
  MEDIA_MODE === "full" ? 15_000 : 5_000,
  0,
  15_000,
);
const MAP_WAIT_MS = clampNumber(
  process.env.AUDIT_MAP_WAIT_MS,
  5_000,
  0,
  15_000,
);
const CONTACT_SHEET_SIZE = clampNumber(
  process.env.AUDIT_CONTACT_SHEET_SIZE,
  80,
  20,
  200,
);
const FAIL_ON_WARNINGS = process.env.AUDIT_FAIL_ON_WARNINGS === "1";
const ALLOW_FAILURES = process.env.AUDIT_ALLOW_FAILURES === "1";
const BASE_PATH = normalizeBasePath(
  process.env.AUDIT_BASE_PATH ?? process.env.BASE_PATH ?? "/",
);
const REQUESTED_ROUTES = new Set(
  (process.env.AUDIT_ROUTES ?? "")
    .split(",")
    .map((route) => route.trim())
    .filter(Boolean),
);

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function clampNumber(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.min(max, Math.max(min, parsed))
    : fallback;
}

function normalizeBasePath(value) {
  const clean = `/${String(value).replace(/^\/+|\/+$/g, "")}`;
  return clean === "/" ? "" : clean;
}

function routeToUrlPath(route) {
  return `${BASE_PATH}${route}` || "/";
}

function routeName(route) {
  if (route === "/") return "root";
  return (
    route
      .replace(/^\/+|\/+$/g, "")
      .replace(/\.html$/, "")
      .replaceAll("/", "_")
      .replace(/[^a-z0-9_-]+/gi, "-")
      .slice(0, 96) || "page"
  );
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function walkHtml(directory) {
  const files = [];
  async function walk(current) {
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      else if (entry.isFile() && entry.name.endsWith(".html"))
        files.push(fullPath);
    }
  }
  await walk(directory);
  return files;
}

function htmlFileToRoute(file) {
  const path = relative(DIST, file).split(sep).join("/");
  if (path === "index.html") return "/";
  if (path.endsWith("/index.html"))
    return `/${path.slice(0, -"index.html".length)}`;
  return `/${path}`;
}

async function enumerateRoutes() {
  await access(join(DIST, "index.html"));
  const files = await walkHtml(DIST);
  const routes = files
    .map(htmlFileToRoute)
    .sort((left, right) => left.localeCompare(right));
  return REQUESTED_ROUTES.size
    ? routes.filter((route) => REQUESTED_ROUTES.has(route))
    : routes;
}

function resolveRequestPath(requestPath) {
  let pathname;
  try {
    pathname = decodeURIComponent(
      new URL(requestPath, "http://audit.local").pathname,
    );
  } catch {
    return null;
  }

  if (
    BASE_PATH &&
    (pathname === BASE_PATH || pathname.startsWith(`${BASE_PATH}/`))
  ) {
    pathname = pathname.slice(BASE_PATH.length) || "/";
  }

  if (pathname.endsWith("/")) pathname += "index.html";
  const candidate = resolve(DIST, `.${pathname}`);
  if (candidate !== DIST && !candidate.startsWith(`${DIST}${sep}`)) return null;
  return candidate;
}

async function startStaticServer() {
  const server = createServer(async (request, response) => {
    const file = resolveRequestPath(request.url ?? "/");
    try {
      if (!file || !(await stat(file)).isFile()) throw new Error("Not found");
      const type =
        CONTENT_TYPES[extname(file).toLowerCase()] ??
        "application/octet-stream";
      response.writeHead(200, {
        "Content-Type": type,
        "Cache-Control": "public, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      });
      if (request.method === "HEAD") response.end();
      else createReadStream(file).pipe(response);
    } catch {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
    }
  });

  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Could not start the audit server.");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolvePromise, reject) =>
        server.close((error) => (error ? reject(error) : resolvePromise())),
      ),
  };
}

function issue(kind, message, details = {}) {
  return { kind, message, ...details };
}

async function inspectPage(page) {
  await page.evaluate(
    async ({ imageWaitMs, mapWaitMs, mediaMode }) => {
      const imageIsNearViewport = (image) => {
        const rect = image.getBoundingClientRect();
        return rect.top < window.innerHeight + 300 && rect.bottom > -300;
      };
      if (mediaMode === "full") {
        for (const image of document.images) image.loading = "eager";
      }
      if (document.fonts?.ready) {
        await Promise.race([
          document.fonts.ready,
          new Promise((resolvePromise) =>
            window.setTimeout(resolvePromise, 1_500),
          ),
        ]);
      }
      const pending = [...document.images].filter(
        (image) =>
          !image.complete &&
          (mediaMode === "full" || imageIsNearViewport(image)),
      );
      if (pending.length && imageWaitMs > 0) {
        await Promise.race([
          Promise.all(
            pending.map(
              (image) =>
                new Promise((resolvePromise) => {
                  image.addEventListener("load", resolvePromise, {
                    once: true,
                  });
                  image.addEventListener("error", resolvePromise, {
                    once: true,
                  });
                }),
            ),
          ),
          new Promise((resolvePromise) =>
            window.setTimeout(resolvePromise, imageWaitMs),
          ),
        ]);
      }
      const loaded = [...document.images].filter(
        (image) =>
          image.complete &&
          image.naturalWidth > 0 &&
          (mediaMode === "full" || imageIsNearViewport(image)),
      );
      if (loaded.length && imageWaitMs > 0) {
        await Promise.race([
          Promise.all(
            loaded.map((image) => image.decode().catch(() => undefined)),
          ),
          new Promise((resolvePromise) =>
            window.setTimeout(resolvePromise, imageWaitMs),
          ),
        ]);
      }
      if (document.querySelector(".maplibregl-map") && mapWaitMs > 0) {
        await new Promise((resolvePromise) =>
          window.setTimeout(resolvePromise, mapWaitMs),
        );
      }
      await new Promise((resolvePromise) =>
        requestAnimationFrame(() => requestAnimationFrame(resolvePromise)),
      );
    },
    {
      imageWaitMs: IMAGE_WAIT_MS,
      mapWaitMs: MAP_WAIT_MS,
      mediaMode: MEDIA_MODE,
    },
  );

  return page.evaluate((mediaMode) => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity) !== 0
      );
    };
    const selector = (element) => {
      const id = element.id ? `#${CSS.escape(element.id)}` : "";
      const classes = [...element.classList]
        .slice(0, 3)
        .map((name) => `.${CSS.escape(name)}`)
        .join("");
      return `${element.tagName.toLowerCase()}${id}${classes}`;
    };
    const imageSource = (image) => image.currentSrc || image.src || "";
    const images = [...document.images];
    const imageIsInScope = (image) => {
      if (mediaMode === "full") return true;
      const rect = image.getBoundingClientRect();
      return rect.top < window.innerHeight + 300 && rect.bottom > -300;
    };
    const main = document.querySelector("main");
    const contentImages = main ? [...main.querySelectorAll("img")] : [];
    const brokenImages = images
      .filter(
        (image) =>
          imageIsInScope(image) && image.complete && image.naturalWidth === 0,
      )
      .map((image) => imageSource(image));
    const incompleteImages = images
      .filter((image) => imageIsInScope(image) && !image.complete)
      .map((image) => imageSource(image));
    const zeroDimensionImages = images
      .filter((image) => {
        if (!imageIsInScope(image) || !visible(image)) return false;
        const rect = image.getBoundingClientRect();
        return image.naturalWidth > 0 && (rect.width < 1 || rect.height < 1);
      })
      .map((image) => ({ src: imageSource(image), selector: selector(image) }));
    const missingAlt = images
      .filter((image) => !image.hasAttribute("alt"))
      .map((image) => imageSource(image));
    const fallbackImages = contentImages
      .filter((image) => {
        const source = imageSource(image);
        let filename = source;
        try {
          filename =
            new URL(source, window.location.href).pathname.split("/").pop() ??
            source;
        } catch {}
        return /(^|[-_.])(placeholder|placehold|fallback|generic|cook-free-or-die|logo)([-_.]|$)/i.test(
          filename,
        );
      })
      .map((image) => imageSource(image));
    const cropRisks = contentImages.flatMap((image) => {
      const rect = image.getBoundingClientRect();
      const style = getComputedStyle(image);
      if (
        style.objectFit !== "cover" ||
        image.naturalWidth < 1 ||
        image.naturalHeight < 1 ||
        rect.width < 40 ||
        rect.height < 40
      )
        return [];
      const sourceRatio = image.naturalWidth / image.naturalHeight;
      const boxRatio = rect.width / rect.height;
      const mismatch = Math.abs(Math.log(sourceRatio / boxRatio));
      if (mismatch < 0.45) return [];
      return [
        {
          src: imageSource(image),
          source: [image.naturalWidth, image.naturalHeight],
          rendered: [Math.round(rect.width), Math.round(rect.height)],
          mismatch: Number(mismatch.toFixed(2)),
        },
      ];
    });
    const upscaleRisks = contentImages.flatMap((image) => {
      const rect = image.getBoundingClientRect();
      if (
        image.naturalWidth < 1 ||
        image.naturalHeight < 1 ||
        rect.width < 40 ||
        rect.height < 40
      )
        return [];
      const widthScale = rect.width / image.naturalWidth;
      const heightScale = rect.height / image.naturalHeight;
      const scale =
        getComputedStyle(image).objectFit === "contain"
          ? Math.min(widthScale, heightScale)
          : Math.max(widthScale, heightScale);
      if (scale < 1.75) return [];
      return [
        {
          src: imageSource(image),
          natural: [image.naturalWidth, image.naturalHeight],
          rendered: [Math.round(rect.width), Math.round(rect.height)],
          scale: Number(scale.toFixed(2)),
        },
      ];
    });
    const tinySourceImages = contentImages
      .filter((image) => {
        const rect = image.getBoundingClientRect();
        return (
          image.complete &&
          image.naturalWidth > 0 &&
          image.naturalHeight > 0 &&
          image.naturalWidth <= 4 &&
          image.naturalHeight <= 4 &&
          rect.width >= 40 &&
          rect.height >= 40
        );
      })
      .map((image) => ({
        src: imageSource(image),
        natural: [image.naturalWidth, image.naturalHeight],
        rendered: [
          Math.round(image.getBoundingClientRect().width),
          Math.round(image.getBoundingClientRect().height),
        ],
      }));

    const mediaCandidates = main
      ? [
          ...main.querySelectorAll(
            '[class*="media"], [class*="image"], [class*="artwork"], [class*="cover"], [class*="poster"], [class*="thumbnail"]',
          ),
        ]
      : [];
    const emptyMediaBoxes = [...new Set(mediaCandidates)]
      .flatMap((element) => {
        if (!visible(element)) return [];
        const rect = element.getBoundingClientRect();
        if (
          mediaMode !== "full" &&
          (rect.top >= window.innerHeight + 300 || rect.bottom <= -300)
        )
          return [];
        if (rect.width < 80 || rect.height < 80) return [];
        const background = getComputedStyle(element).backgroundImage;
        const loadedImage = [...element.querySelectorAll("img")].some(
          (image) => image.naturalWidth > 0,
        );
        if (element instanceof HTMLImageElement && element.naturalWidth > 0)
          return [];
        if (loadedImage || (background && background !== "none")) return [];
        return [
          {
            selector: selector(element),
            size: [Math.round(rect.width), Math.round(rect.height)],
          },
        ];
      })
      .slice(0, 20);

    const sourceCounts = new Map();
    for (const image of contentImages) {
      const src = imageSource(image);
      const rect = image.getBoundingClientRect();
      if (!src || rect.width < 72 || rect.height < 72) continue;
      sourceCounts.set(src, (sourceCounts.get(src) ?? 0) + 1);
    }
    const duplicatePageArt = [...sourceCounts.entries()]
      .filter(([, count]) => count > 1)
      .map(([src, count]) => ({ src, count }));

    const ids = [...document.querySelectorAll("[id]")].map(
      (element) => element.id,
    );
    const repeatedIds = [
      ...new Set(ids.filter((id, index) => ids.indexOf(id) !== index)),
    ];
    const horizontalOverflow =
      document.documentElement.scrollWidth > window.innerWidth + 2;
    const brokenHashLinks = [...document.querySelectorAll("a[href]")].flatMap(
      (link) => {
        let target;
        try {
          target = new URL(link.href, window.location.href);
        } catch {
          return [];
        }
        if (
          !target.hash ||
          target.hash === "#" ||
          target.origin !== window.location.origin ||
          target.pathname !== window.location.pathname
        )
          return [];
        let id;
        try {
          id = decodeURIComponent(target.hash.slice(1));
        } catch {
          id = target.hash.slice(1);
        }
        return document.getElementById(id)
          ? []
          : [
              {
                href: link.getAttribute("href"),
                text: link.textContent?.trim().slice(0, 80),
              },
            ];
      },
    );
    const mapCanvas = document.querySelector(".maplibregl-canvas");
    const mapCanvasRect = mapCanvas?.getBoundingClientRect();
    const overflowElements = horizontalOverflow
      ? [...document.body.querySelectorAll("*")]
          .flatMap((element) => {
            if (!visible(element)) return [];
            const rect = element.getBoundingClientRect();
            if (rect.right <= window.innerWidth + 2 && rect.left >= -2)
              return [];
            return [
              {
                selector: selector(element),
                left: Math.round(rect.left),
                right: Math.round(rect.right),
                width: Math.round(rect.width),
              },
            ];
          })
          .slice(0, 12)
      : [];

    return {
      title: document.title,
      lang: document.documentElement.lang,
      landmarks: {
        headers: document.querySelectorAll("body > header").length,
        mains: document.querySelectorAll("main").length,
        labelledNavigation: document.querySelectorAll("nav[aria-label]").length,
        mainHeadings: document.querySelectorAll("main h1").length,
      },
      linksWithoutHref: [...document.querySelectorAll("a")]
        .filter(
          (link) =>
            !link.getAttribute("href") ||
            link.getAttribute("href")?.includes("undefined"),
        )
        .map((link) => link.textContent?.trim().slice(0, 80) || "(empty link)"),
      brokenHashLinks,
      repeatedIds,
      imageCount: images.length,
      contentImageCount: contentImages.length,
      contentImageSources: [
        ...new Set(contentImages.map(imageSource).filter(Boolean)),
      ],
      brokenImages,
      incompleteImages,
      zeroDimensionImages,
      tinySourceImages,
      missingAlt,
      fallbackImages: [...new Set(fallbackImages)],
      cropRisks,
      upscaleRisks,
      emptyMediaBoxes,
      duplicatePageArt,
      horizontalOverflow,
      overflowElements,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      mapState: {
        present: Boolean(document.querySelector(".maplibregl-map")),
        canvasPresent: Boolean(mapCanvas),
        canvasSize: mapCanvasRect
          ? [Math.round(mapCanvasRect.width), Math.round(mapCanvasRect.height)]
          : [0, 0],
        visibleError: Boolean(
          document.querySelector(".map-error:not([hidden])"),
        ),
      },
    };
  }, MEDIA_MODE);
}

function evaluateChecks(audit, responseStatus, events) {
  const failures = [];
  const warnings = [];

  if (responseStatus !== 200)
    failures.push(
      issue("http", `Page returned HTTP ${responseStatus ?? "no response"}.`),
    );
  for (const error of events.pageErrors)
    failures.push(issue("page-error", error));
  for (const error of events.consoleErrors)
    failures.push(issue("console-error", error));
  for (const request of events.failedRequests) {
    const target = request.error?.includes("ERR_ABORTED") ? warnings : failures;
    target.push(
      issue("request-failed", `Request failed for ${request.url}.`, request),
    );
  }
  for (const response of events.badResponses) {
    failures.push(
      issue(
        "response-error",
        `Request returned HTTP ${response.status} for ${response.url}.`,
        response,
      ),
    );
  }

  if (!audit.title.trim())
    failures.push(issue("missing-title", "The page has no document title."));
  if (!audit.lang.trim())
    failures.push(
      issue("missing-language", "The html element has no language."),
    );
  if (audit.landmarks.headers !== 1)
    failures.push(
      issue(
        "header-landmark",
        `Expected one page header and found ${audit.landmarks.headers}.`,
      ),
    );
  if (audit.landmarks.mains !== 1)
    failures.push(
      issue(
        "main-landmark",
        `Expected one main element and found ${audit.landmarks.mains}.`,
      ),
    );
  if (audit.landmarks.labelledNavigation < 1)
    failures.push(
      issue("navigation-landmark", "No labelled navigation was found."),
    );
  if (audit.landmarks.mainHeadings !== 1)
    failures.push(
      issue(
        "main-heading",
        `Expected one main h1 and found ${audit.landmarks.mainHeadings}.`,
      ),
    );
  if (audit.horizontalOverflow)
    failures.push(
      issue(
        "horizontal-overflow",
        `The document is ${audit.documentWidth}px wide in a ${audit.viewportWidth}px viewport.`,
        { elements: audit.overflowElements },
      ),
    );
  if (
    audit.mapState.present &&
    (!audit.mapState.canvasPresent ||
      audit.mapState.canvasSize[0] < 1 ||
      audit.mapState.canvasSize[1] < 1 ||
      audit.mapState.visibleError)
  ) {
    failures.push(
      issue(
        "map-render",
        "The map did not produce a visible canvas.",
        audit.mapState,
      ),
    );
  }
  if (audit.brokenImages.length)
    failures.push(
      issue(
        "broken-images",
        `${audit.brokenImages.length} images failed to render.`,
        {
          images: audit.brokenImages,
        },
      ),
    );
  if (audit.incompleteImages.length)
    failures.push(
      issue(
        "incomplete-images",
        `${audit.incompleteImages.length} images did not finish loading.`,
        { images: audit.incompleteImages },
      ),
    );
  if (audit.zeroDimensionImages.length)
    failures.push(
      issue(
        "zero-dimension-images",
        `${audit.zeroDimensionImages.length} loaded images have no rendered size.`,
        { images: audit.zeroDimensionImages },
      ),
    );
  if (audit.tinySourceImages.length)
    failures.push(
      issue(
        "tiny-source-images",
        `${audit.tinySourceImages.length} content images returned only a tracking pixel.`,
        { images: audit.tinySourceImages },
      ),
    );
  if (audit.missingAlt.length)
    failures.push(
      issue(
        "missing-alt",
        `${audit.missingAlt.length} images have no alt attribute.`,
        {
          images: audit.missingAlt,
        },
      ),
    );
  if (audit.repeatedIds.length)
    failures.push(
      issue(
        "duplicate-ids",
        `${audit.repeatedIds.length} duplicate element IDs were found.`,
        {
          ids: audit.repeatedIds,
        },
      ),
    );
  if (audit.brokenHashLinks.length)
    failures.push(
      issue(
        "broken-hash-links",
        `${audit.brokenHashLinks.length} same-page links have no target.`,
        { links: audit.brokenHashLinks },
      ),
    );

  if (audit.linksWithoutHref.length)
    warnings.push(
      issue(
        "links-without-href",
        `${audit.linksWithoutHref.length} links have no valid href.`,
        {
          links: audit.linksWithoutHref,
        },
      ),
    );
  if (audit.emptyMediaBoxes.length)
    warnings.push(
      issue(
        "empty-media-boxes",
        `${audit.emptyMediaBoxes.length} large media boxes contain no loaded image.`,
        { boxes: audit.emptyMediaBoxes },
      ),
    );
  if (audit.cropRisks.length)
    warnings.push(
      issue(
        "crop-risk",
        `${audit.cropRisks.length} images use cover with a mismatched aspect ratio.`,
        { images: audit.cropRisks },
      ),
    );
  if (audit.upscaleRisks.length)
    warnings.push(
      issue(
        "upscale-risk",
        `${audit.upscaleRisks.length} images are enlarged well beyond their source size.`,
        { images: audit.upscaleRisks },
      ),
    );
  if (audit.fallbackImages.length)
    warnings.push(
      issue(
        "fallback-art",
        `${audit.fallbackImages.length} images look like fallback art.`,
        {
          images: audit.fallbackImages,
        },
      ),
    );
  if (audit.duplicatePageArt.length)
    warnings.push(
      issue(
        "duplicate-page-art",
        `${audit.duplicatePageArt.length} large images are repeated on the page.`,
        { images: audit.duplicatePageArt },
      ),
    );

  return { failures, warnings };
}

function attachPageEvents(page, state) {
  page.on("pageerror", (error) => {
    state.current?.pageErrors.push(error.message);
  });
  page.on("console", (message) => {
    if (message.type() === "error")
      state.current?.consoleErrors.push(message.text());
  });
  page.on("requestfailed", (request) => {
    state.current?.failedRequests.push({
      url: request.url(),
      resourceType: request.resourceType(),
      error: request.failure()?.errorText ?? "Unknown request error",
    });
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      state.current?.badResponses.push({
        url: response.url(),
        resourceType: response.request().resourceType(),
        status: response.status(),
      });
    }
  });
}

async function captureHomeSections(page, job) {
  if (job.route !== "/") return { captures: [], failures: [] };

  const failures = [];
  const anchorTargets = await page.evaluate(() => {
    const ids = new Set();
    for (const link of document.querySelectorAll("a[href]")) {
      let target;
      try {
        target = new URL(link.href, window.location.href);
      } catch {
        continue;
      }
      if (
        target.origin !== window.location.origin ||
        target.pathname !== window.location.pathname ||
        !target.hash ||
        target.hash === "#"
      )
        continue;
      try {
        ids.add(decodeURIComponent(target.hash.slice(1)));
      } catch {
        ids.add(target.hash.slice(1));
      }
    }
    return [...ids];
  });

  if (!anchorTargets.length) {
    failures.push(
      issue("home-anchor-navigation", "The home page has no section links."),
    );
  }

  for (const id of anchorTargets) {
    const state = await page.evaluate(async (targetId) => {
      const target = document.getElementById(targetId);
      if (!target) return { found: false, hashMatches: false, visible: false };
      window.location.hash = `#${encodeURIComponent(targetId)}`;
      await new Promise((resolvePromise) =>
        requestAnimationFrame(() => requestAnimationFrame(resolvePromise)),
      );
      const rect = target.getBoundingClientRect();
      let hashId;
      try {
        hashId = decodeURIComponent(window.location.hash.slice(1));
      } catch {
        hashId = window.location.hash.slice(1);
      }
      return {
        found: true,
        hashMatches: hashId === targetId,
        visible: rect.top < window.innerHeight && rect.bottom > 0,
      };
    }, id);
    if (!state.found || !state.hashMatches || !state.visible) {
      failures.push(
        issue(
          "home-anchor-navigation",
          `The home section link for #${id} did not reach its target.`,
          {
            target: id,
            state,
          },
        ),
      );
    }
  }

  const captures = [];
  const sections = page.locator("main > section[id]");
  const sectionCount = Math.min(await sections.count(), 24);
  for (let index = 0; index < sectionCount; index += 1) {
    const section = sections.nth(index);
    const id = (await section.getAttribute("id")) ?? `section-${index + 1}`;
    try {
      await section.evaluate(async (element) => {
        element.scrollIntoView({ block: "start", behavior: "instant" });
        const images = [...element.querySelectorAll("img")].filter((image) => {
          const rect = image.getBoundingClientRect();
          return rect.top < window.innerHeight + 300 && rect.bottom > -300;
        });
        for (const image of images) image.loading = "eager";
        await Promise.race([
          Promise.all(
            images
              .filter((image) => !image.complete)
              .map(
                (image) =>
                  new Promise((resolvePromise) => {
                    image.addEventListener("load", resolvePromise, {
                      once: true,
                    });
                    image.addEventListener("error", resolvePromise, {
                      once: true,
                    });
                  }),
              ),
          ),
          new Promise((resolvePromise) =>
            window.setTimeout(resolvePromise, 2_500),
          ),
        ]);
        await Promise.race([
          Promise.all(
            images
              .filter((image) => image.complete && image.naturalWidth > 0)
              .map((image) => image.decode().catch(() => undefined)),
          ),
          new Promise((resolvePromise) =>
            window.setTimeout(resolvePromise, 2_500),
          ),
        ]);
        await new Promise((resolvePromise) =>
          requestAnimationFrame(() => requestAnimationFrame(resolvePromise)),
        );
      });
      const filename = `${String(job.sequence).padStart(5, "0")}-${job.viewport.name}-${String(index + 1).padStart(2, "0")}-${routeName(id)}.jpg`;
      const capture = `sections/${filename}`;
      await page.screenshot({
        path: join(OUTPUT, capture),
        type: "jpeg",
        quality: 45,
        fullPage: false,
        animations: "disabled",
        caret: "hide",
      });
      captures.push({ id, capture });
    } catch (error) {
      failures.push(
        issue("home-section-capture", `The #${id} section screenshot failed.`, {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  return { captures, failures };
}

async function auditJob(page, state, job, baseUrl) {
  state.current = null;
  await page.goto("about:blank");
  await page.setViewportSize(job.viewport);
  const events = {
    pageErrors: [],
    consoleErrors: [],
    failedRequests: [],
    badResponses: [],
  };
  state.current = events;

  const startedAt = performance.now();
  let responseStatus = null;
  let audit = null;
  let navigationError = null;
  const url = `${baseUrl}${routeToUrlPath(job.route)}`;

  try {
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: PAGE_TIMEOUT_MS,
    });
    responseStatus = response?.status() ?? null;
    audit = await inspectPage(page);
  } catch (error) {
    navigationError = error instanceof Error ? error.message : String(error);
  }

  const captureName = `${String(job.sequence).padStart(5, "0")}-${job.viewport.name}-${routeName(job.route)}.jpg`;
  const captureRelative = `captures/${captureName}`;
  let captureError = null;
  try {
    await page.screenshot({
      path: join(OUTPUT, captureRelative),
      type: "jpeg",
      quality: 45,
      fullPage: false,
      animations: "disabled",
      caret: "hide",
    });
  } catch (error) {
    captureError = error instanceof Error ? error.message : String(error);
  }
  state.current = null;
  const homeSections = navigationError
    ? { captures: [], failures: [] }
    : await captureHomeSections(page, job);

  const checked = audit
    ? evaluateChecks(audit, responseStatus, events)
    : { failures: [], warnings: [] };
  if (navigationError)
    checked.failures.push(issue("navigation-error", navigationError));
  if (captureError) checked.failures.push(issue("capture-error", captureError));
  checked.failures.push(...homeSections.failures);

  return {
    sequence: job.sequence,
    route: job.route,
    viewport: job.viewport.name,
    viewportSize: { width: job.viewport.width, height: job.viewport.height },
    url,
    responseStatus,
    durationMs: Math.round(performance.now() - startedAt),
    capture: captureError ? null : captureRelative,
    sectionCaptures: homeSections.captures,
    title: audit?.title ?? "",
    metrics: audit
      ? {
          images: audit.imageCount,
          contentImages: audit.contentImageCount,
          contentImageSources: audit.contentImageSources,
          cropRisks: audit.cropRisks.length,
          upscaleRisks: audit.upscaleRisks.length,
          emptyMediaBoxes: audit.emptyMediaBoxes.length,
          fallbackImages: audit.fallbackImages.length,
        }
      : null,
    failures: checked.failures,
    warnings: checked.warnings,
  };
}

function buildDuplicateArtReport(results) {
  const usage = new Map();
  for (const result of results) {
    for (const src of result.metrics?.contentImageSources ?? []) {
      if (!usage.has(src)) usage.set(src, new Set());
      usage.get(src).add(result.route);
    }
  }
  return [...usage.entries()]
    .map(([src, routes]) => ({
      src,
      routeCount: routes.size,
      routes: [...routes].sort(),
    }))
    .filter((entry) => entry.routeCount > 1)
    .sort(
      (left, right) =>
        right.routeCount - left.routeCount || left.src.localeCompare(right.src),
    )
    .slice(0, 1_000);
}

function buildContactSheet(results, sheetNumber, totalSheets) {
  const cards = results
    .map((result) => {
      const state = result.failures.length
        ? "fail"
        : result.warnings.length
          ? "warn"
          : "pass";
      const capture = result.capture
        ? `<a href="${escapeHtml(result.capture)}"><img src="${escapeHtml(result.capture)}" alt="" loading="lazy"></a>`
        : '<div class="missing-capture">Capture failed</div>';
      return `<article class="${state} ${escapeHtml(result.viewport)}">
      ${capture}
      <p><b>${String(result.sequence).padStart(5, "0")}</b> ${escapeHtml(result.viewport)} ${escapeHtml(result.route)}</p>
      <small>${result.failures.length} failures, ${result.warnings.length} warnings</small>
    </article>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Visual audit sheet ${sheetNumber}</title>
<style>
body{margin:16px;background:#e9e4da;color:#171512;font:12px/1.35 system-ui,sans-serif}header{display:flex;gap:20px;align-items:baseline;margin-bottom:12px}h1{margin:0;font-size:18px}nav{margin-left:auto}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px}article{padding:6px;background:#fff;border:2px solid #bbb;overflow:hidden}article.fail{border-color:#a8321d}article.warn{border-color:#bd7b12}img,.missing-capture{display:block;width:100%;aspect-ratio:16/10;object-fit:contain;background:#eee}.missing-capture{display:grid;place-items:center;color:#a8321d;font-weight:700}p{margin:6px 0 2px;overflow-wrap:anywhere}small{color:#666}.mobile img,.mobile .missing-capture{aspect-ratio:390/844}a{color:inherit}
</style></head><body><header><h1>Visual audit sheet ${sheetNumber} of ${totalSheets}</h1><nav><a href="index.html">Audit index</a></nav></header><main>${cards}</main></body></html>`;
}

async function writeAuditPages(report) {
  const totalSheets = Math.ceil(report.results.length / CONTACT_SHEET_SIZE);
  const sheets = [];
  for (let index = 0; index < totalSheets; index += 1) {
    const number = index + 1;
    const filename = `contact-sheet-${String(number).padStart(3, "0")}.html`;
    const start = index * CONTACT_SHEET_SIZE;
    const items = report.results.slice(start, start + CONTACT_SHEET_SIZE);
    await writeFile(
      join(OUTPUT, filename),
      buildContactSheet(items, number, totalSheets),
    );
    sheets.push(filename);
  }

  const links = sheets
    .map((sheet, index) => `<li><a href="${sheet}">Sheet ${index + 1}</a></li>`)
    .join("");
  const failureLinks = report.results
    .filter((result) => result.failures.length)
    .slice(0, 500)
    .map((result) => {
      const href = result.capture ?? "report.json";
      return `<li><a href="${escapeHtml(href)}">${String(result.sequence).padStart(5, "0")} ${escapeHtml(result.viewport)} ${escapeHtml(result.route)}</a></li>`;
    })
    .join("");
  const sectionLinks = report.results
    .flatMap((result) =>
      result.sectionCaptures.map(
        (item) =>
          `<li><a href="${escapeHtml(item.capture)}">${escapeHtml(result.viewport)} #${escapeHtml(item.id)}</a></li>`,
      ),
    )
    .join("");
  const indexHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Visual audit</title><style>body{max-width:80rem;margin:2rem auto;padding:0 1rem;font:15px/1.5 system-ui,sans-serif}ul{columns:4}code{background:#eee;padding:.1rem .25rem}.fail{color:#a8321d}</style></head><body><h1>Visual audit</h1><p>${report.summary.routes} routes were checked at ${report.summary.viewports} viewport sizes. The audit made ${report.summary.captures} first view captures and ${report.summary.sectionCaptures} home section captures. <span class="fail">${report.summary.pagesWithFailures} pages have failures.</span></p><p><a href="report.json">Machine readable report</a></p><h2>Contact sheets</h2><ul>${links}</ul><h2>Home sections</h2><ul>${sectionLinks || "<li>None</li>"}</ul><h2>Failures</h2><ol>${failureLinks || "<li>None</li>"}</ol></body></html>`;
  await writeFile(join(OUTPUT, "index.html"), indexHtml);
  return sheets;
}

async function prepareOutput() {
  const relativeOutput = relative(ROOT, OUTPUT);
  if (!relativeOutput || relativeOutput.startsWith("..") || OUTPUT === DIST) {
    throw new Error(`Unsafe audit output path: ${OUTPUT}`);
  }
  await rm(OUTPUT, { recursive: true, force: true });
  await mkdir(join(OUTPUT, "captures"), { recursive: true });
  await mkdir(join(OUTPUT, "sections"), { recursive: true });
}

async function run() {
  const started = new Date();
  const routes = await enumerateRoutes();
  if (!routes.length)
    throw new Error(
      "No generated HTML routes were found. Run npm run build first.",
    );
  await prepareOutput();

  const jobs = [];
  let sequence = 1;
  for (const route of routes) {
    for (const viewport of VIEWPORTS)
      jobs.push({ sequence: sequence++, route, viewport });
  }

  console.log(
    `Checking ${routes.length} routes at ${VIEWPORTS.length} viewport sizes.`,
  );
  console.log(
    `Capturing ${jobs.length} first view screenshots with ${CONCURRENCY} workers.`,
  );
  console.log(`Output: ${relative(ROOT, OUTPUT)}`);

  const server = await startStaticServer();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    colorScheme: "light",
    deviceScaleFactor: 1,
    locale: "en-US",
    reducedMotion: "reduce",
    serviceWorkers: "block",
    timezoneId: "UTC",
  });

  const results = [];
  let nextJob = 0;
  let completed = 0;

  async function openWorkerPage() {
    const page = await context.newPage();
    page.setDefaultTimeout(PAGE_TIMEOUT_MS);
    const state = { current: null };
    attachPageEvents(page, state);
    return { page, state };
  }

  async function closeWorkerPage(workerPage) {
    if (!workerPage?.page || workerPage.page.isClosed()) return;
    await workerPage.page.close().catch(() => {});
  }

  async function worker() {
    let workerPage = await openWorkerPage();
    let jobsOnPage = 0;
    try {
      while (true) {
        const index = nextJob++;
        if (index >= jobs.length) break;
        const job = jobs[index];
        let result = null;
        let runnerError = null;

        for (let attempt = 0; attempt < 2 && !result; attempt += 1) {
          try {
            result = await auditJob(
              workerPage.page,
              workerPage.state,
              job,
              server.baseUrl,
            );
          } catch (error) {
            runnerError =
              error instanceof Error ? error.message : String(error);
            await closeWorkerPage(workerPage);
            workerPage = await openWorkerPage();
            jobsOnPage = 0;
          }
        }

        if (!result) {
          result = {
            sequence: job.sequence,
            route: job.route,
            viewport: job.viewport.name,
            viewportSize: {
              width: job.viewport.width,
              height: job.viewport.height,
            },
            url: `${server.baseUrl}${routeToUrlPath(job.route)}`,
            responseStatus: null,
            durationMs: 0,
            capture: null,
            sectionCaptures: [],
            title: "",
            metrics: null,
            failures: [
              issue(
                "audit-runner-error",
                runnerError ??
                  "The browser page closed before the audit finished.",
              ),
            ],
            warnings: [],
          };
        }

        results.push(result);
        completed += 1;
        jobsOnPage += 1;

        if (jobsOnPage >= 100) {
          await closeWorkerPage(workerPage);
          workerPage = await openWorkerPage();
          jobsOnPage = 0;
        }

        if (completed % 25 === 0 || completed === jobs.length) {
          const failed = results.filter((item) => item.failures.length).length;
          process.stdout.write(
            `\r${completed}/${jobs.length} captures complete, ${failed} with failures`,
          );
        }
      }
    } finally {
      await closeWorkerPage(workerPage);
    }
  }

  try {
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    await server.close().catch(() => {});
  }
  process.stdout.write("\n");

  results.sort((left, right) => left.sequence - right.sequence);
  const pagesWithFailures = results.filter(
    (result) => result.failures.length,
  ).length;
  const pagesWithWarnings = results.filter(
    (result) => result.warnings.length,
  ).length;
  const failureCount = results.reduce(
    (sum, result) => sum + result.failures.length,
    0,
  );
  const warningCount = results.reduce(
    (sum, result) => sum + result.warnings.length,
    0,
  );
  const missingSequences = jobs
    .filter(
      (job) => !results.some((result) => result.sequence === job.sequence),
    )
    .map((job) => job.sequence);

  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    configuration: {
      dist: relative(ROOT, DIST),
      output: relative(ROOT, OUTPUT),
      basePath: BASE_PATH || "/",
      concurrency: CONCURRENCY,
      pageTimeoutMs: PAGE_TIMEOUT_MS,
      imageWaitMs: IMAGE_WAIT_MS,
      mapWaitMs: MAP_WAIT_MS,
      mediaMode: MEDIA_MODE,
      requestedRoutes: [...REQUESTED_ROUTES],
      viewportDefinitions: VIEWPORTS,
    },
    summary: {
      routes: routes.length,
      viewports: VIEWPORTS.length,
      expectedPages: jobs.length,
      auditedPages: results.length,
      captures: results.filter((result) => result.capture).length,
      sectionCaptures: results.reduce(
        (sum, result) => sum + result.sectionCaptures.length,
        0,
      ),
      pagesWithFailures,
      pagesWithWarnings,
      failureCount,
      warningCount,
      missingSequences,
      durationSeconds: Math.round((Date.now() - started.getTime()) / 1000),
    },
    duplicateArt: buildDuplicateArtReport(results),
    results,
  };

  const sheets = await writeAuditPages(report);
  report.summary.contactSheets = sheets.length;
  await writeFile(
    join(OUTPUT, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );

  console.log(`Audit report: ${relative(ROOT, join(OUTPUT, "report.json"))}`);
  console.log(
    `Contact sheet index: ${relative(ROOT, join(OUTPUT, "index.html"))}`,
  );
  console.log(
    `${pagesWithFailures} captures have failures and ${pagesWithWarnings} have warnings.`,
  );

  const incompleteCoverage =
    results.length !== jobs.length || missingSequences.length > 0;
  if (
    !ALLOW_FAILURES &&
    (incompleteCoverage ||
      pagesWithFailures > 0 ||
      (FAIL_ON_WARNINGS && pagesWithWarnings > 0))
  ) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
