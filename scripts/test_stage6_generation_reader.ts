import fs from 'fs';
import path from 'path';
import { NovelEngine } from '../novelEngine.js';
import { StoryMemoryManager } from '../storyMemory.js';
import { ReferenceLockEngine } from '../referenceLock.js';
import { StoryboardEngine } from '../storyboardEngine.js';
import { PanelGenerationEngine, GeneratedPanel, TargetedRegenMode } from '../panelGenerationEngine.js';

const TEST_DIR = path.join(process.cwd(), 'novels_test_stage6');

// Clean test dir
if (fs.existsSync(TEST_DIR)) {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
}
fs.mkdirSync(TEST_DIR, { recursive: true });

const novelEngine = new NovelEngine(TEST_DIR);
const storyMemory = new StoryMemoryManager(TEST_DIR);
const referenceLock = new ReferenceLockEngine(TEST_DIR);
const storyboardEngine = new StoryboardEngine(TEST_DIR, storyMemory, referenceLock);
const panelEngine = new PanelGenerationEngine(TEST_DIR, referenceLock, storyboardEngine, true);

let passedCount = 0;
let totalCount = 0;

function assert(condition: boolean, message: string): void {
  totalCount++;
  if (condition) {
    passedCount++;
    console.log(`  ✓ [PASS] ${message}`);
  } else {
    console.error(`  ✗ [FAIL] ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runStage6Tests() {
  console.log('====================================================');
  console.log('STAGE 6 VERIFICATION: IMAGE GENERATION + LETTERING + READER');
  console.log('====================================================\n');

  // --- Setup Test Novel ---
  const novelRaw = `Chapter 1: The Gathering Shadows
The cold wind swept across the abandoned castle courtyard.
Arthur Leywin stepped forward, his dark armor glistening under the crescent moon.
"They are approaching from the western ridge," Arthur whispered to his companion.
Tariq raised his flame-wreathed scimitar. "Let them come! We will hold the gate!"
Arthur thought to himself: If we fail tonight, the entire kingdom falls to the abyss.
***
Chapter 2: The Duel on the Battlements
The enemy vanguard breached the iron gates with a deafening roar.
Arthur leaped from the stone parapet, blades drawn in a flash of blue aura.
"Stand your ground!" Tariq roared, cutting down two shadow beasts in a single sweep.
SLASH! The air crackled with raw magical energy.
Arthur landed gracefully, breathing heavily as the dust settled.`;

  const novelRes = await novelEngine.importNovel({
    filename: 'shadow_chronicles.txt',
    content: novelRaw,
    titleOverride: 'Shadow Chronicles',
  });

  const novelId = (novelRes as any).novel?.id || (novelRes as any).novel_id;

  // Set up Reference Lock (Solo Leveling, Character Lock for Arthur)
  await referenceLock.setReferenceMode(novelId, 'characters_and_style');
  await referenceLock.mapNovelCharacter(novelId, {
    novelCharacterId: 'arthur_leywin',
    novelCharacterName: 'Arthur Leywin',
    referenceSeries: 'Solo Leveling',
    referenceCharacter: 'Sung Jinwoo',
    lockImmediately: true,
  });

  // Customize Arthur's locked attributes for drift verification
  referenceLock.updateCharacterLock(novelId, 'arthur_leywin', {
    face_shape: 'sharp angular jawline',
    facial_proportions: 'slender heroic proportions',
    eyes: 'glowing indigo eyes',
    eyebrows: 'narrow determined',
    nose: 'straight refined',
    mouth: 'firm resolute',
    hairstyle: 'layered undercut',
    hair_color: 'raven black',
    skin_tone: 'pale fair',
    body_build: 'athletic lean muscular',
    apparent_age: 'early 20s',
    height_impression: 'tall commanding',
    signature_outfit: 'shadow monarch black coat and silver pauldrons',
    weapons: ['dual shadow daggers', 'rune blade'],
    distinctive_marks: ['faint mana scar on left wrist'],
  });

  // 1. Provider Architecture & Zero-Cost Adherence
  console.log('1. Provider Architecture & Zero-Cost Policy:');
  const zeroCostActive = panelEngine.getZeroCostOnly();
  assert(zeroCostActive === true, 'Default ZERO_COST_ONLY is strictly true');

  const priorityTiers = panelEngine.getProviderPriority();
  assert(priorityTiers[0] === 'CACHE', 'Priority 1 is CACHE');
  assert(priorityTiers[1] === 'LOCAL_ZERO_COST', 'Priority 2 is LOCAL_ZERO_COST');
  assert(!priorityTiers.includes('PAID_OPTIONAL'), 'Paid tier disabled under ZERO_COST_ONLY=true');

  const resolved = panelEngine.resolveProviderTier('PAID_OPTIONAL');
  assert(resolved.tier === 'LOCAL_ZERO_COST', 'Never silently moves to paid; forces LOCAL_ZERO_COST');

  // 2. Storyboard Plan for Chapter 1
  console.log('\n2. Storyboard Generation & Panel Plan:');
  const ch1 = novelRes.chapters[0];
  const ch1Text = novelEngine.getChapterContent(novelId, ch1.id)?.content || '';
  const sb1 = await storyboardEngine.generateStoryboard({
    novelId,
    chapterId: ch1.id,
    chapterNumber: 1,
    chapterTitle: ch1.title || 'Chapter 1',
    chapterText: ch1Text,
    layoutMode: 'vertical_webtoon',
    generationMode: 'FREE_FAST',
  });
  assert(sb1 !== null && sb1.panels.length > 0, 'Storyboard generated for Chapter 1');
  const p1 = sb1.panels[0];
  assert(p1.id.startsWith('p_ch1_') || p1.id.startsWith('c01_'), 'Panel has persistent unique ID');

  // 3. Panel Generation with 4 Decoupled Input Layers
  console.log('\n3. Panel Generation & Decoupled Input Layers:');
  const genPanel1 = await panelEngine.generatePanel({
    novelId,
    chapterNumber: 1,
    panel: p1,
    language: 'en',
  });

  assert(genPanel1.panel_id === p1.id, 'Generated panel preserves storyboard panel ID');
  assert(genPanel1.input_layers !== undefined, 'Input layers created');
  assert(genPanel1.input_layers.character_constraints.includes('Sung Jinwoo'), 'Character constraints contain Character Lock profile');
  assert(genPanel1.input_layers.character_constraints.includes('raven black'), 'Character constraints specify canonical hair');
  assert(genPanel1.input_layers.style_constraints.includes('Solo Leveling') || genPanel1.input_layers.style_constraints.includes('The Eternal Supreme'), 'Style constraints specify Visual Style Profile');
  assert(genPanel1.input_layers.story_constraints.includes(p1.location), 'Story constraints include location');
  assert(genPanel1.input_layers.panel_composition.includes(p1.camera_angle), 'Panel composition includes camera angle');
  assert(genPanel1.input_layers.negative_constraints.includes('photorealistic'), 'Negative constraints anchored');
  assert(genPanel1.status === 'COMPLETE' || genPanel1.status === 'APPROVED', 'Initial panel generation status is COMPLETE');

  // 4. Reference Modes Behavior
  console.log('\n4. Reference Modes Verification (Characters Only vs Style Only vs Both):');
  const novelState = referenceLock.getNovelReferenceLockState(novelId);
  const arthurLock = novelState.character_locks['arthur_leywin'];
  const styleProfile = novelState.style_locks[0];

  const inputBoth = panelEngine.compileInputLayers({
    panel: p1,
    referenceMode: 'characters_and_style',
    characterLocks: [arthurLock],
    styleProfile,
  });
  assert(inputBoth.character_constraints.includes('Sung Jinwoo') && (inputBoth.style_constraints.includes('Solo Leveling') || inputBoth.style_constraints.includes(styleProfile.reference_series)), 'Both mode applies both locks');

  const inputCharsOnly = panelEngine.compileInputLayers({
    panel: p1,
    referenceMode: 'characters_only',
    characterLocks: [arthurLock],
    styleProfile,
  });
  assert(inputCharsOnly.character_constraints.includes('Sung Jinwoo') && inputCharsOnly.style_constraints.includes('Neutral Manga'), 'Characters Only uses neutral manga style');

  const inputStyleOnly = panelEngine.compileInputLayers({
    panel: p1,
    referenceMode: 'style_only',
    characterLocks: [arthurLock],
    styleProfile,
  });
  assert(inputStyleOnly.character_constraints.includes('Native novel depiction') && (inputStyleOnly.style_constraints.includes('Solo Leveling') || inputStyleOnly.style_constraints.includes(styleProfile.reference_series)), 'Style Only uses native novel character designs');

  // 5. Previous Panel Continuity
  console.log('\n5. Previous Panel Continuity Conditioning:');
  const p2 = sb1.panels[1];
  const genPanel2 = await panelEngine.generatePanel({
    novelId,
    chapterNumber: 1,
    panel: p2,
    previousPanel: genPanel1,
    language: 'en',
  });

  assert(genPanel2.continuity.previous_panel_id === genPanel1.panel_id, 'Panel 2 links previous_panel_id');
  assert(genPanel2.input_layers.story_constraints.includes(`[CONTINUITY from ${genPanel1.panel_id}]`), 'Panel 2 prompt injects continuity context');
  assert(genPanel2.continuity.active_style_version === 1, 'Panel 2 preserves active style version');

  // 6. Style Drift Detection
  console.log('\n6. Style Drift Detection:');
  // Test conflicting style attributes
  const driftPanel = { ...p1, composition_notes: 'vibrant rainbow color and neon hyper splash' };
  const styleDrift = panelEngine.detectStyleDrift({
    panel: driftPanel,
    styleProfile: { ...styleProfile, rendering: { ...styleProfile.rendering, color_mode: 'black_and_white' } },
    referenceMode: 'characters_and_style',
  });
  assert(styleDrift.hasDrift === true, 'Style drift successfully flagged color clash in black_and_white profile');
  assert(styleDrift.reasons[0].includes('Style Drift'), 'Style drift reason recorded');

  // 7. Character Drift Detection
  console.log('\n7. Character Drift Detection:');
  const charDriftPanel = { ...p1, action: 'Arthur adjusts his bright blonde hair and shoots with laser rifle' };
  const charDrift = panelEngine.detectCharacterDrift({
    panel: charDriftPanel,
    characterLocks: [arthurLock],
    referenceMode: 'characters_and_style',
  });
  assert(charDrift.hasDrift === true, 'Character drift successfully flagged hair and weapon clash');
  assert(charDrift.reasons.some((r) => r.includes('blonde')), 'Hair drift reason recorded');
  assert(charDrift.reasons.some((r) => r.includes('laser rifle')), 'Weapon drift reason recorded');

  // 8. Targeted Regeneration
  console.log('\n8. Targeted Regeneration:');
  // 8a. Lettering Only (instant zero-cost)
  const regenLettering = await panelEngine.regeneratePanelTargeted({
    novelId,
    chapterNumber: 1,
    panelId: genPanel1.panel_id,
    regenMode: 'lettering_only',
    language: 'en',
  });
  assert(regenLettering.lettering !== undefined, 'Lettering re-computed successfully');
  assert(regenLettering.status === 'APPROVED', 'Lettering-only update marks panel approved');
  assert(regenLettering.user_edited === true, 'User edited flag set');

  // 8b. Character Only
  const regenChar = await panelEngine.regeneratePanelTargeted({
    novelId,
    chapterNumber: 1,
    panelId: genPanel1.panel_id,
    regenMode: 'character_only',
    userPromptOverride: 'Add glowing eye trail',
  });
  assert(regenChar.input_layers.character_constraints.includes('Add glowing eye trail'), 'Character-only updates character prompt layer');

  // 8c. Background Only
  const regenBg = await panelEngine.regeneratePanelTargeted({
    novelId,
    chapterNumber: 1,
    panelId: genPanel1.panel_id,
    regenMode: 'background_only',
    userPromptOverride: 'Gothic cathedral pillars with gargoyles',
  });
  assert(regenBg.input_layers.story_constraints.includes('Gothic cathedral pillars'), 'Background-only updates story/environment prompt layer');

  // 9. Panel Status Lifecycle & Locking
  console.log('\n9. Panel Status Lifecycle & Locking:');
  const isLocked = panelEngine.togglePanelLock(novelId, 1, genPanel1.panel_id);
  assert(isLocked === true, 'Panel locked successfully');
  const lockedPanel = panelEngine.getSavedPanel(novelId, 1, genPanel1.panel_id)!;
  assert(lockedPanel.status === 'LOCKED', 'Panel status is LOCKED');

  // Attempting to regenerate locked panel throws
  let regenFailed = false;
  try {
    await panelEngine.regeneratePanelTargeted({
      novelId,
      chapterNumber: 1,
      panelId: genPanel1.panel_id,
      regenMode: 'full_panel',
    });
  } catch (err: any) {
    regenFailed = true;
    assert(err.message.includes('locked against regeneration'), 'Locked panel rejects regeneration');
  }
  assert(regenFailed === true, 'Regeneration prevention verified for locked panel');

  // Unlock and Approve
  panelEngine.togglePanelLock(novelId, 1, genPanel1.panel_id);
  panelEngine.approvePanel(novelId, 1, genPanel1.panel_id);
  const approvedPanel = panelEngine.getSavedPanel(novelId, 1, genPanel1.panel_id)!;
  assert(approvedPanel.status === 'APPROVED', 'Panel status updated to APPROVED');

  // 10. Lettering Layer & Face Avoidance Algorithm
  console.log('\n10. Lettering Placement, Face Avoidance & Arabic Support:');
  // Arabic Lettering
  const arabicDialogue = [
    { id: 'd1', speaker: 'طارق', text: 'اثبتوا في مواقعكم! لن تسقط القلعة الليلة!', bubble_type: 'shout' as const },
    { id: 'd2', speaker: 'آرثر', text: 'إنهم يقتربون من التل الغربي، استعدوا.', bubble_type: 'speech' as const },
    { id: 'd3', speaker: 'آرثر', text: 'هل سينجح هذا المخطط؟', bubble_type: 'thought' as const },
  ];
  const arLettering = panelEngine.computeLetteringPlacement({
    dialogue: arabicDialogue,
    framing: 'medium_shot',
    language: 'ar',
    sfxList: [{ text: 'طرااااخ!', placement: 'center', style: 'manga_action' }],
  });

  assert(arLettering.language === 'ar', 'Arabic language recorded');
  assert(arLettering.bubbles.length === 3, '3 Arabic bubbles computed');
  assert(arLettering.bubbles[0].x >= 65, 'Arabic first bubble prioritized to right side (RTL reading flow)');
  assert(arLettering.bubbles[0].type === 'shout', 'Shout bubble type preserved');
  assert(arLettering.bubbles[2].type === 'thought', 'Internal monologue thought bubble preserved');
  assert(arLettering.svg_overlay !== undefined && arLettering.svg_overlay.includes('dir="rtl"') || arLettering.svg_overlay!.includes('direction="rtl"'), 'SVG contains RTL direction');
  assert(arLettering.svg_overlay!.includes('طرااااخ!'), 'Arabic SFX text included in vector overlay');

  // Face Avoidance: verify no bubble is placed in dead center (x: 40-60, y: 35-55)
  const isDeadCenter = arLettering.bubbles.some((b) => b.x >= 40 && b.x <= 60 && b.y >= 35 && b.y <= 55);
  assert(!isDeadCenter, 'Face exclusion zone honored (no bubbles positioned in central face zone)');

  // Bubble Update: interactive repositioning
  const bubbleToMove = arLettering.bubbles[0].id;
  const updatedLettering = panelEngine.updateLetteringBubble({
    novelId,
    chapterNumber: 1,
    panelId: genPanel1.panel_id,
    bubbleId: genPanel1.lettering.bubbles[0].id,
    updates: { x: 82, y: 15, size: 'large' },
  });
  assert(updatedLettering.bubbles[0].x === 82, 'Bubble X coordinate updated');
  assert(updatedLettering.bubbles[0].y === 15, 'Bubble Y coordinate updated');
  assert(updatedLettering.bubbles[0].size === 'large', 'Bubble size updated to large');

  // 11. Cache Reuse & Deterministic Free-First Generation
  console.log('\n11. Cache Reuse & Free-First Generation:');
  const cacheKey = genPanel1.cache_key!;
  const retrievedCached = panelEngine.getCachedPanel(cacheKey);
  assert(retrievedCached !== null, 'Panel retrieved from persistent cache');
  assert(retrievedCached!.panel_id === genPanel1.panel_id, 'Cached panel matches generated ID');

  // Calling generatePanel again with same custom seed hits cache immediately
  const hitPanel = await panelEngine.generatePanel({
    novelId,
    chapterNumber: 1,
    panel: p1,
    language: 'en',
    customSeed: genPanel1.seed,
  });
  assert(hitPanel.cached === true, 'Second generation attempt resolved from CACHE without re-rendering');

  // 12. Session Persistence & Clean Restart Recovery
  console.log('\n12. Session Persistence & Recovery:');
  const reloadedPanels = panelEngine.listChapterPanels(novelId, 1);
  assert(reloadedPanels.length >= 2, 'Chapter panels persisted to disk');
  const reloadedP1 = reloadedPanels.find((p) => p.panel_id === genPanel1.panel_id);
  assert(reloadedP1 !== undefined, 'Panel 1 found in persisted chapter panels file');
  assert(reloadedP1!.input_layers.character_constraints.includes('Sung Jinwoo'), 'Persisted character constraints intact');
  assert(reloadedP1!.lettering.bubbles[0].x === 82, 'Persisted custom bubble position intact');

  console.log('\n====================================================');
  console.log(`STAGE 6 TEST SUITE FINISHED: ${passedCount} / ${totalCount} assertions passed (${((passedCount / totalCount) * 100).toFixed(1)}%)`);
  console.log('====================================================\n');
  console.log('STAGE 6 COMPLETE ✅');
}

runStage6Tests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
