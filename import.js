const fs = require("fs");
const path = require("path");
const https = require("https");
const { execSync } = require("child_process");

const rootDir = process.cwd();
const repoTarUrl = "https://codeload.github.com/scientific-studying/svg/tar.gz/refs/heads/main";
const tarPath = path.join(rootDir, "temp_svg.tar.gz");
const extractDir = path.join(rootDir, "temp_svg_extracted");

function downloadBuffer(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "Node-Downloader" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadBuffer(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Download failed: ${res.statusCode}`));
      }
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    }).on("error", reject);
  });
}

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

async function run() {
  console.log("Fetching files from scientific-studying/svg@main...");
  const buf = await downloadBuffer(repoTarUrl);
  fs.writeFileSync(tarPath, buf);

  if (fs.existsSync(extractDir)) {
    fs.rmSync(extractDir, { recursive: true, force: true });
  }
  fs.mkdirSync(extractDir, { recursive: true });
  execSync(`tar -xzf "${tarPath}" -C "${extractDir}" --strip-components=1`);

  console.log("Placing files into repository root...");
  const items = fs.readdirSync(extractDir);
  for (const item of items) {
    // Preserve local configuration files
    if (item === "build.js" || item === ".git" || item === ".github") continue;
    copyRecursive(path.join(extractDir, item), path.join(rootDir, item));
  }

  // Cleanup temporary extraction artifacts
  fs.rmSync(tarPath, { force: true });
  fs.rmSync(extractDir, { recursive: true, force: true });

  console.log("Root directory populated successfully.");
}

run();
