// detect-format.js
// Reads magic bytes of every file in public/assets/logos/ to detect
// the true format, then patches logos.json quality fields accordingly.
// Run with: node data-scripts/detect-format.js

const fs   = require('fs');
const path = require('path');

const LOGOS_DIR     = path.join(__dirname, '../public/assets/logos');
const MANIFEST_PATH = path.join(__dirname, '../public/logos.json');

// ── magic-byte detector ───────────────────────────────────────────────────────

function detectFormat(filePath) {
  const buf = Buffer.alloc(16);
  const fd  = fs.openSync(filePath, 'r');
  const bytesRead = fs.readSync(fd, buf, 0, 16, 0);
  fs.closeSync(fd);

  if (bytesRead < 3) return 'unknown';

  // PNG: 89 50 4E 47
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'png';

  // JPG: FF D8 FF
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'jpg';

  // GIF: 47 49 46 38
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'gif';

  // WebP: 52 49 46 46 ?? ?? ?? ?? 57 45 42 50
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'webp';

  // SVG: text starting with < or whitespace
  const head = buf.slice(0, bytesRead).toString('utf8').trimStart();
  if (head.startsWith('<')) return 'svg';

  return 'unknown';
}

// ── main ──────────────────────────────────────────────────────────────────────

const files = fs.readdirSync(LOGOS_DIR).sort();

let svgCount = 0, pngCount = 0, jpgCount = 0, gifCount = 0, webpCount = 0, unknownCount = 0;
let mismatchCount = 0;

// { id -> trueFormat }
const trueFormats = {};

console.log('\n── Format scan ────────────────────────────────────────────────');
console.log('File'.padEnd(50), 'True'.padEnd(8), 'Ext'.padEnd(8), 'Match?');
console.log('─'.repeat(75));

for (const file of files) {
  const filePath = path.join(LOGOS_DIR, file);
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) continue;

  const ext        = path.extname(file).toLowerCase().slice(1); // 'svg', 'png', etc.
  const id         = path.basename(file, path.extname(file));
  const trueFormat = detectFormat(filePath);

  const match = ext === trueFormat;
  if (!match) mismatchCount++;

  switch (trueFormat) {
    case 'svg':     svgCount++;     break;
    case 'png':     pngCount++;     break;
    case 'jpg':     jpgCount++;     break;
    case 'gif':     gifCount++;     break;
    case 'webp':    webpCount++;    break;
    default:        unknownCount++; break;
  }

  trueFormats[id] = trueFormat;

  if (!match || trueFormat === 'unknown') {
    console.log(
      file.padEnd(50),
      trueFormat.padEnd(8),
      ext.padEnd(8),
      match ? '✅' : '❌  MISMATCH'
    );
  }
}

console.log('─'.repeat(75));
console.log(`\nSummary:`);
console.log(`  SVG:     ${svgCount}`);
console.log(`  PNG:     ${pngCount}`);
console.log(`  JPG:     ${jpgCount}`);
console.log(`  GIF:     ${gifCount}`);
console.log(`  WebP:    ${webpCount}`);
console.log(`  Unknown: ${unknownCount}`);
console.log(`  Total:   ${files.length}`);
console.log(`\n  Mismatches (ext ≠ true format): ${mismatchCount}`);

if (mismatchCount === 0 && unknownCount === 0) {
  console.log('\n✅  All extensions match true formats — no manifest changes needed.');
  process.exit(0);
}

// ── patch logos.json ──────────────────────────────────────────────────────────

console.log('\n── Patching logos.json ────────────────────────────────────────');

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
const GITHUB_OWNER = process.env.GITHUB_OWNER || 'maryam-ay';
const GITHUB_REPO  = process.env.GITHUB_REPO  || 'nigerian-brands-logos-plugin';
const RAW_BASE = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/main/public/assets/logos`;

let patched = 0;

manifest.logos = manifest.logos.map(logo => {
  const trueFormat = trueFormats[logo.id];
  if (!trueFormat) return logo; // file not on disk — leave untouched

  let quality;
  if (trueFormat === 'svg') {
    quality = 'svg';
  } else if (trueFormat === 'png') {
    // preserve png-hq if already marked so; default to png-lq
    quality = (logo.quality === 'png-hq') ? 'png-hq' : 'png-lq';
  } else {
    // jpg, gif, webp, unknown → lq
    quality = `${trueFormat}-lq`;
  }

  const svgUrl = trueFormat === 'svg' ? `${RAW_BASE}/${logo.id}.svg` : null;
  const pngUrl = trueFormat !== 'svg' ? `${RAW_BASE}/${logo.id}.${trueFormat === 'unknown' ? 'svg' : trueFormat}` : null;

  const changed = logo.quality !== quality || logo.svgUrl !== svgUrl || logo.pngUrl !== pngUrl;
  if (changed) {
    patched++;
    console.log(`  ${logo.id}: quality ${logo.quality} → ${quality}`);
  }

  return { ...logo, quality, svgUrl, pngUrl, updatedAt: changed ? new Date().toISOString() : logo.updatedAt };
});

manifest.totalLogos  = manifest.logos.length;
manifest.lastUpdated = new Date().toISOString();

fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
console.log(`\n✅  Patched ${patched} entries — logos.json saved.`);
