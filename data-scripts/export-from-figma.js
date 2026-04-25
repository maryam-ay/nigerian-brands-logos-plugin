// export-from-figma.js
// One-time script: pulls all components from the Nigerian Brands Figma community file
// and saves them as SVG/PNG files + generates the logos.json manifest.
//
// Run with: npm run export-logos

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const FIGMA_TOKEN = process.env.FIGMA_TOKEN;
const FILE_KEY = process.env.FIGMA_FILE_KEY || '1423382612609415986';
const OUT_DIR = path.join(__dirname, '../public/assets/logos');
const MANIFEST_PATH = path.join(__dirname, '../public/logos.json');

if (!FIGMA_TOKEN) {
  console.error('❌  FIGMA_TOKEN not set in .env');
  process.exit(1);
}

const headers = { 'X-Figma-Token': FIGMA_TOKEN };

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function detectCategory(name) {
  const n = name.toLowerCase();
  if (/bank|finance|fintech|pay|money|zenith|gtb|uba|access|fidelity|stanbic|union|heritage|keystone|polaris|sterling|wema|jaiz/.test(n)) return 'Banking';
  if (/mtn|airtel|glo|9mobile|etisalat|ntel|spectranet|smile|swift|telecom|mobile|network/.test(n)) return 'Telecom';
  if (/nestle|unilever|dangote|flour|breweries|cadbury|pz|reckitt|friesland|chi|indomie|honeywell/.test(n)) return 'FMCG';
  if (/tv|radio|media|channels|arise|silverbird|dstv|gotv|startimes|premium|punch|guardian|vanguard/.test(n)) return 'Media';
  if (/nnpc|oando|seplat|total|shell|chevron|mobil|petrol|energy|gas|power|electricity|eko|ikeja/.test(n)) return 'Energy';
  if (/tech|software|jumia|konga|paystack|flutterwave|interswitch|opay|palmpay|moniepoint|cowry|carbon/.test(n)) return 'Tech';
  if (/insurance|aiico|leadway|custodian|axamansard|nicon|sovereign|prestige|mutual/.test(n)) return 'Insurance';
  if (/airline|aviation|transport|bus|uber|bolt|gokada|okada|rail|shipping|agility|dangote/.test(n)) return 'Transport';
  if (/shoprite|spar|justrite|ebeano|supermarket|store|market|retail/.test(n)) return 'Retail';
  return 'Other';
}

function extractTags(name, category) {
  const tags = [category.toLowerCase()];
  const n = name.toLowerCase();
  if (n.includes('nigeria')) tags.push('nigeria');
  if (n.includes('bank') || n.includes('financial')) tags.push('finance');
  if (n.includes('group')) tags.push('conglomerate');
  return [...new Set(tags)];
}

async function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchWithRetry(url, options, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, options);
      if (res.ok) return res;
      if (res.status === 429) {
        console.log('  Rate limited, waiting 10s…');
        await delay(10000);
        continue;
      }
      throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      if (i === retries - 1) throw err;
      await delay(2000 * (i + 1));
    }
  }
}

async function exportSvg(fileKey, nodeId) {
  const url = `https://api.figma.com/v1/images/${fileKey}?ids=${encodeURIComponent(nodeId)}&format=svg&svg_include_id=false`;
  const res = await fetchWithRetry(url, { headers });
  const data = await res.json();
  if (data.err) throw new Error(data.err);
  const imageUrl = data.images && data.images[nodeId];
  if (!imageUrl) throw new Error('No image URL returned');
  const svgRes = await fetchWithRetry(imageUrl, {});
  return svgRes.text();
}

async function exportPng(fileKey, nodeId, scale = 2) {
  const url = `https://api.figma.com/v1/images/${fileKey}?ids=${encodeURIComponent(nodeId)}&format=png&scale=${scale}`;
  const res = await fetchWithRetry(url, { headers });
  const data = await res.json();
  if (data.err) throw new Error(data.err);
  const imageUrl = data.images && data.images[nodeId];
  if (!imageUrl) throw new Error('No image URL returned');
  const pngRes = await fetchWithRetry(imageUrl, {});
  const buf = await pngRes.buffer();
  return buf;
}

async function main() {
  console.log('🚀 Starting Figma logo export…');
  console.log(`   File: ${FILE_KEY}\n`);

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  // Fetch all components from the file
  console.log('📦 Fetching component list from Figma…');
  const compRes = await fetchWithRetry(
    `https://api.figma.com/v1/files/${FILE_KEY}/components`,
    { headers }
  );
  const compData = await compRes.json();

  if (!compData.meta || !compData.meta.components) {
    console.error('❌  No components found. Check your FIGMA_TOKEN and FILE_KEY.');
    process.exit(1);
  }

  const components = compData.meta.components;
  console.log(`   Found ${components.length} components\n`);

  const logos = [];
  let svgCount = 0;
  let lqCount = 0;
  let failCount = 0;

  for (let i = 0; i < components.length; i++) {
    const comp = components[i];
    const name = comp.name;
    const nodeId = comp.node_id;
    const id = slugify(name);
    const category = detectCategory(name);
    const tags = extractTags(name, category);

    process.stdout.write(`[${i + 1}/${components.length}] ${name}… `);

    try {
      // Try SVG first
      let svgText;
      try {
        svgText = await exportSvg(FILE_KEY, nodeId);
      } catch (svgErr) {
        svgText = null;
      }

      const now = new Date().toISOString();

      if (svgText && svgText.trim().startsWith('<')) {
        // Sanitize and save SVG
        const cleaned = svgText
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/\s+on\w+="[^"]*"/gi, '')
          .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '');
        fs.writeFileSync(path.join(OUT_DIR, `${id}.svg`), cleaned);
        const rawBase = `https://raw.githubusercontent.com/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/main/public/assets/logos`;
        logos.push({
          id, name, brand: name.split(' ')[0], category, tags,
          svgUrl: `${rawBase}/${id}.svg`,
          pngUrl: null,
          quality: 'svg',
          figmaNodeId: nodeId,
          figmaComponentKey: comp.key,
          addedAt: now, updatedAt: now,
          contributedBy: { handle: 'community', source: 'admin' }
        });
        svgCount++;
        console.log('✅ SVG');
      } else {
        // Fall back to PNG
        const pngBuf = await exportPng(FILE_KEY, nodeId, 2);
        fs.writeFileSync(path.join(OUT_DIR, `${id}.png`), pngBuf);
        const rawBase = `https://raw.githubusercontent.com/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/main/public/assets/logos`;
        logos.push({
          id, name, brand: name.split(' ')[0], category, tags,
          svgUrl: null,
          pngUrl: `${rawBase}/${id}.png`,
          quality: 'png-lq',
          figmaNodeId: nodeId,
          figmaComponentKey: comp.key,
          addedAt: now, updatedAt: now,
          contributedBy: { handle: 'community', source: 'admin' }
        });
        lqCount++;
        console.log('⚠️  PNG (low quality)');
      }
    } catch (err) {
      failCount++;
      console.log(`❌  Failed: ${err.message}`);
    }

    // Respectful rate limiting
    await delay(300);
  }

  // Write manifest
  const manifest = {
    version: '1.0.0',
    lastUpdated: new Date().toISOString(),
    totalLogos: logos.length,
    logos
  };
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));

  console.log('\n──────────────────────────────');
  console.log(`✅  Exported ${svgCount} SVG logos`);
  console.log(`⚠️   ${lqCount} logos are low-quality PNG — marked for replacement`);
  if (failCount > 0) console.log(`❌  ${failCount} logos failed to export`);
  console.log(`📄  Manifest saved to public/logos.json`);
  console.log('\nNext step: git add . && git commit -m "feat: add logos" && git push');
}

main().catch(err => {
  console.error('\n❌  Fatal error:', err.message);
  process.exit(1);
});
