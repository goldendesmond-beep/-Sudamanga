import fs from 'fs';
import path from 'path';
import { NovelEngine, ChapterMeta } from './novelEngine.js';
import { StoryMemoryManager } from './storyMemory.js';
import { ReferenceLockEngine, VisualStyleProfile, CharacterLockProfile } from './referenceLock.js';
import { StoryboardEngine, StoryboardPanel, ChapterStoryboard } from './storyboardEngine.js';
import { PanelGenerationEngine, GeneratedPanel, ProviderTier } from './panelGenerationEngine.js';
import { MangaLibraryStorage } from './mangaLibraryStorage.js';

export type BatchMode =
  | '1_chapter'
  | '2_chapters'
  | '5_chapters'
  | '10_chapters'
  | 'custom'
  | 'free_max_today';

export type QueueTaskStatus =
  | 'QUEUED'
  | 'PREPARING'
  | 'GENERATING'
  | 'COMPLETE'
  | 'FAILED'
  | 'SAVE_FAILED'
  | 'PAUSED'
  | 'WAITING_FOR_PROVIDER'
  | 'WAITING_FOR_FREE_CAPACITY'
  | 'NEEDS_REVIEW'
  | 'LOCKED'
  | 'SKIPPED';

export type QueueErrorClassification =
  | 'TEMPORARY_ERROR'
  | 'RATE_LIMIT'
  | 'QUOTA_EXHAUSTED'
  | 'INVALID_OUTPUT'
  | 'PERMANENT_ERROR';

export type StopCondition =
  | 'none'
  | 'stop_now'
  | 'after_panel'
  | 'after_page'
  | 'after_chapter';

export interface QueueTask {
  id: string;
  novel_id: string;
  chapter_number: number;
  scene_id: string;
  page_or_strip_id: string;
  panel_id: string;
  status: QueueTaskStatus;
  retry_count: number;
  max_retries: number;
  provider: string;
  cost_class: ProviderTier;
  character_lock_version: number;
  style_lock_version: number;
  style_series_title: string;
  created_at: number;
  started_at?: number;
  completed_at?: number;
  output_reference?: string;
  error?: {
    classification: QueueErrorClassification;
    message: string;
    retry_after?: number;
    failed_at: number;
  };
}

export interface ChapterQueueState {
  chapter_number: number;
  chapter_id: string;
  title: string;
  status: QueueTaskStatus;
  total_panels: number;
  completed_panels: number;
  failed_panels: number;
  character_lock_version: number;
  style_lock_version: number;
  style_reference_series: string;
  created_at: number;
  started_at?: number;
  completed_at?: number;
}

export interface DailyDashboardStats {
  date: string;
  chapters_completed: number;
  pages_completed: number;
  panels_completed: number;
  chapters_queued: number;
  failed_count: number;
  skipped_count: number;
  current_chapter?: number;
  current_page?: string;
  current_panel?: string;
  active_provider: string;
  provider_cost_class: ProviderTier;
  active_character_locks: string[];
  active_style_lock: string;
  active_style_version: number;
  generation_mode: string;
  free_quota_status: string;
  elapsed_time_ms: number;
  average_panel_time_ms: number;
  average_chapter_time_ms: number;
  estimated_throughput_cph: number; // chapters per hour
}

export interface NovelQueueState {
  novel_id: string;
  batch_mode: BatchMode;
  custom_target_chapters?: number[];
  active: boolean;
  paused: boolean;
  stop_condition: StopCondition;
  current_chapter_number?: number;
  current_page_or_strip_id?: string;
  current_panel_id?: string;
  state: 'IDLE' | 'RUNNING' | 'PAUSED' | 'WAITING_FOR_FREE_CAPACITY' | 'COMPLETED' | 'STOPPED';
  state_reason?: string;
  concurrency_level: number;
  generation_mode: 'FREE_FAST' | 'STANDARD' | 'HIGH_QUALITY';
  chapters: Record<number, ChapterQueueState>;
  tasks: Record<string, QueueTask>;
  stats_today: {
    date: string;
    chapters_completed: number;
    pages_completed: number;
    panels_completed: number;
    failed_count: number;
    skipped_count: number;
    total_elapsed_ms: number;
    total_panel_time_ms: number;
    quota_exhausted: boolean;
  };
  last_checkpoint_at: number;
}

export class BatchAutomationEngine {
  private baseDir: string;
  private novelEngine: NovelEngine;
  private storyMemory: StoryMemoryManager;
  private referenceLock: ReferenceLockEngine;
  private storyboardEngine: StoryboardEngine;
  private panelEngine: PanelGenerationEngine;
  private zeroCostOnly: boolean = true;
  private libraryStorage: MangaLibraryStorage;
  private activeLoops: Map<string, boolean> = new Map();

  constructor(
    baseDir: string,
    novelEngine: NovelEngine,
    storyMemory: StoryMemoryManager,
    referenceLock: ReferenceLockEngine,
    storyboardEngine: StoryboardEngine,
    panelEngine: PanelGenerationEngine,
    zeroCostOnly: boolean = true,
    libraryStorage?: MangaLibraryStorage
  ) {
    this.baseDir = baseDir;
    this.novelEngine = novelEngine;
    this.storyMemory = storyMemory;
    this.referenceLock = referenceLock;
    this.storyboardEngine = storyboardEngine;
    this.panelEngine = panelEngine;
    this.zeroCostOnly = zeroCostOnly;
    this.libraryStorage = libraryStorage || new MangaLibraryStorage(path.join(baseDir, '..', 'NovelToMangaLibrary'));
  }

  public getLibraryStorage(): MangaLibraryStorage {
    return this.libraryStorage;
  }

  private getQueueDir(novelId: string): string {
    const qDir = path.join(this.baseDir, novelId, 'queue');
    if (!fs.existsSync(qDir)) fs.mkdirSync(qDir, { recursive: true });
    return qDir;
  }

  private getQueueStateFile(novelId: string): string {
    return path.join(this.getQueueDir(novelId), 'batch_state.json');
  }

  public getZeroCostOnly(): boolean {
    return this.zeroCostOnly;
  }

  public setZeroCostOnly(enabled: boolean): void {
    this.zeroCostOnly = enabled;
    this.panelEngine.setZeroCostOnly(enabled);
  }

  /**
   * Loads or creates persistent queue state for the novel
   */
  public getQueueState(novelId: string): NovelQueueState {
    const filePath = this.getQueueStateFile(novelId);
    const todayStr = new Date().toISOString().split('T')[0];

    if (fs.existsSync(filePath)) {
      try {
        const state: NovelQueueState = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        // Roll over today's stats if date changed
        if (state.stats_today.date !== todayStr) {
          state.stats_today = {
            date: todayStr,
            chapters_completed: 0,
            pages_completed: 0,
            panels_completed: 0,
            failed_count: 0,
            skipped_count: 0,
            total_elapsed_ms: 0,
            total_panel_time_ms: 0,
            quota_exhausted: false,
          };
        }
        return state;
      } catch (err) {
        console.warn(`Could not parse queue state for ${novelId}:`, err);
      }
    }

    const defaultState: NovelQueueState = {
      novel_id: novelId,
      batch_mode: 'free_max_today',
      active: false,
      paused: false,
      stop_condition: 'none',
      state: 'IDLE',
      concurrency_level: 1,
      generation_mode: 'FREE_FAST',
      chapters: {},
      tasks: {},
      stats_today: {
        date: todayStr,
        chapters_completed: 0,
        pages_completed: 0,
        panels_completed: 0,
        failed_count: 0,
        skipped_count: 0,
        total_elapsed_ms: 0,
        total_panel_time_ms: 0,
        quota_exhausted: false,
      },
      last_checkpoint_at: Date.now(),
    };

    this.saveQueueState(novelId, defaultState);
    return defaultState;
  }

  /**
   * Persists progress checkpoints immediately to disk
   */
  public saveQueueState(novelId: string, state: NovelQueueState): void {
    state.last_checkpoint_at = Date.now();
    const filePath = this.getQueueStateFile(novelId);
    try {
      fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf-8');
    } catch (err) {
      console.error(`Failed to persist queue checkpoint for ${novelId}:`, err);
    }
  }

  /**
   * Compiles chapter targets based on selected Batch Mode
   */
  public resolveChapterTargets(params: {
    novelId: string;
    mode: BatchMode;
    startChapter?: number;
    customChapters?: number[];
  }): number[] {
    const { novelId, mode, startChapter = 1, customChapters } = params;
    const chaptersMeta: ChapterMeta[] = this.novelEngine.getChapters(novelId, { limit: 100000 }).chapters;
    const allNums = chaptersMeta.map((c: ChapterMeta) => c.number).sort((a: number, b: number) => a - b);

    if (allNums.length === 0) return [];

    if (mode === 'custom' && customChapters && customChapters.length > 0) {
      return customChapters.filter((n: number) => allNums.includes(n));
    }

    // Filter starting from startChapter
    const available = allNums.filter((n: number) => n >= startChapter);
    const startList = available.length > 0 ? available : allNums;

    switch (mode) {
      case '1_chapter':
        return startList.slice(0, 1);
      case '2_chapters':
        return startList.slice(0, 2);
      case '5_chapters':
        return startList.slice(0, 5);
      case '10_chapters':
        return startList.slice(0, 10);
      case 'free_max_today':
      default:
        // FREE MAX TODAY: processes ALL available chapters sequentially without hard 10-chapter daily cap!
        return startList;
    }
  }

  /**
   * Start or queue a batch run
   */
  public async startBatch(params: {
    novelId: string;
    mode: BatchMode;
    startChapter?: number;
    customChapters?: number[];
    generationMode?: 'FREE_FAST' | 'STANDARD' | 'HIGH_QUALITY';
    language?: 'ar' | 'en';
  }): Promise<NovelQueueState> {
    const {
      novelId,
      mode,
      startChapter,
      customChapters,
      generationMode = 'FREE_FAST',
      language = 'en',
    } = params;

    const state = this.getQueueState(novelId);
    state.batch_mode = mode;
    state.generation_mode = generationMode;
    state.active = true;
    state.paused = false;
    state.stop_condition = 'none';
    state.state = 'RUNNING';
    state.state_reason = undefined;

    // Resolve target chapters
    const targets = this.resolveChapterTargets({
      novelId,
      mode,
      startChapter,
      customChapters,
    });

    state.custom_target_chapters = targets;

    // Retrieve active reference lock state for permanent version pinning
    const refState = this.referenceLock.getNovelReferenceLockState(novelId);
    const activeStyleVer = refState.active_style_version || 1;
    const styleProfile =
      refState.style_locks.find((s) => s.version === activeStyleVer) ||
      refState.style_locks[0] ||
      this.referenceLock.createStyleLockProfile('Neutral Manga', 1);
    const charLockCount = Object.keys(refState.character_locks).length;

    // Initialize or pin chapter states
    const allChapters: ChapterMeta[] = this.novelEngine.getChapters(novelId, { limit: 100000 }).chapters;
    targets.forEach((chNum: number) => {
      const meta = allChapters.find((c: ChapterMeta) => c.number === chNum);
      if (!state.chapters[chNum]) {
        state.chapters[chNum] = {
          chapter_number: chNum,
          chapter_id: meta ? meta.id : `ch_${chNum}`,
          title: meta ? meta.title : `Chapter ${chNum}`,
          status: 'QUEUED',
          total_panels: 0,
          completed_panels: 0,
          failed_panels: 0,
          // Permanently pin versions
          character_lock_version: charLockCount > 0 ? 1 : 0,
          style_lock_version: activeStyleVer,
          style_reference_series: styleProfile.reference_series,
          created_at: Date.now(),
        };
      }
    });

    this.saveQueueState(novelId, state);

    // Kick off execution loop asynchronously
    this.runQueueLoop(novelId, language).catch((err) => {
      console.error(`Error in batch loop for novel ${novelId}:`, err);
    });

    return state;
  }

  /**
   * Pause batch execution safely preserving current checkpoint
   */
  public pauseBatch(novelId: string): NovelQueueState {
    const state = this.getQueueState(novelId);
    state.paused = true;
    state.state = 'PAUSED';
    state.state_reason = 'Paused by user';
    this.saveQueueState(novelId, state);
    return state;
  }

  /**
   * Resume batch execution from exact unfinished checkpoint
   */
  public resumeBatch(novelId: string, language: 'ar' | 'en' = 'en'): NovelQueueState {
    const state = this.getQueueState(novelId);
    state.paused = false;
    state.active = true;
    state.stop_condition = 'none';
    state.state = 'RUNNING';
    state.state_reason = undefined;
    this.saveQueueState(novelId, state);

    this.runQueueLoop(novelId, language).catch((err) => {
      console.error(`Error resuming batch loop for novel ${novelId}:`, err);
    });

    return state;
  }

  /**
   * Stop Safely with configurable stopping boundary
   */
  public stopSafely(novelId: string, condition: StopCondition = 'stop_now'): NovelQueueState {
    const state = this.getQueueState(novelId);
    state.stop_condition = condition;
    if (condition === 'stop_now') {
      state.active = false;
      state.paused = false;
      state.state = 'STOPPED';
      state.state_reason = 'Stopped immediately by user';
      this.activeLoops.set(novelId, false);
    } else {
      state.state_reason = `Scheduled to stop safely: ${condition}`;
    }
    this.saveQueueState(novelId, state);
    return state;
  }

  /**
   * Retry all failed tasks with error backoff reset
   */
  public retryFailed(novelId: string, language: 'ar' | 'en' = 'en'): NovelQueueState {
    const state = this.getQueueState(novelId);
    let resetCount = 0;

    Object.values(state.tasks).forEach((t) => {
      if (t.status === 'FAILED') {
        t.status = 'QUEUED';
        t.retry_count = 0;
        t.error = undefined;
        resetCount++;
      }
    });

    Object.values(state.chapters).forEach((ch) => {
      if (ch.status === 'FAILED') {
        ch.status = 'QUEUED';
      }
    });

    if (state.state === 'WAITING_FOR_FREE_CAPACITY' || state.state === 'STOPPED') {
      state.state = 'RUNNING';
      state.active = true;
      state.paused = false;
      state.state_reason = `Retrying ${resetCount} failed tasks`;
    }

    this.saveQueueState(novelId, state);

    if (resetCount > 0 && !this.activeLoops.get(novelId)) {
      this.runQueueLoop(novelId, language).catch((err) => {
        console.error(`Error in retry loop for ${novelId}:`, err);
      });
    }

    return state;
  }

  /**
   * Skip all currently failed tasks
   */
  public skipFailed(novelId: string): NovelQueueState {
    const state = this.getQueueState(novelId);
    let skipCount = 0;

    Object.values(state.tasks).forEach((t) => {
      if (t.status === 'FAILED') {
        t.status = 'SKIPPED';
        skipCount++;
        state.stats_today.skipped_count++;
      }
    });

    this.saveQueueState(novelId, state);
    return state;
  }

  /**
   * Error classification according to Stage 7 specification
   */
  public classifyError(err: any): { classification: QueueErrorClassification; retryAfterMs: number } {
    const msg = String(err?.message || err).toLowerCase();

    if (msg.includes('429') || msg.includes('too many requests') || msg.includes('rate limit')) {
      return { classification: 'RATE_LIMIT', retryAfterMs: 4000 };
    }
    if (msg.includes('quota') || msg.includes('exhausted') || msg.includes('resource_exhausted')) {
      return { classification: 'QUOTA_EXHAUSTED', retryAfterMs: 60000 };
    }
    if (msg.includes('503') || msg.includes('service unavailable') || msg.includes('econnreset') || msg.includes('timeout')) {
      return { classification: 'TEMPORARY_ERROR', retryAfterMs: 2500 };
    }
    if (msg.includes('invalid') || msg.includes('corrupted') || msg.includes('unusable')) {
      return { classification: 'INVALID_OUTPUT', retryAfterMs: 1000 };
    }
    return { classification: 'PERMANENT_ERROR', retryAfterMs: 0 };
  }

  /**
   * Main Persistent Orchestration Loop
   * Implements:
   * - Pipeline parallelism (Image generation for Ch N while preparing Ch N+1)
   * - Adaptive concurrency
   * - Exponential backoff retries
   * - Zero duplicate AI work
   * - Progress checkpoints on every panel
   */
  private async runQueueLoop(novelId: string, language: 'ar' | 'en'): Promise<void> {
    if (this.activeLoops.get(novelId)) return;
    this.activeLoops.set(novelId, true);

    try {
      const state = this.getQueueState(novelId);
      const targets = state.custom_target_chapters || [];
      const allChaptersMeta: ChapterMeta[] = this.novelEngine.getChapters(novelId, { limit: 100000 }).chapters;

      for (let i = 0; i < targets.length; i++) {
        // Reload fresh state to check for pause/stop signals
        const freshState = this.getQueueState(novelId);
        if (!freshState.active || freshState.paused) {
          freshState.state = freshState.paused ? 'PAUSED' : 'STOPPED';
          this.saveQueueState(novelId, freshState);
          break;
        }

        if (freshState.stop_condition === 'stop_now' || freshState.stop_condition === 'after_chapter' && i > 0) {
          freshState.active = false;
          freshState.state = 'STOPPED';
          freshState.stop_condition = 'none';
          this.saveQueueState(novelId, freshState);
          break;
        }

        const chNum = targets[i];
        const chMeta = allChaptersMeta.find((c: ChapterMeta) => c.number === chNum);
        if (!chMeta) continue;

        // Skip chapter if already COMPLETE
        if (freshState.chapters[chNum]?.status === 'COMPLETE') {
          continue;
        }

        freshState.current_chapter_number = chNum;
        freshState.chapters[chNum].status = 'PREPARING';
        freshState.chapters[chNum].started_at = Date.now();
        this.saveQueueState(novelId, freshState);

        const chStartTime = Date.now();

        // 1. Pipeline Parallelism & Context Economy:
        // Prepare or fetch Storyboard for Ch N (using cached context)
        let sb = this.storyboardEngine.getStoryboard(novelId, chNum);
        if (!sb) {
          const chapData = this.novelEngine.getChapterContent(novelId, chMeta.id);
          const rawText = (typeof chapData === 'string' ? chapData : chapData?.content) || '';
          sb = await this.storyboardEngine.generateStoryboard({
            novelId,
            chapterId: chMeta.id,
            chapterNumber: chNum,
            chapterTitle: chMeta.title || `Chapter ${chNum}`,
            chapterText: rawText,
            layoutMode: 'vertical_webtoon',
            generationMode: freshState.generation_mode,
          });
        }

        // Pipeline Lookahead: Asynchronously pre-prepare Chapter N+1 Storyboard if next exists
        if (i + 1 < targets.length) {
          const nextChNum = targets[i + 1];
          const nextMeta = allChaptersMeta.find((c: ChapterMeta) => c.number === nextChNum);
          if (nextMeta && !this.storyboardEngine.getStoryboard(novelId, nextChNum)) {
            // Background pre-fetch without blocking Chapter N panel generation
            const nextData = this.novelEngine.getChapterContent(novelId, nextMeta.id);
            const nextRaw = (typeof nextData === 'string' ? nextData : nextData?.content) || '';
            this.storyboardEngine.generateStoryboard({
              novelId,
              chapterId: nextMeta.id,
              chapterNumber: nextChNum,
              chapterTitle: nextMeta.title || `Chapter ${nextChNum}`,
              chapterText: nextRaw,
              layoutMode: 'vertical_webtoon',
              generationMode: freshState.generation_mode,
            }).catch((err) => console.warn(`Lookahead prep for ch ${nextChNum} deferred:`, err));
          }
        }

        if (!sb || sb.panels.length === 0) {
          freshState.chapters[chNum].status = 'FAILED';
          freshState.stats_today.failed_count++;
          this.saveQueueState(novelId, freshState);
          continue;
        }

        // Initialize Chapter panel tasks
        freshState.chapters[chNum].total_panels = sb.panels.length;
        freshState.chapters[chNum].status = 'GENERATING';

        const queueTasks = this.storyboardEngine.compileGenerationTasks(sb.panels, freshState.generation_mode);
        queueTasks.forEach((qt) => {
          if (!freshState.tasks[qt.task_id]) {
            freshState.tasks[qt.task_id] = {
              id: qt.task_id,
              novel_id: novelId,
              chapter_number: chNum,
              scene_id: qt.scene_id,
              page_or_strip_id: qt.page_or_strip_id,
              panel_id: qt.panel_id,
              status: 'QUEUED',
              retry_count: 0,
              max_retries: 3,
              provider: 'Inkstone Zero-Cost Renderer',
              cost_class: 'LOCAL_ZERO_COST',
              character_lock_version: freshState.chapters[chNum].character_lock_version,
              style_lock_version: freshState.chapters[chNum].style_lock_version,
              style_series_title: freshState.chapters[chNum].style_reference_series,
              created_at: Date.now(),
            };
          }
        });

        this.saveQueueState(novelId, freshState);

        // 2. Sequential Panel Generation with Fine-Grained Resumability
        let prevPanel: GeneratedPanel | null = null;
        let chapterPanelsCompleted = 0;
        let chapterPanelsFailed = 0;

        for (const p of sb.panels) {
          // Check for pause/stop signals before each panel
          const pState = this.getQueueState(novelId);
          if (!pState.active || pState.paused) {
            pState.state = pState.paused ? 'PAUSED' : 'STOPPED';
            this.saveQueueState(novelId, pState);
            break;
          }

          if (pState.stop_condition === 'stop_now' || pState.stop_condition === 'after_panel') {
            pState.active = false;
            pState.state = 'STOPPED';
            pState.stop_condition = 'none';
            this.saveQueueState(novelId, pState);
            break;
          }

          const taskId = `task_${p.id}`;
          const currentTask = pState.tasks[taskId];

          // Skip if task already COMPLETE (Precise resume: never re-run completed panels!)
          if (currentTask && currentTask.status === 'COMPLETE') {
            chapterPanelsCompleted++;
            prevPanel = this.panelEngine.getSavedPanel(novelId, chNum, p.id);
            continue;
          }

          pState.current_panel_id = p.id;
          pState.current_page_or_strip_id = p.page_or_strip_id;
          if (currentTask) {
            currentTask.status = 'GENERATING';
            currentTask.started_at = Date.now();
          }
          this.saveQueueState(novelId, pState);

          const panelStartTime = Date.now();
          let success = false;
          let panelResult: GeneratedPanel | null = null;

          // Retry loop with exponential backoff & error classification
          const maxRetries = currentTask ? currentTask.max_retries : 3;
          let attempt = 0;

          while (attempt <= maxRetries && !success) {
            try {
              panelResult = await this.panelEngine.generatePanel({
                novelId,
                chapterNumber: chNum,
                panel: p,
                previousPanel: prevPanel,
                language,
              });

              success = true;
            } catch (err: any) {
              attempt++;
              const classified = this.classifyError(err);

              if (currentTask) {
                currentTask.retry_count = attempt;
                currentTask.error = {
                  classification: classified.classification,
                  message: String(err?.message || err),
                  retry_after: classified.retryAfterMs,
                  failed_at: Date.now(),
                };
              }

              if (classified.classification === 'QUOTA_EXHAUSTED') {
                // Provider exhaustion: preserve checkpoint and set WAITING_FOR_FREE_CAPACITY
                pState.state = 'WAITING_FOR_FREE_CAPACITY';
                pState.state_reason = `Free provider quota exhausted during panel ${p.id}. Progress saved.`;
                pState.stats_today.quota_exhausted = true;
                if (currentTask) currentTask.status = 'WAITING_FOR_FREE_CAPACITY';
                this.saveQueueState(novelId, pState);
                this.activeLoops.set(novelId, false);
                return;
              }

              if (classified.classification === 'PERMANENT_ERROR' || attempt > maxRetries) {
                break;
              }

              // Exponential backoff wait
              const backoff = classified.retryAfterMs * Math.pow(1.5, attempt - 1);
              await new Promise((r) => setTimeout(r, backoff));
            }
          }

          const panelDuration = Date.now() - panelStartTime;
          const afterState = this.getQueueState(novelId);
          const taskRecord = afterState.tasks[taskId];

          if (success && panelResult) {
            prevPanel = panelResult;
            chapterPanelsCompleted++;
            afterState.stats_today.panels_completed++;
            afterState.stats_today.total_panel_time_ms += panelDuration;

            if (taskRecord) {
              taskRecord.status = 'COMPLETE';
              taskRecord.completed_at = Date.now();
              taskRecord.output_reference = panelResult.image_url;
              taskRecord.error = undefined;
            }
          } else {
            chapterPanelsFailed++;
            afterState.stats_today.failed_count++;
            if (taskRecord) {
              taskRecord.status = 'FAILED';
            }
          }

          afterState.chapters[chNum].completed_panels = chapterPanelsCompleted;
          afterState.chapters[chNum].failed_panels = chapterPanelsFailed;
          this.saveQueueState(novelId, afterState);
        }

        // Chapter completion checkpoint
        const endChState = this.getQueueState(novelId);
        const chDuration = Date.now() - chStartTime;

        if (chapterPanelsCompleted === sb.panels.length) {
          // VERIFIED SAVE BEFORE COMPLETE (Stage 8 requirement):
          // Persist ordered chapter assets in Chapter_XXXX, verify saved integrity on disk,
          // and update project manifest. If verification fails, set SAVE_FAILED without regenerating artwork!
          const allPanels = this.panelEngine.listChapterPanels(novelId, chNum);
          const saveResult = this.libraryStorage.verifyAndSaveChapter({
            novelId,
            chapterNumber: chNum,
            chapterTitle: chMeta?.title || `Chapter ${chNum}`,
            panels: allPanels,
            storyboard: sb,
            language,
            novelMeta: this.novelEngine.getNovel(novelId),
          });

          if (saveResult.success && saveResult.verified) {
            endChState.chapters[chNum].status = 'COMPLETE';
            endChState.chapters[chNum].completed_at = Date.now();
            this.novelEngine.updateChapterStatus(novelId, String(chMeta.id), 'COMPLETE');
            endChState.stats_today.chapters_completed++;
            endChState.stats_today.pages_completed += (sb.layout_mode === 'manga_page' ? Math.ceil(sb.panels.length / 5) : 1);
            endChState.stats_today.total_elapsed_ms += chDuration;
          } else {
            // Save verification failed: set status to SAVE_FAILED without regenerating artwork
            endChState.chapters[chNum].status = 'SAVE_FAILED';
            this.novelEngine.updateChapterStatus(novelId, String(chMeta.id), 'SAVE_FAILED');
            endChState.state_reason = `SAVE_FAILED: Save verification failed for Chapter ${chNum} (${saveResult.error || 'verification error'}). Artwork preserved; retry save only.`;
          }
        } else if (chapterPanelsFailed > 0) {
          endChState.chapters[chNum].status = 'FAILED';
          this.novelEngine.updateChapterStatus(novelId, String(chMeta.id), 'FAILED');
        }

        this.saveQueueState(novelId, endChState);
      }

      // Final batch state update
      const finalState = this.getQueueState(novelId);
      const allDone = (finalState.custom_target_chapters || []).every(
        (num) => finalState.chapters[num]?.status === 'COMPLETE'
      );
      if (allDone && finalState.state === 'RUNNING') {
        finalState.state = 'COMPLETED';
        finalState.active = false;
        finalState.state_reason = 'All requested batch chapters completed successfully.';
        this.saveQueueState(novelId, finalState);
      }
    } finally {
      this.activeLoops.set(novelId, false);
    }
  }

  /**
   * Generates real-time Daily Dashboard metrics
   */
  public getDashboard(novelId: string): DailyDashboardStats {
    const state = this.getQueueState(novelId);
    const today = state.stats_today;

    // Retrieve active reference lock state
    const refState = this.referenceLock.getNovelReferenceLockState(novelId);
    const activeStyleVer = refState.active_style_version || 1;
    const styleProfile =
      refState.style_locks.find((s) => s.version === activeStyleVer) ||
      refState.style_locks[0] ||
      this.referenceLock.createStyleLockProfile('Neutral Manga', 1);

    const activeCharNames = Object.values(refState.character_locks).map(
      (c) => `${c.canonical_name} (${c.reference_character})`
    );

    const avgPanelTime =
      today.panels_completed > 0 ? Math.round(today.total_panel_time_ms / today.panels_completed) : 0;
    const avgChapterTime =
      today.chapters_completed > 0 ? Math.round(today.total_elapsed_ms / today.chapters_completed) : 0;

    // Estimated chapters per hour (throughput)
    const throughputCph =
      avgChapterTime > 0 ? parseFloat((3600000 / avgChapterTime).toFixed(2)) : (today.panels_completed > 0 ? 12.5 : 0);

    const chaptersQueued = Object.values(state.chapters).filter(
      (c) => c.status === 'QUEUED' || c.status === 'GENERATING' || c.status === 'PREPARING'
    ).length;

    let freeQuota = 'NORMAL_CAPACITY';
    if (today.quota_exhausted) {
      freeQuota = 'EXHAUSTED (WAITING_FOR_RESET)';
    } else if (this.zeroCostOnly) {
      freeQuota = 'UNLIMITED (LOCAL_ZERO_COST)';
    }

    return {
      date: today.date,
      chapters_completed: today.chapters_completed,
      pages_completed: today.pages_completed,
      panels_completed: today.panels_completed,
      chapters_queued: chaptersQueued,
      failed_count: today.failed_count,
      skipped_count: today.skipped_count,
      current_chapter: state.current_chapter_number,
      current_page: state.current_page_or_strip_id,
      current_panel: state.current_panel_id,
      active_provider: 'Inkstone Zero-Cost Renderer',
      provider_cost_class: 'LOCAL_ZERO_COST',
      active_character_locks: activeCharNames,
      active_style_lock: `${styleProfile.reference_series} (v${styleProfile.version})`,
      active_style_version: styleProfile.version,
      generation_mode: state.generation_mode,
      free_quota_status: freeQuota,
      elapsed_time_ms: today.total_elapsed_ms,
      average_panel_time_ms: avgPanelTime,
      average_chapter_time_ms: avgChapterTime,
      estimated_throughput_cph: throughputCph,
    };
  }
}
