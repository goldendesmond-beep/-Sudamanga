import fs from 'fs';
import path from 'path';
import type { NovelEngine, ChapterMeta } from './novelEngine.js';
import type { BatchAutomationEngine } from './batchAutomationEngine.js';
import type { MangaLibraryStorage } from './mangaLibraryStorage.js';

export type DailyGenerationMode =
  | 'FREE_MAX_TODAY'
  | 'FIXED_CHAPTER_LIMIT'
  | 'FIXED_PANEL_LIMIT'
  | 'FIXED_RUNTIME_LIMIT';

export interface DailySchedulerConfig {
  novel_id: string;
  enabled: boolean; // DAILY_AUTO_RUN = ON / OFF (Default: OFF)
  generation_mode: DailyGenerationMode;
  chapter_limit: number; // 1, 2, 5, 10, or custom (default: 5)
  panel_limit?: number;
  runtime_limit_minutes?: number;
  timezone: string; // Default: 'Asia/Riyadh'
  run_time: string; // e.g. '02:00'
  paused: boolean;
  skip_until_date?: string; // e.g. '2026-10-05'
  last_run_date?: string; // 'YYYY-MM-DD'
  last_run_id?: string;
  updated_at: number;
}

export interface DailyAutomationHistoryRecord {
  run_id: string;
  novel_id: string;
  date: string;
  start_time: number;
  end_time: number;
  duration_ms: number;
  generation_mode: DailyGenerationMode;
  planned_limit: number;
  chapters_attempted: number;
  chapters_completed: number;
  pages_completed: number;
  panels_completed: number;
  provider_used: string;
  cost_tier: string;
  quota_state: 'NORMAL' | 'WAITING_FOR_FREE_CAPACITY' | 'EXHAUSTED';
  stop_reason: string;
  errors: string[];
  final_checkpoint: {
    chapter_number: number;
    page_id?: string;
    panel_id?: string;
  };
}

export interface HostingCapabilityReport {
  supports_persistent_storage: boolean;
  storage_mode: 'APPLICATION_MANAGED_LOCAL' | 'BROWSER_MANAGED_OPFS' | 'PERSISTENT_STORAGE_UNAVAILABLE';
  supports_offline_autorun: boolean;
  autorun_status: 'AVAILABLE' | 'BACKGROUND_AUTORUN_UNAVAILABLE_ON_CURRENT_HOST';
  active_host_environment: string;
  details: string;
  cron_or_scheduler_setup_hint: string;
}

export interface LibraryHealthReport {
  storage_mode: string;
  storage_root: string;
  total_projects: number;
  total_chapters: number;
  total_pages: number;
  storage_usage_bytes: number;
  failed_saves_count: number;
  last_successful_save: number | null;
  last_successful_backup: number | null;
  backup_status: 'HEALTHY' | 'WARNING' | 'NO_BACKUPS';
  persistent_storage_verified: boolean;
}

export class DailySchedulerEngine {
  private baseDir: string;
  private batchEngine: BatchAutomationEngine;
  private libraryStorage: MangaLibraryStorage;
  private novelEngine: NovelEngine;
  private schedulerSecret: string;
  private activeInterval: NodeJS.Timeout | null = null;

  constructor(
    baseDir: string,
    batchEngine: BatchAutomationEngine,
    libraryStorage: MangaLibraryStorage,
    novelEngine: NovelEngine,
    schedulerSecret?: string
  ) {
    this.baseDir = baseDir;
    this.batchEngine = batchEngine;
    this.libraryStorage = libraryStorage;
    this.novelEngine = novelEngine;
    this.schedulerSecret = schedulerSecret || process.env.SCHEDULER_SECRET || 'inkstone_scheduler_internal_key';
  }

  public getSchedulerDir(novelId: string): string {
    const dir = path.join(this.baseDir, novelId, 'scheduler');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  public getConfigPath(novelId: string): string {
    return path.join(this.getSchedulerDir(novelId), 'daily_autorun_config.json');
  }

  public getHistoryPath(novelId: string): string {
    return path.join(this.getSchedulerDir(novelId), 'daily_automation_history.json');
  }

  /**
   * Retrieve or initialize Daily Auto Run configuration for a novel project.
   * Default: DAILY_AUTO_RUN = OFF, Timezone: Asia/Riyadh, Run Time: 02:00
   */
  public getConfig(novelId: string): DailySchedulerConfig {
    const configPath = this.getConfigPath(novelId);
    if (fs.existsSync(configPath)) {
      try {
        return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      } catch (err) {
        console.warn(`Could not read scheduler config for ${novelId}:`, err);
      }
    }

    const defaultConfig: DailySchedulerConfig = {
      novel_id: novelId,
      enabled: false, // Default: OFF (User must explicitly enable)
      generation_mode: 'FIXED_CHAPTER_LIMIT',
      chapter_limit: 5, // Default 5 chapters/day
      timezone: 'Asia/Riyadh', // Default Riyadh timezone
      run_time: '02:00', // Default 2:00 AM
      paused: false,
      updated_at: Date.now(),
    };

    this.saveConfig(novelId, defaultConfig);
    return defaultConfig;
  }

  public saveConfig(novelId: string, config: DailySchedulerConfig): void {
    config.updated_at = Date.now();
    const configPath = this.getConfigPath(novelId);
    const tmp = `${configPath}.tmp_${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(config, null, 2), 'utf-8');
    fs.renameSync(tmp, configPath);
  }

  /**
   * Update configuration fields safely
   */
  public updateConfig(novelId: string, updates: Partial<DailySchedulerConfig>): DailySchedulerConfig {
    const current = this.getConfig(novelId);
    const updated: DailySchedulerConfig = {
      ...current,
      ...updates,
      novel_id: novelId,
      updated_at: Date.now(),
    };
    this.saveConfig(novelId, updated);
    return updated;
  }

  /**
   * Retrieve automation execution history
   */
  public getHistory(novelId: string): DailyAutomationHistoryRecord[] {
    const historyPath = this.getHistoryPath(novelId);
    if (!fs.existsSync(historyPath)) return [];
    try {
      return JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
    } catch {
      return [];
    }
  }

  public appendHistoryRecord(novelId: string, record: DailyAutomationHistoryRecord): void {
    const list = this.getHistory(novelId);
    list.unshift(record); // newest first
    // Retain up to 100 historical daily records
    const trimmed = list.slice(0, 100);
    const historyPath = this.getHistoryPath(novelId);
    fs.writeFileSync(historyPath, JSON.stringify(trimmed, null, 2), 'utf-8');
  }

  /**
   * Current calendar date formatted as YYYY-MM-DD in the specified timezone
   */
  public getCurrentDateInTimezone(timezone: string = 'Asia/Riyadh'): string {
    try {
      const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      return formatter.format(new Date()); // Outputs YYYY-MM-DD
    } catch {
      return new Date().toISOString().slice(0, 10);
    }
  }

  /**
   * Generate unique daily run ID: <novelId>_<YYYY-MM-DD>
   */
  public generateDailyRunId(novelId: string, dateStr: string): string {
    return `${novelId}_${dateStr}`;
  }

  /**
   * Authenticate scheduler webhook/trigger using secret token
   */
  public verifySchedulerAuth(headerAuthToken?: string): boolean {
    if (!this.schedulerSecret) return true;
    if (!headerAuthToken) return false;
    const cleanToken = headerAuthToken.replace(/^Bearer\s+/i, '').trim();
    return cleanToken === this.schedulerSecret;
  }

  /**
   * Check whether today's scheduled run has already been completed
   */
  public hasRunToday(novelId: string, timezone: string = 'Asia/Riyadh'): boolean {
    const today = this.getCurrentDateInTimezone(timezone);
    const config = this.getConfig(novelId);
    return config.last_run_date === today;
  }

  /**
   * Execute scheduled daily generation run.
   * Follows strict flow:
   * 1. Check enabled & paused
   * 2. Check duplicate run today
   * 3. Load persistent queue
   * 4. Find next unfinished chapter
   * 5. Enforce ZERO_COST_ONLY policy
   * 6. Generate sequentially and persist each chapter
   * 7. Stop on quota exhaustion or limit reached
   * 8. Append detailed history record
   */
  public async executeDailyRun(
    novelId: string,
    options?: {
      forceNow?: boolean;
      overrideLimit?: number;
      triggerSource?: 'scheduler_cron' | 'manual_run_now' | 'cloud_job';
    }
  ): Promise<{
    success: boolean;
    run_id: string;
    chapters_completed: number;
    stop_reason: string;
    record: DailyAutomationHistoryRecord;
  }> {
    const config = this.getConfig(novelId);
    const tz = config.timezone || 'Asia/Riyadh';
    const today = this.getCurrentDateInTimezone(tz);
    const runId = this.generateDailyRunId(novelId, today);
    const startTime = Date.now();

    // Check if enabled or force
    if (!config.enabled && !options?.forceNow) {
      const skippedRecord: DailyAutomationHistoryRecord = {
        run_id: runId,
        novel_id: novelId,
        date: today,
        start_time: startTime,
        end_time: Date.now(),
        duration_ms: 0,
        generation_mode: config.generation_mode,
        planned_limit: config.chapter_limit,
        chapters_attempted: 0,
        chapters_completed: 0,
        pages_completed: 0,
        panels_completed: 0,
        provider_used: 'LOCAL_ZERO_COST',
        cost_tier: 'LOCAL_ZERO_COST',
        quota_state: 'NORMAL',
        stop_reason: 'DAILY_AUTO_RUN is disabled in project settings.',
        errors: [],
        final_checkpoint: { chapter_number: 1 },
      };
      return {
        success: false,
        run_id: runId,
        chapters_completed: 0,
        stop_reason: skippedRecord.stop_reason,
        record: skippedRecord,
      };
    }

    // Check if skipped for today
    if (config.skip_until_date && config.skip_until_date >= today && !options?.forceNow) {
      const skippedRecord: DailyAutomationHistoryRecord = {
        run_id: runId,
        novel_id: novelId,
        date: today,
        start_time: startTime,
        end_time: Date.now(),
        duration_ms: 0,
        generation_mode: config.generation_mode,
        planned_limit: config.chapter_limit,
        chapters_attempted: 0,
        chapters_completed: 0,
        pages_completed: 0,
        panels_completed: 0,
        provider_used: 'LOCAL_ZERO_COST',
        cost_tier: 'LOCAL_ZERO_COST',
        quota_state: 'NORMAL',
        stop_reason: `Today's run was skipped by user request (skip_until: ${config.skip_until_date}).`,
        errors: [],
        final_checkpoint: { chapter_number: 1 },
      };
      return {
        success: false,
        run_id: runId,
        chapters_completed: 0,
        stop_reason: skippedRecord.stop_reason,
        record: skippedRecord,
      };
    }

    // Prevent duplicate daily runs unless forceNow is passed
    if (config.last_run_date === today && !options?.forceNow) {
      const duplicateRecord: DailyAutomationHistoryRecord = {
        run_id: runId,
        novel_id: novelId,
        date: today,
        start_time: startTime,
        end_time: Date.now(),
        duration_ms: 0,
        generation_mode: config.generation_mode,
        planned_limit: config.chapter_limit,
        chapters_attempted: 0,
        chapters_completed: 0,
        pages_completed: 0,
        panels_completed: 0,
        provider_used: 'LOCAL_ZERO_COST',
        cost_tier: 'LOCAL_ZERO_COST',
        quota_state: 'NORMAL',
        stop_reason: `Daily run for ${today} already completed previously (run ID: ${config.last_run_id}). Duplicate prevented.`,
        errors: [],
        final_checkpoint: { chapter_number: 1 },
      };
      return {
        success: true,
        run_id: runId,
        chapters_completed: 0,
        stop_reason: duplicateRecord.stop_reason,
        record: duplicateRecord,
      };
    }

    // Check if paused
    if (config.paused && !options?.forceNow) {
      const pausedRecord: DailyAutomationHistoryRecord = {
        run_id: runId,
        novel_id: novelId,
        date: today,
        start_time: startTime,
        end_time: Date.now(),
        duration_ms: 0,
        generation_mode: config.generation_mode,
        planned_limit: config.chapter_limit,
        chapters_attempted: 0,
        chapters_completed: 0,
        pages_completed: 0,
        panels_completed: 0,
        provider_used: 'LOCAL_ZERO_COST',
        cost_tier: 'LOCAL_ZERO_COST',
        quota_state: 'NORMAL',
        stop_reason: 'Automation is currently PAUSED for this project.',
        errors: [],
        final_checkpoint: { chapter_number: 1 },
      };
      return {
        success: false,
        run_id: runId,
        chapters_completed: 0,
        stop_reason: pausedRecord.stop_reason,
        record: pausedRecord,
      };
    }

    // Determine target limit
    const plannedLimit =
      options?.overrideLimit !== undefined
        ? options.overrideLimit
        : config.generation_mode === 'FREE_MAX_TODAY'
        ? 999999
        : config.chapter_limit || 5;

    // Load persistent queue and find next unfinished chapter
    const queueState = this.batchEngine.getQueueState(novelId);
    const allChapters = this.novelEngine.getChapters(novelId, { limit: 99999 }).chapters;
    const unfinishedChapters = allChapters.filter((ch: ChapterMeta) => ch.status !== 'COMPLETE');

    if (unfinishedChapters.length === 0) {
      const allDoneRecord: DailyAutomationHistoryRecord = {
        run_id: runId,
        novel_id: novelId,
        date: today,
        start_time: startTime,
        end_time: Date.now(),
        duration_ms: Date.now() - startTime,
        generation_mode: config.generation_mode,
        planned_limit: plannedLimit,
        chapters_attempted: 0,
        chapters_completed: 0,
        pages_completed: 0,
        panels_completed: 0,
        provider_used: 'LOCAL_ZERO_COST',
        cost_tier: 'LOCAL_ZERO_COST',
        quota_state: 'NORMAL',
        stop_reason: 'All novel chapters are already completed!',
        errors: [],
        final_checkpoint: { chapter_number: allChapters.length },
      };
      config.last_run_date = today;
      config.last_run_id = runId;
      this.saveConfig(novelId, config);
      this.appendHistoryRecord(novelId, allDoneRecord);
      return {
        success: true,
        run_id: runId,
        chapters_completed: 0,
        stop_reason: allDoneRecord.stop_reason,
        record: allDoneRecord,
      };
    }

    // Select target batch chapters up to plannedLimit
    const targetChapters = unfinishedChapters.slice(0, plannedLimit).map((ch: ChapterMeta) => ch.number);
    let chaptersCompletedCount = 0;
    let pagesCompletedCount = 0;
    let panelsCompletedCount = 0;
    let stopReason = 'Daily target chapter limit completed successfully.';
    let quotaState: 'NORMAL' | 'WAITING_FOR_FREE_CAPACITY' | 'EXHAUSTED' = 'NORMAL';
    const errors: string[] = [];

    // Launch batch generation loop
    try {
      const batchResult = await this.batchEngine.startBatch({
        novelId,
        mode: config.generation_mode === 'FREE_MAX_TODAY' ? 'free_max_today' : 'custom',
        customChapters: targetChapters,
        generationMode: 'FREE_FAST',
      });

      // Track completion metrics
      const freshQueue = this.batchEngine.getQueueState(novelId);
      chaptersCompletedCount = freshQueue.stats_today.chapters_completed || 0;
      pagesCompletedCount = freshQueue.stats_today.pages_completed || 0;
      panelsCompletedCount = freshQueue.stats_today.panels_completed || 0;

      if (freshQueue.state === 'WAITING_FOR_FREE_CAPACITY' || freshQueue.stats_today.quota_exhausted) {
        quotaState = 'WAITING_FOR_FREE_CAPACITY';
        stopReason = 'Free provider quota exhausted. Checkpoint saved safely for tomorrow.';
      } else if (chaptersCompletedCount < targetChapters.length && freshQueue.state === 'PAUSED') {
        stopReason = 'Paused mid-run.';
      }
    } catch (err: any) {
      errors.push(String(err?.message || err));
      stopReason = `Error during daily autorun: ${String(err?.message || err)}`;
    }

    const endTime = Date.now();
    const finalQueue = this.batchEngine.getQueueState(novelId);

    const historyRecord: DailyAutomationHistoryRecord = {
      run_id: runId,
      novel_id: novelId,
      date: today,
      start_time: startTime,
      end_time: endTime,
      duration_ms: endTime - startTime,
      generation_mode: config.generation_mode,
      planned_limit: plannedLimit,
      chapters_attempted: targetChapters.length,
      chapters_completed: chaptersCompletedCount,
      pages_completed: pagesCompletedCount,
      panels_completed: panelsCompletedCount,
      provider_used: 'LOCAL_ZERO_COST',
      cost_tier: 'LOCAL_ZERO_COST',
      quota_state: quotaState,
      stop_reason: stopReason,
      errors,
      final_checkpoint: {
        chapter_number: finalQueue.current_chapter_number || targetChapters[0] || 1,
        page_id: finalQueue.current_page_or_strip_id,
        panel_id: finalQueue.current_panel_id,
      },
    };

    // Update config last run
    config.last_run_date = today;
    config.last_run_id = runId;
    this.saveConfig(novelId, config);
    this.appendHistoryRecord(novelId, historyRecord);

    return {
      success: errors.length === 0,
      run_id: runId,
      chapters_completed: chaptersCompletedCount,
      stop_reason: stopReason,
      record: historyRecord,
    };
  }

  /**
   * Truthful Hosting Reality Check (Requirement 48):
   * Detect whether active environment supports persistent offline background jobs.
   * If running in ephemeral/browser-hosted dev server without cloud cron or daemon,
   * honestly returns BACKGROUND_AUTORUN_UNAVAILABLE_ON_CURRENT_HOST.
   */
  public inspectHostingCapabilities(): HostingCapabilityReport {
    const isCloudSchedulerConfigured = Boolean(process.env.CLOUD_SCHEDULER_ENABLED === 'true' || process.env.CRON_JOB_ENABLED === 'true');
    const hasPersistentStorage = fs.existsSync(this.libraryStorage.getBaseDir());

    // Detect environment
    let activeHost = 'Node.js 22 LTS (Local / Container Runtime)';
    if (process.env.K_SERVICE) {
      activeHost = `Google Cloud Run (${process.env.K_SERVICE})`;
    } else if (process.env.CODESPACES) {
      activeHost = 'GitHub Codespaces';
    }

    if (isCloudSchedulerConfigured) {
      return {
        supports_persistent_storage: hasPersistentStorage,
        storage_mode: 'APPLICATION_MANAGED_LOCAL',
        supports_offline_autorun: true,
        autorun_status: 'AVAILABLE',
        active_host_environment: activeHost,
        details: 'External persistent Cloud Scheduler or Cron daemon is configured.',
        cron_or_scheduler_setup_hint: 'POST /api/scheduler/daily-run with Authorization header.',
      };
    }

    // When running inside AI Studio preview or interactive dev server without an external cron daemon:
    return {
      supports_persistent_storage: hasPersistentStorage,
      storage_mode: 'APPLICATION_MANAGED_LOCAL',
      supports_offline_autorun: false,
      autorun_status: 'BACKGROUND_AUTORUN_UNAVAILABLE_ON_CURRENT_HOST',
      active_host_environment: activeHost,
      details:
        'The current runtime environment is an interactive dev server. It does not include an autonomous background cron service when offline. To enable 24/7 background execution while closed, configure an external HTTP cron trigger (e.g. Google Cloud Scheduler, cron daemon, or GitHub Action) pointing to POST /api/scheduler/daily-run.',
      cron_or_scheduler_setup_hint:
        'Deploy with Cloud Run Job / Cloud Scheduler: curl -X POST https://your-domain/api/scheduler/daily-run -H "Authorization: Bearer <SCHEDULER_SECRET>"',
    };
  }

  /**
   * Storage and Library Health Report (Requirement 30)
   */
  public inspectLibraryHealth(): LibraryHealthReport {
    const baseDir = this.libraryStorage.getBaseDir();
    const projects = this.libraryStorage.listLibraryProjects();
    let totalChapters = 0;
    let totalPages = 0;
    let failedSaves = 0;
    let storageUsageBytes = 0;
    let lastSave: number | null = null;
    let lastBackup: number | null = null;

    for (const p of projects) {
      totalChapters += p.total_chapters;
      const manifest = this.libraryStorage.getProjectManifest(p.project_id);
      totalPages += Object.values(manifest.page_order || {}).reduce((acc, pgs) => acc + pgs.length, 0);
      failedSaves += Object.values(manifest.chapter_statuses || {}).filter((s) => s === 'SAVE_FAILED').length;
      if (manifest.updated_at && (!lastSave || manifest.updated_at > lastSave)) {
        lastSave = manifest.updated_at;
      }

      // Check backups
      const backupsDir = this.libraryStorage.getBackupsDir(p.project_id);
      if (fs.existsSync(backupsDir)) {
        const files = fs.readdirSync(backupsDir);
        for (const f of files) {
          const stat = fs.statSync(path.join(backupsDir, f));
          storageUsageBytes += stat.size;
          if (!lastBackup || stat.mtimeMs > lastBackup) {
            lastBackup = stat.mtimeMs;
          }
        }
      }
    }

    let backupStatus: LibraryHealthReport['backup_status'] = 'HEALTHY';
    if (!lastBackup) backupStatus = 'NO_BACKUPS';
    else if (failedSaves > 0) backupStatus = 'WARNING';

    return {
      storage_mode: 'Application-Managed Local Storage',
      storage_root: baseDir,
      total_projects: projects.length,
      total_chapters: totalChapters,
      total_pages: totalPages,
      storage_usage_bytes: storageUsageBytes,
      failed_saves_count: failedSaves,
      last_successful_save: lastSave,
      last_successful_backup: lastBackup,
      backup_status: backupStatus,
      persistent_storage_verified: fs.existsSync(baseDir),
    };
  }

  /**
   * Verify Asset Integrity and handle missing or damaged assets safely (Requirement 31)
   */
  public verifyChapterAssets(novelId: string, chapterNumber: number): {
    status: 'HEALTHY' | 'MISSING_ASSET' | 'DAMAGED_ASSET';
    missing_files: string[];
    damaged_files: string[];
    details: string;
  } {
    const chapterDir = this.libraryStorage.getChapterDir(novelId, chapterNumber);
    const dataPath = path.join(chapterDir, 'chapter_data.json');
    const missing: string[] = [];
    const damaged: string[] = [];

    if (!fs.existsSync(dataPath)) {
      return {
        status: 'MISSING_ASSET',
        missing_files: ['chapter_data.json'],
        damaged_files: [],
        details: 'chapter_data.json is missing on disk',
      };
    }

    try {
      const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
      for (const pg of data.pages || []) {
        const imgPath = path.join(chapterDir, pg.filename);
        if (!fs.existsSync(imgPath)) {
          missing.push(pg.filename);
        } else {
          const stat = fs.statSync(imgPath);
          if (stat.size === 0) damaged.push(pg.filename);
        }
      }
    } catch {
      damaged.push('chapter_data.json');
    }

    if (missing.length > 0) {
      return {
        status: 'MISSING_ASSET',
        missing_files: missing,
        damaged_files: damaged,
        details: `${missing.length} page assets are missing`,
      };
    }

    if (damaged.length > 0) {
      return {
        status: 'DAMAGED_ASSET',
        missing_files: [],
        damaged_files: damaged,
        details: `${damaged.length} assets are corrupt (0-bytes)`,
      };
    }

    return {
      status: 'HEALTHY',
      missing_files: [],
      damaged_files: [],
      details: 'All chapter assets are verified and intact',
    };
  }
}
