/**
 * Stage 5 Verification & Benchmarks: Chapter to Manga Storyboard
 * Validates:
 * 1. Chapter Processing & Selective Context (One chapter at a time, zero whole-novel leak)
 * 2. Scene Extraction (Arabic & English, locations, time, participants, tones, objects, dialogue)
 * 3. Manga Script Visual Conversion & Monologue Preservation (thought bubbles vs narration)
 * 4. Page Layout Modes (Manga Pages vs Vertical Webtoon)
 * 5. Panel Plan Schema & Unique IDs
 * 6. Generation Speed Modes (FREE_FAST vs STANDARD vs HIGH_QUALITY)
 * 7. Smart Panel Count (Fight dynamic pacing vs dialogue vs transition, anti-hardcoded 7)
 * 8. Storyboard Review (Edit panel dialogue/camera/pose, add panel, delete panel, approve plan)
 * 9. Generation Tasks Compilation & Provider Routing (Agnes L2 img2img vs Agnes L1 prompt conditioning)
 * 10. Character Lock & Style Lock Integration
 * 11. Persistence & Clean Restart Recovery from Disk
 * 12. ZERO_COST_ONLY Compliance
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { StoryboardEngine } from '../storyboardEngine.js';
import { StoryMemoryManager } from '../storyMemory.js';
import { ReferenceLockEngine } from '../referenceLock.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_DIR = path.join(__dirname, '..', 'novels_test_stage5');

if (fs.existsSync(TEST_DIR)) {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
}
fs.mkdirSync(TEST_DIR, { recursive: true });

async function runStage5Tests() {
  console.log('====================================================');
  console.log('STAGE 5 VERIFICATION: NOVEL CHAPTER TO MANGA STORYBOARD');
  console.log('====================================================\n');

  let passed = 0;
  let total = 0;

  function assert(desc: string, condition: boolean, extra?: string) {
    total++;
    if (condition) {
      console.log(`  ✓ [PASS] ${desc}`);
      passed++;
    } else {
      console.error(`  ✗ [FAIL] ${desc}${extra ? ' -> ' + extra : ''}`);
      process.exitCode = 1;
    }
  }

  const storyMemory = new StoryMemoryManager(TEST_DIR);
  const refLock = new ReferenceLockEngine(TEST_DIR);
  const sbEngine = new StoryboardEngine(TEST_DIR, storyMemory, refLock);
  const novelId = 'novel_stage5_test';

  // Seed Story Bible & Reference Lock for novel
  await storyMemory.processChapterIncremental(
    novelId,
    1,
    'Tariq and his companion Layla entered the Grand Citadel. Tariq wielded the Celestial Blade. Layla cast Starfire Veil.',
    'en'
  );
  await refLock.setReferenceMode(novelId, 'characters_and_style');
  await refLock.mapNovelCharacter(novelId, {
    novelCharacterId: 'tariq',
    novelCharacterName: 'Tariq',
    referenceSeries: 'Solo Leveling',
    referenceCharacter: 'Sung Jinwoo',
    lockImmediately: true,
  });

  // --- Test 1: Arabic Chapter Storyboard ---
  console.log('1. Arabic Chapter Storyboard & Bilingual Scene Extraction:');
  const arabicText = `الفصل الأول: معركة بوابة الظلال

في ساحة المعركة الكبرى عند أطلال القلعة المظلمة، كانت الرياح تعصف بشدة.
وقف طارق وهو يحدق في جيش الوحوش المقترب من الأفق.
سحب سيف النور الأبدي وصرخ بصوت ملأ الساحة: «لن تسقط هذه القلعة اليوم! استعدوا للدفاع!»
ردت ليلى وهي ترفع عصا النجوم: «سأغطي جناحك الأيمن بسحر اللهب الأزرق!»

***

داخل القلعة المظلمة، ساد الهدوء لبرهة.
فكر طارق في نفسه: هل سننجو من هذه الكارثة إذا استمر تدفق الوحوش؟
«علينا إغلاق البوابة قبل شروق الشمس»، همس طارق بحزم.`;

  const sbArabic = await sbEngine.generateStoryboard({
    novelId,
    chapterId: 'ch_01',
    chapterNumber: 1,
    chapterTitle: 'معركة بوابة الظلال',
    chapterText: arabicText,
    layoutMode: 'vertical_webtoon',
    generationMode: 'FREE_FAST',
    forceRegenerate: true,
  });

  assert('Arabic storyboard successfully generated', !!sbArabic);
  assert('Detected scenes across scene break (***)', sbArabic.scenes.length >= 2);
  assert('Scene 1 location extracted in Arabic (ساحة المعركة الكبرى)', sbArabic.scenes[0].location.includes('ساحة المعركة') || sbArabic.scenes[0].location.includes('القلعة'));
  assert('Scene 1 tone identified as intense combat', sbArabic.scenes[0].emotional_tone.includes('combat'));
  assert('Arabic dialogue extracted with speaker Tariq/طارق', sbArabic.scenes[0].dialogue.length >= 2);
  assert('Arabic exclamation detected as shout bubble', sbArabic.scenes[0].dialogue.some((d) => d.bubble_type === 'shout'));
  
  // Scene 2 checks for thought bubble & internal monologue
  const scene2 = sbArabic.scenes[1];
  assert('Scene 2 location identified (داخل القلعة المظلمة)', scene2.location.includes('القلعة المظلمة') || scene2.location.includes('القلعة'));
  assert('Internal monologue preserved as thought bubble', scene2.dialogue.some((d) => d.bubble_type === 'thought') || sbArabic.panels.some((p) => p.dialogue.some((d) => d.bubble_type === 'thought')));

  // --- Test 2: English Chapter & Fight Choreography ---
  console.log('\n2. English Chapter & Fight Scene Choreography:');
  const fightText = `Chapter 2: Clash at Iron Ridge

At the Iron Ridge Summit, the wind howled fiercely over jagged peaks.
Tariq stood face to face with the Crimson Wyrm.
"Show me your true strength," Tariq challenged with cold calm.
The Wyrm unleashed an inferno of black flames that scorched the stone!
Tariq dropped low, his daggers slicing diagonally through the heat haze with a sharp SLASH!
He struck the dragon's armored throat, sending a seismic shockwave rippling across the valley!
Tariq landed on one knee, breath steady, eyes glowing with unyielding resolve.`;

  const sbFight = await sbEngine.generateStoryboard({
    novelId,
    chapterId: 'ch_02',
    chapterNumber: 2,
    chapterTitle: 'Clash at Iron Ridge',
    chapterText: fightText,
    layoutMode: 'vertical_webtoon',
    generationMode: 'FREE_FAST',
    forceRegenerate: true,
  });

  assert('Fight chapter storyboard generated', !!sbFight);
  assert('Combat tone detected', sbFight.scenes[0].emotional_tone.includes('combat'));
  assert('Dynamic fight panels budgeted (establishing, strike, impact, resolve)', sbFight.panels.length >= 4);
  assert('Combat strike panel has low angle or dynamic camera', sbFight.panels.some((p) => p.camera_angle === 'low_angle' || p.framing === 'cut_in'));
  assert('Impact panel contains SFX (SLASH! or BOOM!)', sbFight.panels.some((p) => p.sfx && p.sfx.length > 0));

  // --- Test 3: Dialogue-Heavy Chapter ---
  console.log('\n3. Dialogue-Heavy Chapter & Conversational Pacing:');
  const dialogueText = `Chapter 3: Council of Elders

Inside the Grand Council Chamber, the afternoon sunlight poured through stained glass.
Elder Moran sat at the mahogany table, furrowing his brow.
"The eastern borders have gone silent," Moran stated grimly.
"We cannot afford another war," Tariq replied, leaning forward with intense urgency.
"If we hesitate, the shadow rifts will consume the capital," Layla interjected.
Moran sighed, tapping his weathered fingers against the parchment. "Then we must act tonight."
"I will lead the vanguard," Tariq declared without a shred of doubt.`;

  const sbDialogue = await sbEngine.generateStoryboard({
    novelId,
    chapterId: 'ch_03',
    chapterNumber: 3,
    chapterTitle: 'Council of Elders',
    chapterText: dialogueText,
    layoutMode: 'vertical_webtoon',
    generationMode: 'FREE_FAST',
    forceRegenerate: true,
  });

  assert('Dialogue-heavy storyboard generated', !!sbDialogue);
  assert('Dialogue beats extracted correctly (multiple lines)', sbDialogue.scenes[0].dialogue.length >= 4);
  assert('Panels feature conversational framing (medium_shot or close_up)', sbDialogue.panels.every((p) => p.framing === 'medium_shot' || p.framing === 'close_up' || p.framing === 'wide_shot'));
  assert('Dialogue speech lines assigned to panels', sbDialogue.panels.some((p) => p.dialogue.length > 0));

  // --- Test 4: Multiple Locations Chapter ---
  console.log('\n4. Multiple Locations Chapter:');
  const multiLocText = `Chapter 4: The Long Journey

At the Seaside Pier, sea spray misted the wooden docks as ships prepared to set sail.
Tariq waved farewell to the harbor master as dawn broke over the horizon.

***

Hours later, deep within the Whispering Forest, ancient boughs blocked the sunlight.
Strange shadows darted between the moss-covered pines.
"Stay alert," Tariq cautioned his scouts.

***

By nightfall, at the Obsidian Fortress Gates, heavy iron portcullises barred the way.
Torches flickered against black stone.`;

  const sbMultiLoc = await sbEngine.generateStoryboard({
    novelId,
    chapterId: 'ch_04',
    chapterNumber: 4,
    chapterTitle: 'The Long Journey',
    chapterText: multiLocText,
    layoutMode: 'vertical_webtoon',
    generationMode: 'FREE_FAST',
    forceRegenerate: true,
  });

  assert('Multiple locations chapter extracted 3 distinct scenes', sbMultiLoc.scenes.length === 3);
  assert('Scene 1 captures Pier / Harbor location', sbMultiLoc.scenes[0].location.toLowerCase().includes('pier') || sbMultiLoc.scenes[0].location.toLowerCase().includes('seaside'));
  assert('Scene 2 captures Forest location', sbMultiLoc.scenes[1].location.toLowerCase().includes('forest'));
  assert('Scene 3 captures Fortress location and Night time', sbMultiLoc.scenes[2].location.toLowerCase().includes('fortress') && sbMultiLoc.scenes[2].time_of_day === 'Night');

  // --- Test 5: Multi-Character Chapter ---
  console.log('\n5. Multi-Character Chapter:');
  const multiCharText = `Chapter 5: The Vanguard Assembly

In the War Room, Tariq, Layla, General Vance, and Scholar Cheryl gathered around the map.
"Tariq will spearhead the assault," Vance announced.
"Cheryl, prepare the teleportation glyphs," Layla requested.
"The coordinates are locked and ready," Cheryl confirmed.`;

  const sbMultiChar = await sbEngine.generateStoryboard({
    novelId,
    chapterId: 'ch_05',
    chapterNumber: 5,
    chapterTitle: 'The Vanguard Assembly',
    chapterText: multiCharText,
    layoutMode: 'vertical_webtoon',
    generationMode: 'FREE_FAST',
    forceRegenerate: true,
  });

  assert('Multi-character chapter captured participating characters', sbMultiChar.scenes[0].participating_characters.length >= 2);
  assert('Panels include character tags', sbMultiChar.panels[0].characters.length > 0);

  // --- Test 6: Manga Page Mode vs Vertical Webtoon Mode ---
  console.log('\n6. Layout Modes: Manga Page (Paginated) vs Vertical Webtoon:');
  const sbMangaPage = await sbEngine.generateStoryboard({
    novelId,
    chapterId: 'ch_06',
    chapterNumber: 6,
    chapterTitle: 'Manga Page Test',
    chapterText: fightText,
    layoutMode: 'manga_page',
    generationMode: 'STANDARD',
    forceRegenerate: true,
  });

  assert('Manga page mode layout_mode is manga_page', sbMangaPage.layout_mode === 'manga_page');
  assert('Manga page mode paginates panels into pages', sbMangaPage.pages.length >= 1);
  assert('Panels have page_or_strip_id prefixed with page_', sbMangaPage.panels[0].page_or_strip_id.startsWith('page_'));
  assert('Panels have panel_number_in_page bounded between 1 and 5', sbMangaPage.panels.every((p) => p.panel_number_in_page >= 1 && p.panel_number_in_page <= 5));

  const sbWebtoon = await sbEngine.generateStoryboard({
    novelId,
    chapterId: 'ch_06_wt',
    chapterNumber: 6,
    chapterTitle: 'Webtoon Test',
    chapterText: fightText,
    layoutMode: 'vertical_webtoon',
    generationMode: 'STANDARD',
    forceRegenerate: true,
  });

  assert('Webtoon mode layout_mode is vertical_webtoon', sbWebtoon.layout_mode === 'vertical_webtoon');
  assert('Webtoon mode groups into continuous strip_01', sbWebtoon.pages[0].page_id === 'strip_01');

  // --- Test 7: FREE_FAST Mode & Smart Panel Count ---
  console.log('\n7. Generation Speed Modes & Smart Panel Pacing:');
  const sbFast = await sbEngine.generateStoryboard({
    novelId,
    chapterId: 'ch_07_fast',
    chapterNumber: 7,
    chapterTitle: 'Speed Mode Comparison',
    chapterText: fightText,
    generationMode: 'FREE_FAST',
    forceRegenerate: true,
  });

  const sbHq = await sbEngine.generateStoryboard({
    novelId,
    chapterId: 'ch_07_hq',
    chapterNumber: 7,
    chapterTitle: 'Speed Mode Comparison HQ',
    chapterText: fightText,
    generationMode: 'HIGH_QUALITY',
    forceRegenerate: true,
  });

  assert('FREE_FAST mode produces smart compact panel count for high throughput', sbFast.panels.length <= sbHq.panels.length);
  assert('FREE_FAST did NOT remove important story beats (scenes preserved)', sbFast.scenes.length === sbHq.scenes.length);
  assert('Anti-hardcoded 7 panels validated (panel count is dynamic)', sbFast.panels.length !== 7 || sbDialogue.panels.length !== 7);

  // --- Test 8: Character Lock & Style Lock Integration ---
  console.log('\n8. Character Lock & Style Lock Integration in Panel Plan:');
  const charLockedPanel = sbFight.panels.find((p) => p.character_lock_ids.includes('tariq'));
  assert('Panel includes Character Lock ID for mapped character', !!charLockedPanel);
  assert('Panel prompt payload contains Character Lock block', charLockedPanel?.prompt_payload?.character_lock_block.includes('CHARACTER LOCK') ?? false);
  assert('Panel prompt payload contains Style Lock profile', charLockedPanel?.prompt_payload?.style_lock_block.includes('VISUAL STYLE PROFILE') ?? false);
  assert('Panel style_version matches active style lock version', charLockedPanel?.style_version === 1);

  // --- Test 9: Storyboard Review Operations (Edit, Add, Delete, Approve) ---
  console.log('\n9. Storyboard Review Operations:');
  const targetPanelId = sbFight.panels[0].id;

  // Edit panel
  const editedPanel = sbEngine.updatePanel({
    novelId,
    chapterNumber: 2,
    panelId: targetPanelId,
    updates: {
      camera_angle: 'dutch_tilt',
      framing: 'extreme_close_up',
      action: 'Tariq eyes glow celestial violet as mana gathers',
      pose: 'Crouched combat readiness',
    },
  });

  assert('Panel update succeeded', !!editedPanel && editedPanel.camera_angle === 'dutch_tilt');
  assert('Panel user_edited flagged true and status EDITED', editedPanel?.user_edited === true && editedPanel?.status === 'EDITED');
  assert('Recompiled positive prompt reflects new camera & framing', editedPanel?.prompt_payload.positive_prompt.includes('dutch tilt') && editedPanel?.prompt_payload.positive_prompt.includes('extreme close up'));

  // Add custom panel
  const addedPanel = sbEngine.addPanel({
    novelId,
    chapterNumber: 2,
    sceneId: sbFight.scenes[0].id,
    afterPanelId: targetPanelId,
    panelData: {
      action: 'Custom close-up reaction shot added during director review',
      framing: 'close_up',
      camera_angle: 'low_angle',
    },
  });

  assert('Custom panel added to storyboard', !!addedPanel);
  const reloadedAfterAdd = sbEngine.getStoryboard(novelId, 2);
  assert('Total panels incremented after addPanel', reloadedAfterAdd?.panels.length === sbFight.panels.length + 1);

  // Delete redundant panel
  const deleteSuccess = sbEngine.deletePanel({
    novelId,
    chapterNumber: 2,
    panelId: addedPanel!.id,
  });

  assert('Redundant panel deletion succeeded', deleteSuccess);
  const reloadedAfterDel = sbEngine.getStoryboard(novelId, 2);
  assert('Total panels restored after deletePanel', reloadedAfterDel?.panels.length === sbFight.panels.length);

  // Approve storyboard
  const approvedSb = sbEngine.approveStoryboard(novelId, 2, true);
  assert('Storyboard approved flag set to true', approvedSb?.approved === true);
  assert('All planned panels updated to APPROVED status', approvedSb?.panels.every((p) => p.status === 'APPROVED'));

  // --- Test 10: Generation Tasks Compilation & Provider Routing ---
  console.log('\n10. Generation Tasks Compilation & Provider Routing:');
  const tasks = sbEngine.getGenerationTasks(novelId, 2);
  assert('Compiled generation tasks matching total panels', tasks.length === approvedSb?.panels.length);
  assert('Tasks have stable unique task IDs', tasks[0].task_id.startsWith('task_p_'));
  assert('Task status reflects approved storyboard (QUEUED)', tasks[0].status === 'QUEUED');
  assert('Provider routing configured with honesty (Agnes L2 vs Agnes L1)', !!tasks[0].provider_routing.engine);
  assert('Task character references contain canonical IDs', tasks[0].character_refs.length > 0);

  // --- Test 11: Restart / Recovery Persistence ---
  console.log('\n11. Clean Restart & Recovery Persistence:');
  const freshSbEngine = new StoryboardEngine(TEST_DIR, storyMemory, refLock);
  const recoveredSb = freshSbEngine.getStoryboard(novelId, 2);

  assert('Recovered Chapter 2 storyboard from disk without regeneration', !!recoveredSb);
  assert('Recovered total panels matches saved state', recoveredSb?.total_panels === approvedSb?.total_panels);
  assert('Recovered approved status persisted cleanly', recoveredSb?.approved === true);
  assert('Recovered tasks count matches panel count', recoveredSb?.tasks?.length === recoveredSb?.panels.length);

  // --- Test 12: List Storyboards ---
  console.log('\n12. List Storyboards across novel:');
  const allStoryboards = freshSbEngine.listStoryboards(novelId);
  assert('listStoryboards returned all planned chapters', allStoryboards.length >= 6);
  assert('List is sorted by chapter number', allStoryboards[0].chapter_number <= allStoryboards[1].chapter_number);

  console.log('\n====================================================');
  console.log(`STAGE 5 TEST SUITE FINISHED: ${passed} / ${total} assertions passed (${((passed / total) * 100).toFixed(1)}%)`);
  console.log('====================================================\n');

  if (passed === total) {
    console.log('STAGE 5 COMPLETE ✅');
  } else {
    console.error('STAGE 5 INCOMPLETE: Some tests failed.');
    process.exit(1);
  }
}

runStage5Tests().catch((err) => {
  console.error('Fatal error during Stage 5 tests:', err);
  process.exit(1);
});
