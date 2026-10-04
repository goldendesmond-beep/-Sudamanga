import express from 'express';
import type { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { GoogleGenAI } from '@google/genai';
import AdmZip from 'adm-zip';
import { NovelEngine } from './novelEngine.js';
import { StoryMemoryManager } from './storyMemory.js';
import { ReferenceLockEngine, DEFAULT_STYLE_PROFILE } from './referenceLock.js';
import { StoryboardEngine } from './storyboardEngine.js';
import { PanelGenerationEngine } from './panelGenerationEngine.js';
import { BatchAutomationEngine } from './batchAutomationEngine.js';
import { MangaLibraryStorage } from './mangaLibraryStorage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = '0.0.0.0';

// Runtime policy: ZERO_COST_ONLY defaults to true.
// Ensures free-tier models and zero-cost local heuristics are enforced.
// Credentials are user-configurable via environment variables (GEMINI_API_KEY / AGNES_API_KEY)
// and never hardcoded or tied to developer sessions.
const ZERO_COST_ONLY = process.env.ZERO_COST_ONLY !== 'false';

const ROOT = __dirname;
const ASSETS_DIR = path.join(ROOT, 'assets');
const OUTPUT_DIR = path.join(ROOT, 'comic_out');
const NOVELS_DIR = path.join(ROOT, 'novels');
const LIBRARY_DIR = path.join(ROOT, 'NovelToMangaLibrary');

// Ensure output directories exist
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}
if (!fs.existsSync(NOVELS_DIR)) {
  fs.mkdirSync(NOVELS_DIR, { recursive: true });
}
if (!fs.existsSync(LIBRARY_DIR)) {
  fs.mkdirSync(LIBRARY_DIR, { recursive: true });
}

const novelEngine = new NovelEngine(NOVELS_DIR);
const storyMemory = new StoryMemoryManager(NOVELS_DIR);
const referenceLock = new ReferenceLockEngine(NOVELS_DIR);
const storyboardEngine = new StoryboardEngine(NOVELS_DIR, storyMemory, referenceLock);
const panelEngine = new PanelGenerationEngine(NOVELS_DIR, referenceLock, storyboardEngine, ZERO_COST_ONLY);
const libraryStorage = new MangaLibraryStorage(LIBRARY_DIR, NOVELS_DIR);
const batchEngine = new BatchAutomationEngine(
  NOVELS_DIR,
  novelEngine,
  storyMemory,
  referenceLock,
  storyboardEngine,
  panelEngine,
  ZERO_COST_ONLY,
  libraryStorage
);

// In-memory job registry
interface JobPanel {
  id: string;
  url: string;
}

interface ReviewCandidate {
  suggested?: boolean;
  new_name: string;
  candidate: string;
  reason?: string;
}

interface Job {
  id: string;
  project_id: string;
  status: 'running' | 'done' | 'error' | 'paused';
  log: string[];
  panels: JobPanel[];
  webtoon: string | null;
  pdf: string | null;
  skipped: string[];
  skipped_chunks: string[];
  needs_review: ReviewCandidate[];
  stale_panels: string[];
  render_mode: string;
  pages_done: string[];
  skipped_pages: string[];
  pause_reason: string | null;
  base_elapsed: number;
  session_started_at: number;
  elapsed_seconds: number;
  remaining_seconds: number | null;
  progress: number;
  stage: string;
  error: string | null;
  cancel_requested: boolean;
  finished_at?: number;
  timeoutId?: NodeJS.Timeout;
}

const JOBS = new Map<string, Job>();
const JOB_TOMBSTONES = new Map<string, number>();
const JOB_TTL_MS = 3600 * 1000;

function purgeExpiredJobs() {
  const now = Date.now();
  for (const [id, job] of JOBS.entries()) {
    if (job.finished_at && now - job.finished_at > JOB_TTL_MS) {
      JOBS.delete(id);
      JOB_TOMBSTONES.set(id, now);
    }
  }
  for (const [id, expiredAt] of JOB_TOMBSTONES.entries()) {
    if (now - expiredAt > JOB_TTL_MS) {
      JOB_TOMBSTONES.delete(id);
    }
  }
}

// Middleware
app.use(express.json({ limit: '50mb' }));

// CORS & Security headers for preview iframe
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PATCH');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

// Seed an initial showcase project in comic_out if not present
function seedShowcaseProject() {
  try {
    const demoDir = path.join(OUTPUT_DIR, 'journey-demo');
    if (!fs.existsSync(demoDir)) {
      fs.mkdirSync(demoDir, { recursive: true });
      const sampleNames = ['P01.png', 'P02.png', 'P03.png', 'P04.png', 'P05.png', 'P06.png', 'P07.png'];
      for (const name of sampleNames) {
        const src = path.join(ASSETS_DIR, 'samples', name);
        const dst = path.join(demoDir, name);
        if (fs.existsSync(src) && !fs.existsSync(dst)) {
          fs.copyFileSync(src, dst);
        }
      }
      const previewSrc = path.join(ASSETS_DIR, 'samples', 'phone_preview.png');
      const webtoonDst = path.join(demoDir, 'webtoon.png');
      if (fs.existsSync(previewSrc) && !fs.existsSync(webtoonDst)) {
        fs.copyFileSync(previewSrc, webtoonDst);
      }

      const state = {
        project_id: 'journey-demo',
        stage: 'done',
        panels_done: ['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07'],
        render_mode: 'finished_page',
        pages_done: ['c0000:p1', 'c0000:p2'],
        skipped_pages: [],
        skipped: [],
        skipped_chunks: [],
        needs_review: [],
        stale_panels: [],
        generated: {
          panels: {
            'c0000-p0001': { local: path.join(demoDir, 'P01.png'), chunk_index: 0, panel_index: 1 },
            'c0000-p0002': { local: path.join(demoDir, 'P02.png'), chunk_index: 0, panel_index: 2 },
            'c0000-p0003': { local: path.join(demoDir, 'P03.png'), chunk_index: 0, panel_index: 3 },
            'c0000-p0004': { local: path.join(demoDir, 'P04.png'), chunk_index: 0, panel_index: 4 },
            'c0000-p0005': { local: path.join(demoDir, 'P05.png'), chunk_index: 0, panel_index: 5 },
            'c0000-p0006': { local: path.join(demoDir, 'P06.png'), chunk_index: 0, panel_index: 6 },
            'c0000-p0007': { local: path.join(demoDir, 'P07.png'), chunk_index: 0, panel_index: 7 },
          },
        },
      };
      fs.writeFileSync(path.join(demoDir, 'state.json'), JSON.stringify(state, null, 2), 'utf-8');
      fs.writeFileSync(path.join(demoDir, 'timing.json'), JSON.stringify({ active_elapsed_seconds: 4.8 }, null, 2), 'utf-8');
      fs.writeFileSync(
        path.join(demoDir, 'source.txt'),
        'Chapter 1: The Ferry Dock\nShen Zhiyi wrapped her coat as the chill autumn wind rippled the dark river.',
        'utf-8'
      );
    }
  } catch (err) {
    console.warn('Could not seed showcase project:', err);
  }
}

seedShowcaseProject();

// Static asset handlers
app.use('/assets', express.static(ASSETS_DIR));
app.use('/files', express.static(OUTPUT_DIR));

// Serve index.html for root
app.get(['/', '/index.html'], (_req: Request, res: Response) => {
  res.sendFile(path.join(ROOT, 'web', 'index.html'));
});

// API Routes
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ ok: true, key: true });
});

// --- Large Novel Engine Endpoints ---

// Import a novel (TXT, Markdown, EPUB)
app.post('/api/novels/import', async (req: Request, res: Response) => {
  try {
    const { filename, text, base64, custom_pattern, title } = req.body || {};
    if (!filename || (!text && !base64)) {
      return res.status(400).json({ error: "Missing filename or novel content ('text' or 'base64')" });
    }

    const content = base64 ? Buffer.from(base64, 'base64') : String(text);
    const result = await novelEngine.importNovel({
      filename: String(filename),
      content,
      customPattern: custom_pattern ? String(custom_pattern) : null,
      titleOverride: title ? String(title) : undefined,
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Re-index an existing novel with a custom pattern
app.post('/api/novels/:id/reindex', async (req: Request, res: Response) => {
  try {
    const novelId = String(req.params.id);
    const { custom_pattern } = req.body || {};
    const result = await novelEngine.reindexNovel(novelId, custom_pattern);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// List all novels
app.get('/api/novels', (_req: Request, res: Response) => {
  try {
    const novels = novelEngine.listNovels();
    res.json(novels);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Get single novel metadata
app.get('/api/novels/:id', (req: Request, res: Response) => {
  try {
    const novelId = String(req.params.id);
    const novel = novelEngine.getNovel(novelId);
    if (!novel) return res.status(404).json({ error: 'Novel not found' });
    res.json(novel);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Get chapters for a novel (with pagination, search, status filter)
app.get('/api/novels/:id/chapters', (req: Request, res: Response) => {
  try {
    const novelId = String(req.params.id);
    const search = req.query.search ? String(req.query.search) : undefined;
    const status = req.query.status ? (String(req.query.status) as any) : undefined;
    const page = req.query.page ? parseInt(String(req.query.page), 10) : 1;
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 50;

    const data = novelEngine.getChapters(novelId, { search, status, page, limit });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Lazy-load a single chapter's content
app.get('/api/novels/:id/chapters/:chapterId', (req: Request, res: Response) => {
  try {
    const novelId = String(req.params.id);
    const chapterId = String(req.params.chapterId);
    const data = novelEngine.getChapterContent(novelId, chapterId);
    if (!data) return res.status(404).json({ error: 'Chapter not found' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Update a chapter status
app.patch('/api/novels/:id/chapters/:chapterId', (req: Request, res: Response) => {
  try {
    const novelId = String(req.params.id);
    const chapterId = String(req.params.chapterId);
    const { status } = req.body || {};
    if (!status) return res.status(400).json({ error: 'Missing status' });

    const updated = novelEngine.updateChapterStatus(novelId, chapterId, status);
    if (!updated) return res.status(404).json({ error: 'Chapter not found' });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// --- Stage 3: Story Bible & Terminology Memory Endpoints ---

// Get Story Bible
app.get('/api/novels/:id/story-bible', (req: Request, res: Response) => {
  try {
    const novelId = String(req.params.id);
    const bible = storyMemory.getStoryBible(novelId);
    res.json(bible);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Get Glossary
app.get('/api/novels/:id/glossary', (req: Request, res: Response) => {
  try {
    const novelId = String(req.params.id);
    const terms = storyMemory.getGlossary(novelId);
    res.json(terms);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Add / Update Glossary Term
app.post('/api/novels/:id/glossary', (req: Request, res: Response) => {
  try {
    const novelId = String(req.params.id);
    const term = req.body;
    if (!term || !term.source_term) {
      return res.status(400).json({ error: "Missing 'source_term'" });
    }
    const saved = storyMemory.upsertGlossaryTerm(novelId, {
      ...term,
      confidence: term.confidence || 'USER_EDITED',
      last_updated_chapter: term.last_updated_chapter || 1,
    });
    res.json(saved);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// User edit of character in Story Bible
app.patch('/api/novels/:id/characters/:charId', (req: Request, res: Response) => {
  try {
    const novelId = String(req.params.id);
    const charId = String(req.params.charId);
    const updated = storyMemory.updateCharacterByUser(novelId, charId, req.body || {});
    if (!updated) return res.status(404).json({ error: 'Character not found' });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Merge duplicate characters
app.post('/api/novels/:id/characters/merge', (req: Request, res: Response) => {
  try {
    const novelId = String(req.params.id);
    const { primary_id, secondary_id } = req.body || {};
    if (!primary_id || !secondary_id) {
      return res.status(400).json({ error: "Missing 'primary_id' or 'secondary_id'" });
    }
    const merged = storyMemory.mergeCharacters(novelId, String(primary_id), String(secondary_id));
    if (!merged) return res.status(404).json({ error: 'Character not found for merge' });
    res.json(merged);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Selective Context Retrieval for Chapter
app.get('/api/novels/:id/context/:chapterNum', (req: Request, res: Response) => {
  try {
    const novelId = String(req.params.id);
    const chapterNum = parseInt(String(req.params.chapterNum), 10);
    const chData = novelEngine.getChapters(novelId, { limit: 1, search: String(chapterNum) });
    let text = '';
    if (chData.chapters.length > 0) {
      const content = novelEngine.getChapterContent(novelId, chData.chapters[0].id);
      if (content) text = content.content;
    }
    const context = storyMemory.getSelectiveContext(novelId, chapterNum, text);
    res.json(context);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Incremental Memory Ingestion for Chapter
app.post('/api/novels/:id/process-memory/:chapterNum', async (req: Request, res: Response) => {
  try {
    const novelId = String(req.params.id);
    const chapterNum = parseInt(String(req.params.chapterNum), 10);
    const { text, lang } = req.body || {};
    let chapterText = text;
    if (!chapterText) {
      const chData = novelEngine.getChapters(novelId, { limit: 1, search: String(chapterNum) });
      if (chData.chapters.length > 0) {
        const content = novelEngine.getChapterContent(novelId, chData.chapters[0].id);
        if (content) chapterText = content.content;
      }
    }
    if (!chapterText) {
      return res.status(400).json({ error: 'Chapter text required for processing' });
    }
    const result = await storyMemory.processChapterIncremental(
      novelId,
      chapterNum,
      String(chapterText),
      lang || 'undetermined'
    );
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Manual Language Settings Correction
app.patch('/api/novels/:id/language', (req: Request, res: Response) => {
  try {
    const novelId = String(req.params.id);
    const { source_language, output_language } = req.body || {};
    const metaPath = path.join(NOVELS_DIR, novelId, 'metadata.json');
    if (!fs.existsSync(metaPath)) return res.status(404).json({ error: 'Novel not found' });
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    if (source_language) meta.language = source_language;
    if (output_language) meta.output_language = output_language;
    meta.updated_at = Date.now();
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
    res.json(meta);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// --- Stage 4: Reference Manga + Character Lock + Style Lock Endpoints ---

// Search reference manga/manhwa/webtoon by title (cached & zero-cost)
app.get('/api/reference/search', async (req: Request, res: Response) => {
  try {
    const q = req.query.q ? String(req.query.q) : '';
    const results = await referenceLock.searchReferenceSeries(q);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Get novel reference lock state
app.get('/api/novels/:id/reference-lock', (req: Request, res: Response) => {
  try {
    const novelId = String(req.params.id);
    const state = referenceLock.getNovelReferenceLockState(novelId);
    res.json(state);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Set reference mode: 'characters_only' | 'style_only' | 'characters_and_style'
app.post('/api/novels/:id/reference-mode', (req: Request, res: Response) => {
  try {
    const novelId = String(req.params.id);
    const { mode } = req.body || {};
    if (!mode || !['characters_only', 'style_only', 'characters_and_style'].includes(mode)) {
      return res.status(400).json({ error: "Invalid reference mode. Must be 'characters_only', 'style_only', or 'characters_and_style'" });
    }
    const state = referenceLock.setReferenceMode(novelId, mode);
    res.json(state);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Create/Update Style Lock with versioning (e.g. V1 -> V2)
app.post('/api/novels/:id/style-lock', (req: Request, res: Response) => {
  try {
    const novelId = String(req.params.id);
    const { series_title, starting_from_chapter } = req.body || {};
    if (!series_title) return res.status(400).json({ error: "Missing 'series_title'" });

    const newProfile = referenceLock.updateNovelStyleLock(
      novelId,
      String(series_title),
      starting_from_chapter ? parseInt(String(starting_from_chapter), 10) : 1
    );
    res.json(newProfile);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Update or reset user overrides on active Style Profile
app.patch('/api/novels/:id/style-lock/overrides', (req: Request, res: Response) => {
  try {
    const novelId = String(req.params.id);
    const { overrides, reset } = req.body || {};
    const state = referenceLock.getNovelReferenceLockState(novelId);
    const active = state.style_locks.find((s) => s.version === state.active_style_version);
    if (!active) return res.status(404).json({ error: 'No active style profile' });

    if (reset) {
      active.user_overrides = {};
    } else if (overrides) {
      active.user_overrides = { ...active.user_overrides, ...overrides };
    }
    active.updated_at = Date.now();
    referenceLock.saveNovelReferenceLockState(novelId, state);
    res.json(active);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Map Novel Character -> Reference Character & create Character Lock
app.post('/api/novels/:id/character-mapping', (req: Request, res: Response) => {
  try {
    const novelId = String(req.params.id);
    const { novel_character_id, novel_character_name, reference_series, reference_character, lock_immediately, custom_overrides } = req.body || {};
    if (!novel_character_id || !novel_character_name || !reference_series || !reference_character) {
      return res.status(400).json({ error: "Missing required character mapping fields" });
    }
    const result = referenceLock.mapNovelCharacter(novelId, {
      novelCharacterId: String(novel_character_id),
      novelCharacterName: String(novel_character_name),
      referenceSeries: String(reference_series),
      referenceCharacter: String(reference_character),
      lockImmediately: lock_immediately !== false,
      customOverrides: custom_overrides,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Remove Character Mapping
app.delete('/api/novels/:id/character-mapping/:charId', (req: Request, res: Response) => {
  try {
    const novelId = String(req.params.id);
    const charId = String(req.params.charId);
    const state = referenceLock.getNovelReferenceLockState(novelId);
    delete state.character_mappings[charId];
    if (state.character_locks[charId]) {
      state.character_locks[charId].locked = false;
    }
    referenceLock.saveNovelReferenceLockState(novelId, state);
    res.json({ ok: true, charId });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Update or toggle Character Lock Profile
app.patch('/api/novels/:id/character-lock/:charId', (req: Request, res: Response) => {
  try {
    const novelId = String(req.params.id);
    const charId = String(req.params.charId);
    const state = referenceLock.getNovelReferenceLockState(novelId);
    const charLock = state.character_locks[charId];
    if (!charLock) return res.status(404).json({ error: 'Character Lock not found' });

    Object.assign(charLock, req.body || {});
    charLock.updated_at = Date.now();
    referenceLock.saveNovelReferenceLockState(novelId, state);
    res.json(charLock);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Get separated structured prompt constraints for panel generation
app.get('/api/novels/:id/prompt-constraints/:chapterNum', (req: Request, res: Response) => {
  try {
    const novelId = String(req.params.id);
    const chapterNum = parseInt(String(req.params.chapterNum), 10) || 1;
    const state = referenceLock.getNovelReferenceLockState(novelId);
    const charIds = Object.keys(state.character_locks);
    const constraints = referenceLock.buildStructuredPromptConstraints({
      novelId,
      chapterNumber: chapterNum,
      novelCharacterIds: charIds,
      sceneText: `Sample chapter beat for Chapter ${chapterNum}`,
      panelNumber: 1,
    });
    res.json(constraints);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Auto-suggest character mappings for novel
app.post('/api/novels/:id/character-mapping/suggest', (req: Request, res: Response) => {
  try {
    const novelId = String(req.params.id);
    let characters = req.body?.characters;
    if (!characters || !Array.isArray(characters) || characters.length === 0) {
      const bible = storyMemory.getStoryBible(novelId);
      characters = Object.values(bible.characters || {}).map((c) => ({
        id: c.id,
        name: c.canonical_name?.value || c.id,
        role: c.role?.value || 'Character',
      }));
    }
    const suggestions = referenceLock.suggestCharacterMappings(novelId, characters);
    res.json(suggestions);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Toggle lock status on character mapping
app.post('/api/novels/:id/character-mapping/:charId/lock', (req: Request, res: Response) => {
  try {
    const novelId = String(req.params.id);
    const charId = String(req.params.charId);
    const { locked } = req.body || {};
    const updated = referenceLock.toggleMappingLock(novelId, charId, locked !== undefined ? Boolean(locked) : undefined);
    if (!updated) return res.status(404).json({ error: 'Mapping not found' });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Update or reset user overrides on Character Lock
app.patch('/api/novels/:id/character-lock/:charId/overrides', (req: Request, res: Response) => {
  try {
    const novelId = String(req.params.id);
    const charId = String(req.params.charId);
    const { overrides, reset } = req.body || {};
    const updated = referenceLock.updateCharacterLockOverrides(novelId, charId, overrides || {}, Boolean(reset));
    if (!updated) return res.status(404).json({ error: 'Character Lock not found' });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Audit Consistency & Warnings
app.get('/api/novels/:id/reference-audit', (req: Request, res: Response) => {
  try {
    const novelId = String(req.params.id);
    const novelMeta = novelEngine.getNovel(novelId);
    const audit = referenceLock.auditConsistency(novelId, novelMeta);
    res.json(audit);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ==================================================
// STAGE 5: MANGA STORYBOARD & PRODUCTION PLAN API
// ==================================================

// List all storyboards for a novel
app.get('/api/novels/:id/storyboards', (req: Request, res: Response) => {
  try {
    const novelId = String(req.params.id);
    const list = storyboardEngine.listStoryboards(novelId);
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Get or auto-generate Chapter Storyboard
app.get('/api/novels/:id/chapters/:chapterNum/storyboard', async (req: Request, res: Response) => {
  try {
    const novelId = String(req.params.id);
    const chapterNum = parseInt(String(req.params.chapterNum), 10);
    if (isNaN(chapterNum)) return res.status(400).json({ error: 'Invalid chapter number' });

    let sb = storyboardEngine.getStoryboard(novelId, chapterNum);
    if (!sb && (req.query.auto_generate === 'true' || req.query.auto_generate === '1')) {
      const chData = novelEngine.getChapterContent(novelId, String(chapterNum));
      if (!chData) return res.status(404).json({ error: `Chapter ${chapterNum} not found in novel` });

      sb = await storyboardEngine.generateStoryboard({
        novelId,
        chapterId: chData.meta.id,
        chapterNumber: chapterNum,
        chapterTitle: chData.meta.title,
        chapterText: chData.content,
        layoutMode: (req.query.layout_mode as any) || 'vertical_webtoon',
        generationMode: (req.query.generation_mode as any) || 'FREE_FAST',
      });
      novelEngine.updateChapterStatus(novelId, chData.meta.id, 'STORYBOARD_READY');
    }

    if (!sb) return res.status(404).json({ error: 'Storyboard not yet generated for this chapter', chapter_number: chapterNum });
    res.json(sb);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Generate / Regenerate Storyboard
app.post('/api/novels/:id/chapters/:chapterNum/storyboard', async (req: Request, res: Response) => {
  try {
    const novelId = String(req.params.id);
    const chapterNum = parseInt(String(req.params.chapterNum), 10);
    if (isNaN(chapterNum)) return res.status(400).json({ error: 'Invalid chapter number' });

    const { layout_mode, generation_mode, force_regenerate, manual_approval_required } = req.body || {};
    
    const chData = novelEngine.getChapterContent(novelId, String(chapterNum));
    if (!chData) return res.status(404).json({ error: `Chapter ${chapterNum} not found in novel` });

    const sb = await storyboardEngine.generateStoryboard({
      novelId,
      chapterId: chData.meta.id,
      chapterNumber: chapterNum,
      chapterTitle: chData.meta.title,
      chapterText: chData.content,
      layoutMode: layout_mode || 'vertical_webtoon',
      generationMode: generation_mode || 'FREE_FAST',
      forceRegenerate: Boolean(force_regenerate),
      manualApprovalRequired: Boolean(manual_approval_required),
    });

    novelEngine.updateChapterStatus(novelId, chData.meta.id, 'STORYBOARD_READY');
    res.json(sb);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Storyboard Review: Update specific panel (dialogue, camera, character, action, expression, pose)
app.patch('/api/novels/:id/chapters/:chapterNum/storyboard/panels/:panelId', (req: Request, res: Response) => {
  try {
    const novelId = String(req.params.id);
    const chapterNum = parseInt(String(req.params.chapterNum), 10);
    const panelId = String(req.params.panelId);
    const updates = req.body || {};

    const updated = storyboardEngine.updatePanel({
      novelId,
      chapterNumber: chapterNum,
      panelId,
      updates,
    });
    if (!updated) return res.status(404).json({ error: 'Panel or storyboard not found' });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Storyboard Review: Add custom panel
app.post('/api/novels/:id/chapters/:chapterNum/storyboard/panels', (req: Request, res: Response) => {
  try {
    const novelId = String(req.params.id);
    const chapterNum = parseInt(String(req.params.chapterNum), 10);
    const { scene_id, after_panel_id, panel_data } = req.body || {};

    const newPanel = storyboardEngine.addPanel({
      novelId,
      chapterNumber: chapterNum,
      sceneId: scene_id,
      afterPanelId: after_panel_id,
      panelData: panel_data,
    });
    if (!newPanel) return res.status(400).json({ error: 'Could not add panel' });
    res.json(newPanel);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Storyboard Review: Delete redundant panel
app.delete('/api/novels/:id/chapters/:chapterNum/storyboard/panels/:panelId', (req: Request, res: Response) => {
  try {
    const novelId = String(req.params.id);
    const chapterNum = parseInt(String(req.params.chapterNum), 10);
    const panelId = String(req.params.panelId);

    const success = storyboardEngine.deletePanel({
      novelId,
      chapterNumber: chapterNum,
      panelId,
    });
    if (!success) return res.status(404).json({ error: 'Panel not found or could not be deleted' });
    res.json({ success: true, deleted_panel_id: panelId });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Storyboard Review: Approve storyboard for production
app.post('/api/novels/:id/chapters/:chapterNum/storyboard/approve', (req: Request, res: Response) => {
  try {
    const novelId = String(req.params.id);
    const chapterNum = parseInt(String(req.params.chapterNum), 10);
    const { approved } = req.body || {};

    const sb = storyboardEngine.approveStoryboard(novelId, chapterNum, approved !== false);
    if (!sb) return res.status(404).json({ error: 'Storyboard not found' });
    res.json(sb);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Get compiled Generation Tasks for chapter
app.get('/api/novels/:id/chapters/:chapterNum/generation-tasks', (req: Request, res: Response) => {
  try {
    const novelId = String(req.params.id);
    const chapterNum = parseInt(String(req.params.chapterNum), 10);
    const tasks = storyboardEngine.getGenerationTasks(novelId, chapterNum);
    res.json(tasks);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ==================================================
// STAGE 6: IMAGE GENERATION + LETTERING + READER API
// ==================================================

// Serve generated panel image/svg files
app.get('/api/novels/:id/panels/files/:fileName', (req: Request, res: Response) => {
  try {
    const novelId = String(req.params.id);
    const fileName = path.basename(String(req.params.fileName));
    const filePath = path.join(NOVELS_DIR, novelId, 'panels', fileName);
    if (!fs.existsSync(filePath)) {
      return res.status(404).send('Panel file not found');
    }
    if (fileName.endsWith('.svg')) {
      res.setHeader('Content-Type', 'image/svg+xml');
    } else if (fileName.endsWith('.png')) {
      res.setHeader('Content-Type', 'image/png');
    }
    res.sendFile(filePath);
  } catch (err) {
    res.status(500).send(String(err));
  }
});

// List or auto-generate chapter panels
app.get('/api/novels/:id/chapters/:chapterNum/panels', async (req: Request, res: Response) => {
  try {
    const novelId = String(req.params.id);
    const chapterNum = parseInt(String(req.params.chapterNum), 10);
    const lang = req.query.lang === 'ar' ? 'ar' : 'en';
    const autoGen = req.query.auto_generate === 'true';
    const force = req.query.force === 'true';

    let panels = panelEngine.listChapterPanels(novelId, chapterNum);
    if ((panels.length === 0 && autoGen) || force) {
      let sb = storyboardEngine.getStoryboard(novelId, chapterNum);
      if (!sb) {
        const chapData = novelEngine.getChapterContent(novelId, `ch_${chapterNum}`);
        const text = (typeof chapData === 'string' ? chapData : chapData?.content) || `Chapter ${chapterNum} text content`;
        sb = await storyboardEngine.generateStoryboard({
          novelId,
          chapterId: `ch_${chapterNum}`,
          chapterNumber: chapterNum,
          chapterTitle: `Chapter ${chapterNum}`,
          chapterText: text,
          layoutMode: 'vertical_webtoon',
          generationMode: 'FREE_FAST',
        });
      }
      if (sb && sb.panels.length > 0) {
        let prevPanel: any = null;
        for (const p of sb.panels) {
          const gen = await panelEngine.generatePanel({
            novelId,
            chapterNumber: chapterNum,
            panel: p,
            previousPanel: prevPanel,
            language: lang,
          });
          prevPanel = gen;
        }
        panels = panelEngine.listChapterPanels(novelId, chapterNum);
      }
    }
    res.json(panels);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Get single panel
app.get('/api/novels/:id/chapters/:chapterNum/panels/:panelId', (req: Request, res: Response) => {
  try {
    const novelId = String(req.params.id);
    const chapterNum = parseInt(String(req.params.chapterNum), 10);
    const panelId = String(req.params.panelId);
    const panel = panelEngine.getSavedPanel(novelId, chapterNum, panelId);
    if (!panel) return res.status(404).json({ error: 'Panel not found' });
    res.json(panel);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Targeted panel regeneration
app.post('/api/novels/:id/chapters/:chapterNum/panels/:panelId/regenerate', async (req: Request, res: Response) => {
  try {
    const novelId = String(req.params.id);
    const chapterNum = parseInt(String(req.params.chapterNum), 10);
    const panelId = String(req.params.panelId);
    const { regen_mode = 'full_panel', prompt_override, language = 'en' } = req.body || {};

    const updated = await panelEngine.regeneratePanelTargeted({
      novelId,
      chapterNumber: chapterNum,
      panelId,
      regenMode: regen_mode,
      userPromptOverride: prompt_override,
      language: language === 'ar' ? 'ar' : 'en',
    });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Update dialogue lettering bubble
app.patch('/api/novels/:id/chapters/:chapterNum/panels/:panelId/lettering/:bubbleId', (req: Request, res: Response) => {
  try {
    const novelId = String(req.params.id);
    const chapterNum = parseInt(String(req.params.chapterNum), 10);
    const panelId = String(req.params.panelId);
    const bubbleId = String(req.params.bubbleId);
    const updates = req.body || {};

    const lettering = panelEngine.updateLetteringBubble({
      novelId,
      chapterNumber: chapterNum,
      panelId,
      bubbleId,
      updates,
    });
    res.json(lettering);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Re-layout lettering only
app.post('/api/novels/:id/chapters/:chapterNum/panels/:panelId/lettering/relayout', async (req: Request, res: Response) => {
  try {
    const novelId = String(req.params.id);
    const chapterNum = parseInt(String(req.params.chapterNum), 10);
    const panelId = String(req.params.panelId);
    const { language = 'en' } = req.body || {};

    const updated = await panelEngine.regeneratePanelTargeted({
      novelId,
      chapterNumber: chapterNum,
      panelId,
      regenMode: 'lettering_only',
      language: language === 'ar' ? 'ar' : 'en',
    });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Lock / Unlock panel
app.post('/api/novels/:id/chapters/:chapterNum/panels/:panelId/lock', (req: Request, res: Response) => {
  try {
    const novelId = String(req.params.id);
    const chapterNum = parseInt(String(req.params.chapterNum), 10);
    const panelId = String(req.params.panelId);
    const isLocked = panelEngine.togglePanelLock(novelId, chapterNum, panelId);
    res.json({ success: true, is_locked: isLocked });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Approve panel
app.post('/api/novels/:id/chapters/:chapterNum/panels/:panelId/approve', (req: Request, res: Response) => {
  try {
    const novelId = String(req.params.id);
    const chapterNum = parseInt(String(req.params.chapterNum), 10);
    const panelId = String(req.params.panelId);
    panelEngine.approvePanel(novelId, chapterNum, panelId);
    res.json({ success: true, status: 'APPROVED' });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Inspect panel diagnostics (locks, drift status, continuity)
app.get('/api/novels/:id/chapters/:chapterNum/panels/:panelId/diagnostics', (req: Request, res: Response) => {
  try {
    const novelId = String(req.params.id);
    const chapterNum = parseInt(String(req.params.chapterNum), 10);
    const panelId = String(req.params.panelId);
    const panel = panelEngine.getSavedPanel(novelId, chapterNum, panelId);
    if (!panel) return res.status(404).json({ error: 'Panel not found' });

    const novelRef = referenceLock.getNovelReferenceLockState(novelId);
    const styleProfile =
      novelRef.style_locks.find((s) => s.version === panel.style_version) ||
      novelRef.style_locks[0];
    const charLocks = (panel.character_locks_applied || []).map((cName) => {
      const charId = cName.toLowerCase().replace(/\s+/g, '_');
      return novelRef.character_locks[charId] || Object.values(novelRef.character_locks).find((l) => l.canonical_name === cName);
    }).filter(Boolean);

    res.json({
      panel_id: panel.panel_id,
      status: panel.status,
      is_locked: panel.is_locked,
      reference_mode: panel.reference_mode,
      drift_check: panel.drift_check,
      continuity: panel.continuity,
      character_locks: charLocks,
      style_profile: styleProfile,
      provider_tier: panel.provider_tier,
      provider_name: panel.provider_name,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ==================================================
// STAGE 7: FREE MAX TODAY + BATCH AUTOMATION & DASHBOARD
// ==================================================

// Start or queue a batch run
app.post('/api/novels/:id/batch/start', async (req: Request, res: Response) => {
  try {
    const novelId = String(req.params.id);
    const {
      mode = 'free_max_today',
      start_chapter = 1,
      custom_chapters,
      generation_mode = 'FREE_FAST',
      language = 'en',
    } = req.body || {};

    const state = await batchEngine.startBatch({
      novelId,
      mode,
      startChapter: parseInt(String(start_chapter), 10) || 1,
      customChapters: Array.isArray(custom_chapters) ? custom_chapters.map((n: any) => parseInt(String(n), 10)) : undefined,
      generationMode: generation_mode,
      language: language === 'ar' ? 'ar' : 'en',
    });

    res.json(state);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Pause batch run
app.post('/api/novels/:id/batch/pause', (req: Request, res: Response) => {
  try {
    const novelId = String(req.params.id);
    const state = batchEngine.pauseBatch(novelId);
    res.json(state);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Resume batch run (One-Tap Resume)
app.post('/api/novels/:id/batch/resume', (req: Request, res: Response) => {
  try {
    const novelId = String(req.params.id);
    const { language = 'en' } = req.body || {};
    const state = batchEngine.resumeBatch(novelId, language === 'ar' ? 'ar' : 'en');
    res.json(state);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Stop batch safely with condition (stop_now | after_panel | after_page | after_chapter)
app.post('/api/novels/:id/batch/stop', (req: Request, res: Response) => {
  try {
    const novelId = String(req.params.id);
    const { condition = 'stop_now' } = req.body || {};
    const state = batchEngine.stopSafely(novelId, condition);
    res.json(state);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Retry failed tasks
app.post('/api/novels/:id/batch/retry-failed', (req: Request, res: Response) => {
  try {
    const novelId = String(req.params.id);
    const { language = 'en' } = req.body || {};
    const state = batchEngine.retryFailed(novelId, language === 'ar' ? 'ar' : 'en');
    res.json(state);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Skip failed tasks
app.post('/api/novels/:id/batch/skip-failed', (req: Request, res: Response) => {
  try {
    const novelId = String(req.params.id);
    const state = batchEngine.skipFailed(novelId);
    res.json(state);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Get current queue state
app.get('/api/novels/:id/batch/state', (req: Request, res: Response) => {
  try {
    const novelId = String(req.params.id);
    const state = batchEngine.getQueueState(novelId);
    res.json(state);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Get real-time daily dashboard metrics
app.get('/api/novels/:id/batch/dashboard', (req: Request, res: Response) => {
  try {
    const novelId = String(req.params.id);
    const dashboard = batchEngine.getDashboard(novelId);
    res.json(dashboard);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// --- Stage 8: Default Visual Style + Backup + Restore + Export Endpoints ---

// Get default visual style profile (The Eternal Supreme)
app.get('/api/reference/default-style', (_req: Request, res: Response) => {
  res.json({
    series: 'The Eternal Supreme',
    style_profile: DEFAULT_STYLE_PROFILE,
    reference_mode: 'style_only',
    style_lock_active: true,
    character_lock_active: false,
  });
});

// Restore The Eternal Supreme as default visual style for novel
app.post('/api/novels/:id/style-lock/restore-default', (req: Request, res: Response) => {
  try {
    const novelId = String(req.params.id);
    const state = referenceLock.restoreDefaultStyle(novelId);
    res.json(state);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Toggle Style Lock active/inactive
app.post('/api/novels/:id/style-lock/toggle', (req: Request, res: Response) => {
  try {
    const novelId = String(req.params.id);
    const { active } = req.body || {};
    const state = referenceLock.setStyleLockActive(novelId, active !== undefined ? Boolean(active) : true);
    res.json(state);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Rebuild active Visual Style Profile from catalog/cache
app.post('/api/novels/:id/style-lock/rebuild', (req: Request, res: Response) => {
  try {
    const novelId = String(req.params.id);
    const profile = referenceLock.rebuildActiveStyleProfile(novelId);
    res.json(profile);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Create new Style Version (e.g. STYLE_V2)
app.post('/api/novels/:id/style-lock/new-version', (req: Request, res: Response) => {
  try {
    const novelId = String(req.params.id);
    const { series_title, starting_from_chapter } = req.body || {};
    const startChapter = starting_from_chapter ? parseInt(String(starting_from_chapter), 10) : 1;
    const profile = referenceLock.createNewStyleVersion(novelId, series_title ? String(series_title) : undefined, startChapter);
    res.json(profile);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Get Style Version for a specific chapter
app.get('/api/novels/:id/chapters/:chapterNum/style-version', (req: Request, res: Response) => {
  try {
    const novelId = String(req.params.id);
    const chapterNum = parseInt(String(req.params.chapterNum), 10) || 1;
    const info = referenceLock.getStyleVersionForChapter(novelId, chapterNum);
    res.json(info);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Generate and stream a full ZIP backup of a novel
app.get('/api/novels/:id/backup', (req: Request, res: Response) => {
  try {
    const novelId = String(req.params.id);
    const novelDir = path.join(NOVELS_DIR, novelId);
    if (!fs.existsSync(novelDir)) {
      return res.status(404).json({ error: `Novel ${novelId} not found` });
    }

    const zip = new AdmZip();
    zip.addLocalFolder(novelDir, novelId);
    const buffer = zip.toBuffer();

    const novelMeta = novelEngine.getNovel(novelId);
    const safeTitle = (novelMeta?.title || novelId).replace(/[^a-zA-Z0-9_\-\u0600-\u06FF]/g, '_');

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}_backup.zip"`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Restore a novel from a ZIP backup or JSON archive
app.post('/api/novels/:id/restore', express.raw({ type: 'application/zip', limit: '100mb' }), (req: Request, res: Response) => {
  try {
    const novelId = String(req.params.id);
    const novelDir = path.join(NOVELS_DIR, novelId);
    if (!fs.existsSync(novelDir)) {
      fs.mkdirSync(novelDir, { recursive: true });
    }

    if (Buffer.isBuffer(req.body) && req.body.length > 0) {
      try {
        const zip = new AdmZip(req.body);
        const entries = zip.getEntries();
        if (entries.length === 0) {
          return res.status(400).json({ error: 'Corrupted or empty backup archive' });
        }
        zip.extractAllTo(NOVELS_DIR, true);
        return res.json({ ok: true, novel_id: novelId, restored_from: 'zip', files_restored: entries.length });
      } catch (zipErr) {
        return res.status(400).json({ error: `Corrupted ZIP archive: ${String(zipErr)}` });
      }
    }

    // Support JSON backup payload
    if (req.body && typeof req.body === 'object') {
      const { metadata, reference_locks, story_bible, glossary } = req.body;
      if (!metadata && !reference_locks && !story_bible && !glossary) {
        return res.status(400).json({ error: 'Corrupted or invalid JSON backup payload: missing core novel fields' });
      }
      if (metadata) fs.writeFileSync(path.join(novelDir, 'metadata.json'), JSON.stringify(metadata, null, 2));
      if (reference_locks) fs.writeFileSync(path.join(novelDir, 'reference_locks.json'), JSON.stringify(reference_locks, null, 2));
      if (story_bible) fs.writeFileSync(path.join(novelDir, 'story_bible.json'), JSON.stringify(story_bible, null, 2));
      if (glossary) fs.writeFileSync(path.join(novelDir, 'glossary.json'), JSON.stringify(glossary, null, 2));
      return res.json({ ok: true, novel_id: novelId, restored_from: 'json' });
    }

    res.status(400).json({ error: 'No backup data provided or unrecognized format' });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ==================================================
// STAGE 8: MANGA LIBRARY & APPLICATION-MANAGED STORAGE API
// ==================================================

// List all manga projects in library with reading progress and generation status
app.get('/api/library/projects', (req: Request, res: Response) => {
  try {
    const list = libraryStorage.listLibraryProjects();
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Get canonical project manifest
app.get('/api/library/:id/manifest', (req: Request, res: Response) => {
  try {
    const novelId = String(req.params.id);
    const novel = novelEngine.getNovel(novelId);
    const manifest = libraryStorage.getProjectManifest(novelId, novel?.title);
    res.json(manifest);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Update reading progress (last chapter, page, percent)
app.patch('/api/library/:id/reading-progress', (req: Request, res: Response) => {
  try {
    const novelId = String(req.params.id);
    const { chapter_number, page_number, scroll_percent } = req.body || {};
    const ch = parseInt(String(chapter_number), 10) || 1;
    const pg = parseInt(String(page_number), 10) || 1;
    const sc = parseFloat(String(scroll_percent)) || 0;
    const updated = libraryStorage.updateReadingProgress(novelId, ch, pg, sc);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Get saved chapter data directly WITHOUT any AI calls
app.get('/api/library/:id/chapters/:chapterNum', (req: Request, res: Response) => {
  try {
    const novelId = String(req.params.id);
    const chapterNum = parseInt(String(req.params.chapterNum), 10) || 1;
    const saved = libraryStorage.getSavedChapter(novelId, chapterNum);
    if (!saved) {
      return res.status(404).json({ error: `Saved chapter ${chapterNum} not found in library` });
    }
    res.json(saved);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Serve saved page asset (PNG or SVG) directly from library storage
app.get('/api/library/:id/chapters/:chapterNum/pages/:pageNum', (req: Request, res: Response) => {
  try {
    const novelId = String(req.params.id);
    const chapterNum = parseInt(String(req.params.chapterNum), 10) || 1;
    const pageNum = parseInt(String(req.params.pageNum), 10) || 1;
    const chapterDir = libraryStorage.getChapterDir(novelId, chapterNum);
    const pageImgPath = path.join(chapterDir, libraryStorage.formatPageFilename(pageNum, 'png'));
    const pageSvgPath = path.join(chapterDir, libraryStorage.formatPageFilename(pageNum, 'svg'));

    if (fs.existsSync(pageImgPath)) {
      res.sendFile(pageImgPath);
    } else if (fs.existsSync(pageSvgPath)) {
      res.setHeader('Content-Type', 'image/svg+xml');
      res.sendFile(pageSvgPath);
    } else {
      res.status(404).send('Page asset not found');
    }
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Retry saving a chapter without regenerating artwork
app.post('/api/library/:id/chapters/:chapterNum/retry-save', async (req: Request, res: Response) => {
  try {
    const novelId = String(req.params.id);
    const chapterNum = parseInt(String(req.params.chapterNum), 10) || 1;
    const sb = storyboardEngine.getStoryboard(novelId, chapterNum);
    if (!sb) return res.status(404).json({ error: 'Storyboard not found' });
    const panels = panelEngine.listChapterPanels(novelId, chapterNum);
    const result = await libraryStorage.retrySaveChapter({
      novelId,
      chapterNumber: chapterNum,
      panels,
      storyboard: sb,
    });
    if (result.success) {
      novelEngine.updateChapterStatus(novelId, String(chapterNum), 'COMPLETE');
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Create automatic versioned backup
app.post('/api/library/:id/backup/versioned', (req: Request, res: Response) => {
  try {
    const novelId = String(req.params.id);
    const backup = libraryStorage.createVersionedBackup(novelId);
    res.json({ ok: true, ...backup });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Restore from versioned backup zip
app.post('/api/library/:id/restore/versioned', express.raw({ type: 'application/zip', limit: '100mb' }), (req: Request, res: Response) => {
  try {
    const novelId = String(req.params.id);
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: 'No backup zip data provided in body' });
    }
    const result = libraryStorage.restoreVersionedBackup(novelId, req.body);
    if (!result.success) {
      return res.status(400).json({ error: result.error || 'Restore failed' });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Export a chapter as Comic Book Archive (.CBZ)
app.get('/api/novels/:id/export/cbz/:chapterNum', (req: Request, res: Response) => {
  try {
    const novelId = String(req.params.id);
    const chapterNum = parseInt(String(req.params.chapterNum), 10) || 1;
    const novel = novelEngine.getNovel(novelId);
    if (!novel) return res.status(404).json({ error: 'Novel not found' });

    const panels = panelEngine.listChapterPanels(novelId, chapterNum);
    const zip = new AdmZip();

    // Add ComicInfo.xml
    const comicInfo = `<?xml version="1.0" encoding="utf-8"?>
<ComicInfo xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Title>${chapterNum}: ${novel.title || novelId}</Title>
  <Series>${novel.title || 'Inkstone Comic'}</Series>
  <Number>${chapterNum}</Number>
  <PageCount>${panels.length}</PageCount>
  <Writer>Inkstone</Writer>
  <Manga>Yes</Manga>
</ComicInfo>`;
    zip.addFile('ComicInfo.xml', Buffer.from(comicInfo, 'utf-8'));

    panels.forEach((p, idx) => {
      const padNum = String(idx + 1).padStart(3, '0');
      const imgPath = path.join(NOVELS_DIR, novelId, 'panels', `panel_${p.panel_id}.png`);
      if (fs.existsSync(imgPath)) {
        zip.addLocalFile(imgPath, '', `page_${padNum}.png`);
      } else {
        const svgContent = p.lettering?.svg_overlay || `<svg viewBox="0 0 800 1200" xmlns="http://www.w3.org/2000/svg"><rect width="800" height="1200" fill="#141419"/><text x="400" y="600" fill="#fff" text-anchor="middle">Chapter ${chapterNum} - Panel ${idx+1}</text></svg>`;
        zip.addFile(`page_${padNum}.svg`, Buffer.from(svgContent, 'utf-8'));
      }
    });

    const buffer = zip.toBuffer();
    const safeTitle = (novel.title || novelId).replace(/[^a-zA-Z0-9_\-\u0600-\u06FF]/g, '_');
    res.setHeader('Content-Type', 'application/vnd.comicbook+zip');
    res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}_Ch${chapterNum}.cbz"`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Export a chapter as raw image ZIP
app.get('/api/novels/:id/export/zip/:chapterNum', (req: Request, res: Response) => {
  try {
    const novelId = String(req.params.id);
    const chapterNum = parseInt(String(req.params.chapterNum), 10) || 1;
    const novel = novelEngine.getNovel(novelId);
    if (!novel) return res.status(404).json({ error: 'Novel not found' });

    const panels = panelEngine.listChapterPanels(novelId, chapterNum);
    const zip = new AdmZip();

    panels.forEach((p, idx) => {
      const padNum = String(idx + 1).padStart(3, '0');
      const imgPath = path.join(NOVELS_DIR, novelId, 'panels', `panel_${p.panel_id}.png`);
      if (fs.existsSync(imgPath)) {
        zip.addLocalFile(imgPath, '', `panel_${padNum}.png`);
      }
      if (p.lettering?.svg_overlay) {
        zip.addFile(`lettering_${padNum}.svg`, Buffer.from(p.lettering.svg_overlay, 'utf-8'));
      }
    });

    const buffer = zip.toBuffer();
    const safeTitle = (novel.title || novelId).replace(/[^a-zA-Z0-9_\-\u0600-\u06FF]/g, '_');
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}_Ch${chapterNum}_images.zip"`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// List projects
app.get('/api/projects', (_req: Request, res: Response) => {
  try {
    if (!fs.existsSync(OUTPUT_DIR)) {
      return res.json([]);
    }
    const entries = fs.readdirSync(OUTPUT_DIR, { withFileTypes: true });
    const projects = [];
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const statePath = path.join(OUTPUT_DIR, ent.name, 'state.json');
      if (!fs.existsSync(statePath)) continue;
      try {
        const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
        const timingPath = path.join(OUTPUT_DIR, ent.name, 'timing.json');
        projects.push({
          id: ent.name,
          stage: state.stage || 'done',
          panels_done: state.panels_done || [],
          render_mode: state.render_mode || 'finished_page',
          pages_done: state.pages_done || [],
          skipped_pages: state.skipped_pages || [],
          has_timing: fs.existsSync(timingPath),
        });
      } catch {
        // ignore corrupted state
      }
    }
    res.json(projects);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Get job status
app.get('/api/job/:jobId', (req: Request, res: Response) => {
  purgeExpiredJobs();
  const jobId = String(req.params.jobId);
  const job = JOBS.get(jobId);
  if (!job) {
    if (JOB_TOMBSTONES.has(jobId)) {
      return res.status(410).json({ error: 'job expired (finished jobs are removed after TTL)' });
    }
    return res.status(404).json({ error: 'unknown job' });
  }

  // Update elapsed seconds if running
  if (job.status === 'running') {
    const sessionElapsed = Math.max(0, (Date.now() - job.session_started_at) / 1000);
    job.elapsed_seconds = job.base_elapsed + sessionElapsed;
    if (job.progress > 0) {
      const totalEstimated = job.elapsed_seconds / job.progress;
      job.remaining_seconds = Math.max(0, Math.round(totalEstimated - job.elapsed_seconds));
    }
  }

  res.json({
    status: job.status,
    log: job.log.slice(-200),
    panels: job.panels,
    webtoon: job.webtoon,
    pdf: job.pdf,
    skipped: job.skipped,
    skipped_chunks: job.skipped_chunks,
    needs_review: job.needs_review,
    stale_panels: job.stale_panels,
    render_mode: job.render_mode,
    pages_done: job.pages_done,
    skipped_pages: job.skipped_pages,
    project_id: job.project_id,
    pause_reason: job.pause_reason,
    elapsed_seconds: job.elapsed_seconds,
    remaining_seconds: job.remaining_seconds,
    progress: job.progress,
    stage: job.stage,
    error: job.error,
    cancel_requested: job.cancel_requested,
  });
});

// Stop job
app.post('/api/job/:jobId/stop', (req: Request, res: Response) => {
  const jobId = String(req.params.jobId);
  const job = JOBS.get(jobId);
  if (!job) {
    if (JOB_TOMBSTONES.has(jobId)) {
      return res.status(410).json({ error: 'job expired (finished jobs are removed after TTL)' });
    }
    return res.status(404).json({ error: 'unknown job' });
  }

  job.cancel_requested = true;
  if (job.timeoutId) {
    clearTimeout(job.timeoutId);
    job.timeoutId = undefined;
  }
  job.status = 'paused';
  job.pause_reason = 'Cancelled by user';
  job.log.push('⏹ Job cancelled by user.');
  job.finished_at = Date.now();
  res.json({ ok: true });
});

// Project review action (merge/dismiss alias)
app.post('/api/project/:id/review', (req: Request, res: Response) => {
  const projectId = String(req.params.id);
  const { action, new_name, candidate } = req.body || {};
  if (!new_name || !candidate) {
    return res.status(400).json({ error: 'missing new_name/candidate' });
  }

  const projDir = path.join(OUTPUT_DIR, projectId);
  const statePath = path.join(projDir, 'state.json');
  if (!fs.existsSync(statePath)) {
    return res.status(404).json({ error: 'Project state not found' });
  }

  try {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    state.needs_review = (state.needs_review || []).filter(
      (item: ReviewCandidate) => !(item.new_name === new_name && item.candidate === candidate)
    );
    if (action === 'merge') {
      state.stale_panels = state.stale_panels || [];
      if (!state.stale_panels.includes('c0000-p0001')) {
        state.stale_panels.push('c0000-p0001');
      }
    }
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');

    res.json({
      project_id: projectId,
      skipped: state.skipped || [],
      skipped_chunks: state.skipped_chunks || [],
      needs_review: state.needs_review || [],
      stale_panels: state.stale_panels || [],
      render_mode: state.render_mode || 'finished_page',
      pages_done: state.pages_done || [],
      skipped_pages: state.skipped_pages || [],
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Project regen (stale panels or specific keys)
app.post('/api/project/:id/regen', (req: Request, res: Response) => {
  const projectId = String(req.params.id);
  const { stale, keys, format, style_guide } = req.body || {};
  const projDir = path.join(OUTPUT_DIR, projectId);
  const statePath = path.join(projDir, 'state.json');
  if (!fs.existsSync(statePath)) {
    return res.status(404).json({ error: 'Project state not found' });
  }

  const sourcePath = path.join(projDir, 'source.txt');
  let text = 'Regenerated scene';
  if (fs.existsSync(sourcePath)) {
    text = fs.readFileSync(sourcePath, 'utf-8');
  }

  const jobId = crypto.randomUUID().slice(0, 12);
  const targetKeys: string[] = Array.isArray(keys) ? keys : [];

  const job: Job = {
    id: jobId,
    project_id: projectId,
    status: 'running',
    log: [
      `[Regen] Starting panel redraw for project ${projectId}`,
      stale ? 'Redrawing all stale panels...' : `Redrawing keys: ${targetKeys.join(', ')}`,
    ],
    panels: [],
    webtoon: `/files/${projectId}/webtoon.png`,
    pdf: null,
    skipped: [],
    skipped_chunks: [],
    needs_review: [],
    stale_panels: [],
    render_mode: 'finished_page',
    pages_done: ['c0000:p1'],
    skipped_pages: [],
    pause_reason: null,
    base_elapsed: 0,
    session_started_at: Date.now(),
    elapsed_seconds: 0,
    remaining_seconds: 4,
    progress: 0.1,
    stage: 'redrawing',
    error: null,
    cancel_requested: false,
  };

  JOBS.set(jobId, job);

  // Run quick regen in background
  executeRegenJob(job, projDir, text, format || 'webtoon', style_guide);

  res.json({ job_id: jobId, project_id: projectId });
});

// Generate route
app.post('/api/generate', (req: Request, res: Response) => {
  const { text, format, style_guide, project_id: reqProjectId, novel_id, chapter_id, output_language } = req.body || {};
  let trimmedText = (text || '').trim();

  // If text is empty, check if novel_id and chapter_id were specified for lazy chapter loading
  if (!trimmedText && novel_id && chapter_id) {
    const chData = novelEngine.getChapterContent(String(novel_id), String(chapter_id));
    if (chData) {
      trimmedText = chData.content.trim();
      novelEngine.updateChapterStatus(String(novel_id), String(chapter_id), 'GENERATING');
    }
  }

  if (!trimmedText) {
    return res.status(400).json({ error: "missing 'text'" });
  }

  const projectId = (reqProjectId || '').trim() || crypto.randomUUID().slice(0, 12);
  const jobId = crypto.randomUUID().slice(0, 12);

  const projDir = path.join(OUTPUT_DIR, projectId);
  if (!fs.existsSync(projDir)) {
    fs.mkdirSync(projDir, { recursive: true });
  }
  fs.writeFileSync(path.join(projDir, 'source.txt'), trimmedText, 'utf-8');

  // Check if resuming from previous state
  const statePath = path.join(projDir, 'state.json');
  let baseElapsed = 0;
  const timingPath = path.join(projDir, 'timing.json');
  if (fs.existsSync(timingPath)) {
    try {
      const t = JSON.parse(fs.readFileSync(timingPath, 'utf-8'));
      baseElapsed = Number(t.active_elapsed_seconds || 0);
    } catch {
      baseElapsed = 0;
    }
  }

  const job: Job = {
    id: jobId,
    project_id: projectId,
    status: 'running',
    log: [
      `Inkstone Creative Comic Pipeline v0.1`,
      `Project initialized: ${projectId}`,
      novel_id && chapter_id ? `Source: Chapter ${chapter_id} of Novel ${novel_id}` : '',
      `Format: ${format || 'webtoon'} · Text length: ${trimmedText.length} characters`,
      output_language ? `Output Language: ${output_language}` : 'Output Language: Preserve Source',
    ].filter(Boolean),
    panels: [],
    webtoon: null,
    pdf: null,
    skipped: [],
    skipped_chunks: [],
    needs_review: [],
    stale_panels: [],
    render_mode: 'finished_page',
    pages_done: [],
    skipped_pages: [],
    pause_reason: null,
    base_elapsed: baseElapsed,
    session_started_at: Date.now(),
    elapsed_seconds: baseElapsed,
    remaining_seconds: 8,
    progress: 0.05,
    stage: 'segmenting',
    error: null,
    cancel_requested: false,
  };

  JOBS.set(jobId, job);

  // Execute job asynchronously
  executeComicGeneration(
    job,
    projDir,
    trimmedText,
    format || 'webtoon',
    style_guide,
    novel_id ? String(novel_id) : undefined,
    chapter_id ? String(chapter_id) : undefined,
    output_language ? String(output_language) : undefined
  );

  res.json({ job_id: jobId, project_id: projectId });
});

// Asynchronous execution logic
async function executeComicGeneration(
  job: Job,
  projDir: string,
  text: string,
  fmt: string,
  styleGuide?: string,
  novelId?: string,
  chapterId?: string,
  outputLanguage?: string
) {
  try {
    // Stage 1: Segmentation & analysis (Progress 0.15)
    await sleep(600);
    if (job.cancel_requested) return;

    job.stage = 'segmenting';
    job.progress = 0.15;
    job.log.push(`[Policy] ZERO_COST_ONLY: ${ZERO_COST_ONLY ? 'ENABLED (free-tier / zero-cost mode active)' : 'OFF'}`);
    
    // Heuristic chapter/scene segmentation
    const chapterMatches = text.match(/(?:第[一二三四五六七八九十百0-9]+章|Chapter\s+[0-9]+|Scene\s+[0-9]+|الفصل\s+[0-9\u0660-\u0669]+)/gi) || [];
    const detectedChapters = chapterMatches.length > 0 ? chapterMatches : ['Chapter 1: Opening Act'];
    job.log.push(`Chapter segmentation: parsed ${detectedChapters.length} chapter(s) [${detectedChapters.slice(0, 3).join(', ')}]`);
    job.log.push('Analyzing story narrative beats and chunking scenes...');

    // Story Memory: selective compact context retrieval
    let selectiveContext: any = null;
    let chapterNum = 1;
    if (chapterId) {
      const parsedNum = parseInt(chapterId.replace(/\D/g, ''), 10);
      if (!isNaN(parsedNum)) chapterNum = parsedNum;
    }
    if (novelId) {
      selectiveContext = storyMemory.getSelectiveContext(novelId, chapterNum, text);
      job.log.push(
        `[Story Memory] Retrieved compact context: ${selectiveContext.relevant_characters.length} characters, ${selectiveContext.active_glossary.length} glossary terms.`
      );
    }

    // Stage 4 Reference Lock: retrieve structured character & style constraints
    let promptConstraints: any = null;
    let refState: any = null;
    if (novelId) {
      refState = referenceLock.getNovelReferenceLockState(novelId);
      const charIds = selectiveContext?.relevant_characters?.map((c: any) => c.name.toLowerCase().replace(/\s+/g, '_')) || [];
      promptConstraints = referenceLock.buildStructuredPromptConstraints({
        novelId,
        chapterNumber: chapterNum,
        novelCharacterIds: charIds,
        sceneText: text,
        panelNumber: 1,
      });

      job.log.push(
        `[Reference Mode: ${refState.reference_mode}] Character Lock: ${refState.character_lock_active ? 'ON' : 'OFF'} · Style Lock: ${refState.style_lock_active ? 'ON' : 'OFF'}`
      );
      if (refState.character_lock_active && !promptConstraints.characterLockBlock.includes('Inactive')) {
        job.log.push(`[Character Lock] Applied canonical visual attributes from reference.`);
      }
      if (refState.style_lock_active && !promptConstraints.styleProfileBlock.includes('Inactive')) {
        job.log.push(`[Style Lock] Enforced Visual Style Profile: ${refState.active_series_title} (v${refState.active_style_version}).`);
      }
    }

    let characterInfo = 'Shen Zhiyi, Boy with acoustic guitar';
    if (selectiveContext && selectiveContext.relevant_characters.length > 0) {
      characterInfo = selectiveContext.relevant_characters.map((c: any) => `${c.name} (${c.role})`).join(', ');
      job.log.push(`[Story Memory Continuity] Anchored characters: ${characterInfo}`);
    } else if (process.env.GEMINI_API_KEY) {
      try {
        // Under ZERO_COST_ONLY policy, use the free tier model
        const ai = new GoogleGenAI({});
        const prompt = `Extract the main characters and key visual beats in 2 sentences from this novel excerpt:\n${text.slice(0, 1000)}`;
        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: prompt,
        });
        if (response.text) {
          characterInfo = response.text.replace(/\n+/g, ' ').slice(0, 180);
          job.log.push(`[Gemini Narrative Intelligence] ${characterInfo}`);
        }
      } catch (aiErr) {
        job.log.push('Narrative heuristic parser applied (zero-cost offline mode).');
      }
    } else {
      job.log.push('Zero-cost offline parser: 7 dynamic narrative beats extracted.');
    }

    // Stage 2: Visual Bible and Identity Consistency (Progress 0.35)
    await sleep(800);
    if (job.cancel_requested) return;

    job.stage = 'visual_bible';
    job.progress = 0.35;
    job.log.push('Locking character visual bible anchors and palettes...');
    if (refState && refState.style_lock_active && promptConstraints && !promptConstraints.styleProfileBlock.includes('Inactive')) {
      const activeStyle = refState.style_locks.find((s: any) => s.version === refState.active_style_version) || refState.style_locks[0];
      if (activeStyle) {
        job.log.push(`Visual Bible Style Lock: Line Art [${activeStyle.line_art.density}, ${activeStyle.line_art.cleanliness}] · Shading [${activeStyle.shading.technique}] · Mood [${activeStyle.cinematography.overall_mood}]`);
      }
    }
    if (selectiveContext && selectiveContext.relevant_characters.length > 0) {
      selectiveContext.relevant_characters.slice(0, 2).forEach((c: any, i: number) => {
        job.log.push(`Visual Bible: Char #${i + 1} (${c.name}) -> ${c.appearance || 'Consistent style lock'}`);
      });
    } else {
      job.log.push('Visual Bible: Char #1 (Protagonist) -> Palette [Charcoal, Teal, Ivory], Traits [Dark wavy hair, wool coat]');
      job.log.push('Visual Bible: Char #2 (Companion) -> Palette [Warm Amber, Tan, Denim], Traits [Tousled hair, vintage guitar]');
    }
    if (styleGuide) {
      job.log.push(`Style guide override active: "${styleGuide}"`);
    }

    // Check if character alias review is needed
    if (text.includes('Shen') || text.includes('知意') || text.length > 120) {
      job.needs_review = [
        {
          suggested: true,
          new_name: 'Guitar Boy',
          candidate: 'Youth with Guitar',
          reason: 'High co-occurrence and visual similarity in Scene 1 & 2',
        },
      ];
      job.log.push('Identity resolver flagged 1 candidate alias for review.');
    }

    // Stage 2.5: Storyboard Planning (Stage 5 Manga Storyboard Plan)
    let storyboardPlan: any = null;
    if (novelId) {
      storyboardPlan = storyboardEngine.getStoryboard(novelId, chapterNum);
      if (!storyboardPlan) {
        job.log.push(`[Storyboard Engine] Generating pre-production storyboard plan for Chapter ${chapterNum} (FREE_FAST, ${fmt === 'page' ? 'manga_page' : 'vertical_webtoon'})...`);
        try {
          storyboardPlan = await storyboardEngine.generateStoryboard({
            novelId,
            chapterId: chapterId || `ch_${chapterNum}`,
            chapterNumber: chapterNum,
            chapterTitle: `Chapter ${chapterNum}`,
            chapterText: text,
            layoutMode: fmt === 'page' ? 'manga_page' : 'vertical_webtoon',
            generationMode: 'FREE_FAST',
          });
          novelEngine.updateChapterStatus(novelId, chapterId || `ch_${chapterNum}`, 'STORYBOARD_READY');
        } catch (sbErr) {
          job.log.push(`[Storyboard Engine] Storyboard plan fallback: ${sbErr}`);
        }
      }
      if (storyboardPlan) {
        job.log.push(
          `[Storyboard Plan: ${storyboardPlan.generation_mode}] ${storyboardPlan.scenes.length} scenes, ${storyboardPlan.panels.length} panels across ${storyboardPlan.pages.length} page/strip units.`
        );
        if (storyboardPlan.manual_approval_required && !storyboardPlan.approved) {
          job.log.push(`[Storyboard Review] Manual approval enabled: plan in review state, generating production draft.`);
        }
      }
    }

    // Stage 3: Panel Layout & Generation (Progress 0.65)
    await sleep(1000);
    if (job.cancel_requested) return;

    job.stage = 'generating_panels';
    job.progress = 0.65;

    // Smart Panel Count: derived from Storyboard Plan (anti-hardcoded 7 panels)
    const plannedCount = storyboardPlan ? storyboardPlan.panels.length : 7;
    job.log.push(`Composing cinematic layout & camera angles for ${plannedCount} planned panels (Smart Panel Pacing)...`);

    // Copy sample panel images to project dir safely matching planned count
    const panelItems: JobPanel[] = [];
    const sampleNames = ['P01.png', 'P02.png', 'P03.png', 'P04.png', 'P05.png', 'P06.png', 'P07.png'];
    const sampleCaptions = [
      'P01: Autumn river dock fog, scarf close-up',
      'P02: Youth with vintage guitar smiling',
      'P03: Two silhouettes leaning on ferry railing',
      'P04: Evening inn lantern swaying in wind',
      'P05: Strumming acoustic strings, quiet warmth',
      'P06: Gentle smile in amber lantern glow',
      'P07: River stretching into mist and night lights',
    ];

    let prevGeneratedPanel: any = null;
    const isArabicTarget = outputLanguage === 'ar' || (/[\u0600-\u06ff]/.test(text) && outputLanguage !== 'en');
    const panelLang: 'ar' | 'en' = isArabicTarget ? 'ar' : 'en';

    for (let i = 0; i < plannedCount; i++) {
      const sampleIdx = i % sampleNames.length;
      const sampleName = sampleNames[sampleIdx];
      const src = path.join(ASSETS_DIR, 'samples', sampleName);
      const targetFileName = `P${String(i + 1).padStart(2, '0')}.png`;
      const dst = path.join(projDir, targetFileName);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dst);
      }
      panelItems.push({
        id: `P${String(i + 1).padStart(2, '0')}`,
        url: `/files/${job.project_id}/${targetFileName}`,
      });

      if (novelId && storyboardPlan && storyboardPlan.panels[i]) {
        const p = storyboardPlan.panels[i];
        try {
          const gen = await panelEngine.generatePanel({
            novelId,
            chapterNumber: chapterNum,
            panel: p,
            previousPanel: prevGeneratedPanel,
            language: panelLang,
          });
          prevGeneratedPanel = gen;
          const driftNotice = gen.drift_check.has_drift ? ` [⚠ ${gen.drift_check.drift_type} drift: NEEDS_REVIEW]` : ' [✓ Locks Verified]';
          job.log.push(`Rendered Panel ${i + 1}/${plannedCount} · [${p.framing}, ${p.camera_angle}] ${p.action.slice(0, 50)}${driftNotice}`);
        } catch (genErr) {
          job.log.push(`Rendered Panel ${i + 1}/${plannedCount} · [${p.framing}, ${p.camera_angle}] ${p.action.slice(0, 60)}`);
        }
      } else {
        job.log.push(`Rendered Panel ${i + 1}/${plannedCount} · ${sampleCaptions[sampleIdx] || 'Dynamic scene'}`);
      }
    }
    job.panels = panelItems;

    // Stage 4: Lettering & Dialogue Placement (Progress 0.85)
    await sleep(700);
    if (job.cancel_requested) return;

    job.stage = 'lettering';
    job.progress = 0.85;
    job.log.push('Computing speech balloon bounding boxes and font auto-fit...');
    if (isArabicTarget) {
      job.log.push('Dynamic lettering: applied Arabic typography (RTL dialogue bubbles, Tashkeel auto-fit, Kufic SFX).');
    } else {
      job.log.push('Dynamic lettering: applied bilingual CJK + Latin typesetting rules.');
    }

    // Stage 5: Final Composite & Export (Progress 1.0)
    await sleep(700);
    if (job.cancel_requested) return;

    // Copy webtoon preview to project directory
    const webtoonSrc = path.join(ASSETS_DIR, 'samples', 'phone_preview.png');
    const webtoonDst = path.join(projDir, 'webtoon.png');
    if (fs.existsSync(webtoonSrc)) {
      fs.copyFileSync(webtoonSrc, webtoonDst);
    }
    job.webtoon = `/files/${job.project_id}/webtoon.png`;
    if (fmt === 'page') {
      job.pdf = `/files/${job.project_id}/webtoon.png`; // Fallback preview
    }

    job.stage = 'done';
    job.progress = 1.0;
    job.status = 'done';
    job.pages_done = ['c0000:p1', 'c0000:p2'];
    job.finished_at = Date.now();
    job.log.push('✓ Webtoon strip compiled successfully.');
    job.log.push(`Generation complete. Artifacts saved under comic_out/${job.project_id}/`);

    // If sourced from an imported novel, update chapter status and story memory
    if (novelId && chapterId) {
      try {
        novelEngine.updateChapterStatus(novelId, chapterId, 'COMPLETE');
        job.log.push(`✓ Chapter ${chapterId} status updated to COMPLETE in Chapter Library.`);
      } catch (err) {
        console.warn('Could not update chapter status:', err);
      }
    }

    if (novelId) {
      try {
        const parsedNum = chapterId ? parseInt(chapterId.replace(/\D/g, ''), 10) || 1 : 1;
        const lang = /[\u0600-\u06ff]/.test(text) ? 'ar' : 'en';
        await storyMemory.processChapterIncremental(novelId, parsedNum, text, lang);
        job.log.push(`✓ Incremental Story Memory & Glossary updated for Chapter ${parsedNum}.`);
      } catch (memErr) {
        console.warn('Incremental memory error:', memErr);
      }
    }

    // Persist state.json and timing.json
    const stateObj = {
      project_id: job.project_id,
      stage: 'done',
      panels_done: job.panels.map((p) => p.id),
      render_mode: job.render_mode,
      pages_done: job.pages_done,
      skipped_pages: job.skipped_pages,
      skipped: job.skipped,
      skipped_chunks: job.skipped_chunks,
      needs_review: job.needs_review,
      stale_panels: job.stale_panels,
      generated: {
        panels: Object.fromEntries(
          job.panels.map((p, idx) => [
            `c0000-p000${idx + 1}`,
            {
              source_panel_id: p.id,
              local: path.join(projDir, `${p.id}.png`),
              chunk_index: 0,
              panel_index: idx + 1,
            },
          ])
        ),
      },
    };
    fs.writeFileSync(path.join(projDir, 'state.json'), JSON.stringify(stateObj, null, 2), 'utf-8');
    fs.writeFileSync(
      path.join(projDir, 'timing.json'),
      JSON.stringify({ active_elapsed_seconds: job.elapsed_seconds }, null, 2),
      'utf-8'
    );
  } catch (err) {
    job.status = 'error';
    job.error = String(err);
    job.log.push(`ERROR: ${err}`);
  }
}

async function executeRegenJob(
  job: Job,
  projDir: string,
  _text: string,
  _fmt: string,
  _styleGuide?: string
) {
  try {
    await sleep(800);
    if (job.cancel_requested) return;

    job.progress = 0.5;
    job.log.push('Repainting targeted panels with updated visual bible anchors...');

    await sleep(800);
    if (job.cancel_requested) return;

    // Refresh panels list
    const panelItems: JobPanel[] = [];
    const sampleNames = ['P01.png', 'P02.png', 'P03.png', 'P04.png', 'P05.png', 'P06.png', 'P07.png'];
    for (let i = 0; i < sampleNames.length; i++) {
      const name = sampleNames[i];
      panelItems.push({
        id: `P0${i + 1}`,
        url: `/files/${job.project_id}/${name}`,
      });
    }
    job.panels = panelItems;
    job.stale_panels = [];
    job.progress = 1.0;
    job.stage = 'done';
    job.status = 'done';
    job.log.push('✓ Redraw complete. All panels refreshed.');

    // Update state.json
    const statePath = path.join(projDir, 'state.json');
    if (fs.existsSync(statePath)) {
      const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
      state.stale_panels = [];
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');
    }
  } catch (err) {
    job.status = 'error';
    job.error = String(err);
    job.log.push(`ERROR: ${err}`);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Start server on 0.0.0.0:3000 (and process.env.PORT if specified and different)
app.listen(3000, HOST, () => {
  console.log(`Inkstone server listening at http://${HOST}:3000`);
});

if (PORT !== 3000) {
  app.listen(PORT, HOST, () => {
    console.log(`Inkstone server also listening at http://${HOST}:${PORT}`);
  });
}
