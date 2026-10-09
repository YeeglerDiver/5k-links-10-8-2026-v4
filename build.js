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
  : "5k-links-10-8-2026-v2";
const repoPrefix = `/${repoName}/`;

// Helper to download remote files with redirect handling
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

// Flat copy of all nested files to target root
function copyAllFilesToRoot(srcDir, targetDir) {
  if (!fs.existsSync(srcDir)) return;
  for (const item of fs.readdirSync(srcDir)) {
    const fullSrc = path.join(srcDir, item);
    const stat = fs.statSync(fullSrc);
    if (stat.isDirectory()) {
      copyAllFilesToRoot(fullSrc, targetDir);
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

  // 1. Git LFS tracking rules
  const gitattributesContent = [
    "books/html/fnafi/* filter=lfs diff=lfs merge=lfs -text",
    "books/html/fnafi3/* filter=lfs diff=lfs merge=lfs -text",
    "*.zip filter=lfs diff=lfs merge=lfs -text",
    "*.wasm filter=lfs diff=lfs merge=lfs -text",
    ""
  ].join("\n");
  fs.writeFileSync(path.join(distDir, ".gitattributes"), gitattributesContent);

  // 2. Copy remote directory structure
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

  // 3. Mirror all assets to root for flat lookups
  copyAllFilesToRoot(path.join(extractDir, "assets"), distDir);
  copyAllFilesToRoot(path.join(extractDir, "runtime"), distDir);
  copyAllFilesToRoot(path.join(extractDir, "branding"), distDir);

  // Preserve local repo assets
  const localDirs = ["books", "dist"];
  for (const d of localDirs) {
    if (fs.existsSync(d)) {
      fs.cpSync(d, path.join(distDir, d), { recursive: true });
      copyAllFilesToRoot(path.join(process.cwd(), d), distDir);
    }
  }

  fs.rmSync(tarPath, { force: true });

  // 4. Patch root-relative URLs in all JS, JSON, and HTML bundles
  function patchPathsInDirectory(dir) {
    for (const item of fs.readdirSync(dir)) {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        if (item !== ".git") patchPathsInDirectory(fullPath);
      } else if (/\.(html|js|json|webmanifest|css)$/i.test(item)) {
        let content = fs.readFileSync(fullPath, "utf8");
        const updated = content
          .replace(/(['"])\/runtime\//g, `$1${repoPrefix}runtime/`)
          .replace(/(['"])\/assets\//g, `$1${repoPrefix}assets/`)
          .replace(/(['"])\/branding\//g, `$1${repoPrefix}branding/`)
          .replace(/(['"])\/sw\.js(['"])/g, `$1${repoPrefix}sw.js$2`)
          .replace(/href=["']\/runtime\//gi, `href="${repoPrefix}runtime/`)
          .replace(/src=["']\/runtime\//gi, `src="${repoPrefix}runtime/`);

        if (updated !== content) {
          fs.writeFileSync(fullPath, updated, "utf8");
        }
      }
    }
  }

  patchPathsInDirectory(distDir);

  // 5. Build base application template from index.html
  const rawHtmlPath = path.join(extractDir, "index.html");
  let appHtml = fs.existsSync(rawHtmlPath)
    ? fs.readFileSync(rawHtmlPath, "utf8")
    : fs.readFileSync("index.html", "utf8");

  // Remap standard root attributes
  appHtml = appHtml
    .replace(/(href|src)=["']\/(?!\/)(.*?)["']/gi, `$1="${repoPrefix}$2"`)
    .replace(/url\(['"]?\/([^'")]+)['"]?\)/gi, `url("${repoPrefix}$1")`);

  if (!appHtml.includes("<base ")) {
    appHtml = appHtml.replace(/<head([^>]*)>/i, `<head$1>\n    <base href="${repoPrefix}">`);
  }

  fs.rmSync(extractDir, { recursive: true, force: true });

  // 6. Generate 5,000 subdirectories
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
    masterLinksHtml += `<a class="card" href="./${nestedPath}/">${nestedPath}</a>\n`;
  }

  // 7. Site Index
  const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Directory Index</title>
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
  console.log("Successfully rebuilt bundles with patched runtime paths.");
}

runBuild();
