// detect-format.js
// Two-pass format scanner for public/assets/logos/:
//   Pass 1 — magic bytes (PNG/JPG/GIF/WebP vs text)
//   Pass 2 — SVG content analysis (genuine vector vs raster-wrapped-in-SVG)
// Updates logos.json quality fields to reflect true format.
// Run with: node data-scripts/detect-format.js

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const fs   = require('fs');
const path = require('path');

const LOGOS_DIR     = path.join(__dirname, '../public/assets/logos');
const MANIFEST_PATH = path.join(__dirname, '../public/logos.json');
const GITHUB_OWNER  = process.env.GITHUB_OWNER || 'maryam-ay';
const GITHUB_REPO   = process.env.GITHUB_REPO  || 'nigerian-brands-logos-plugin';
const RAW_BASE      = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/main/public/assets/logos`;

// ── Pass 1: magic bytes ───────────────────────────────────────────────────────

function readMagicBytes(filePath) {
  const buf = Buffer.alloc(16);
  const fd  = fs.openSync(filePath, 'r');
  const n   = fs.readSync(fd, buf, 0, 16, 0);
  fs.closeSync(fd);
  return buf.slice(0, n);
}

function detectMagic(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'png';
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF)                     return 'jpg';
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'gif';
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'webp';
  // Starts with text — could be SVG or XML
  const head = buf.toString('utf8').trimStart();
  if (head.startsWith('<')) return 'text-xml';
  return 'unknown';
}

// ── Pass 2: SVG content analysis ─────────────────────────────────────────────

// Patterns that indicate a raster image is embedded or referenced
const RE_EMBEDDED_PNG  = /data:image\/png;base64/i;
const RE_EMBEDDED_JPG  = /data:image\/jpe?g;base64/i;
const RE_EXTERNAL_RASTER = /<image[^>]+(href|xlink:href)\s*=\s*["'][^"']*\.(png|jpe?g|gif|webp)["']/i;

function classifySvgContent(content) {
  if (RE_EMBEDDED_PNG.test(content))     return 'fake-svg:embedded-png';
  if (RE_EMBEDDED_JPG.test(content))     return 'fake-svg:embedded-jpg';
  if (RE_EXTERNAL_RASTER.test(content))  return 'fake-svg:external-raster';
  return 'svg';
}

// ── Scan all files ────────────────────────────────────────────────────────────

const files = fs.readdirSync(LOGOS_DIR).sort().filter(f => {
  return fs.statSync(path.join(LOGOS_DIR, f)).isFile();
});

const results = []; // { file, id, ext, magic, svgClass, finalFormat }

for (const file of files) {
  const filePath = path.join(LOGOS_DIR, file);
  const ext      = path.extname(file).toLowerCase().slice(1);
  const id       = path.basename(file, path.extname(file));
  const magic    = detectMagic(readMagicBytes(filePath));

  let svgClass   = null;
  let finalFormat;

  if (magic === 'text-xml' || magic === 'unknown') {
    // Read text and do SVG content analysis
    const content = fs.readFileSync(filePath, 'utf8');
    svgClass      = classifySvgContent(content);
    finalFormat   = svgClass === 'svg' ? 'svg' : 'png'; // all raster-wraps → png quality
  } else {
    finalFormat = magic; // png / jpg / gif / webp
  }

  results.push({ file, id, ext, magic, svgClass, finalFormat });
}

// ── Report ────────────────────────────────────────────────────────────────────

const genuineSvg      = results.filter(r => r.finalFormat === 'svg');
const fakeSvgEmbPng   = results.filter(r => r.svgClass === 'fake-svg:embedded-png');
const fakeSvgEmbJpg   = results.filter(r => r.svgClass === 'fake-svg:embedded-jpg');
const fakeSvgExtRas   = results.filter(r => r.svgClass === 'fake-svg:external-raster');
const rasterMagic     = results.filter(r => ['png','jpg','gif','webp'].includes(r.magic));
const unknown         = results.filter(r => r.finalFormat !== 'svg' && !['png','jpg','gif','webp'].includes(r.magic) && r.svgClass && r.svgClass !== 'svg');

const fakeSvgs = [...fakeSvgEmbPng, ...fakeSvgEmbJpg, ...fakeSvgExtRas];
const nonSvg   = [...rasterMagic, ...fakeSvgs];

console.log('\n══════════════════════════════════════════════════════');
console.log(' SVG Content + Magic-Byte Format Scan');
console.log('══════════════════════════════════════════════════════');
console.log(`\n  Total files scanned : ${results.length}`);
console.log(`  Genuine vector SVGs : ${genuineSvg.length}`);
console.log(`  Fake SVGs (embedded PNG)     : ${fakeSvgEmbPng.length}`);
console.log(`  Fake SVGs (embedded JPG)     : ${fakeSvgEmbJpg.length}`);
console.log(`  Fake SVGs (external raster)  : ${fakeSvgExtRas.length}`);
console.log(`  Non-SVG magic bytes (disguised) : ${rasterMagic.length}`);

if (nonSvg.length === 0) {
  console.log('\n✅  No fake or disguised SVGs found. logos.json is already accurate.');
  process.exit(0);
}

// List every problematic file
console.log('\n── Fake / disguised SVGs ──────────────────────────────');
for (const r of fakeSvgEmbPng)  console.log(`  [embedded PNG ] ${r.file}`);
for (const r of fakeSvgEmbJpg)  console.log(`  [embedded JPG ] ${r.file}`);
for (const r of fakeSvgExtRas)  console.log(`  [external raster] ${r.file}`);
for (const r of rasterMagic)    console.log(`  [${r.magic} magic  ] ${r.file}  (ext: .${r.ext})`);

// ── Patch logos.json ──────────────────────────────────────────────────────────

console.log('\n── Patching logos.json ────────────────────────────────');

const formatById = {};
for (const r of results) formatById[r.id] = r.finalFormat;

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
let patched = 0;

manifest.logos = manifest.logos.map(logo => {
  const trueFormat = formatById[logo.id];
  if (trueFormat === undefined) return logo; // file not on disk

  let quality;
  if (trueFormat === 'svg') {
    quality = 'svg';
  } else {
    // Preserve png-hq only if previously marked so AND it's a real raster magic-byte file
    // For fake SVGs wrapping raster data: always downgrade to lq
    const isFake = fakeSvgs.some(r => r.id === logo.id);
    quality = (!isFake && logo.quality === 'png-hq') ? 'png-hq' : 'png-lq';
  }

  const svgUrl = trueFormat === 'svg' ? `${RAW_BASE}/${logo.id}.svg` : null;
  const pngUrl = trueFormat !== 'svg' ? `${RAW_BASE}/${logo.id}.${trueFormat === 'jpg' ? 'jpg' : trueFormat === 'svg' ? 'svg' : 'png'}` : null;

  const changed = logo.quality !== quality || logo.svgUrl !== svgUrl || logo.pngUrl !== pngUrl;
  if (changed) {
    patched++;
    const reason = fakeSvgs.find(r => r.id === logo.id)
      ? `(fake SVG: ${fakeSvgs.find(r => r.id === logo.id).svgClass})`
      : `(magic bytes: ${formatById[logo.id]})`;
    console.log(`  ${logo.id}: ${logo.quality} → ${quality}  ${reason}`);
  }

  return {
    ...logo,
    quality,
    svgUrl,
    pngUrl,
    updatedAt: changed ? new Date().toISOString() : logo.updatedAt,
  };
});

manifest.totalLogos  = manifest.logos.length;
manifest.lastUpdated = new Date().toISOString();
fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));

console.log(`\n✅  Patched ${patched} entr${patched === 1 ? 'y' : 'ies'} — logos.json saved.`);
console.log('   Run: git add public/logos.json && git commit && git push');
