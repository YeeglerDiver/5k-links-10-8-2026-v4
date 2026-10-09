const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const distDir = path.join(process.cwd(), "dist");
if (fs.existsSync(distDir)) {
  fs.rmSync(distDir, { recursive: true, force: true });
}
fs.mkdirSync(distDir, { recursive: true });
fs.writeFileSync(path.join(distDir, ".nojekyll"), "");

const repoName = process.env.GITHUB_REPOSITORY
  ? process.env.GITHUB_REPOSITORY.split("/")[1]
  : "5k-links-10-8-2026-v4";
const repoPrefix = `/${repoName}/`;
const fullScramPrefix = `${repoPrefix}scram/`;

// 1. Download and extract scientific-studying/svg directly into dist
console.log("Downloading and extracting upstream package...");
const tarPath = path.join(process.cwd(), "temp.tar.gz");
execSync(`curl -sL "https://codeload.github.com/scientific-studying/svg/tar.gz/refs/heads/main" -o "${tarPath}"`);
execSync(`tar -xzf "${tarPath}" -C "${distDir}" --strip-components=1`);
fs.rmSync(tarPath, { force: true });

// 2. Rename root index.html to app.html
const origHtml = path.join(distDir, "index.html");
const appShellHtml = path.join(distDir, "app.html");
if (fs.existsSync(origHtml)) {
  fs.renameSync(origHtml, appShellHtml);
}

// 3. Patch Scramjet prefix (/scram/ -> /<repoName>/scram/) across runtime files
const prefixRegex = /(['"`])\/scram\//g;

const swPath = path.join(distDir, "sw.js");
if (fs.existsSync(swPath)) {
  let swCode = fs.readFileSync(swPath, "utf8");
  swCode = swCode.replace(prefixRegex, `$1${fullScramPrefix}`);
  fs.writeFileSync(swPath, swCode);
}

// 4. Overwrite dead hardcoded domains inside all asset bundles with live public Wisp servers
const TARGET_WISP_WS = "wss://wisp.mercurywork.shop/";
const TARGET_WISP_HTTP = "https://wisp.mercurywork.shop/";

const deadDomains = [
  "21baseballacademy.com",
  "k12-nj2-portal.educationate.space",
  "k12-nj1-portal.khanlearning.art",
  "k12-na-east1-portal.johnsclasslearning.store",
  "new-server.baylib.top"
];

const assetsDir = path.join(distDir, "assets");
if (fs.existsSync(assetsDir)) {
  for (const file of fs.readdirSync(assetsDir)) {
    if (file.endsWith(".js") || file.endsWith(".json")) {
      const p = path.join(assetsDir, file);
      let content = fs.readFileSync(p, "utf8");

      // Patch scram prefix
      content = content.replace(prefixRegex, `$1${fullScramPrefix}`);

      // Overwrite dead domains
      for (const dead of deadDomains) {
        content = content.split(`wss://${dead}/ws/`).join(TARGET_WISP_WS);
        content = content.split(`wss://${dead}/ws`).join(TARGET_WISP_WS);
        content = content.split(`wss://${dead}`).join(TARGET_WISP_WS);
        content = content.split(`https://${dead}`).join(TARGET_WISP_HTTP);
        content = content.split(dead).join("wisp.mercurywork.shop");
      }

      fs.writeFileSync(p, content);
    }
  }
}

const scramjetAll = path.join(distDir, "runtime", "scramjet", "scramjet.all.js");
if (fs.existsSync(scramjetAll)) {
  let scramjetCode = fs.readFileSync(scramjetAll, "utf8");
  scramjetCode = scramjetCode.replace(prefixRegex, `$1${fullScramPrefix}`);
  fs.writeFileSync(scramjetAll, scramjetCode);
}

// 5. Inject auth-stub into app.html so /api/auth/session never triggers CORS errors
if (fs.existsSync(appShellHtml)) {
  let htmlCode = fs.readFileSync(appShellHtml, "utf8");
  htmlCode = htmlCode.replace(prefixRegex, `$1${fullScramPrefix}`);
  
  const authShim = `
  <script>
    (function() {
      const origFetch = window.fetch;
      window.fetch = async function(...args) {
        const url = typeof args[0] === "string" ? args[0] : (args[0] && args[0].url) || "";
        if (url.includes("/api/auth/session")) {
          return new Response(JSON.stringify({ user: null, authenticated: false }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          });
        }
        return origFetch.apply(this, args);
      };
    })();
  </script>`;
  
  htmlCode = htmlCode.replace(/<head([^>]*)>/i, `<head$1>\n${authShim}`);
  fs.writeFileSync(appShellHtml, htmlCode);
}

// 6. Subdirectory wrapper template
const pageTemplate = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>App</title>
  <link rel="icon" type="image/png" href="${repoPrefix}branding/lucide.png">
  <style>
    html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #000; }
    iframe { width: 100%; height: 100%; border: none; display: block; }
  </style>
</head>
<body>
  <iframe src="${repoPrefix}app.html" allow="fullscreen; clipboard-read; clipboard-write"></iframe>
</body>
</html>`;

// 7. Generate 5,000 subfolders
const TOTAL_PAGES = 5000;
const chars = "abcdefghijklmnopqrstuvwxyz0123456789";

function getRandomSegment(minLen = 4, maxLen = 10) {
  const length = Math.floor(Math.random() * (maxLen - minLen + 1)) + minLen;
  let segment = "";
  for (let i = 0; i < length; i++) segment += chars.charAt(Math.floor(Math.random() * chars.length));
  return segment;
}

function getNestedPath(minSegments = 2, maxSegments = 4) {
  const depth = Math.floor(Math.random() * (maxSegments - minSegments + 1)) + minSegments;
  const segments = [];
  for (let i = 0; i < depth; i++) segments.push(getRandomSegment(4, 10));
  return segments.join("/");
}

const uniquePaths = new Set();
while (uniquePaths.size < TOTAL_PAGES) {
  uniquePaths.add(getNestedPath(2, 4));
}

let masterLinksHtml = "";

for (const nestedPath of uniquePaths) {
  const folderPath = path.join(distDir, nestedPath);
  fs.mkdirSync(folderPath, { recursive: true });
  fs.writeFileSync(path.join(folderPath, "index.html"), pageTemplate);
  masterLinksHtml += `<a class="card" href="${repoPrefix}${nestedPath}/">${nestedPath}</a>\n`;
}

// 8. Main directory index dashboard
const masterIndexHtml = `<!DOCTYPE html>
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
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
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

fs.writeFileSync(path.join(distDir, "index.html"), masterIndexHtml);
console.log("Build and domain patch completed successfully.");
