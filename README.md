# Inkstone — Turn Novels Into Comics

Inkstone is a full-featured, bilingual (Arabic & English) personal web application that converts large text novels into visual manga pages and vertical webtoon strips with character consistency, structured style locks, automated storyboarding, vector lettering, interactive reading, and autonomous batch generation.

---

## 🌟 Key Features

1. **Large Novel Engine (500 / 1000 / 2000+ Chapters in One File)**:
   - Ingests massive monolithic novels in a single TXT or EPUB file without crashing or exceeding AI context windows.
   - High-speed regex streaming chapter detection and indexing (<100ms for 2000 chapters).
   - Lightweight metadata indexing with on-demand lazy loading (<2ms per chapter).

2. **Default Visual Style: The Eternal Supreme (万古至尊)**:
   - Application defaults to **The Eternal Supreme** as its canonical drawing style.
   - Default Mode: **Style Only** (`style_only`).
   - Default Style Lock: **ON** (`is_style_lock_active = true`).
   - Default Character Lock: **Unset / User-configurable** (Character identity is strictly separated from drawing style; characters from The Eternal Supreme are never forced upon the user's cast).
   - Structured visual dimensions: refined xianxia linework, martial arts cinematography, floating spirit peaks, and celestial aura effects.

3. **Character Lock & Style Lock Decoupling**:
   - **Style Only**: Locks drawing style (e.g. *The Eternal Supreme*); uses novel's native character traits.
   - **Characters Only**: Locks character facial identities and outfits; uses neutral manga art style.
   - **Characters + Style**: Dual visual lock enforcing both character facial identity and series art style.
   - Mix and match freely: e.g. Draw your novel in *The Eternal Supreme* style while mapping a protagonist to *Sung Jinwoo* (from Solo Leveling) or *Guts* (from Berserk).
   - Permanent style version pinning: Old chapters retain their original style version when newer chapters switch to a new style.

4. **Story Bible & Terminology Memory**:
   - Tracks characters, aliases, locations, factions, and objects across chapters.
   - Confidence levels (`CONFIRMED_FROM_NOVEL`, `AI_INFERRED`, `USER_EDITED`).
   - Selective compact context retrieval (<5KB per chapter, <10ms lookup) to avoid flooding AI context windows.
   - Bilingual Arabic & English Terminology Glossary with duplicate entity merging.

5. **Independent Vector Lettering Engine**:
   - Lettering is stored as a vector SVG overlay completely decoupled from base artwork.
   - **Arabic**: Native Right-to-Left (RTL) reading flow, Arabic typography (Amiri / Scheherazade New), right-to-left bubble placement, Arabic SFX (طرااااخ!).
   - **English**: Left-to-Right (LTR) reading flow, comic fonts (Bangers / Comic Neue).
   - Smart Face Avoidance: Automatically excludes the central facial zone (x: 40–60%, y: 35–55%), placing dialogue in optimal quadrants.
   - Interactive Panel Editor: Drag-and-drop bubble repositioning, speech/thought/shout/whisper/narration bubble toggling, text edits, and live re-layout.

6. **Integrated Manga Reader**:
   - **Continuous Vertical Webtoon Mode**: Smooth mobile-friendly vertical scroll.
   - **Paginated Manga Page Mode**: Traditional spread with arrow key and button navigation (RTL-aware for Arabic).
   - Zoom controls: Fit Width (100%), 75%, 100%, 125%, 150%.
   - Fullscreen reading mode and chapter quick-jump library.

7. **FREE MAX TODAY Autonomous Batch Automation**:
   - Primary Batch Mode: **FREE MAX TODAY** (Autonomous Continuous Maximum without an arbitrary 10-chapter cap).
   - Additional Batch Modes: 1 Chapter, 2 Chapters, 5 Chapters, 10 Chapters, Custom Range/List (e.g. `1, 3, 5-8`).
   - Granular Disk Checkpointing: State is saved after every single generated panel to `novels/<novelId>/queue/batch_state.json`.
   - Precise One-Tap Resume: Resumes from the exact next unfinished panel after browser refresh, quota exhaustion, network drop, or server restart.
   - Safe Batch Controls: Start, Pause, Resume, Stop Safely (`stop_now`, `after_panel`, `after_page`, `after_chapter`), Retry Failed, Skip Failed.

8. **Strict Zero-Cost Policy (`ZERO_COST_ONLY=true`)**:
   - Provider Priority:
     1. `CACHE` (Aggressive reuse of completed panels, storyboards, and character profiles)
     2. `LOCAL_ZERO_COST` (Deterministic local heuristics & vector letterer)
     3. `FREE_NO_BILLING` (Free API endpoints without billing required)
     4. `FREE_TIER` (Free-tier quotas)
     5. `PAID_OPTIONAL` (Only if manually configured by user; never activates automatically)
   - When free quota is exhausted, sets system state to `WAITING_FOR_FREE_CAPACITY` and preserves all checkpoints.

9. **Backup, Restore & Export**:
   - **Full Backup**: Download complete novel state as a `.zip` archive (metadata, chapters, story bible, glossary, locks, storyboards, panels, lettering, queue).
   - **One-Click Restore**: Upload backup `.zip` to restore the complete novel workspace.
   - **Export CBZ**: Export chapter as a Comic Book Archive (`.cbz`) containing sequential page images and `ComicInfo.xml` metadata for digital comic readers.
   - **Export ZIP**: Export raw chapter panel images and vector lettering SVGs.

---

## 🚀 Quick Start

### 1. Installation

Ensure Node.js 20+ or 22 LTS is installed:

```bash
git clone https://github.com/phaethix/inkstone.git
cd inkstone
npm install
```

### 2. Environment Setup

Copy `.env.example`:

```bash
cp .env.example .env
```

Default contents of `.env.example`:
```ini
AGNES_API_KEY=
GEMINI_API_KEY=
PORT=3000
```

By default, Inkstone runs with `ZERO_COST_ONLY=true`. No API keys are required for offline/local deterministic operation, large novel indexing, storyboards, lettering, reading, queue automation, and local zero-cost rendering.

### 3. Startup

Start the development server:

```bash
npm run dev
```

Or build and run in production:

```bash
npm run build
npm start
```

Open your browser at `http://localhost:3000`.

---

## 📖 Step-by-Step User Guide

### 1. Importing a Large Novel
1. Open the web interface.
2. In the **Upload & Analyze Novel** card, enter your novel title and select novel language (Arabic or English).
3. Paste text or upload a `.txt` or `.epub` file containing up to 2000+ chapters.
4. Click **Parse Chapters**. Inkstone streams and indexes all chapters in seconds with zero AI token consumption.

### 2. Setting Drawing Style & Reference Manga
1. Navigate to the **Reference & Style Lock** tab.
2. **Default Active Style**: *The Eternal Supreme* (v1) with *Style Only* mode is active out of the box.
3. To change reference style:
   - Search for any manga, manhwa, or webtoon title (e.g. *Solo Leveling*, *Berserk*, *Tower of God*, *Demon Slayer*).
   - Click **Apply as Active Reference Series**. This increments the style version (e.g. v2) while leaving previously generated chapters pinned to v1.
4. To restore default style anytime, click **↺ Restore Default Style**.

### 3. Setting Character Locks (Optional)
1. Switch Reference Mode to **Characters + Style** or **Characters Only**.
2. Click **✨ Auto-Suggest Mappings** to map novel characters to reference archetypes, or click **+ Add Character Mapping**.
3. Customize physical attributes (hair color, hairstyle, facial structure, weapons, costume) or click **🔒 Lock Mapping** to protect against automated re-indexing.

### 4. Generating Chapters with FREE MAX TODAY
1. Navigate to the **Free Max Today & Queue** tab.
2. Choose **⚡ FREE MAX TODAY** (or select 1, 2, 5, 10, or Custom chapters).
3. Select Speed Mode: **⚡ FREE_FAST (Max Throughput)**.
4. Click **▶ Start Batch**.
5. Inkstone will sequentially generate storyboards, render panels, compute face-avoiding lettering overlays, assemble spreads, and save disk checkpoints after every panel.
6. The real-time Daily Dashboard displays chapters completed today, throughput (chapters/hour), active provider, and visual style bindings.

### 5. Pausing, Resuming, or Stopping
- **Pause**: Click `⏸ Pause` to pause mid-run.
- **One-Tap Resume**: Click `▶ Resume FREE MAX TODAY` to resume from the exact next unfinished panel.
- **Stop Safely**: Choose from `Stop Immediately`, `Stop After Current Panel`, `Stop After Current Page`, or `Stop After Current Chapter`.
- **Retry / Skip**: Click `🔄 Retry Failed` to retry failed panels or `⏭ Skip Failed` to skip blocked tasks and proceed.

### 6. Reading and Editing Panels
1. Navigate to the **Manga Reader** tab and choose your chapter.
2. Toggle between **📜 Vertical Webtoon** and **📖 Manga Pages**.
3. Click any dialogue bubble to drag and reposition it on the canvas.
4. Double-click or click **Edit Lettering** to change dialogue text, bubble type (`speech`, `thought`, `shout`, `whisper`, `narration`), tail direction, or size.
5. Click **Targeted Regeneration** to redraw specific scopes (`character_only`, `background_only`, `lettering_only`, `same_character_lock`, `same_style_lock`, `both_locks`).

### 7. Backup & Export
- In the **Chapter Library**, click **💾 Backup Novel (.zip)** to download a complete workspace snapshot. Click **📂 Restore Novel (.zip)** to restore.
- In the **Manga Reader**, click **📥 Export CBZ** to download standard `.cbz` comic book files for e-readers, or click **📦 Export ZIP** for raw panel images.

---

## 🔒 Known Limitations & Honest Architectural Trade-offs

- **Zero-Cost & Free-Tier Boundaries**: Inkstone prioritizes zero financial cost. Free-tier cloud providers enforce daily request quotas and rate limits (e.g. 15 RPM). When free quota is reached, Inkstone pauses safely under `WAITING_FOR_FREE_CAPACITY` rather than incurring cloud billing.
- **Character Consistency Scope**: In accordance with the Agnes L1+L2 consistency architecture, character facial features, hairstyles, and outfits are anchored via structured semantic constraint injection and reference latent guidance. True pixel-perfect 100% face invariance across arbitrary angles requires heavy local GPU hardware (SDXL IP-Adapter / LoRA training), which contradicts the zero-GPU, zero-cost architecture.
- **Export Formats**: Reliable Comic Book Archive (`.cbz`) and `.zip` image archives are natively supported. PDF exports are assembled via the browser's native print-to-PDF engine to guarantee layout fidelity without bloated headless browser dependencies.

---

## 📜 License & Attribution

Inkstone is released under the MIT License. See [LICENSE](LICENSE) and [NOTICE](NOTICE) for details.
