# 🇳🇬 Nigerian Brands Logos — Figma Plugin

A public Figma plugin that lets any designer search and insert Nigerian brand logos directly onto their canvas. SVG logos render crisply at any size.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Figma Plugin (ui.html + code.ts)                           │
│  ┌─────────────────────────┐   ┌──────────────────────────┐ │
│  │  Browse & Insert logos  │   │  Admin Mode (password)   │ │
│  │  Search / filter        │   │  Add / Replace / Delete  │ │
│  │  Suggest & Request      │   │  GitHub sync             │ │
│  └─────────────────────────┘   └──────────────────────────┘ │
└────────────────────────┬────────────────────────────────────┘
                         │ fetch
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  GitHub Repository (free static backend)                    │
│  public/logos.json          ← manifest (single source of   │
│  public/assets/logos/*.svg       truth, fetched on open)   │
│  public/assets/logos/*.png                                  │
└─────────────────────────────────────────────────────────────┘
```

---

## For Users — How to Install

1. Open Figma Desktop or Figma in your browser
2. Go to the **Community** tab and search "Nigerian Brands Logos"
3. Click **Install**
4. In any file, go to **Plugins → Nigerian Brands Logos** to open it
5. Search for a brand, then click **Insert** to add it to your canvas

---

## For the Owner — Initial Setup

### Prerequisites
- Node.js v18+ installed
- Figma Desktop app installed
- A GitHub account

### Step 1 — Clone & Install
```bash
git clone https://github.com/YOUR_USERNAME/nigerian-brands-logos-plugin.git
cd nigerian-brands-logos-plugin
npm install
```

### Step 2 — Configure Environment
```bash
cp data-scripts/.env.example data-scripts/.env
```
Edit `.env` and fill in:
- `FIGMA_TOKEN` — from Figma → Account Settings → Personal access tokens
- `GITHUB_TOKEN` — from GitHub → Settings → Developer settings → Personal access tokens (repo scope)
- `GITHUB_OWNER` — your GitHub username
- `GITHUB_REPO` — this repository's name

### Step 3 — Export Logos from Figma
This is a one-time step that downloads all logos from the Figma community file.
```bash
npm run export-logos
```
This saves SVG/PNG files to `public/assets/logos/` and creates `public/logos.json`.

### Step 4 — Update the Plugin Config
Open `plugin/ui.html` and update the `CONFIG` block at the bottom:
```javascript
const CONFIG = {
  MANIFEST_URL: 'https://raw.githubusercontent.com/YOUR_USERNAME/nigerian-brands-logos-plugin/main/public/logos.json',
  GITHUB_REPO_OWNER: 'YOUR_USERNAME',
  GITHUB_REPO_NAME: 'nigerian-brands-logos-plugin',
  SUGGESTIONS_TOKEN: 'YOUR_SUGGESTIONS_TOKEN', // see below
  ...
};
```
Do the same for `admin-panel/index.html` (the `CFG` block).

### Step 5 — Push to GitHub
```bash
git add .
git commit -m "feat: initial logo library"
git push origin main
```

### Step 6 — Build the Plugin
```bash
npm run build
```
This compiles `plugin/code.ts` → `plugin/code.js`.

### Step 7 — Load in Figma Desktop
1. Open Figma Desktop
2. Go to **Plugins → Development → Import plugin from manifest**
3. Select `plugin/manifest.json`
4. The plugin now appears under **Plugins → Development → Nigerian Brands Logos**

---

## Managing Logos (Admin Mode)

### In-Plugin Admin
1. Open the plugin in Figma
2. Click the ⚙️ gear icon **5 times** (or hold for 3 seconds)
3. Enter your admin password (you'll be asked to create one on first use)
4. Connect your GitHub repo (token + owner + repo name)
5. Use the **Manage**, **Add Logo**, and **Inbox** tabs

### Standalone Admin Panel
A more powerful admin panel is available at `admin-panel/index.html`.

**Deploy to GitHub Pages:**
1. Go to your repo on GitHub
2. Settings → Pages → Source: Deploy from branch → `main` → `/admin-panel`
3. Your admin panel will be at `https://YOUR_USERNAME.github.io/nigerian-brands-logos-plugin/`

---

## Setting Up Logo Suggestions (Optional)

To enable the community Suggest/Request feature:
1. Go to GitHub → Settings → Developer settings → Fine-grained tokens
2. Create a token with **only** `issues:write` permission on this repo
3. Add it as `SUGGESTIONS_TOKEN` in `plugin/ui.html` CONFIG block
4. Also create the GitHub labels in your repo: `logo-suggestion` and `logo-request`
   - Go to Issues → Labels → New label

---

## Adding / Replacing Logos Manually

### Add a new logo
1. Save your SVG/PNG to `public/assets/logos/brand-name.svg`
2. Run `npm run build-manifest` to regenerate `logos.json`
3. Commit and push

### Rebuild the manifest after manual changes
```bash
npm run build-manifest
git add public/
git commit -m "chore: update logos"
git push
```

---

## Contributing

Community members can improve the logo library by:

1. **Submitting a logo** — use the "Suggest / Request" tab in the plugin
2. **Requesting a logo** — use the same tab; others can upvote requests
3. **Pull request** — fork the repo, add SVG to `public/assets/logos/`, run `npm run build-manifest`, and open a PR

Logo file requirements:
- SVG preferred (vector, crisp at any size)
- PNG accepted (minimum 512×512px recommended)
- File size max 500KB
- No watermarks or copyright restrictions

---

## Project Structure

```
nigerian-brands-logos-plugin/
├── plugin/
│   ├── manifest.json     Figma plugin config
│   ├── code.ts           Plugin logic (runs in Figma's main thread)
│   ├── code.js           Compiled output (generated by npm run build)
│   ├── ui.html           Plugin UI (single-file, no framework)
│   ├── types.ts          Shared TypeScript types
│   └── tsconfig.json
├── data-scripts/
│   ├── export-from-figma.js   One-time: pulls logos from Figma API
│   ├── build-manifest.js      Rebuilds logos.json from assets folder
│   └── .env.example
├── public/
│   ├── logos.json             The manifest (fetched by the plugin)
│   └── assets/
│       └── logos/             All SVG and PNG logo files
├── admin-panel/
│   └── index.html             Standalone admin web app
├── package.json
└── README.md
```

---

## Scripts Reference

| Command | What it does |
|---|---|
| `npm install` | Install dependencies |
| `npm run build` | Compile TypeScript |
| `npm run watch` | Auto-compile on save |
| `npm run export-logos` | Export logos from Figma community file |
| `npm run build-manifest` | Regenerate logos.json from assets folder |
