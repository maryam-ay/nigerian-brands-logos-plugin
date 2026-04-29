// build-manifest.js
// Scans public/assets/logos/ and regenerates public/logos.json
// Run with: npm run build-manifest

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const fs = require('fs');
const path = require('path');

const LOGOS_DIR = path.join(__dirname, '../public/assets/logos');
const MANIFEST_PATH = path.join(__dirname, '../public/logos.json');
const GITHUB_OWNER = process.env.GITHUB_OWNER || 'maryam-ay';
const GITHUB_REPO = process.env.GITHUB_REPO || 'nigerian-brands-logos-plugin';
const RAW_BASE = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/main/public/assets/logos`;

function slugToName(slug) {
  return slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function detectCategory(name) {
  const n = name.toLowerCase();
  if (/bank|finance|fintech|zenith|gtb|uba|access|fidelity|stanbic|union|heritage|keystone|polaris|sterling|wema|jaiz/.test(n)) return 'Banking';
  if (/mtn|airtel|glo|9mobile|etisalat|ntel|spectranet|smile|swift|telecom/.test(n)) return 'Telecom';
  if (/nestle|unilever|dangote|flour|breweries|cadbury|pz|reckitt|friesland|chi|indomie|honeywell/.test(n)) return 'FMCG';
  if (/tv|radio|media|channels|arise|silverbird|dstv|gotv|startimes|punch|guardian|vanguard/.test(n)) return 'Media';
  if (/nnpc|oando|seplat|total|shell|chevron|mobil|petrol|energy|gas|power|electricity/.test(n)) return 'Energy';
  if (/tech|software|jumia|konga|paystack|flutterwave|interswitch|opay|palmpay|moniepoint|cowry|carbon/.test(n)) return 'Tech';
  if (/insurance|aiico|leadway|custodian|axamansard|nicon|sovereign/.test(n)) return 'Insurance';
  if (/airline|aviation|transport|bus|rail|shipping/.test(n)) return 'Transport';
  if (/shoprite|spar|justrite|ebeano|supermarket|store|market|retail/.test(n)) return 'Retail';
  return 'Other';
}

function main() {
  if (!fs.existsSync(LOGOS_DIR)) {
    console.error('❌  public/assets/logos/ directory not found. Run npm run export-logos first.');
    process.exit(1);
  }

  // Load existing manifest to preserve existing metadata
  let existingLogos = {};
  if (fs.existsSync(MANIFEST_PATH)) {
    try {
      const existing = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
      (existing.logos || []).forEach(l => { existingLogos[l.id] = l; });
      console.log(`📂  Loaded ${Object.keys(existingLogos).length} existing logos from manifest`);
    } catch { console.log('⚠️  Could not read existing manifest, starting fresh'); }
  }

  const files = fs.readdirSync(LOGOS_DIR);
  const seenIds = new Set();
  const logos = [];

  files.forEach(file => {
    const ext = path.extname(file).toLowerCase();
    if (!['.svg', '.png', '.jpg', '.jpeg', '.webp'].includes(ext)) return;

    const id = path.basename(file, ext);
    if (seenIds.has(id)) return;
    seenIds.add(id);

    const existing = existingLogos[id];
    const name = existing ? existing.name : slugToName(id);
    const category = existing ? existing.category : detectCategory(name);
    const now = new Date().toISOString();

    const isSvg = ext === '.svg';
    const filePath = path.join(LOGOS_DIR, file);
    const content = isSvg ? fs.readFileSync(filePath, 'utf8') : '';
    const hasEmbeddedImage = content.includes('<image');
    const quality = !isSvg ? 'png' : hasEmbeddedImage ? 'img' : 'svg';

    logos.push({
      id,
      name,
      brand: existing ? existing.brand : name.split(' ')[0],
      category,
      tags: existing ? existing.tags : [category.toLowerCase()],
      svgUrl: isSvg ? `${RAW_BASE}/${id}.svg` : null,
      pngUrl: !isSvg ? `${RAW_BASE}/${id}${ext}` : null,
      quality,
      figmaNodeId: existing ? existing.figmaNodeId : '0:0',
      figmaComponentKey: existing ? existing.figmaComponentKey : '',
      addedAt: existing ? existing.addedAt : now,
      updatedAt: now,
      contributedBy: existing ? existing.contributedBy : { handle: 'admin', source: 'admin' }
    });
  });

  logos.sort((a, b) => a.name.localeCompare(b.name));

  const manifest = {
    version: '1.0.0',
    lastUpdated: new Date().toISOString(),
    totalLogos: logos.length,
    logos
  };

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));

  const svgCount = logos.filter(l => l.quality === 'svg').length;
  const imgCount = logos.filter(l => l.quality === 'img').length;
  const pngCount = logos.filter(l => l.quality === 'png').length;

  console.log('\n──────────────────────────────');
  console.log(`✅  Total: ${logos.length} logos`);
  console.log(`   SVG: ${svgCount} · IMG (embedded raster): ${imgCount} · PNG: ${pngCount}`);
  console.log(`📄  Saved to public/logos.json`);
}

main();
