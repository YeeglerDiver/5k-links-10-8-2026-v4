const fs = require("fs");
const path = require("path");

const distDir = path.join(process.cwd(), "dist_deploy");
if (fs.existsSync(distDir)) {
  fs.rmSync(distDir, { recursive: true, force: true });
}
fs.mkdirSync(distDir, { recursive: true });
fs.writeFileSync(path.join(distDir, ".nojekyll"), "");

const repoName = process.env.GITHUB_REPOSITORY
  ? process.env.GITHUB_REPOSITORY.split("/")[1]
  : "5k-links-10-8-2026-v4";
const repoPrefix = `/${repoName}/`;

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const item of fs.readdirSync(src)) {
      copyRecursive(path.join(src, item), path.join(dest, item));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

function copyFlatFiles(srcDir, targetDir) {
  if (!fs.existsSync(srcDir)) return;
  for (const item of fs.readdirSync(srcDir)) {
    const fullSrc = path.join(srcDir, item);
    const stat = fs.statSync(fullSrc);
    if (stat.isDirectory()) {
      copyFlatFiles(fullSrc, targetDir);
    } else {
      const fullDest = path.join(targetDir, item);
      if (!fs.existsSync(fullDest)) {
        fs.copyFileSync(fullSrc, fullDest);
      }
    }
  }
}

function runBuild() {
  console.log("Building directly from committed repository assets...");

  // 1. Copy repository files into dist_deploy
  const rootItems = fs.readdirSync(process.cwd());
  for (const item of rootItems) {
    if (["dist_deploy", ".git", ".github", "node_modules", "build.js"].includes(item)) continue;
    copyRecursive(path.join(process.cwd(), item), path.join(distDir, item));
  }

  // 2. Mirror assets directly into root for flat fallback lookups
  copyFlatFiles(path.join(distDir, "assets"), distDir);
  copyFlatFiles(path.join(distDir, "runtime"), distDir);
  copyFlatFiles(path.join(distDir, "branding"), distDir);

  // 3. Mirror Bare-Mux explicitly to baremux/ and dist root
  const baremuxDir = path.join(distDir, "runtime", "baremux");
  if (fs.existsSync(baremuxDir)) {
    const targets = [path.join(distDir, "baremux"), distDir];
    for (const t of targets) {
      fs.mkdirSync(t, { recursive: true });
      for (const f of fs.readdirSync(baremuxDir)) {
        fs.copyFileSync(path.join(baremuxDir, f), path.join(t, f));
      }
    }
  }

  // 4. Handle scramjet.wasm.wasm single and double extensions
  const scramjetDir = path.join(distDir, "runtime", "scramjet");
  if (fs.existsSync(scramjetDir)) {
    const doubleWasm = path.join(scramjetDir, "scramjet.wasm.wasm");
    const singleWasm = path.join(scramjetDir, "scramjet.wasm");
    if (fs.existsSync(doubleWasm)) {
      fs.copyFileSync(doubleWasm, singleWasm);
      fs.copyFileSync(doubleWasm, path.join(distDir, "scramjet.wasm.wasm"));
      fs.copyFileSync(doubleWasm, path.join(distDir, "scramjet.wasm"));
    }
  }

  // 5. Place lucide.png at root and inside assets/
  const lucideSrc = path.join(distDir, "branding", "lucide.png");
  if (fs.existsSync(lucideSrc)) {
    const buf = fs.readFileSync(lucideSrc);
    fs.writeFileSync(path.join(distDir, "lucide.png"), buf);
    fs.mkdirSync(path.join(distDir, "assets"), { recursive: true });
    fs.writeFileSync(path.join(distDir, "assets", "lucide.png"), buf);
  }

  // 6. Patch sw.js to prevent duplicate prefixing
  const swPath = path.join(distDir, "sw.js");
  if (fs.existsSync(swPath)) {
    let content = fs.readFileSync(swPath, "utf8");
    const swHeader = `
      const APP_PREFIX = "${repoPrefix}";
      self.addEventListener("fetch", (event) => {
        const reqUrl = new URL(event.request.url);
        if (reqUrl.pathname.endsWith("worker.js") || reqUrl.pathname.includes("baremux")) {
          return;
        }
        if (reqUrl.origin === location.origin) {
          if (!reqUrl.pathname.startsWith(APP_PREFIX)) {
            const cleanPath = reqUrl.pathname.replace(/^\\/+/, "");
            const remapped = new URL(APP_PREFIX + cleanPath + reqUrl.search, location.origin);
            event.respondWith(fetch(remapped, event.request));
            return;
          }
        }
      }, { prepend: true });
    `;
    fs.writeFileSync(swPath, swHeader + "\n" + content, "utf8");
  }

  // 7. Patch hardcoded paths in JS bundles (without creating duplicate prefixes)
  function deepPatch(dir) {
    for (const item of fs.readdirSync(dir)) {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        if (item !== ".git") deepPatch(fullPath);
      } else if (/\.(html|js|json|webmanifest|css)$/i.test(item)) {
        let text = fs.readFileSync(fullPath, "utf8");
        // Only prepend repoPrefix if not already prefixed
        const updated = text
          .replace(/(['"`])\/(?!5k-links-10-8-2026-v4\/)runtime\//g, `$1${repoPrefix}runtime/`)
          .replace(/(['"`])\/(?!5k-links-10-8-2026-v4\/)branding\//g, `$1${repoPrefix}branding/`)
          .replace(/(['"`])\/(?!5k-links-10-8-2026-v4\/)assets\//g, `$1${repoPrefix}assets/`)
          .replace(/(['"`])\/(?!5k-links-10-8-2026-v4\/)sw\.js/g, `$1${repoPrefix}sw.js`);

        if (updated !== text) {
          fs.writeFileSync(fullPath, updated, "utf8");
        }
      }
    }
  }
  deepPatch(distDir);

  // 8. Application HTML template (NO <base> tag to avoid double prefixing)
  const rawHtmlPath = path.join(distDir, "index.html");
  let appHtml = fs.readFileSync(rawHtmlPath, "utf8");
  appHtml = appHtml.replace(/<link[^>]+rel=["']preload["'][^>]*>/gi, "");
  appHtml = appHtml.replace(/<base[^>]*>/gi, ""); // Strip any existing base tag

  // Replace root paths that are not yet prefixed
  appHtml = appHtml
    .replace(/(href|src)=["']\/(?!5k-links-10-8-2026-v4\/)(?!\/)(.*?)["']/gi, `$1="${repoPrefix}$2"`)
    .replace(/url\(['"]?\/(?!5k-links-10-8-2026-v4\/)([^'")]+)['"]?\)/gi, `url("${repoPrefix}$1")`);

  const runtimeScript = `
  <link rel="icon" type="image/png" href="${repoPrefix}branding/lucide.png">
  <link rel="shortcut icon" type="image/png" href="${repoPrefix}branding/lucide.png">
  <script>
    (function() {
      const BASE = "${repoPrefix}";
      window.__bareMuxPath = BASE + "runtime/baremux/worker.js";
      window.BareMux = window.BareMux || {};
      window.BareMux.workerPath = BASE + "runtime/baremux/worker.js";

      document.addEventListener("click", function(e) {
        const link = e.target.closest("a");
        if (!link) return;
        const href = link.getAttribute("href");
        if (href === "/" || href === "./" || href === "") {
          e.preventDefault();
          e.stopPropagation();
          return false;
        }
      }, true);

      const origPush = history.pushState;
      const origReplace = history.replaceState;
      history.pushState = function(state, unused, url) {
        if (typeof url === "string" && url.startsWith("/") && !url.startsWith(BASE)) {
          url = BASE + url.replace(/^\\/+/, "");
        }
        return origPush.apply(this, [state, unused, url]);
      };
      history.replaceState = function(state, unused, url) {
        if (typeof url === "string" && url.startsWith("/") && !url.startsWith(BASE)) {
          url = BASE + url.replace(/^\\/+/, "");
        }
        return origReplace.apply(this, [state, unused, url]);
      };

      const origFetch = window.fetch;
      window.fetch = async function(...args) {
        if (typeof args[0] === "string") {
          let u = args[0];
          // Prepend BASE only if not already prefixed
          if (!u.startsWith(BASE)) {
            if (u.startsWith("/runtime/") || u.startsWith("/branding/") || u.startsWith("/assets/") || u.startsWith("/baremux/")) {
              args[0] = BASE + u.replace(/^\\/+/, "");
            } else if (u === "sw.js" || u === "/sw.js") {
              args[0] = BASE + "sw.js";
            } else if (u === "worker.js" || u === "/worker.js") {
              args[0] = BASE + "worker.js";
            }
          }
          if (u.includes("/api/auth/session")) {
            return new Response(JSON.stringify({ user: null, authenticated: false }), {
              status: 200,
              headers: { "Content-Type": "application/json" }
            });
          }
        }
        try {
          return await origFetch.apply(this, args);
        } catch (err) {
          if (typeof args[0] === "string" && (args[0].includes("/api/") || args[0].includes("/ws/"))) {
            return new Response(JSON.stringify({ error: "offline" }), {
              status: 503,
              headers: { "Content-Type": "application/json" }
            });
          }
          throw err;
        }
      };

      const OrigWorker = window.Worker;
      window.Worker = function(url, opts) {
        let u = url.toString();
        if (!u.startsWith(BASE) && (u.startsWith("/runtime/") || u.startsWith("/assets/") || u.includes("worker.js") || u.includes("baremux"))) {
          u = BASE + u.replace(/^\\/+/, "");
        }
        return new OrigWorker(u, opts);
      };

      if (window.SharedWorker) {
        const OrigShared = window.SharedWorker;
        window.SharedWorker = function(url, opts) {
          let u = url.toString();
          if (!u.startsWith(BASE) && (u.startsWith("/runtime/") || u.startsWith("/assets/") || u.includes("worker.js") || u.includes("baremux"))) {
            u = BASE + u.replace(/^\\/+/, "");
          }
          return new OrigShared(u, opts);
        };
      }
    })();
  </script>`;

  appHtml = appHtml.replace(/<head([^>]*)>/i, `<head$1>\n${runtimeScript}`);

  // 9. SPA 404 Fallback
  const spaFallback = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <script>
    const p = window.location.pathname;
    if (!p.startsWith("${repoPrefix}")) {
      window.location.replace("${repoPrefix}" + p.replace(/^\\/+/, "") + window.location.search + window.location.hash);
    }
  </script>
</head>
<body>
  <script>window.location.replace("${repoPrefix}");</script>
</body>
</html>`;
  fs.writeFileSync(path.join(distDir, "404.html"), spaFallback);

  // 10. Cache local files for subfolders
  const localCopies = [
    "sw.js",
    "worker.js",
    "scramjet.all.js",
    "scramjet.sync.js",
    "scramjet.wasm.wasm",
    "scramjet.wasm",
    "index.js",
    "lucide.png"
  ];
  const fileBuffers = {};
  for (const name of localCopies) {
    const p = path.join(distDir, name);
    if (fs.existsSync(p)) fileBuffers[name] = fs.readFileSync(p);
  }

  // 11. Generate 5,000 subdirectories
  const TOTAL_PAGES = 5000;
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";

  function getRandomSegment(minLen = 4, maxLen = 10) {
    const len = Math.floor(Math.random() * (maxLen - minLen + 1)) + minLen;
    let seg = "";
    for (let i = 0; i < len; i++) seg += chars.charAt(Math.floor(Math.random() * chars.length));
    return seg;
  }

  function getNestedPath(minSegments = 2, maxSegments = 4) {
    const depth = Math.floor(Math.random() * (maxSegments - minSegments + 1)) + minSegments;
    const segs = [];
    for (let i = 0; i < depth; i++) segs.push(getRandomSegment(4, 10));
    return segs.join("/");
  }

  const uniquePaths = new Set();
  while (uniquePaths.size < TOTAL_PAGES) {
    uniquePaths.add(getNestedPath(2, 4));
  }

  let masterLinksHtml = "";

  for (const nestedPath of uniquePaths) {
    const folderPath = path.join(distDir, nestedPath);
    fs.mkdirSync(folderPath, { recursive: true });
    fs.writeFileSync(path.join(folderPath, "index.html"), appHtml);

    for (const [fname, buf] of Object.entries(fileBuffers)) {
      fs.writeFileSync(path.join(folderPath, fname), buf);
    }

    if (fileBuffers["worker.js"]) {
      const subBaremux = path.join(folderPath, "baremux");
      fs.mkdirSync(subBaremux, { recursive: true });
      fs.writeFileSync(path.join(subBaremux, "worker.js"), fileBuffers["worker.js"]);
      if (fileBuffers["index.js"]) {
        fs.writeFileSync(path.join(subBaremux, "index.js"), fileBuffers["index.js"]);
      }
    }

    if (fileBuffers["lucide.png"]) {
      fs.mkdirSync(path.join(folderPath, "branding"), { recursive: true });
      fs.writeFileSync(path.join(folderPath, "branding", "lucide.png"), fileBuffers["lucide.png"]);
    }

    masterLinksHtml += `<a class="card" href="${repoPrefix}${nestedPath}/">${nestedPath}</a>\n`;
  }

  // 12. Write Root Directory Index
  const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Directory Index</title>
  <link rel="icon" type="image/png" href="${repoPrefix}branding/lucide.png">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #0d1117; color: #c9d1d9;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      padding: 40px 20px; display: flex; flex-direction: column; align-items: center;
    }
    header { text-align: center; margin-bottom: 28px; max-width: 650px; width: 100%; }
    h1 { font-size: 28px; font-weight: 700; color: #f0f6fc; margin-bottom: 8px; }
    p { color: #8b949e; font-size: 14px; margin-bottom: 20px; }
    .search-box {
      width: 100%; padding: 12px 18px; border-radius: 8px; border: 1px solid #30363d;
      background: #161b22; color: #f0f6fc; font-size: 15px; outline: none;
    }
    .search-box:focus { border-color: #58a6ff; box-shadow: 0 0 0 3px rgba(88, 166, 255, 0.2); }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px; width: 100%; max-width: 1300px; }
    .card {
      display: flex; align-items: center; justify-content: center; background: #161b22;
      border: 1px solid #30363d; border-radius: 6px; padding: 12px; color: #58a6ff;
      text-decoration: none; font-size: 12px; font-family: monospace; word-break: break-all; text-align: center;
    }
    .card:hover { background: #21262d; border-color: #58a6ff; color: #79c0ff; transform: translateY(-2px); }
    .hidden { display: none !important; }
  </style>
</head>
<body>
  <header>
    <h1>Directory Index</h1>
    <p>5,000 Nested Endpoints</p>
    <input type="text" id="filter" class="search-box" placeholder="Quick find path..." autocomplete="off" />
  </header>
  <main class="grid" id="link-grid">${masterLinksHtml}</main>
  <script>
    const filter = document.getElementById("filter");
    const links = document.querySelectorAll(".card");
    filter.addEventListener("input", (e) => {
      const term = e.target.value.toLowerCase().trim();
      links.forEach(card => card.classList.toggle("hidden", !card.textContent.toLowerCase().includes(term)));
    });
  </script>
</body>
</html>`;

  fs.writeFileSync(path.join(distDir, "index.html"), indexHtml);
  console.log("Build complete.");
}

runBuild();
