// export-from-figma.js
// Exports all logo components from the Nigerian Brands Figma file.
// Processes in batches of 5, waits 3s between batches, skips files
// already on disk, and saves progress so it can resume if interrupted.
// Run with: npm run export-logos

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const FIGMA_TOKEN  = process.env.FIGMA_TOKEN;
const FILE_KEY     = process.env.FIGMA_FILE_KEY || 'Scp7i5b52gFyFOyyY4HXwT';
const GITHUB_OWNER = process.env.GITHUB_OWNER  || 'maryam-ay';
const GITHUB_REPO  = process.env.GITHUB_REPO   || 'nigerian-brands-logos-plugin';

const OUT_DIR       = path.join(__dirname, '../public/assets/logos');
const MANIFEST_PATH = path.join(__dirname, '../public/logos.json');
const PROGRESS_PATH = path.join(__dirname, '../public/assets/export-progress.json');
const RAW_BASE      = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/main/public/assets/logos`;

const BATCH_SIZE   = 20;
const BATCH_DELAY  = 2000;  // ms between batches
const CALL_DELAY   = 500;   // ms between individual API calls
const RATE_WAIT    = 30000; // ms to wait on 429

if (!FIGMA_TOKEN) { console.error('❌  FIGMA_TOKEN not set in .env'); process.exit(1); }

const figmaHeaders = { 'X-Figma-Token': FIGMA_TOKEN };

// ── helpers ──────────────────────────────────────────────────────────────────

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'logo';
}

function detectCategory(name) {
  const n = name.toLowerCase();
  if (/bank|zenith|gtb|uba|access|fidelity|stanbic|union|heritage|keystone|polaris|sterling|wema|jaiz|fcmb|ecobank/.test(n)) return 'Banking';
  if (/mtn|airtel|glo|9mobile|etisalat|ntel|spectranet|smile|swift/.test(n)) return 'Telecom';
  if (/nestle|unilever|dangote|flour|breweries|cadbury|pz|reckitt|friesland|chi|indomie|honeywell|nasco/.test(n)) return 'FMCG';
  if (/tv|radio|channels|arise|silverbird|dstv|gotv|startimes|punch|guardian|vanguard|tvc|cool/.test(n)) return 'Media';
  if (/nnpc|oando|seplat|total|shell|chevron|mobil|petrol|energy|gas|eko|ikeja|power/.test(n)) return 'Energy';
  if (/tech|jumia|konga|paystack|flutterwave|interswitch|opay|palmpay|moniepoint|cowry|carbon|kuda|piggyvest/.test(n)) return 'Tech';
  if (/insurance|aiico|leadway|custodian|axamansard|nicon|sovereign|mutual|prestige/.test(n)) return 'Insurance';
  if (/airline|aviation|arik|dana|transport|bus|gokada|rail|bolt|uber/.test(n)) return 'Transport';
  if (/shoprite|spar|justrite|ebeano|supermarket|store|market/.test(n)) return 'Retail';
  return 'Other';
}

function extractTags(name, category) {
  const tags = [category.toLowerCase(), 'nigeria', 'nigerian'];
  const n = name.toLowerCase();
  if (n.includes('group') || n.includes('holdings')) tags.push('conglomerate');
  if (n.includes('bank') || n.includes('finance')) tags.push('finance');
  if (n.includes('tech') || n.includes('digital')) tags.push('digital');
  return [...new Set(tags)];
}

function collectNodes(node, results = [], depth = 0) {
  if (!node) return results;
  if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') {
    results.push({ id: node.id, name: node.name, type: node.type });
  } else if (depth <= 3 && node.type === 'FRAME' && node.name &&
             !node.name.startsWith('_') && !node.name.startsWith('.')) {
    results.push({ id: node.id, name: node.name, type: node.type });
  }
  if (node.children && depth < 6) {
    for (const child of node.children) collectNodes(child, results, depth + 1);
  }
  return results;
}

// ── progress persistence ──────────────────────────────────────────────────────

function loadProgress() {
  if (fs.existsSync(PROGRESS_PATH)) {
    try { return JSON.parse(fs.readFileSync(PROGRESS_PATH, 'utf8')); } catch {}
  }
  return { processedIds: [], logos: [] };
}

function saveProgress(progress) {
  fs.writeFileSync(PROGRESS_PATH, JSON.stringify(progress, null, 2));
}

// ── network helpers ───────────────────────────────────────────────────────────

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchWithRetry(url, options, retries = 12) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, options);
      if (res.status === 429) {
        console.log(`\n  ⏳ Rate limited (attempt ${i + 1}/${retries}) — waiting ${RATE_WAIT / 1000}s…`);
        await delay(RATE_WAIT);
        continue;
      }
      return res;
    } catch (err) {
      if (i === retries - 1) throw err;
      await delay(5000 * (i + 1));
    }
  }
  throw new Error('Max retries exceeded');
}

async function batchGetSvgUrls(nodeIds) {
  await delay(CALL_DELAY);
  const url = `https://api.figma.com/v1/images/${FILE_KEY}?ids=${nodeIds.map(encodeURIComponent).join(',')}&format=svg&svg_include_id=false`;
  const res = await fetchWithRetry(url, { headers: figmaHeaders });
  const data = await res.json();
  return data.images || {};
}

async function batchGetPngUrls(nodeIds, scale = 2) {
  await delay(CALL_DELAY);
  const url = `https://api.figma.com/v1/images/${FILE_KEY}?ids=${nodeIds.map(encodeURIComponent).join(',')}&format=png&scale=${scale}`;
  const res = await fetchWithRetry(url, { headers: figmaHeaders });
  const data = await res.json();
  return data.images || {};
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🚀  Starting Figma logo export  (batch=20, 500ms/call, 2s between batches, resumable)');
  console.log(`    File: ${FILE_KEY}\n`);

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  // Load saved progress
  const progress = loadProgress();
  const doneIds  = new Set(progress.processedIds);
  console.log(`📂  Progress file: ${doneIds.size} node IDs already processed`);

  // Fetch Figma document tree
  console.log('📄  Fetching Figma document tree…');
  const fileRes = await fetchWithRetry(
    `https://api.figma.com/v1/files/${FILE_KEY}?depth=5`,
    { headers: figmaHeaders }
  );
  if (!fileRes.ok) { console.error(`❌  Cannot read file: HTTP ${fileRes.status}`); process.exit(1); }
  const fileData = await fileRes.json();

  const allNodes = [];
  if (fileData.document) collectNodes(fileData.document, allNodes);

  // Deduplicate by slug
  const seen  = new Set();
  const nodes = allNodes.filter(n => {
    const key = slugify(n.name);
    if (seen.has(key) || !n.name || n.name.length < 2) return false;
    seen.add(key);
    return true;
  });
  console.log(`    Found ${nodes.length} total logo nodes in Figma\n`);

  // Filter: skip if already in progress OR if the output file exists on disk
  const remaining = nodes.filter(n => {
    if (doneIds.has(n.id)) return false;
    const slug = slugify(n.name);
    if (fs.existsSync(path.join(OUT_DIR, `${slug}.svg`))) return false;
    if (fs.existsSync(path.join(OUT_DIR, `${slug}.png`))) return false;
    return true;
  });

  const skipped = nodes.length - remaining.length;
  console.log(`    ${skipped} already done (skipping)  |  ${remaining.length} remaining\n`);

  if (remaining.length === 0) {
    console.log('✅  Nothing left to export — all logos already on disk.');
  } else {
    let svgCount = 0, lqCount = 0, failCount = 0;
    const totalBatches = Math.ceil(remaining.length / BATCH_SIZE);

    for (let i = 0; i < remaining.length; i += BATCH_SIZE) {
      const batch    = remaining.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      console.log(`\n📦  Batch ${batchNum}/${totalBatches}  (logos ${i + 1}–${Math.min(i + BATCH_SIZE, remaining.length)} of ${remaining.length})`);
      if (i > 0 && i % 10 === 0) {
        console.log(`📊  Progress: ${i}/${remaining.length} processed — ${svgCount} SVG, ${lqCount} PNG, ${failCount} failed`);
      }

      // Step 1: get SVG export URLs for this batch (1 API call)
      let svgUrls = {};
      try {
        svgUrls = await batchGetSvgUrls(batch.map(n => n.id));
      } catch (err) {
        console.log(`    ⚠️  Could not get SVG URLs for batch: ${err.message}`);
      }

      // Step 2: download SVGs (CDN calls — not rate-limited by Figma)
      const needPng = []; // nodes whose SVG failed; we'll batch-fetch their PNGs
      const partialResults = {};

      for (const node of batch) {
        const slug   = slugify(node.name);
        const svgUrl = svgUrls[node.id];
        process.stdout.write(`    ${node.name}… `);

        if (svgUrl) {
          try {
            const svgRes  = await fetchWithRetry(svgUrl, {});
            const svgText = await svgRes.text();
            if (svgText && svgText.trim().startsWith('<')) {
              const cleaned = svgText
                .replace(/<script[\s\S]*?<\/script>/gi, '')
                .replace(/\s+on\w+="[^"]*"/gi, '')
                .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '');
              fs.writeFileSync(path.join(OUT_DIR, `${slug}.svg`), cleaned);
              partialResults[node.id] = 'svg';
              svgCount++;
              console.log('✅ SVG');
            } else {
              needPng.push(node);
              process.stdout.write('(SVG empty, trying PNG)\n');
            }
          } catch (_) {
            needPng.push(node);
            process.stdout.write('(SVG failed, trying PNG)\n');
          }
        } else {
          needPng.push(node);
          process.stdout.write('(no SVG URL, trying PNG)\n');
        }
      }

      // Step 3: batch-fetch PNG URLs for all nodes that need it (1 API call max)
      if (needPng.length > 0) {
        let pngUrls = {};
        try {
          pngUrls = await batchGetPngUrls(needPng.map(n => n.id));
        } catch (err) {
          console.log(`    ⚠️  Could not get PNG URLs: ${err.message}`);
        }

        for (const node of needPng) {
          const slug   = slugify(node.name);
          const pngUrl = pngUrls[node.id];
          process.stdout.write(`    ${node.name} (PNG)… `);

          if (pngUrl) {
            try {
              const pngRes = await fetchWithRetry(pngUrl, {});
              const pngBuf = await pngRes.buffer();
              fs.writeFileSync(path.join(OUT_DIR, `${slug}.png`), pngBuf);
              partialResults[node.id] = 'png';
              lqCount++;
              console.log('⚠️  PNG saved');
            } catch (err) {
              partialResults[node.id] = 'fail';
              failCount++;
              console.log(`❌  Failed: ${err.message}`);
            }
          } else {
            partialResults[node.id] = 'fail';
            failCount++;
            console.log('❌  No PNG URL returned');
          }
        }
      }

      // Step 4: record all results in progress
      const now = new Date().toISOString();
      for (const node of batch) {
        const slug     = slugify(node.name);
        const category = detectCategory(node.name);
        const tags     = extractTags(node.name, category);
        const result   = partialResults[node.id];

        if (result === 'svg') {
          progress.logos.push({
            id: slug, name: node.name, brand: node.name.split(' ')[0],
            category, tags,
            svgUrl: `${RAW_BASE}/${slug}.svg`, pngUrl: null, quality: 'svg',
            figmaNodeId: node.id, figmaComponentKey: node.id,
            addedAt: now, updatedAt: now,
            contributedBy: { handle: 'community', source: 'admin' }
          });
        } else if (result === 'png') {
          progress.logos.push({
            id: slug, name: node.name, brand: node.name.split(' ')[0],
            category, tags,
            svgUrl: null, pngUrl: `${RAW_BASE}/${slug}.png`, quality: 'png-lq',
            figmaNodeId: node.id, figmaComponentKey: node.id,
            addedAt: now, updatedAt: now,
            contributedBy: { handle: 'community', source: 'admin' }
          });
        }
        // Always mark processed so we don't re-attempt broken nodes
        progress.processedIds.push(node.id);
      }

      // Save progress after every batch
      saveProgress(progress);
      console.log(`    💾  Progress saved (${progress.processedIds.length} total processed)`);

      // Pause before next batch (skip after the last one)
      if (i + BATCH_SIZE < remaining.length) {
        process.stdout.write(`    ⏳  Waiting ${BATCH_DELAY / 1000}s…`);
        await delay(BATCH_DELAY);
        console.log(' done');
      }
    }

    console.log('\n──────────────────────────────────────');
    console.log(`✅  Exported this run: ${svgCount} SVG, ${lqCount} PNG, ${failCount} failed`);
  }

  // ── Write final manifest ──
  // Load existing logos.json so we keep previously exported entries (the 300 on disk)
  let existingLogos = {};
  if (fs.existsSync(MANIFEST_PATH)) {
    try {
      const prev = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
      (prev.logos || []).forEach(l => { existingLogos[l.id] = l; });
    } catch {}
  }
  // Merge: progress logos override existing ones with the same id
  progress.logos.forEach(l => { existingLogos[l.id] = l; });

  const allLogos = Object.values(existingLogos).sort((a, b) => a.name.localeCompare(b.name));
  const manifest = {
    version: '1.0.0',
    lastUpdated: new Date().toISOString(),
    totalLogos: allLogos.length,
    logos: allLogos
  };
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  console.log(`\n📄  Manifest saved → public/logos.json  (${allLogos.length} total logos)`);
  console.log('\n🚀  Next: push to GitHub');
  console.log('    git add public/ && git commit -m "feat: add logos" && git push');
}

main().catch(err => {
  console.error('\n❌  Fatal error:', err.message);
  process.exit(1);
});
