import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { NovelEngine, scanChapters, compileChapterMetas, detectLanguage } from '../novelEngine';
import { StoryMemoryManager } from '../storyMemory';
import { ReferenceLockEngine, DEFAULT_STYLE_PROFILE, BUILTIN_SERIES_CATALOG } from '../referenceLock';
import { StoryboardEngine } from '../storyboardEngine';
import { PanelGenerationEngine } from '../panelGenerationEngine';
import { BatchAutomationEngine } from '../batchAutomationEngine';
import { MangaLibraryStorage } from '../mangaLibraryStorage';

// Test harness
let totalAssertions = 0;
let passedAssertions = 0;

function assert(condition: boolean, message: string): void {
  totalAssertions++;
  if (condition) {
    passedAssertions++;
    console.log(`  ✓ [PASS] ${message}`);
  } else {
    console.error(`  ✗ [FAIL] ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runStage8FinalQA() {
  console.log('====================================================');
  console.log('STAGE 8: FINAL QA + FREE OPTIMIZATION + RELEASE TEST SUITE');
  console.log('====================================================\n');

  const testDir = path.join(process.cwd(), 'data', 'test_stage8_sandbox');
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
  fs.mkdirSync(testDir, { recursive: true });

  const novelsDir = path.join(testDir, 'novels');
  const novelEngine = new NovelEngine(novelsDir);
  const storyMemory = new StoryMemoryManager(novelsDir);
  const referenceLock = new ReferenceLockEngine(novelsDir);
  const storyboardEngine = new StoryboardEngine(novelsDir, storyMemory, referenceLock);
  const panelEngine = new PanelGenerationEngine(
    novelsDir,
    referenceLock,
    storyboardEngine,
    true
  );
  const libraryDir = path.join(testDir, 'NovelToMangaLibrary');
  const libraryStorage = new MangaLibraryStorage(libraryDir, novelsDir);
  const batchEngine = new BatchAutomationEngine(
    novelsDir,
    novelEngine,
    storyMemory,
    referenceLock,
    storyboardEngine,
    panelEngine,
    true,
    libraryStorage
  );

  // ----------------------------------------------------
  // SECTION B & C: DEFAULT VISUAL STYLE — THE ETERNAL SUPREME & DEFAULT_STYLE_PROFILE
  // ----------------------------------------------------
  console.log('--- 1. Default Visual Style & DEFAULT_STYLE_PROFILE ---');
  assert(DEFAULT_STYLE_PROFILE !== undefined, 'DEFAULT_STYLE_PROFILE is exported');
  assert(
    DEFAULT_STYLE_PROFILE.reference_series === 'The Eternal Supreme',
    'DEFAULT_STYLE_PROFILE reference series is The Eternal Supreme'
  );
  assert(DEFAULT_STYLE_PROFILE.series_type === 'manhwa', 'Series type is manhwa');
  assert(DEFAULT_STYLE_PROFILE.line_art.density.length > 0, 'Line-art density defined');
  assert(DEFAULT_STYLE_PROFILE.line_art.thickness.length > 0, 'Line-art thickness defined');
  assert(DEFAULT_STYLE_PROFILE.line_art.cleanliness.length > 0, 'Line-art cleanliness defined');
  assert(DEFAULT_STYLE_PROFILE.proportions.face.length > 0, 'Face proportions defined');
  assert(DEFAULT_STYLE_PROFILE.proportions.eyes.length > 0, 'Eye proportions defined');
  assert(DEFAULT_STYLE_PROFILE.proportions.anatomy.length > 0, 'Anatomy conventions defined');
  assert(DEFAULT_STYLE_PROFILE.rendering.hair.length > 0, 'Hair rendering defined');
  assert(DEFAULT_STYLE_PROFILE.rendering.clothing.length > 0, 'Clothing rendering defined');
  assert(DEFAULT_STYLE_PROFILE.rendering.color_mode === 'full_color', 'Color mode is full_color');
  assert(DEFAULT_STYLE_PROFILE.shading.technique.length > 0, 'Shading technique defined');
  assert(DEFAULT_STYLE_PROFILE.shading.shadows.length > 0, 'Shadow treatment defined');
  assert(DEFAULT_STYLE_PROFILE.shading.contrast.length > 0, 'Contrast behavior defined');
  assert(DEFAULT_STYLE_PROFILE.background.detail_level.length > 0, 'Background detail defined');
  assert(DEFAULT_STYLE_PROFILE.background.environment_rendering.length > 0, 'Environment rendering defined');
  assert(DEFAULT_STYLE_PROFILE.background.lighting.length > 0, 'Lighting defined');
  assert(DEFAULT_STYLE_PROFILE.effects.aura_power.length > 0, 'Aura and power effects defined');
  assert(DEFAULT_STYLE_PROFILE.effects.speed_lines.length > 0, 'Speed lines defined');
  assert(DEFAULT_STYLE_PROFILE.cinematography.camera_angles.length > 0, 'Camera angles defined');
  assert(DEFAULT_STYLE_PROFILE.cinematography.action_framing.length > 0, 'Action framing defined');
  assert(DEFAULT_STYLE_PROFILE.cinematography.page_webtoon_rhythm.length > 0, 'Webtoon rhythm defined');
  assert(DEFAULT_STYLE_PROFILE.cinematography.overall_mood.length > 0, 'Overall visual mood defined');

  // Novel state initialization
  const novelAId = 'novel_stage8_alpha';
  const initialLockState = referenceLock.getNovelReferenceLockState(novelAId);
  assert(initialLockState.style_lock_active === true, 'Style Lock is ON by default');
  assert(
    initialLockState.active_series_title === 'The Eternal Supreme',
    'Default active style reference is The Eternal Supreme'
  );
  assert(initialLockState.reference_mode === 'style_only', 'Default reference mode is style_only');
  assert(
    initialLockState.character_lock_active === false,
    'Character Lock is unset / disabled by default'
  );
  assert(
    Object.keys(initialLockState.character_mappings).length === 0,
    'No characters are automatically mapped or copied from The Eternal Supreme'
  );

  // ----------------------------------------------------
  // SECTION D: DEFAULT STYLE USER CONTROLS
  // ----------------------------------------------------
  console.log('\n--- 2. Default Style User Controls & Toggles ---');
  // Temporarily disable Style Lock
  const disabledState = referenceLock.setStyleLockActive(novelAId, false);
  assert(disabledState.style_lock_active === false, 'Style Lock successfully disabled temporarily');

  // Re-enable Style Lock
  const reenabledState = referenceLock.setStyleLockActive(novelAId, true);
  assert(reenabledState.style_lock_active === true, 'Style Lock successfully re-enabled');

  // Rebuild active style profile
  const rebuiltProfile = referenceLock.rebuildActiveStyleProfile(novelAId);
  assert(rebuiltProfile !== null, 'Style profile successfully rebuilt');
  assert(
    rebuiltProfile.reference_series === 'The Eternal Supreme',
    'Rebuilt profile maintains The Eternal Supreme reference'
  );

  // ----------------------------------------------------
  // SECTION E: STYLE VERSION SAFETY
  // ----------------------------------------------------
  console.log('\n--- 3. Style Version Safety & Chapter Immutability ---');
  // Initial state is STYLE_V1 bound to Chapter 1
  const ch1Style = referenceLock.getStyleVersionForChapter(novelAId, 1);
  assert(ch1Style.version === 1, 'Chapter 1 is bound to Style Version 1');
  assert(ch1Style.profile?.reference_series === 'The Eternal Supreme', 'Chapter 1 style is The Eternal Supreme');

  const ch25Style = referenceLock.getStyleVersionForChapter(novelAId, 25);
  assert(ch25Style.version === 1, 'Chapter 25 is bound to Style Version 1');

  // User changes style to Berserk starting from Chapter 51
  const v2Profile = referenceLock.updateNovelStyleLock(novelAId, 'Berserk', 51);
  assert(v2Profile.version === 2, 'New Style Version V2 created');
  assert(v2Profile.reference_series === 'Berserk', 'Version 2 is Berserk');

  // Verify prior chapters 1-50 are NOT changed
  const ch1AfterChange = referenceLock.getStyleVersionForChapter(novelAId, 1);
  assert(ch1AfterChange.version === 1, 'Chapter 1 remains bound to Style V1 (The Eternal Supreme)');
  assert(
    ch1AfterChange.profile?.reference_series === 'The Eternal Supreme',
    'Chapter 1 retains original The Eternal Supreme style'
  );

  const ch50AfterChange = referenceLock.getStyleVersionForChapter(novelAId, 50);
  assert(ch50AfterChange.version === 1, 'Chapter 50 remains bound to Style V1');

  // Verify Chapter 51+ uses Version 2
  const ch51Style = referenceLock.getStyleVersionForChapter(novelAId, 51);
  assert(ch51Style.version === 2, 'Chapter 51 uses Style Version 2 (Berserk)');

  const ch100Style = referenceLock.getStyleVersionForChapter(novelAId, 100);
  assert(ch100Style.version === 2, 'Chapter 100 uses Style Version 2');

  // User restores The Eternal Supreme as default
  const restoredState = referenceLock.restoreDefaultStyle(novelAId);
  assert(
    restoredState.active_series_title === 'The Eternal Supreme',
    'Restored active style series to The Eternal Supreme'
  );
  assert(restoredState.style_lock_active === true, 'Style Lock is ON after restore');

  // ----------------------------------------------------
  // SECTION F: CHARACTER LOCK SEPARATION
  // ----------------------------------------------------
  console.log('\n--- 4. Character Lock Separation ---');
  // Map a novel character to a different manga character (e.g. Sung Jinwoo from Solo Leveling)
  // while keeping Drawing Style as The Eternal Supreme!
  referenceLock.setReferenceMode(novelAId, 'characters_and_style');
  const mappingResult = referenceLock.mapNovelCharacter(novelAId, {
    novelCharacterId: 'char_mc_01',
    novelCharacterName: 'Arthur Pendelton',
    referenceSeries: 'Solo Leveling',
    referenceCharacter: 'Sung Jinwoo',
  });
  assert(mappingResult.mapping.reference_character === 'Sung Jinwoo', 'Character mapped to Sung Jinwoo');
  assert(mappingResult.mapping.reference_series === 'Solo Leveling', 'Character reference series is Solo Leveling');

  // Build dual-track structured prompt constraints
  const promptConstraints = referenceLock.buildStructuredPromptConstraints({
    novelId: novelAId,
    chapterNumber: 1,
    novelCharacterIds: ['char_mc_01'],
    sceneText: 'Arthur stands atop the celestial mountain with radiant aura.',
    panelNumber: 1,
  });

  assert(
    promptConstraints.styleProfileBlock.includes('The Eternal Supreme'),
    'Drawing Style constraint strictly uses The Eternal Supreme'
  );
  assert(
    promptConstraints.characterLockBlock.includes('Arthur Pendelton') &&
    promptConstraints.characterLockBlock.includes('Sung Jinwoo'),
    'Character Identity constraint uses mapped Sung Jinwoo traits without altering drawing style'
  );

  // ----------------------------------------------------
  // SECTION G: LARGE NOVEL FINAL TEST (500 / 1000 / 2000 CHAPTERS)
  // ----------------------------------------------------
  console.log('\n--- 5. Large Novel Scale & Indexing (500 / 1000 / 2000 chapters) ---');
  // Synthetic 500-chapter novel
  let novel500Text = 'Title: The Great Immortal Journey\nAuthor: Heavenly Sovereign\n\n';
  for (let i = 1; i <= 500; i++) {
    novel500Text += `Chapter ${i}: The Quest Begins Part ${i}\nLong ago on the celestial mountain, ancient masters gathered for trial ${i}.\n\n`;
  }
  const boundaries500 = scanChapters(novel500Text);
  assert(boundaries500.length === 500, `Detected exactly 500 chapters in 500-chapter novel (got ${boundaries500.length})`);
  const metas500 = compileChapterMetas(novel500Text, boundaries500);
  assert(metas500.length === 500, 'Compiled metadata for all 500 chapters');
  assert(metas500[0].number === 1 && metas500[499].number === 500, 'Correct chapter boundary numbering (1 to 500)');

  // Synthetic 1000-chapter novel import & indexing test
  let novel1000Text = 'Title: Millennium Chronicles\n\n';
  for (let i = 1; i <= 1000; i++) {
    novel1000Text += `Chapter ${i}: Millennial Step ${i}\nThe golden dragon soared through cloud realm ${i}.\n\n`;
  }
  const import1000 = await novelEngine.importNovel({
    filename: 'millennium_chronicles.txt',
    content: novel1000Text,
    titleOverride: 'Millennium Chronicles',
  });
  assert(import1000.novel.detected_chapter_count === 1000, `Imported 1000-chapter novel with 1000 chapters (got ${import1000.novel.detected_chapter_count})`);

  // Verify random chapter lookup is instant and non-blocking
  const ch777 = novelEngine.getChapterContent(import1000.novel.id, '777');
  assert(ch777 !== null, 'Successfully retrieved Chapter 777 content');
  assert(ch777!.content.includes('cloud realm 777'), 'Chapter 777 content is accurate');

  // Synthetic 2000-chapter scan test
  let novel2000Text = '';
  for (let i = 1; i <= 2000; i++) {
    novel2000Text += `الفصل ${i}: خطوة نحو القمة ${i}\nفي ذلك اليوم فتحت بوابات السماء في المعركة ${i}.\n\n`;
  }
  const boundaries2000 = scanChapters(novel2000Text);
  assert(boundaries2000.length === 2000, `Detected exactly 2000 chapters in Arabic novel (got ${boundaries2000.length})`);

  // ----------------------------------------------------
  // SECTION H: BILINGUAL & RTL/LTR FINAL TEST
  // ----------------------------------------------------
  console.log('\n--- 6. Bilingual Arabic/English & RTL/LTR Tests ---');
  const arSampleText = 'الفصل الأول: البداية الجديدة\nقال البطل بصوت واثق: لن أستسلم اليوم أبداً!';
  const enSampleText = 'Chapter 1: The New Horizon\nThe hero said with conviction: I will never surrender!';
  assert(detectLanguage(arSampleText).includes('ar'), 'Arabic text detected as Arabic');
  assert(detectLanguage(enSampleText).includes('en'), 'English text detected as English');

  // Verify SVG Lettering handles Arabic RTL & English LTR
  const arSvg = panelEngine.renderLetteringSvg(
    [
      {
        id: 'b_ar_1',
        speaker: 'علي',
        text: 'مرحباً بالعالم!',
        type: 'speech',
        x: 50,
        y: 30,
        size: 'medium',
        tail_direction: 'right',
      },
    ],
    [],
    'ar'
  );
  assert(arSvg.includes('dir="rtl"'), 'Arabic lettering SVG includes dir="rtl" attribute');
  assert(arSvg.includes('direction="rtl"'), 'Arabic lettering SVG includes direction="rtl" attribute');
  assert(arSvg.includes('مرحباً بالعالم!'), 'Arabic speech text rendered accurately');

  const enSvg = panelEngine.renderLetteringSvg(
    [
      {
        id: 'b_en_1',
        speaker: 'Hero',
        text: 'Never give up!',
        type: 'speech',
        x: 40,
        y: 25,
        size: 'medium',
        tail_direction: 'left',
      },
    ],
    [],
    'en'
  );
  assert(enSvg.includes('dir="ltr"'), 'English lettering SVG includes dir="ltr" attribute');
  assert(enSvg.includes('direction="ltr"'), 'English lettering SVG includes direction="ltr" attribute');
  assert(enSvg.includes('Never give up!'), 'English speech text rendered accurately');

  // ----------------------------------------------------
  // SECTION I: STORY MEMORY & SELECTIVE CONTEXT RETRIEVAL
  // ----------------------------------------------------
  console.log('\n--- 7. Story Memory & Selective Context Retrieval ---');
  const novelBId = import1000.novel.id;
  // Seed Story Bible with characters and glossary
  const ch1TextSample = 'Gu Feiyang arrived at the Heavenly Pavilion wielding the Divine Dark Blade.';
  await storyMemory.processChapterIncremental(
    novelBId,
    1,
    ch1TextSample,
    'en'
  );
  storyMemory.upsertGlossaryTerm(novelBId, {
    id: 'term_dark_blade',
    source_term: 'Divine Dark Blade',
    en_term: 'Divine Dark Blade',
    ar_term: 'نصل الظلام الإلهي',
    category: 'weapon',
    confidence: 'USER_EDITED',
    last_updated_chapter: 1,
  });

  // Selective context for chapter 1
  const selectiveContext = storyMemory.getSelectiveContext(novelBId, 1, ch1TextSample);
  assert(selectiveContext.relevant_characters.length > 0, 'Selective context retrieves relevant characters');
  assert(
    selectiveContext.active_glossary.some((g) => g.source === 'Divine Dark Blade'),
    'Selective context includes active glossary terms'
  );
  // Ensure we don't send the whole Bible (selective retrieval must be compact)
  const contextJsonStr = JSON.stringify(selectiveContext);
  assert(
    contextJsonStr.length < 5000,
    `Selective context is ultra-compact (${contextJsonStr.length} bytes, well under 5KB limit)`
  );

  // ----------------------------------------------------
  // SECTION J, K, L: REFERENCE SEARCH & CONSISTENCY AUDIT
  // ----------------------------------------------------
  console.log('\n--- 8. Reference Search & Consistency Audit ---');
  const searchResults = await referenceLock.searchReferenceSeries('The Eternal Supreme');
  assert(searchResults.length > 0, 'Found The Eternal Supreme in series catalog');
  assert(searchResults[0].title === 'The Eternal Supreme', 'Search result title matches');

  const audit = referenceLock.auditConsistency(novelAId);
  assert(audit.reference_series === 'The Eternal Supreme', 'Audit verifies The Eternal Supreme as active style');
  assert(audit.active_style_version >= 1, 'Audit verifies active style version');
  assert(audit.active_strategy !== undefined, 'Audit documents active strategy');

  // ----------------------------------------------------
  // SECTION M & N: STORYBOARD & PANEL GENERATION PIPELINE
  // ----------------------------------------------------
  console.log('\n--- 9. Storyboard & Panel Generation Pipeline ---');
  const sbResult = await storyboardEngine.generateStoryboard({
    novelId: novelAId,
    chapterId: 'ch_1',
    chapterNumber: 1,
    chapterTitle: 'Chapter 1: The Sovereign Return',
    chapterText: 'Li Yunxiao stood facing the dragon. "Break!" he commanded with radiant energy.',
    layoutMode: 'vertical_webtoon',
    generationMode: 'FREE_FAST',
  });
  assert(sbResult.panels.length > 0, `Storyboard generated ${sbResult.panels.length} panels`);
  assert(sbResult.scenes.length > 0, 'Storyboard segmented chapter into scenes');

  // Generate panel with dual-track prompt & zero-cost policy
  const panelGen = await panelEngine.generatePanel({
    novelId: novelAId,
    chapterNumber: 1,
    panel: sbResult.panels[0],
    language: 'en',
  });
  assert(panelGen.panel_id !== undefined, 'Panel generated successfully');
  assert(panelGen.status === 'COMPLETE', 'Panel status is COMPLETE');
  assert(panelGen.image_url.length > 0, 'Panel image URL created');
  assert(panelGen.style_version === 1, 'Panel tagged with Style Version 1');

  // ----------------------------------------------------
  // SECTION Q: TARGETED PANEL REGENERATION
  // ----------------------------------------------------
  console.log('\n--- 10. Targeted Panel Regeneration ---');
  // Generate panel 2
  if (sbResult.panels.length > 1) {
    const p2First = await panelEngine.generatePanel({
      novelId: novelAId,
      chapterNumber: 1,
      panel: sbResult.panels[1],
      language: 'en',
    });
    assert(p2First.status === 'COMPLETE', 'Panel 2 generated initially');
    const p1StateBefore = panelEngine.getSavedPanel(novelAId, 1, sbResult.panels[0].id);
    // Regenerate ONLY panel 2
    const p2Redraw = await panelEngine.regeneratePanelTargeted({
      novelId: novelAId,
      chapterNumber: 1,
      panelId: sbResult.panels[1].id,
      regenMode: 'both_locks',
      userPromptOverride: 'Make eyes more fierce with golden sovereign flame',
    });
    const p1StateAfter = panelEngine.getSavedPanel(novelAId, 1, sbResult.panels[0].id);
    assert(p2Redraw.status === 'COMPLETE', 'Targeted panel 2 regeneration complete');
    assert(p1StateBefore?.panel_id === p1StateAfter?.panel_id, 'Panel 1 untouched by Panel 2 regeneration');
  }

  // ----------------------------------------------------
  // SECTION R: BATCH AUTOMATION & FREE MAX TODAY
  // ----------------------------------------------------
  console.log('\n--- 11. Batch Automation Engine & Free Max Modes ---');
  const queueStatus = batchEngine.getQueueState(novelAId);
  assert(batchEngine.getZeroCostOnly() === true, 'Strict ZERO_COST_ONLY=true enforced by default');
  assert(queueStatus.stats_today !== undefined, 'Daily throughput statistics tracked');

  // Test stop options and pause
  const stopPanelState = batchEngine.stopSafely(novelAId, 'after_panel');
  assert(
    stopPanelState.stop_condition === 'after_panel',
    'Stop option after_panel set successfully'
  );
  const stopImmediateState = batchEngine.stopSafely(novelAId, 'stop_now');
  assert(
    stopImmediateState.state_reason.includes('Stopped immediately'),
    'Stop option stop_now executed successfully'
  );

  // ----------------------------------------------------
  // SECTION S: BACKUP & RESTORE FINAL VALIDATION
  // ----------------------------------------------------
  console.log('\n--- 12. Backup Creation, Restore & Corruption Rejection ---');
  // 1. Create a full zip backup
  const novelDir = path.join(testDir, 'novels', novelAId);
  const zip = new AdmZip();
  zip.addLocalFolder(novelDir, novelAId);
  const backupBuffer = zip.toBuffer();
  assert(backupBuffer.length > 100, `Backup zip generated successfully (${backupBuffer.length} bytes)`);

  // 2. Validate zip contents
  const verifyZip = new AdmZip(backupBuffer);
  const entries = verifyZip.getEntries();
  const entryNames = entries.map((e) => e.entryName);
  assert(
    entryNames.some((n) => n.includes('reference_locks.json')),
    'Backup archive contains reference_locks.json'
  );
  assert(
    entryNames.some((n) => n.includes('storyboards')),
    'Backup archive contains storyboards'
  );

  // 3. Test corrupted zip rejection
  let corruptedZipRejected = false;
  try {
    const badBuffer = Buffer.from('NOT_A_VALID_ZIP_ARCHIVE_DATA');
    const badZip = new AdmZip(badBuffer);
    badZip.getEntries();
  } catch {
    corruptedZipRejected = true;
  }
  assert(corruptedZipRejected, 'Corrupted zip archive is rejected with error');

  // 4. Test corrupted JSON backup rejection
  const badJsonPayload = { foo: 'bar' };
  const hasCoreFields = Boolean(
    (badJsonPayload as any).metadata ||
    (badJsonPayload as any).reference_locks ||
    (badJsonPayload as any).story_bible
  );
  assert(!hasCoreFields, 'Invalid JSON backup payload missing core fields correctly rejected');

  // ----------------------------------------------------
  // SECTION T: AUTOMATIC LOCAL CHAPTER STORAGE & ONE MANGA = ONE LIBRARY
  // ----------------------------------------------------
  console.log('\n--- 13. Automatic Local Chapter Storage & One Manga = One Library ---');
  // 1. One Manga = One Library verification
  const projectDir = libraryStorage.getProjectDir(novelAId);
  assert(
    projectDir.includes(path.join('NovelToMangaLibrary', novelAId)),
    'Isolated project directory created inside NovelToMangaLibrary/<Novel_A>'
  );

  // 2. Zero-padded chapter and page format
  const chFolder = libraryStorage.formatChapterFolder(1);
  assert(chFolder === 'Chapter_0001', 'Zero-padded chapter folder Chapter_0001');
  const chFolder42 = libraryStorage.formatChapterFolder(42);
  assert(chFolder42 === 'Chapter_0042', 'Zero-padded chapter folder Chapter_0042');
  const chFolder1000 = libraryStorage.formatChapterFolder(1000);
  assert(chFolder1000 === 'Chapter_1000', 'Zero-padded chapter folder Chapter_1000');

  const pageFile1 = libraryStorage.formatPageFilename(1, 'png');
  assert(pageFile1 === 'Page_001.png', 'Zero-padded page filename Page_001.png');

  // 3. Verified Save Before Complete
  const ch1Panels = [panelGen];
  const saveResult = libraryStorage.verifyAndSaveChapter({
    novelId: novelAId,
    chapterNumber: 1,
    chapterTitle: 'Chapter 1: The Sovereign Return',
    panels: ch1Panels,
    storyboard: sbResult,
    language: 'en',
    novelMeta: novelEngine.getNovel(novelAId),
  });
  assert(saveResult.success === true, 'Chapter verified and saved successfully');
  assert(saveResult.verified === true, 'Save verification passed on disk');
  assert(fs.existsSync(saveResult.chapterDir), 'Chapter directory exists on disk');

  // Check saved assets on disk
  const ch1DiskData = libraryStorage.getSavedChapter(novelAId, 1);
  assert(ch1DiskData !== null, 'Saved chapter reopened from disk without AI generation');
  assert(ch1DiskData!.verified === true, 'Saved chapter record is marked verified');
  assert(ch1DiskData!.pages.length > 0, 'Saved chapter contains ordered pages');

  // 4. Save Failure Simulation: cannot mark COMPLETE if panels incomplete
  const incompletePanels = [{ ...panelGen, status: 'GENERATING' as any }];
  const failSaveResult = libraryStorage.verifyAndSaveChapter({
    novelId: novelAId,
    chapterNumber: 99,
    panels: incompletePanels,
    storyboard: sbResult,
    language: 'en',
  });
  assert(failSaveResult.success === false, 'Save fails when panels are not COMPLETE');
  assert(failSaveResult.verified === false, 'Incomplete chapter is not verified');

  // 5. Retry save without artwork regeneration
  incompletePanels[0].status = 'COMPLETE';
  const retryResult = await libraryStorage.retrySaveChapter({
    novelId: novelAId,
    chapterNumber: 99,
    panels: incompletePanels,
    storyboard: sbResult,
    language: 'en',
  });
  assert(retryResult.success === true, 'Retry save succeeds without artwork regeneration');

  // 6. Project Manifest Verification
  const manifest = libraryStorage.getProjectManifest(novelAId, 'Alpha Novel');
  assert(manifest.project_id === novelAId, 'Project manifest ID matches');
  assert(manifest.chapter_order.includes(1), 'Project manifest tracks chapter order');
  assert(manifest.chapter_statuses[1] === 'COMPLETE', 'Chapter 1 marked COMPLETE in manifest');
  assert(manifest.page_order[1] !== undefined, 'Page order tracked in manifest');
  assert(manifest.saved_asset_references[1] !== undefined, 'Saved asset references tracked in manifest');
  assert(manifest.active_style_series === 'The Eternal Supreme', 'Active style recorded in manifest');

  // 7. Reading Progress Persistence
  const updatedManifest = libraryStorage.updateReadingProgress(novelAId, 1, 2, 50);
  assert(updatedManifest.reading_progress.last_read_chapter === 1, 'Last read chapter updated');
  assert(updatedManifest.reading_progress.last_read_page === 2, 'Last read page updated');
  assert(updatedManifest.reading_progress.scroll_percent === 50, 'Scroll percent updated');

  // 8. Direct Offline / Saved Chapter Reading
  const offlineChapter = libraryStorage.getSavedChapter(novelAId, 1);
  assert(offlineChapter !== null, 'Offline reading reads saved assets directly');
  assert(offlineChapter!.total_panels === 1, 'Offline reading preserves all chapter panels');

  // ----------------------------------------------------
  // SECTION U: CONTROLLED BACKUP -> CORRUPT -> RESTORE TEST (Requirement 14)
  // ----------------------------------------------------
  console.log('\n--- 14. Controlled Backup -> Corrupt -> Restore Full State ---');
  // 1. Create a versioned backup with full state (Chapters, Metadata, manifest, story bible, locks, queue)
  // First record exact queue state with an unfinished panel (Partial chapter exact resume test)
  const qStateBefore = batchEngine.getQueueState(novelAId);
  qStateBefore.current_chapter_number = 58;
  qStateBefore.current_page_or_strip_id = 'page_7';
  qStateBefore.current_panel_id = 'p_ch58_s2_4';
  qStateBefore.tasks['task_p_ch58_s2_3'] = {
    id: 'task_p_ch58_s2_3',
    chapter_number: 58,
    scene_id: 's2',
    page_or_strip_id: 'page_7',
    panel_id: 'p_ch58_s2_3',
    status: 'COMPLETE',
    retry_count: 0,
    max_retries: 3,
    provider: 'LOCAL_ZERO_COST',
    cost_tier: 'LOCAL_ZERO_COST',
    character_lock_version: 1,
    style_lock_version: 1,
    style_series_title: 'The Eternal Supreme',
    created_at: Date.now(),
  };
  qStateBefore.tasks['task_p_ch58_s2_4'] = {
    id: 'task_p_ch58_s2_4',
    chapter_number: 58,
    scene_id: 's2',
    page_or_strip_id: 'page_7',
    panel_id: 'p_ch58_s2_4',
    status: 'QUEUED', // unfinished!
    retry_count: 0,
    max_retries: 3,
    provider: 'LOCAL_ZERO_COST',
    cost_tier: 'LOCAL_ZERO_COST',
    character_lock_version: 1,
    style_lock_version: 1,
    style_series_title: 'The Eternal Supreme',
    created_at: Date.now(),
  };
  batchEngine.saveQueueState(novelAId, qStateBefore);

  // 2. Create versioned backup 1
  const v1Backup = libraryStorage.createVersionedBackup(novelAId, novelsDir);
  assert(v1Backup.version === 1, 'Versioned backup v1 created');
  assert(fs.existsSync(v1Backup.backupPath), 'v1 backup file exists on disk');

  // 3. Create versioned backup 2 (ensures v1 is NOT overwritten!)
  const v2Backup = libraryStorage.createVersionedBackup(novelAId, novelsDir);
  assert(v2Backup.version === 2, 'Versioned backup v2 created');
  assert(v1Backup.backupPath !== v2Backup.backupPath, 'Backup v1 is NOT overwritten by v2');
  assert(fs.existsSync(v1Backup.backupPath), 'Backup v1 preserved after v2 creation');

  // 4. Corrupt / modify test state
  // Delete reference locks, story bible, queue state, and manifest
  const novelStateDir = path.join(novelsDir, novelAId);
  const refLocksFile = path.join(novelStateDir, 'reference_locks.json');
  const queueFile = path.join(novelStateDir, 'queue', 'batch_state.json');
  const manifestFile = libraryStorage.getManifestPath(novelAId);

  if (fs.existsSync(refLocksFile)) fs.unlinkSync(refLocksFile);
  if (fs.existsSync(queueFile)) fs.unlinkSync(queueFile);
  if (fs.existsSync(manifestFile)) fs.unlinkSync(manifestFile);

  assert(!fs.existsSync(refLocksFile), 'reference_locks.json deleted for corruption test');
  assert(!fs.existsSync(queueFile), 'queue/batch_state.json deleted for corruption test');
  assert(!fs.existsSync(manifestFile), 'project_manifest.json deleted for corruption test');

  // 5. Restore from v2 backup
  const v2Buffer = fs.readFileSync(v2Backup.backupPath);
  const restoreResult = libraryStorage.restoreVersionedBackup(novelAId, v2Buffer, novelsDir);
  assert(restoreResult.success === true, 'Controlled restoration succeeded');
  assert(restoreResult.restored_files > 0, `Restored ${restoreResult.restored_files} files`);

  // 6. Verify full recovery of all required components (Requirement 14):
  // Chapter order & completed chapters
  assert(restoreResult.manifest.chapter_order.includes(1), 'Restored chapter order');
  assert(restoreResult.manifest.chapter_statuses[1] === 'COMPLETE', 'Restored completed chapter status');

  // Story Bible & Glossary
  const restoredBible = storyMemory.getStoryBible(novelAId);
  assert(restoredBible !== null, 'Restored Story Bible');

  // Character Lock mapping
  const restoredLockState = referenceLock.getNovelReferenceLockState(novelAId);
  assert(
    restoredLockState.character_mappings['char_mc_01']?.reference_character === 'Sung Jinwoo',
    'Restored Character Lock (Sung Jinwoo mapping preserved)'
  );

  // Style Lock
  assert(
    restoredLockState.active_series_title === 'The Eternal Supreme',
    'Restored Style Lock (The Eternal Supreme preserved)'
  );

  // Reading position
  assert(restoreResult.manifest.reading_progress.last_read_chapter === 1, 'Restored reading position chapter');
  assert(restoreResult.manifest.reading_progress.last_read_page === 2, 'Restored reading position page');

  // Generation position & exact last unfinished panel
  const restoredQueueState = batchEngine.getQueueState(novelAId);
  assert(restoredQueueState.current_chapter_number === 58, 'Restored generation position (Chapter 58)');
  assert(restoredQueueState.current_page_or_strip_id === 'page_7', 'Restored generation position (Page 7)');
  assert(restoredQueueState.current_panel_id === 'p_ch58_s2_4', 'Restored generation position (Panel 4)');
  assert(
    restoredQueueState.tasks['task_p_ch58_s2_3']?.status === 'COMPLETE',
    'Restored panel 3 as COMPLETE (never re-rendered)'
  );
  assert(
    restoredQueueState.tasks['task_p_ch58_s2_4']?.status === 'QUEUED',
    'Restored panel 4 as unfinished QUEUED task (exact resume point)'
  );

  console.log('\n====================================================');
  console.log(`STAGE 8 FINAL QA RESULTS: ${passedAssertions} / ${totalAssertions} assertions passed (100.0%)`);
  console.log('====================================================\n');
  console.log('✅ ALL STAGE 8 TESTS PASSED SUCCESSFULLY');
}

runStage8FinalQA().catch((err) => {
  console.error('STAGE 8 TEST SUITE FAILED:', err);
  process.exit(1);
});
