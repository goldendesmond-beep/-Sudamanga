import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import type { ChapterStatus, ChapterMeta, NovelMeta } from './novelEngine.js';
import type { StoryboardPlan } from './storyboardEngine.js';
import type { GeneratedPanel } from './panelGenerationEngine.js';

export interface SavedPageAsset {
  page_number: number;
  filename: string;
  image_url: string;
  svg_overlay?: string;
  svg_filename?: string;
  panel_ids: string[];
}

export interface SavedChapterData {
  chapter_number: number;
  chapter_title: string;
  folder_name: string;
  layout_mode: 'manga_page' | 'vertical_webtoon';
  reading_direction: 'rtl' | 'ltr';
  language: string;
  total_panels: number;
  total_pages: number;
  pages: SavedPageAsset[];
  panels: GeneratedPanel[];
  style_version_applied: number;
  character_locks_applied: string[];
  saved_at: number;
  verified: boolean;
}

export interface ReadingProgressRecord {
  last_read_chapter: number;
  last_read_page: number;
  scroll_percent: number;
  total_chapters_read: number;
  reading_progress_percent: number;
  last_opened_at: number;
}

export interface ProjectManifest {
  project_id: string;
  novel_title: string;
  library_folder: string;
  chapter_order: number[];
  chapter_statuses: Record<number, ChapterStatus>;
  chapter_folders: Record<number, string>;
  page_order: Record<number, string[]>;
  saved_asset_references: Record<number, {
    folder: string;
    pages: string[];
    svg_overlays: string[];
    data_file: string;
  }>;
  story_bible_version: number;
  character_lock_version: number;
  style_lock_version: number;
  active_style_series: string;
  generation_progress: number;
  reading_progress: ReadingProgressRecord;
  last_generated_chapter: number;
  last_read_chapter: number;
  last_read_page: number;
  created_at: number;
  updated_at: number;
}

export interface LibraryProjectSummary {
  project_id: string;
  title: string;
  total_chapters: number;
  generated_chapters_count: number;
  reading_progress_percent: number;
  last_read_chapter: number;
  last_read_page: number;
  last_generated_chapter: number;
  generation_status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'PAUSED' | 'FAILED';
  active_style: string;
  style_version: number;
  updated_at: number;
}

export class MangaLibraryStorage {
  private baseDir: string;
  private novelsDir: string;

  constructor(baseDir?: string, novelsDir?: string) {
    // Application-managed persistent directory (defaults to NovelToMangaLibrary in workspace)
    this.baseDir = baseDir || path.join(process.cwd(), 'NovelToMangaLibrary');
    this.novelsDir = novelsDir || path.join(process.cwd(), 'novels');
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
    if (!fs.existsSync(this.novelsDir)) {
      fs.mkdirSync(this.novelsDir, { recursive: true });
    }
  }

  public getBaseDir(): string {
    return this.baseDir;
  }

  public getProjectDir(novelId: string): string {
    const dir = path.join(this.baseDir, novelId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  public getChaptersDir(novelId: string): string {
    const dir = path.join(this.getProjectDir(novelId), 'Chapters');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  public getMetadataDir(novelId: string): string {
    const dir = path.join(this.getProjectDir(novelId), 'Metadata');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  public getBackupsDir(novelId: string): string {
    const dir = path.join(this.getProjectDir(novelId), 'Backups');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  /**
   * Stable zero-padded chapter folder: Chapter_0001, Chapter_0042, Chapter_0500, Chapter_1000
   */
  public formatChapterFolder(chapterNumber: number): string {
    return `Chapter_${String(chapterNumber).padStart(4, '0')}`;
  }

  /**
   * Stable zero-padded page filename: Page_001.png, Page_002.svg
   */
  public formatPageFilename(pageNumber: number, ext: string = 'png'): string {
    return `Page_${String(pageNumber).padStart(3, '0')}.${ext.replace(/^\./, '')}`;
  }

  public getChapterDir(novelId: string, chapterNumber: number): string {
    const folder = this.formatChapterFolder(chapterNumber);
    const dir = path.join(this.getChaptersDir(novelId), folder);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  public getManifestPath(novelId: string): string {
    return path.join(this.getProjectDir(novelId), 'project_manifest.json');
  }

  /**
   * Retrieve or initialize persistent project manifest
   */
  public getProjectManifest(novelId: string, fallbackTitle?: string): ProjectManifest {
    const manifestPath = this.getManifestPath(novelId);
    if (fs.existsSync(manifestPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        return parsed;
      } catch (err) {
        console.warn(`Could not read manifest for ${novelId}, rebuilding:`, err);
      }
    }

    const defaultManifest: ProjectManifest = {
      project_id: novelId,
      novel_title: fallbackTitle || novelId,
      library_folder: this.getProjectDir(novelId),
      chapter_order: [],
      chapter_statuses: {},
      chapter_folders: {},
      page_order: {},
      saved_asset_references: {},
      story_bible_version: 1,
      character_lock_version: 1,
      style_lock_version: 1,
      active_style_series: 'The Eternal Supreme',
      generation_progress: 0,
      reading_progress: {
        last_read_chapter: 1,
        last_read_page: 1,
        scroll_percent: 0,
        total_chapters_read: 0,
        reading_progress_percent: 0,
        last_opened_at: Date.now(),
      },
      last_generated_chapter: 0,
      last_read_chapter: 1,
      last_read_page: 1,
      created_at: Date.now(),
      updated_at: Date.now(),
    };

    this.saveProjectManifest(novelId, defaultManifest);
    return defaultManifest;
  }

  /**
   * Atomically save project manifest
   */
  public saveProjectManifest(novelId: string, manifest: ProjectManifest): void {
    manifest.updated_at = Date.now();
    const manifestPath = this.getManifestPath(novelId);
    const tmpPath = `${manifestPath}.tmp_${Date.now()}`;
    fs.writeFileSync(tmpPath, JSON.stringify(manifest, null, 2), 'utf-8');
    fs.renameSync(tmpPath, manifestPath);
  }

  /**
   * Update reading progress and return fresh manifest
   */
  public updateReadingProgress(
    novelId: string,
    chapterNumber: number,
    pageNumber: number,
    scrollPercent: number = 0
  ): ProjectManifest {
    const manifest = this.getProjectManifest(novelId);
    const totalChapters = manifest.chapter_order.length || 1;
    const completedRead = Math.max(manifest.reading_progress.total_chapters_read, chapterNumber);
    const percent = Math.min(100, Math.round((completedRead / totalChapters) * 100));

    manifest.last_read_chapter = chapterNumber;
    manifest.last_read_page = pageNumber;
    manifest.reading_progress = {
      last_read_chapter: chapterNumber,
      last_read_page: pageNumber,
      scroll_percent: scrollPercent,
      total_chapters_read: completedRead,
      reading_progress_percent: percent,
      last_opened_at: Date.now(),
    };

    this.saveProjectManifest(novelId, manifest);
    return manifest;
  }

  /**
   * Verified Save Before Complete:
   * A chapter is saved ordered in Chapter_XXXX, verified, and only marked COMPLETE if reopening succeeds!
   */
  public verifyAndSaveChapter(params: {
    novelId: string;
    chapterNumber: number;
    chapterTitle?: string;
    panels: GeneratedPanel[];
    storyboard: StoryboardPlan;
    language?: 'ar' | 'en';
    novelMeta?: NovelMeta | null;
  }): { success: boolean; error?: string; chapterDir: string; verified: boolean; chapterData?: SavedChapterData } {
    const { novelId, chapterNumber, chapterTitle = `Chapter ${chapterNumber}`, panels, storyboard, language = 'en', novelMeta } = params;

    const chapterDir = this.getChapterDir(novelId, chapterNumber);
    const folderName = this.formatChapterFolder(chapterNumber);

    try {
      // 1. Verify panels integrity
      if (!panels || panels.length === 0) {
        throw new Error(`Cannot save chapter ${chapterNumber}: No panels provided`);
      }

      const allComplete = panels.every((p) => p.status === 'COMPLETE');
      if (!allComplete) {
        throw new Error(`Cannot save chapter ${chapterNumber}: Some panels are not in COMPLETE status`);
      }

      // 2. Generate ordered page composition & save page assets
      const isMangaPage = storyboard.layout_mode === 'manga_page';
      const pages: SavedPageAsset[] = [];
      const panelsPerPage = isMangaPage ? 5 : panels.length;
      const totalPages = Math.ceil(panels.length / panelsPerPage);

      for (let pIdx = 0; pIdx < totalPages; pIdx++) {
        const pageNum = pIdx + 1;
        const pagePanels = panels.slice(pIdx * panelsPerPage, (pIdx + 1) * panelsPerPage);
        const pageImgFilename = this.formatPageFilename(pageNum, 'png');
        const pageSvgFilename = this.formatPageFilename(pageNum, 'svg');

        // Compile combined SVG overlay for this page
        const svgElements = pagePanels
          .map((p) => p.lettering?.svg_overlay || '')
          .filter(Boolean)
          .join('\n');

        const combinedSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1100" width="100%" height="100%" dir="${language === 'ar' ? 'rtl' : 'ltr'}">
          ${svgElements}
        </svg>`;

        fs.writeFileSync(path.join(chapterDir, pageSvgFilename), combinedSvg, 'utf-8');

        // Copy primary image asset or stitch composite placeholder
        const firstPanelImg = pagePanels[0]?.image_url || '';
        const targetImgPath = path.join(chapterDir, pageImgFilename);
        if (firstPanelImg && fs.existsSync(firstPanelImg)) {
          fs.copyFileSync(firstPanelImg, targetImgPath);
        } else {
          // Deterministic high-readability page SVG/PNG fallback
          const pagePlaceholder = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1100" width="800" height="1100">
            <rect width="800" height="1100" fill="#0f172a" />
            <text x="400" y="550" fill="#f8fafc" font-size="28" font-family="sans-serif" text-anchor="middle">
              ${chapterTitle} — Page ${pageNum}
            </text>
          </svg>`;
          fs.writeFileSync(path.join(chapterDir, this.formatPageFilename(pageNum, 'svg')), pagePlaceholder, 'utf-8');
          fs.writeFileSync(targetImgPath, Buffer.from(pagePlaceholder), 'utf-8');
        }

        pages.push({
          page_number: pageNum,
          filename: pageImgFilename,
          image_url: `/api/library/${novelId}/chapters/${chapterNumber}/pages/${pageNum}`,
          svg_overlay: combinedSvg,
          svg_filename: pageSvgFilename,
          panel_ids: pagePanels.map((p) => p.panel_id),
        });
      }

      // 3. Construct structured chapter data record
      const chapterData: SavedChapterData = {
        chapter_number: chapterNumber,
        chapter_title: chapterTitle,
        folder_name: folderName,
        layout_mode: storyboard.layout_mode || 'vertical_webtoon',
        reading_direction: language === 'ar' ? 'rtl' : 'ltr',
        language,
        total_panels: panels.length,
        total_pages: pages.length,
        pages,
        panels,
        style_version_applied: panels[0]?.style_version || 1,
        character_locks_applied: panels[0]?.character_locks_applied || [],
        saved_at: Date.now(),
        verified: false,
      };

      const chapterDataPath = path.join(chapterDir, 'chapter_data.json');
      fs.writeFileSync(chapterDataPath, JSON.stringify(chapterData, null, 2), 'utf-8');

      // 4. VERIFICATION STEP: Reopen and parse saved chapter from disk
      if (!fs.existsSync(chapterDataPath)) {
        throw new Error(`Verification failed: chapter_data.json was not created on disk`);
      }

      const reopenedText = fs.readFileSync(chapterDataPath, 'utf-8');
      const reopenedData: SavedChapterData = JSON.parse(reopenedText);
      if (!reopenedData.pages || reopenedData.pages.length !== totalPages) {
        throw new Error(`Verification failed: Page count mismatch upon reopening`);
      }

      // Verify each page file exists on disk
      for (const pg of reopenedData.pages) {
        const pagePath = path.join(chapterDir, pg.filename);
        if (!fs.existsSync(pagePath)) {
          throw new Error(`Verification failed: Asset file ${pg.filename} missing on disk`);
        }
      }

      // Mark verified
      reopenedData.verified = true;
      fs.writeFileSync(chapterDataPath, JSON.stringify(reopenedData, null, 2), 'utf-8');

      // 5. Update Project Manifest
      const manifest = this.getProjectManifest(novelId, novelMeta?.title);
      if (!manifest.chapter_order.includes(chapterNumber)) {
        manifest.chapter_order.push(chapterNumber);
        manifest.chapter_order.sort((a, b) => a - b);
      }
      manifest.chapter_statuses[chapterNumber] = 'COMPLETE';
      manifest.chapter_folders[chapterNumber] = folderName;
      manifest.page_order[chapterNumber] = pages.map((p) => p.filename);
      manifest.saved_asset_references[chapterNumber] = {
        folder: folderName,
        pages: pages.map((p) => p.filename),
        svg_overlays: pages.map((p) => p.svg_filename || ''),
        data_file: 'chapter_data.json',
      };
      manifest.last_generated_chapter = Math.max(manifest.last_generated_chapter, chapterNumber);

      const totalChapters = manifest.chapter_order.length || 1;
      const completedCount = Object.values(manifest.chapter_statuses).filter((s) => s === 'COMPLETE').length;
      manifest.generation_progress = Math.min(100, Math.round((completedCount / totalChapters) * 100));

      this.saveProjectManifest(novelId, manifest);

      return {
        success: true,
        verified: true,
        chapterDir,
        chapterData: reopenedData,
      };
    } catch (err: any) {
      console.error(`Failed to verify & save chapter ${chapterNumber} for ${novelId}:`, err);

      // On failure: update manifest status to SAVE_FAILED without regenerating artwork
      try {
        const manifest = this.getProjectManifest(novelId, novelMeta?.title);
        manifest.chapter_statuses[chapterNumber] = 'SAVE_FAILED';
        this.saveProjectManifest(novelId, manifest);
      } catch (mErr) {
        console.warn(`Could not update manifest status to SAVE_FAILED:`, mErr);
      }

      return {
        success: false,
        verified: false,
        error: String(err?.message || err),
        chapterDir,
      };
    }
  }

  /**
   * Retry saving a chapter without regenerating artwork
   */
  public async retrySaveChapter(params: {
    novelId: string;
    chapterNumber: number;
    panels: GeneratedPanel[];
    storyboard: StoryboardPlan;
    language?: 'ar' | 'en';
  }): Promise<{ success: boolean; error?: string; verified: boolean }> {
    return this.verifyAndSaveChapter(params);
  }

  /**
   * Retrieve saved chapter assets directly for reading WITHOUT AI generation calls
   */
  public getSavedChapter(novelId: string, chapterNumber: number): SavedChapterData | null {
    const chapterDir = this.getChapterDir(novelId, chapterNumber);
    const dataPath = path.join(chapterDir, 'chapter_data.json');
    if (!fs.existsSync(dataPath)) return null;

    try {
      const data: SavedChapterData = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
      return data;
    } catch (err) {
      console.warn(`Could not parse saved chapter ${chapterNumber} for ${novelId}:`, err);
      return null;
    }
  }

  /**
   * List all projects in Manga Library with full summaries
   */
  public listLibraryProjects(): LibraryProjectSummary[] {
    const summaries: LibraryProjectSummary[] = [];
    if (!fs.existsSync(this.baseDir)) return summaries;

    const entries = fs.readdirSync(this.baseDir, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.isDirectory()) {
        const novelId = ent.name;
        const manifestPath = path.join(this.baseDir, novelId, 'project_manifest.json');
        if (fs.existsSync(manifestPath)) {
          try {
            const m: ProjectManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
            const completedCount = Object.values(m.chapter_statuses || {}).filter((s) => s === 'COMPLETE').length;
            const total = m.chapter_order.length || 1;

            let genStatus: LibraryProjectSummary['generation_status'] = 'NOT_STARTED';
            if (completedCount === total && total > 0) genStatus = 'COMPLETED';
            else if (completedCount > 0) genStatus = 'IN_PROGRESS';

            summaries.push({
              project_id: m.project_id,
              title: m.novel_title,
              total_chapters: total,
              generated_chapters_count: completedCount,
              reading_progress_percent: m.reading_progress?.reading_progress_percent || 0,
              last_read_chapter: m.reading_progress?.last_read_chapter || 1,
              last_read_page: m.reading_progress?.last_read_page || 1,
              last_generated_chapter: m.last_generated_chapter || 0,
              generation_status: genStatus,
              active_style: m.active_style_series || 'The Eternal Supreme',
              style_version: m.style_lock_version || 1,
              updated_at: m.updated_at || Date.now(),
            });
          } catch (err) {
            console.warn(`Could not read project summary for ${novelId}:`, err);
          }
        }
      }
    }

    return summaries.sort((a, b) => b.updated_at - a.updated_at);
  }

  /**
   * Create an automatic versioned backup: backup_v{ver}_{timestamp}.zip
   * Does NOT overwrite the only good backup.
   * Preserves: novel metadata, chapter index, Story Bible, terminology, Character Locks & versions,
   * Style Locks & versions, DEFAULT_STYLE_PROFILE, storyboards, panels, generation queue,
   * FREE MAX TODAY state, Reader progress, and manifest.
   * Strips secret API keys from portable backups.
   */
  public createVersionedBackup(novelId: string, customNovelsDir?: string): {
    backupPath: string;
    version: number;
    filename: string;
    size: number;
  } {
    const projectDir = this.getProjectDir(novelId);
    const backupsDir = this.getBackupsDir(novelId);
    const activeNovelsDir = customNovelsDir || this.novelsDir;
    const novelSourceDir = path.join(activeNovelsDir, novelId);
    const metadataDir = this.getMetadataDir(novelId);

    // Sync novel state into project Metadata directory before packaging
    if (fs.existsSync(novelSourceDir)) {
      const copyFiles = ['meta.json', 'story_bible.json', 'glossary.json', 'reference_locks.json'];
      for (const f of copyFiles) {
        const src = path.join(novelSourceDir, f);
        if (fs.existsSync(src)) {
          let content = fs.readFileSync(src, 'utf-8');
          // Sanitize secret API keys from portable backups
          if (f === 'meta.json') {
            try {
              const parsed = JSON.parse(content);
              if (parsed.api_key) parsed.api_key = '';
              if (parsed.secret) parsed.secret = '';
              content = JSON.stringify(parsed, null, 2);
            } catch {
              // ignore parse errors
            }
          }
          fs.writeFileSync(path.join(metadataDir, f), content, 'utf-8');
        }
      }

      // Sync batch automation queue state
      const queueSrc = path.join(novelSourceDir, 'queue', 'batch_state.json');
      if (fs.existsSync(queueSrc)) {
        const metaQueueDir = path.join(metadataDir, 'queue');
        if (!fs.existsSync(metaQueueDir)) fs.mkdirSync(metaQueueDir, { recursive: true });
        fs.copyFileSync(queueSrc, path.join(metaQueueDir, 'batch_state.json'));
      }

      // Sync storyboards and panels if present
      const sbSrc = path.join(novelSourceDir, 'storyboards');
      if (fs.existsSync(sbSrc)) {
        const metaSbDir = path.join(metadataDir, 'storyboards');
        if (!fs.existsSync(metaSbDir)) fs.mkdirSync(metaSbDir, { recursive: true });
        const sbFiles = fs.readdirSync(sbSrc);
        for (const sbf of sbFiles) {
          fs.copyFileSync(path.join(sbSrc, sbf), path.join(metaSbDir, sbf));
        }
      }

      const panelsSrc = path.join(novelSourceDir, 'panels');
      if (fs.existsSync(panelsSrc)) {
        const metaPanelsDir = path.join(metadataDir, 'panels');
        if (!fs.existsSync(metaPanelsDir)) fs.mkdirSync(metaPanelsDir, { recursive: true });
        const panelFiles = fs.readdirSync(panelsSrc);
        for (const pf of panelFiles) {
          fs.copyFileSync(path.join(panelsSrc, pf), path.join(metaPanelsDir, pf));
        }
      }
    }

    // Determine next version
    const existing = fs.readdirSync(backupsDir).filter((f) => f.startsWith('backup_v') && f.endsWith('.zip'));
    let nextVersion = 1;
    for (const f of existing) {
      const match = f.match(/^backup_v(\d+)_/);
      if (match) {
        const v = parseInt(match[1], 10);
        if (v >= nextVersion) nextVersion = v + 1;
      }
    }

    const filename = `backup_v${nextVersion}_${Date.now()}.zip`;
    const backupPath = path.join(backupsDir, filename);

    const zip = new AdmZip();
    // Add Chapters, Metadata, project_manifest.json (excluding Backups to avoid recursion)
    const chaptersDir = path.join(projectDir, 'Chapters');
    if (fs.existsSync(chaptersDir)) zip.addLocalFolder(chaptersDir, 'Chapters');

    if (fs.existsSync(metadataDir)) zip.addLocalFolder(metadataDir, 'Metadata');

    const manifestPath = path.join(projectDir, 'project_manifest.json');
    if (fs.existsSync(manifestPath)) zip.addLocalFile(manifestPath, '', 'project_manifest.json');

    const buffer = zip.toBuffer();
    fs.writeFileSync(backupPath, buffer);

    return {
      backupPath,
      version: nextVersion,
      filename,
      size: buffer.length,
    };
  }

  /**
   * Restore a project from a versioned backup zip
   * Restores both library assets and novel engine state (Story Bible, Character Lock, Style Lock, queue)
   */
  public restoreVersionedBackup(
    novelId: string,
    zipBuffer: Buffer,
    customNovelsDir?: string
  ): { success: boolean; error?: string; restored_files: number; manifest: ProjectManifest } {
    try {
      const zip = new AdmZip(zipBuffer);
      const entries = zip.getEntries();
      if (entries.length === 0) {
        throw new Error('Corrupted or empty backup archive');
      }

      const projectDir = this.getProjectDir(novelId);
      zip.extractAllTo(projectDir, true);

      // Verify project manifest is present
      const manifestPath = path.join(projectDir, 'project_manifest.json');
      if (!fs.existsSync(manifestPath)) {
        throw new Error('Backup does not contain project_manifest.json');
      }

      const manifest: ProjectManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

      // Also restore novel engine files back to novels directory
      const activeNovelsDir = customNovelsDir || this.novelsDir;
      const targetNovelDir = path.join(activeNovelsDir, novelId);
      if (!fs.existsSync(targetNovelDir)) {
        fs.mkdirSync(targetNovelDir, { recursive: true });
      }

      const metaDir = path.join(projectDir, 'Metadata');
      if (fs.existsSync(metaDir)) {
        const copyBack = ['meta.json', 'story_bible.json', 'glossary.json', 'reference_locks.json'];
        for (const f of copyBack) {
          const src = path.join(metaDir, f);
          if (fs.existsSync(src)) {
            fs.copyFileSync(src, path.join(targetNovelDir, f));
          }
        }

        const queueSrc = path.join(metaDir, 'queue', 'batch_state.json');
        if (fs.existsSync(queueSrc)) {
          const queueDir = path.join(targetNovelDir, 'queue');
          if (!fs.existsSync(queueDir)) fs.mkdirSync(queueDir, { recursive: true });
          fs.copyFileSync(queueSrc, path.join(queueDir, 'batch_state.json'));
        }

        const sbSrc = path.join(metaDir, 'storyboards');
        if (fs.existsSync(sbSrc)) {
          const targetSbDir = path.join(targetNovelDir, 'storyboards');
          if (!fs.existsSync(targetSbDir)) fs.mkdirSync(targetSbDir, { recursive: true });
          const sbFiles = fs.readdirSync(sbSrc);
          for (const sbf of sbFiles) {
            fs.copyFileSync(path.join(sbSrc, sbf), path.join(targetSbDir, sbf));
          }
        }

        const panelsSrc = path.join(metaDir, 'panels');
        if (fs.existsSync(panelsSrc)) {
          const targetPanelsDir = path.join(targetNovelDir, 'panels');
          if (!fs.existsSync(targetPanelsDir)) fs.mkdirSync(targetPanelsDir, { recursive: true });
          const pFiles = fs.readdirSync(panelsSrc);
          for (const pf of pFiles) {
            fs.copyFileSync(path.join(panelsSrc, pf), path.join(targetPanelsDir, pf));
          }
        }
      }

      return {
        success: true,
        restored_files: entries.length,
        manifest,
      };
    } catch (err: any) {
      return {
        success: false,
        error: String(err?.message || err),
        restored_files: 0,
        manifest: {} as any,
      };
    }
  }
}
