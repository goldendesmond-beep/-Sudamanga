/**
 * Stage 4 Verification & Benchmarks: Reference Manga, Character Lock, Style Lock
 * Validates zero-image-upload reference search, persistent canonical character locks,
 * structured visual style profiles, style versioning (V1 -> V2), user overrides,
 * auto-suggested mappings, dual-track prompt generation, provider capabilities,
 * and conflict detection.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ReferenceLockEngine, PROVIDER_CAPABILITIES } from '../referenceLock.js';
import { StoryMemoryManager } from '../storyMemory.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_DIR = path.join(__dirname, '..', 'novels_test_stage4');

if (fs.existsSync(TEST_DIR)) {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
}
fs.mkdirSync(TEST_DIR, { recursive: true });

async function runStage4Tests() {
  console.log('====================================================');
  console.log('STAGE 4 VERIFICATION: REFERENCE MANGA + CHARACTER LOCK + STYLE LOCK');
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

  const refEngine = new ReferenceLockEngine(TEST_DIR);
  const storyMem = new StoryMemoryManager(TEST_DIR);
  const novelId = 'novel_stage4_test';

  // --- Test 1: Reference Manga Search & Local Caching ---
  console.log('1. Reference Manga Search & Permitted Public/Builtin Lookups:');
  const searchResults = await refEngine.searchReferenceSeries('Solo Leveling');
  assert('Found "Solo Leveling" reference metadata in catalog/cache', searchResults.length > 0 && searchResults[0].title === 'Solo Leveling');
  assert('Metadata contains series_type manhwa', searchResults[0].series_type === 'manhwa');
  assert('Metadata contains lead archetype Sung Jinwoo', searchResults[0].characters.some((c) => c.name.includes('Sung Jinwoo')));
  assert('Metadata contains derived structured style profile', !!searchResults[0].derived_style.line_art);

  // Search by keyword/alt-title
  const altSearch = await refEngine.searchReferenceSeries('Only I Level Up');
  assert('Search by alt-title "Only I Level Up" resolves to Solo Leveling', altSearch.length > 0 && altSearch[0].title === 'Solo Leveling');

  // Search unfamiliar title with zero-cost deterministic synthesizer
  const customSearch = await refEngine.searchReferenceSeries('Omniscient Reader Webtoon');
  assert('Synthesized structured reference metadata for new series', customSearch.length > 0 && customSearch[0].title === 'Omniscient Reader Webtoon');
  assert('Synthesized series recognizes webtoon type', customSearch[0].series_type === 'manhwa');

  // Verify caching in reference_series_cache.json
  const cachePath = path.join(TEST_DIR, 'cache', 'reference_series_cache.json');
  assert('Reference search results are persistently cached', fs.existsSync(cachePath));

  // --- Test 2: Reference Mode Switching ---
  console.log('\n2. Reference Mode Switching & ON/OFF Constraints:');
  const stateDefault = refEngine.getNovelReferenceLockState(novelId);
  assert('Default reference mode is "style_only" (Stage 8) or "characters_and_style"', stateDefault.reference_mode === 'style_only' || stateDefault.reference_mode === 'characters_and_style');
  assert('Character Lock state matches reference mode', stateDefault.character_lock_active === (stateDefault.reference_mode !== 'style_only'));
  assert('Default Style Lock is ACTIVE', stateDefault.style_lock_active === true);

  const stateCharOnly = refEngine.setReferenceMode(novelId, 'characters_only');
  assert('Mode "characters_only" activates character lock and deactivates style lock', stateCharOnly.character_lock_active === true && stateCharOnly.style_lock_active === false);

  const stateStyleOnly = refEngine.setReferenceMode(novelId, 'style_only');
  assert('Mode "style_only" deactivates character lock and activates style lock', stateStyleOnly.character_lock_active === false && stateStyleOnly.style_lock_active === true);

  // Return to dual mode
  refEngine.setReferenceMode(novelId, 'characters_and_style');

  // --- Test 3: Structured Visual Style Profile Generation ---
  console.log('\n3. Structured Visual Style Profile (Anti-Slop & Anti-"Draw like X"):');
  const styleProfile = refEngine.createStyleLockProfile('Solo Leveling', 1);
  assert('Style profile has unique style_id', !!styleProfile.style_id && styleProfile.style_id.startsWith('style_'));
  assert('Line Art specifies density, thickness, and cleanliness', !!styleProfile.line_art.density && !!styleProfile.line_art.thickness && !!styleProfile.line_art.cleanliness);
  assert('Rendering specifies color_mode (full_color for manhwa)', styleProfile.rendering.color_mode === 'full_color');
  assert('Shading specifies technique, shadows, and contrast', !!styleProfile.shading.technique && !!styleProfile.shading.contrast);
  assert('Effects specify aura and power rendering', styleProfile.effects.aura_power.includes('violet') || styleProfile.effects.aura_power.length > 5);
  assert('Cinematography specifies camera angles, framing, and overall mood', !!styleProfile.cinematography.camera_angles && !!styleProfile.cinematography.overall_mood);

  // --- Test 4: Canonical Character Lock Creation & Attribute Completeness ---
  console.log('\n4. Canonical Character Lock Profiles:');
  const charLockResult = refEngine.mapNovelCharacter(novelId, {
    novelCharacterId: 'char_mc_01',
    novelCharacterName: 'Arthur Leywin',
    referenceSeries: 'Solo Leveling',
    referenceCharacter: 'Sung Jinwoo',
    lockImmediately: true,
  });

  const lock = charLockResult.lockProfile;
  assert('Character Lock created for Arthur Leywin mapped to Sung Jinwoo', lock.canonical_name === 'Arthur Leywin' && lock.reference_character === 'Sung Jinwoo');
  assert('Face shape and facial proportions recorded', !!lock.face_shape && !!lock.facial_proportions);
  assert('Eyes and eyebrows recorded', !!lock.eyes && !!lock.eyebrows);
  assert('Hairstyle and hair color recorded', !!lock.hairstyle && !!lock.hair_color);
  assert('Body build and apparent age recorded', !!lock.body_build && !!lock.apparent_age);
  assert('Signature attire and weapons recorded', !!lock.signature_outfit && lock.weapons.length > 0);
  assert('Mapping is locked immediately', charLockResult.mapping.locked === true && lock.locked === true);

  // --- Test 5: Auto-Suggested Character Mappings ---
  console.log('\n5. Auto-Suggested Mappings from Novel Cast:');
  const suggestions = refEngine.suggestCharacterMappings(novelId, [
    { id: 'char_mc', name: 'Lin Dong', role: 'Main Protagonist' },
    { id: 'char_mentor', name: 'Grandmaster Ling', role: 'Martial Mentor' },
  ]);
  assert('Generated 2 suggestions for novel cast', suggestions.length === 2);
  assert('Protagonist mapped to lead reference archetype', suggestions[0].suggested_reference_character === 'Sung Jinwoo' || suggestions[0].suggested_reference_character.includes('Li Yunxiao'));
  assert('High confidence on protagonist mapping', suggestions[0].confidence === 'HIGH');

  // --- Test 6: User Overrides Priority on Character Lock ---
  console.log('\n6. Manual User Overrides on Character Lock (Highest Priority):');
  const overriddenLock = refEngine.updateCharacterLockOverrides(novelId, 'char_mc_01', {
    hair_color: 'Silver Platinum',
    signature_outfit: 'Cerulean Royal Mantle over runic plate armor',
  });
  assert('User override stored in user_overrides record', overriddenLock?.user_overrides?.hair_color === 'Silver Platinum');

  // Build prompt constraints to verify override precedence
  const promptConstraints = refEngine.buildStructuredPromptConstraints({
    novelId,
    chapterNumber: 1,
    novelCharacterIds: ['char_mc_01'],
    sceneText: 'Arthur stands before the portal gates.',
    panelNumber: 1,
  });

  assert('Prompt output prioritizes User Override for hair', promptConstraints.characterLockBlock.includes('Silver Platinum [User Override]'));
  assert('Prompt output prioritizes User Override for outfit', promptConstraints.characterLockBlock.includes('Cerulean Royal Mantle'));

  // Test reset of character overrides
  const resetLock = refEngine.updateCharacterLockOverrides(novelId, 'char_mc_01', {}, true);
  assert('User overrides reset clears override record', Object.keys(resetLock?.user_overrides || {}).length === 0);

  // --- Test 7: Style Versioning (V1 -> V2 Without Altering Previous Chapters) ---
  console.log('\n7. Style Versioning & Immutability of Prior Chapters:');
  // Initially V1 is active (Solo Leveling)
  const initialV1 = refEngine.getNovelReferenceLockState(novelId).active_style_version;
  assert('Initial style version is V1', initialV1 === 1);

  // User changes reference series to "Berserk" starting from Chapter 26
  const newStyleV2 = refEngine.updateNovelStyleLock(novelId, 'Berserk', 26);
  assert('Changing reference series creates Version 2', newStyleV2.version === 2);
  assert('Active series title updated to Berserk', refEngine.getNovelReferenceLockState(novelId).active_series_title === 'Berserk');

  // Chapter 1..25 must still resolve to Style V1 (Solo Leveling)
  const ch1Constraints = refEngine.buildStructuredPromptConstraints({
    novelId,
    chapterNumber: 15,
    novelCharacterIds: [],
    sceneText: 'Early chapter in dungeon.',
    panelNumber: 1,
  });
  assert('Chapter 15 preserves Style V1', ch1Constraints.styleProfileBlock.includes('Solo Leveling (Version 1)') || ch1Constraints.styleProfileBlock.includes('The Eternal Supreme (Version 1)'));

  // Chapter 26+ must resolve to Style V2 (Berserk)
  const ch26Constraints = refEngine.buildStructuredPromptConstraints({
    novelId,
    chapterNumber: 26,
    novelCharacterIds: [],
    sceneText: 'Dark castle gates under crimson moon.',
    panelNumber: 1,
  });
  assert('Chapter 26 enforces Style V2 (Berserk)', ch26Constraints.styleProfileBlock.includes('Berserk (Version 2)'));

  // --- Test 8: Consistency Audit, Warnings & Conflict Detection ---
  console.log('\n8. Consistency Audit Inspector & Conflict Warnings:');
  const audit = refEngine.auditConsistency(novelId, { preferred_format: 'webtoon' });
  assert('Audit identifies active reference series and version', audit.reference_series === 'Berserk' && audit.active_style_version === 2);
  assert('Audit identifies provider capabilities', !!audit.provider_capabilities.agnes_l2 && !!audit.provider_capabilities.agnes_l1);
  assert('Audit flags black-and-white manga vs webtoon strip notice', audit.warnings.some((w) => w.includes('Style Adaptation Notice')));
  assert('Audit produces live combined sample prompt for Panel 1', audit.sample_prompt.combined_prompt.includes('[NEGATIVE PROMPT]'));

  // --- Test 9: Provider Capabilities Truthfulness ---
  console.log('\n9. Provider Capabilities & Integrity:');
  assert('Agnes L2 recorded as img2img consistency mechanism', PROVIDER_CAPABILITIES.agnes_l2.type === 'img2img');
  assert('Agnes L1 recorded as structured prompt conditioning', PROVIDER_CAPABILITIES.agnes_l1.type === 'prompt_conditioning');
  assert('Fidelity notes honestly describe consistency mechanism without claiming 100% pixel invariance',
    PROVIDER_CAPABILITIES.agnes_l1.fidelity_notes.includes('structured prompt injection') &&
    PROVIDER_CAPABILITIES.agnes_l2.fidelity_notes.includes('Strongest available visual identity preservation')
  );

  // --- Test 10: Mapping Lock, Unlock & Persistence ---
  console.log('\n10. Mapping Lock / Unlock Actions & Session Persistence:');
  const unlocked = refEngine.toggleMappingLock(novelId, 'char_mc_01', false);
  assert('Mapping lock can be toggled to UNLOCKED', unlocked?.locked === false);

  const lockedAgain = refEngine.toggleMappingLock(novelId, 'char_mc_01', true);
  assert('Mapping lock can be toggled to LOCKED', lockedAgain?.locked === true);

  // Read clean state from disk
  const reloadedEngine = new ReferenceLockEngine(TEST_DIR);
  const reloadedState = reloadedEngine.getNovelReferenceLockState(novelId);
  assert('Reference Lock state reloaded from disk matches memory state', reloadedState.character_mappings['char_mc_01'].locked === true);
  assert('Style versions persist on disk', reloadedState.style_locks.length >= 2);

  // Clean test artifacts
  fs.rmSync(TEST_DIR, { recursive: true, force: true });

  console.log('\n====================================================');
  console.log(`STAGE 4 TEST RESULTS: ${passed} / ${total} assertions passed (${((passed / total) * 100).toFixed(1)}%)`);
  console.log('====================================================');

  if (passed === total) {
    console.log('✅ ALL STAGE 4 REFERENCE LOCK TESTS PASSED');
  } else {
    console.error('❌ SOME TESTS FAILED');
    process.exitCode = 1;
  }
}

runStage4Tests().catch((err) => {
  console.error('Stage 4 test runner fatal error:', err);
  process.exit(1);
});
