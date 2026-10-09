const fs = require("fs");
const path = require("path");
const https = require("https");
const { execSync } = require("child_process");

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

function downloadBuffer(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "Node-Build-Script" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadBuffer(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Failed to fetch ${url}, status: ${res.statusCode}`));
      }
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    }).on("error", reject);
  });
}

function copyAllFilesToTarget(srcDir, targetDir) {
  if (!fs.existsSync(srcDir)) return;
  for (const item of fs.readdirSync(srcDir)) {
    const fullSrc = path.join(srcDir, item);
    const stat = fs.statSync(fullSrc);
    if (stat.isDirectory()) {
      copyAllFilesToTarget(fullSrc, targetDir);
    } else {
      const fullDest = path.join(targetDir, item);
      if (!fs.existsSync(fullDest)) {
        fs.copyFileSync(fullSrc, fullDest);
      }
    }
  }
}

async function runBuild() {
  console.log("Fetching upstream repository package...");

  const repoTarUrl = "https://codeload.github.com/scientific-studying/svg/tar.gz/refs/heads/main";
  const tarPath = path.join(process.cwd(), "temp_svg.tar.gz");
  const extractDir = path.join(process.cwd(), "temp_svg_extracted");

  try {
    const tarBuffer = await downloadBuffer(repoTarUrl);
    fs.writeFileSync(tarPath, tarBuffer);

    if (fs.existsSync(extractDir)) {
      fs.rmSync(extractDir, { recursive: true, force: true });
    }
    fs.mkdirSync(extractDir, { recursive: true });

    execSync(`tar -xzf "${tarPath}" -C "${extractDir}" --strip-components=1`);
    console.log("Remote source extracted.");
  } catch (err) {
    console.error("Failed to download or extract source repository:", err.message);
    process.exit(1);
  }

  // 1. Setup Git LFS rules
  const gitattributesContent = [
    "books/html/fnafi/* filter=lfs diff=lfs merge=lfs -text",
    "books/html/fnafi3/* filter=lfs diff=lfs merge=lfs -text",
    "*.zip filter=lfs diff=lfs merge=lfs -text",
    "*.wasm filter=lfs diff=lfs merge=lfs -text",
    "*.wasm.wasm filter=lfs diff=lfs merge=lfs -text",
    ""
  ].join("\n");
  fs.writeFileSync(path.join(distDir, ".gitattributes"), gitattributesContent);

  // 2. Mirror remote repository directory structure to dist_deploy
  const remoteItems = fs.readdirSync(extractDir);
  for (const item of remoteItems) {
    const src = path.join(extractDir, item);
    const dest = path.join(distDir, item);
    if (fs.statSync(src).isDirectory()) {
      fs.cpSync(src, dest, { recursive: true });
    } else {
      fs.copyFileSync(src, dest);
    }
  }

  // 3. Mirror all assets and runtimes directly into the ROOT of dist_deploy
  copyAllFilesToTarget(path.join(extractDir, "assets"), distDir);
  copyAllFilesToTarget(path.join(extractDir, "runtime"), distDir);
  copyAllFilesToTarget(path.join(extractDir, "branding"), distDir);

  // Also retain local books/dist if present
  const localDirs = ["books", "dist"];
  for (const d of localDirs) {
    if (fs.existsSync(d)) {
      fs.cpSync(d, path.join(distDir, d), { recursive: true });
      copyAllFilesToTarget(path.join(process.cwd(), d), distDir);
    }
  }

  // 4. Mirror Bare-Mux explicitly to root, baremux/, and runtime/baremux/
  const baremuxDir = path.join(extractDir, "runtime", "baremux");
  if (fs.existsSync(baremuxDir)) {
    const baremuxTargets = [
      path.join(distDir, "baremux"),
      path.join(distDir, "runtime", "baremux"),
      distDir // root: /worker.js, /index.js
    ];
    for (const target of baremuxTargets) {
      fs.mkdirSync(target, { recursive: true });
      for (const file of fs.readdirSync(baremuxDir)) {
        fs.copyFileSync(path.join(baremuxDir, file), path.join(target, file));
      }
    }
  }

  // 5. Ensure scramjet.wasm.wasm and scramjet.wasm exist at root and runtime/scramjet
  const scramjetDir = path.join(distDir, "runtime", "scramjet");
  if (fs.existsSync(scramjetDir)) {
    const doubleWasm = path.join(scramjetDir, "scramjet.wasm.wasm");
    const singleWasm = path.join(scramjetDir, "scramjet.wasm");
    if (fs.existsSync(doubleWasm)) {
      fs.copyFileSync(doubleWasm, singleWasm);
      fs.copyFileSync(doubleWasm, path.join(distDir, "scramjet.wasm.wasm"));
      fs.copyFileSync(doubleWasm, path.join(distDir, "scramjet.wasm"));
    }
    const scramjetAll = path.join(scramjetDir, "scramjet.all.js");
    if (fs.existsSync(scramjetAll)) {
      fs.copyFileSync(scramjetAll, path.join(distDir, "scramjet.all.js"));
    }
  }

  // 6. Ensure lucide.png exists at the root, in branding/, and assets/
  const lucideSrc = path.join(distDir, "branding", "lucide.png");
  if (fs.existsSync(lucideSrc)) {
    const lucideBuf = fs.readFileSync(lucideSrc);
    fs.writeFileSync(path.join(distDir, "lucide.png"), lucideBuf);
    fs.mkdirSync(path.join(distDir, "assets"), { recursive: true });
    fs.writeFileSync(path.join(distDir, "assets", "lucide.png"), lucideBuf);
  }

  // 7. Patch sw.js so it bypasses worker.js, baremux, and routes prefix paths
  const swPath = path.join(distDir, "sw.js");
  if (fs.existsSync(swPath)) {
    let swContent = fs.readFileSync(swPath, "utf8");
    const swHeader = `
      const APP_PREFIX = "${repoPrefix}";
      self.addEventListener("fetch", (event) => {
        const reqUrl = new URL(event.request.url);
        // Let worker.js and baremux load natively as static files
        if (reqUrl.pathname.endsWith("worker.js") || reqUrl.pathname.includes("baremux")) {
          return;
        }
        if (reqUrl.origin === location.origin) {
          if (!reqUrl.pathname.startsWith(APP_PREFIX)) {
            const remapped = new URL(APP_PREFIX + reqUrl.pathname.replace(/^\\/+/, "") + reqUrl.search, location.origin);
            event.respondWith(fetch(remapped, event.request));
            return;
          }
        }
      }, { prepend: true });
    `;
    swContent = swHeader + "\n" + swContent;
    fs.writeFileSync(swPath, swContent, "utf8");
  }

  // 8. Patch root-relative strings inside bundles
  function deepPatch(dir) {
    for (const item of fs.readdirSync(dir)) {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        if (item !== ".git") deepPatch(fullPath);
      } else if (/\.(html|js|json|webmanifest|css)$/i.test(item)) {
        let content = fs.readFileSync(fullPath, "utf8");
        const updated = content
          .replace(/(['"`])\/runtime\//g, `$1${repoPrefix}runtime/`)
          .replace(/(['"`])\/branding\//g, `$1${repoPrefix}branding/`)
          .replace(/(['"`])\/assets\//g, `$1${repoPrefix}assets/`)
          .replace(/(['"`])\/sw\.js/g, `$1${repoPrefix}sw.js`);

        if (updated !== content) {
          fs.writeFileSync(fullPath, updated, "utf8");
        }
      }
    }
  }
  deepPatch(distDir);

  // 9. Prepare application HTML template
  const rawHtmlPath = path.join(extractDir, "index.html");
  let appHtml = fs.existsSync(rawHtmlPath)
    ? fs.readFileSync(rawHtmlPath, "utf8")
    : fs.readFileSync("index.html", "utf8");

  appHtml = appHtml.replace(/<link[^>]+rel=["']preload["'][^>]*>/gi, "");
  appHtml = appHtml
    .replace(/(href|src)=["']\/(?!\/)(.*?)["']/gi, `$1="${repoPrefix}$2"`)
    .replace(/url\(['"]?\/([^'")]+)['"]?\)/gi, `url("${repoPrefix}$1")`);

  const routerAndRuntimePatch = `
  <base href="${repoPrefix}">
  <link rel="icon" type="image/png" href="${repoPrefix}branding/lucide.png">
  <link rel="shortcut icon" type="image/png" href="${repoPrefix}branding/lucide.png">
  <script>
    (function() {
      const BASE = "${repoPrefix}";

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
          if (u.startsWith("/runtime/") || u.startsWith("/branding/") || u.startsWith("/assets/") || u.startsWith("/books/") || u.startsWith("/baremux/")) {
            args[0] = BASE + u.replace(/^\\/+/, "");
          } else if (u === "sw.js" || u === "/sw.js") {
            args[0] = BASE + "sw.js";
          } else if (u === "worker.js" || u === "/worker.js") {
            args[0] = BASE + "worker.js";
          } else if (u.includes("/api/auth/session")) {
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
        if (u.startsWith("/runtime/") || u.startsWith("/assets/") || u.includes("worker.js") || u.includes("baremux")) {
          u = BASE + u.replace(/^\\/+/, "");
        }
        return new OrigWorker(u, opts);
      };

      if (window.SharedWorker) {
        const OrigShared = window.SharedWorker;
        window.SharedWorker = function(url, opts) {
          let u = url.toString();
          if (u.startsWith("/runtime/") || u.startsWith("/assets/") || u.includes("worker.js") || u.includes("baremux")) {
            u = BASE + u.replace(/^\\/+/, "");
          }
          return new OrigShared(u, opts);
        };
      }
    })();
  </script>`;

  if (!appHtml.includes("<base ")) {
    appHtml = appHtml.replace(/<head([^>]*)>/i, `<head$1>\n${routerAndRuntimePatch}`);
  }

  // 10. SPA 404 Fallback
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
  <script>
    window.location.replace("${repoPrefix}");
  </script>
</body>
</html>`;
  fs.writeFileSync(path.join(distDir, "404.html"), spaFallback);

  fs.rmSync(tarPath, { force: true });
  fs.rmSync(extractDir, { recursive: true, force: true });

  // 11. Read local dependencies into memory to mirror inside each subfolder
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
    if (fs.existsSync(p)) {
      fileBuffers[name] = fs.readFileSync(p);
    }
  }

  // 12. Generate 5,000 subdirectories
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

    // Explicit baremux folder mirroring inside each nested path
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

  // 13. Root Landing Dashboard
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
