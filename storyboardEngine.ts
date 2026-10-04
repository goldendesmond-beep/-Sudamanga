import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { GoogleGenAI } from '@google/genai';
import { StoryMemoryManager, CompactContext } from './storyMemory.js';
import { ReferenceLockEngine } from './referenceLock.js';

export type MangaLayoutMode = 'manga_page' | 'vertical_webtoon';
export type GenerationSpeedMode = 'FREE_FAST' | 'STANDARD' | 'HIGH_QUALITY';
export type PanelStatus =
  | 'QUEUED'
  | 'GENERATING'
  | 'COMPLETE'
  | 'FAILED'
  | 'NEEDS_REVIEW'
  | 'APPROVED'
  | 'LOCKED'
  | 'PLANNED'
  | 'EDITED'
  | 'READY';

export interface DialogueLine {
  id: string;
  speaker: string;
  text: string;
  bubble_type: 'speech' | 'thought' | 'shout' | 'whisper';
  tail_direction?: 'left' | 'right' | 'up' | 'down';
}

export interface SceneBeat {
  id: string;
  scene_number: number;
  location: string;
  time_of_day?: string;
  participating_characters: string[];
  action_summary: string;
  dialogue: DialogueLine[];
  narration: string[];
  emotional_tone: string;
  important_objects: string[];
  powers_techniques: string[];
  continuity_requirements: string[];
  story_bible_references: {
    character_ids: string[];
    location_id?: string;
    power_ids?: string[];
    object_ids?: string[];
  };
}

export interface StoryboardPanel {
  id: string;
  chapter_id: string;
  chapter_number: number;
  scene_id: string;
  page_or_strip_id: string;
  panel_number_in_page: number;
  global_panel_number: number;
  characters: Array<{
    name: string;
    role: string;
    character_lock_id?: string;
  }>;
  character_lock_ids: string[];
  style_lock_id: string;
  style_version: number;
  location: string;
  story_bible_references: string[];
  action: string;
  pose: string;
  facial_expression: string;
  camera_angle: 'eye_level' | 'low_angle' | 'high_angle' | 'dutch_tilt' | 'birds_eye' | 'worm_eye';
  framing: 'extreme_close_up' | 'close_up' | 'medium_shot' | 'cowboy_shot' | 'wide_shot' | 'extreme_wide' | 'cut_in';
  background_detail: string;
  lighting: string;
  dialogue: DialogueLine[];
  narration_boxes: string[];
  sfx: Array<{ text: string; placement: string; style: string }>;
  composition_notes: string;
  prompt_payload: {
    positive_prompt: string;
    negative_prompt: string;
    character_lock_block: string;
    style_lock_block: string;
  };
  status: PanelStatus;
  user_edited?: boolean;
  image_url?: string;
  is_locked?: boolean;
  drift_status?: {
    has_drift: boolean;
    drift_type?: 'style' | 'character' | 'none';
    drift_reasons?: string[];
  };
  lettering?: any;
  created_at: number;
  updated_at: number;
}

export interface StoryboardPage {
  page_id: string;
  page_number: number;
  panels: StoryboardPanel[];
}

export interface GenerationTask {
  task_id: string;
  panel_id: string;
  scene_id: string;
  page_or_strip_id: string;
  chapter_number: number;
  priority: number;
  status: 'PENDING' | 'QUEUED' | 'GENERATED' | 'FAILED' | 'SKIPPED';
  generation_mode: GenerationSpeedMode;
  provider_routing: {
    engine: string;
    consistency_strategy: string;
    supports_img2img: boolean;
  };
  prompt_payload: {
    positive_prompt: string;
    negative_prompt: string;
    character_lock_block: string;
    style_lock_block: string;
  };
  character_refs: Array<{
    name: string;
    character_lock_id?: string;
  }>;
  style_ref: {
    style_id: string;
    style_version: number;
  };
  output_image_url?: string;
  created_at: number;
  updated_at: number;
}

export interface ChapterStoryboard {
  id: string;
  novel_id: string;
  chapter_id: string;
  chapter_number: number;
  chapter_title: string;
  layout_mode: MangaLayoutMode;
  generation_mode: GenerationSpeedMode;
  scenes: SceneBeat[];
  pages: StoryboardPage[];
  panels: StoryboardPanel[];
  tasks?: GenerationTask[];
  total_panels: number;
  total_pages: number;
  approved: boolean;
  manual_approval_required: boolean;
  created_at: number;
  updated_at: number;
}

export type StoryboardPlan = ChapterStoryboard;

export class StoryboardEngine {
  private baseDir: string;
  private storyMemory: StoryMemoryManager;
  private referenceLock: ReferenceLockEngine;

  constructor(baseDir: string, storyMemory: StoryMemoryManager, referenceLock: ReferenceLockEngine) {
    this.baseDir = baseDir;
    this.storyMemory = storyMemory;
    this.referenceLock = referenceLock;
  }

  private getStoryboardDir(novelId: string): string {
    const dir = path.join(this.baseDir, novelId, 'storyboards');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  private getStoryboardFilePath(novelId: string, chapterNumber: number): string {
    return path.join(this.getStoryboardDir(novelId), `chapter_${chapterNumber}.json`);
  }

  /**
   * Load existing storyboard if persisted on disk
   */
  getStoryboard(novelId: string, chapterNumber: number): ChapterStoryboard | null {
    const filePath = this.getStoryboardFilePath(novelId, chapterNumber);
    if (fs.existsSync(filePath)) {
      try {
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      } catch (err) {
        console.warn(`Could not read storyboard file for chapter ${chapterNumber}:`, err);
      }
    }
    return null;
  }

  /**
   * Persist storyboard to disk permanently
   */
  saveStoryboard(novelId: string, storyboard: ChapterStoryboard): void {
    const filePath = this.getStoryboardFilePath(novelId, storyboard.chapter_number);
    storyboard.updated_at = Date.now();
    storyboard.total_panels = storyboard.panels.length;
    storyboard.total_pages = storyboard.pages.length;
    storyboard.tasks = this.compileGenerationTasks(storyboard.panels, storyboard.generation_mode);
    fs.writeFileSync(filePath, JSON.stringify(storyboard, null, 2), 'utf-8');
  }

  /**
   * Compiles individual generation tasks from panel plan
   * Pipeline: NOVEL CHAPTER -> CHAPTER ANALYSIS -> SCENES -> MANGA SCRIPT -> PAGE/WEBTOON PLAN -> PANEL PLAN -> GENERATION TASKS
   */
  compileGenerationTasks(panels: StoryboardPanel[], generationMode: GenerationSpeedMode): GenerationTask[] {
    return panels.map((panel, idx) => ({
      task_id: `task_${panel.id}`,
      panel_id: panel.id,
      scene_id: panel.scene_id,
      page_or_strip_id: panel.page_or_strip_id,
      chapter_number: panel.chapter_number,
      priority: idx + 1,
      status: panel.status === 'APPROVED' ? 'QUEUED' : 'PENDING',
      generation_mode: generationMode,
      provider_routing: {
        engine: panel.character_lock_ids.length > 0 ? 'Agnes L2 (img2img conditioning)' : 'Agnes L1 (Structured Prompt)',
        consistency_strategy: 'Dual-Track Structured Conditioning (Character Lock + Style Lock Profile)',
        supports_img2img: panel.character_lock_ids.length > 0,
      },
      prompt_payload: { ...panel.prompt_payload },
      character_refs: panel.characters.map((c) => ({
        name: c.name,
        character_lock_id: c.character_lock_id,
      })),
      style_ref: {
        style_id: panel.style_lock_id,
        style_version: panel.style_version,
      },
      created_at: panel.created_at || Date.now(),
      updated_at: Date.now(),
    }));
  }

  /**
   * Retrieve generation tasks for a given chapter
   */
  getGenerationTasks(novelId: string, chapterNumber: number): GenerationTask[] {
    const sb = this.getStoryboard(novelId, chapterNumber);
    if (!sb) return [];
    if (sb.tasks && sb.tasks.length > 0) return sb.tasks;
    return this.compileGenerationTasks(sb.panels, sb.generation_mode);
  }

  /**
   * List all generated storyboards for a novel
   */
  listStoryboards(novelId: string): Array<{
    chapter_number: number;
    total_panels: number;
    total_pages: number;
    layout_mode: MangaLayoutMode;
    generation_mode: GenerationSpeedMode;
    approved: boolean;
    updated_at: number;
  }> {
    const dir = this.getStoryboardDir(novelId);
    if (!fs.existsSync(dir)) return [];
    const files = fs.readdirSync(dir).filter((f) => f.startsWith('chapter_') && f.endsWith('.json'));
    const list: Array<{
      chapter_number: number;
      total_panels: number;
      total_pages: number;
      layout_mode: MangaLayoutMode;
      generation_mode: GenerationSpeedMode;
      approved: boolean;
      updated_at: number;
    }> = [];
    for (const f of files) {
      try {
        const full = path.join(dir, f);
        const data = JSON.parse(fs.readFileSync(full, 'utf-8'));
        list.push({
          chapter_number: data.chapter_number,
          total_panels: data.total_panels,
          total_pages: data.total_pages,
          layout_mode: data.layout_mode,
          generation_mode: data.generation_mode,
          approved: !!data.approved,
          updated_at: data.updated_at,
        });
      } catch {}
    }
    return list.sort((a, b) => a.chapter_number - b.chapter_number);
  }

  /**
   * Main Pipeline: NOVEL CHAPTER -> CHAPTER ANALYSIS -> SCENES -> MANGA SCRIPT -> PAGE/WEBTOON PLAN -> PANEL PLAN
   */
  async generateStoryboard(params: {
    novelId: string;
    chapterId: string;
    chapterNumber: number;
    chapterTitle: string;
    chapterText: string;
    layoutMode?: MangaLayoutMode;
    generationMode?: GenerationSpeedMode;
    forceRegenerate?: boolean;
    manualApprovalRequired?: boolean;
  }): Promise<ChapterStoryboard> {
    const { novelId, chapterId, chapterNumber, chapterTitle, chapterText } = params;
    const layoutMode = params.layoutMode || 'vertical_webtoon';
    const generationMode = params.generationMode || 'FREE_FAST';

    // 1. Check existing cached storyboard unless force regeneration is requested (FREE-FIRST)
    if (!params.forceRegenerate) {
      const existing = this.getStoryboard(novelId, chapterNumber);
      if (existing) {
        return existing;
      }
    }

    // 2. Retrieve ONLY relevant selective context from Story Bible (DO NOT send entire novel/Story Bible)
    const selectiveContext = this.storyMemory.getSelectiveContext(novelId, chapterNumber, chapterText);

    // 3. Retrieve Reference Lock state (Character Lock + Style Lock)
    const refState = this.referenceLock.getNovelReferenceLockState(novelId);
    const boundStyleVersion = refState.chapter_style_bindings[chapterNumber] || refState.active_style_version;
    const activeStyle = refState.style_locks.find((s) => s.version === boundStyleVersion) || refState.style_locks[0];

    // 4. Scene Extraction
    const scenes = this.extractScenes({
      chapterNumber,
      chapterText,
      selectiveContext,
      generationMode,
    });

    // 5. Manga Script & Panel Plan generation
    const panels = this.buildPanelPlan({
      novelId,
      chapterId,
      chapterNumber,
      scenes,
      refState,
      activeStyle,
      generationMode,
      layoutMode,
    });

    // 6. Group Panels into Pages (for Manga Page) or Segments (for Webtoon)
    const pages = this.groupPanelsIntoPages(panels, layoutMode);

    const storyboard: ChapterStoryboard = {
      id: `sb_${novelId}_ch${chapterNumber}_${Date.now()}`,
      novel_id: novelId,
      chapter_id: chapterId,
      chapter_number: chapterNumber,
      chapter_title: chapterTitle,
      layout_mode: layoutMode,
      generation_mode: generationMode,
      scenes,
      pages,
      panels,
      tasks: this.compileGenerationTasks(panels, generationMode),
      total_panels: panels.length,
      total_pages: pages.length,
      approved: false,
      manual_approval_required: params.manualApprovalRequired ?? false,
      created_at: Date.now(),
      updated_at: Date.now(),
    };

    // 7. Persist permanently
    this.saveStoryboard(novelId, storyboard);
    return storyboard;
  }

  /**
   * Scene Extraction: Breaks chapter prose into coherent narrative beats
   */
  private extractScenes(params: {
    chapterNumber: number;
    chapterText: string;
    selectiveContext: CompactContext;
    generationMode: GenerationSpeedMode;
  }): SceneBeat[] {
    const { chapterNumber, chapterText, selectiveContext, generationMode } = params;
    const lines = chapterText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

    // Identify scene boundaries using delimiters or transition phrases
    const rawSceneChunks: string[][] = [];
    let currentChunk: string[] = [];

    const sceneBreakRegex = /^(\*\*\*|---|###|___|\/\/\/|===|—{3,})$/;
    const timeLocationRegex = /^(at the|in the|inside the|outside the|meanwhile|later that|the next morning|hours later|back at|deep within|في |داخل |خارج |في هذه الأثناء|في صباح اليوم التالي|بعد مرور|في عمق |في ساحة )/i;

    for (const line of lines) {
      if (sceneBreakRegex.test(line)) {
        if (currentChunk.length > 0) {
          rawSceneChunks.push(currentChunk);
          currentChunk = [];
        }
      } else if (currentChunk.length >= 4 && timeLocationRegex.test(line)) {
        rawSceneChunks.push(currentChunk);
        currentChunk = [line];
      } else {
        currentChunk.push(line);
      }
    }
    if (currentChunk.length > 0) {
      rawSceneChunks.push(currentChunk);
    }

    // Fallback if no explicit boundaries found: divide by paragraph groups
    if (rawSceneChunks.length === 1 && lines.length > 15) {
      const targetScenes = generationMode === 'HIGH_QUALITY' ? 4 : (generationMode === 'STANDARD' ? 3 : 2);
      const chunkSize = Math.ceil(lines.length / targetScenes);
      rawSceneChunks.length = 0;
      for (let i = 0; i < lines.length; i += chunkSize) {
        rawSceneChunks.push(lines.slice(i, i + chunkSize));
      }
    }

    const scenes: SceneBeat[] = [];
    rawSceneChunks.forEach((chunkLines, idx) => {
      const chunkText = chunkLines.join(' ');
      const sceneNum = idx + 1;
      const sceneId = `scene_ch${chapterNumber}_s${sceneNum}`;

      // 1. Detect location
      let location = 'Setting';
      for (const loc of selectiveContext.relevant_locations) {
        if (chunkText.includes(loc.name)) {
          location = loc.name;
          break;
        }
      }
      if (location === 'Setting') {
        const locMatch = chunkText.match(/(?:at the\s+|in the\s+|inside the\s+|deep within the\s+|deep within\s+|outside the\s+|في\s+|داخل\s+|عند\s+)([A-Za-z0-9\s]{2,30}|[\u0600-\u06FF\s]{3,30})/i);
        if (locMatch && locMatch[1]) {
          location = locMatch[1].replace(/[,;.].*$/, '').trim();
        }
      }

      // 2. Detect participating characters
      const participants: string[] = [];
      const charIds: string[] = [];
      for (const c of selectiveContext.relevant_characters) {
        if (chunkText.includes(c.name) || c.aliases.some((a: string) => chunkText.includes(a))) {
          participants.push(c.name);
          charIds.push(c.name.toLowerCase().replace(/\s+/g, '_'));
        }
      }
      if (participants.length === 0) {
        participants.push('Protagonist');
      }

      // 3. Extract dialogue lines
      const dialogue: DialogueLine[] = [];
      // Matches English, Arabic, and CJK quotation styles
      const quoteRegex = /["“«「]([^"”»」]+)["”»」]/g;
      let qMatch;
      let dIndex = 1;
      while ((qMatch = quoteRegex.exec(chunkText)) !== null) {
        const quoteContent = qMatch[1].trim();
        if (quoteContent.length > 1) {
          // Detect speaker from nearby context
          const beforeQuote = chunkText.slice(Math.max(0, qMatch.index - 50), qMatch.index);
          const afterQuote = chunkText.slice(qMatch.index + qMatch[0].length, qMatch.index + qMatch[0].length + 50);
          let speaker = participants[0] || 'Character';

          for (const p of participants) {
            if (beforeQuote.includes(p) || afterQuote.includes(p)) {
              speaker = p;
              break;
            }
          }

          // Detect bubble type
          let bubbleType: DialogueLine['bubble_type'] = 'speech';
          if (quoteContent.endsWith('!') || quoteContent.includes('!!') || quoteContent === quoteContent.toUpperCase() && quoteContent.length > 5) {
            bubbleType = 'shout';
          } else if (quoteContent.includes('...') || beforeQuote.includes('whisper') || beforeQuote.includes('همس')) {
            bubbleType = 'whisper';
          } else if (beforeQuote.includes('thought') || beforeQuote.includes('pondered') || beforeQuote.includes('فكر') || beforeQuote.includes('في نفسه')) {
            bubbleType = 'thought';
          }

          dialogue.push({
            id: `dlg_${sceneId}_${dIndex++}`,
            speaker,
            text: quoteContent,
            bubble_type: bubbleType,
          });
          if (dialogue.length >= 8) break; // Keep manageable per scene
        }
      }

      // Also detect unquoted internal monologue (e.g. "thought to himself: ...", "فكر في نفسه: ...")
      const monologueRegex = /(?:thought to (?:himself|herself|themselves)|pondered|wondered|فكر(?:\s+[\u0600-\u06FF]+)?(?:\s+في نفسه|\s+في نفسها)?|حدث(?:\s+[\u0600-\u06FF]+)?(?:\s+نفسه|\s+نفسها)?)[:\s]+([^.\n!?؟]+[.?!\n؟])/gi;
      let mMatch;
      while ((mMatch = monologueRegex.exec(chunkText)) !== null) {
        const thoughtContent = mMatch[1].trim();
        if (thoughtContent.length > 2 && !dialogue.some(d => d.text.includes(thoughtContent))) {
          dialogue.push({
            id: `dlg_${sceneId}_thought_${dIndex++}`,
            speaker: participants[0] || 'Character',
            text: thoughtContent,
            bubble_type: 'thought',
          });
        }
      }

      // 4. Emotional tone & action summary
      let emotionalTone = 'Neutral dramatic';
      if (/fight|slash|blade|attack|punch|kill|blood|battle|معركة|سيف|ضربة|قتال/i.test(chunkText)) {
        emotionalTone = 'Intense kinetic combat';
      } else if (/laugh|smile|grin|chuckle|joke|ابتسم|ضحك|مزاح/i.test(chunkText)) {
        emotionalTone = 'Lighthearted warm';
      } else if (/shock|gasp|eyes widened|impossible|revealed|صدمة|ذهول|مستحيل/i.test(chunkText)) {
        emotionalTone = 'High-stakes revelation';
      } else if (/dark|gloom|fear|shadow|ominous|ظلام|خوف|شؤم/i.test(chunkText)) {
        emotionalTone = 'Ominous tense';
      }

      // 5. Important objects & powers from glossary
      const importantObjects: string[] = [];
      const powers: string[] = [];
      for (const term of selectiveContext.active_glossary) {
        if (chunkText.includes(term.source) || (term.en && chunkText.includes(term.en)) || (term.ar && chunkText.includes(term.ar))) {
          if (term.category === 'weapon' || term.category === 'artifact') {
            importantObjects.push(term.en || term.source);
          } else if (term.category === 'ability') {
            powers.push(term.en || term.source);
          }
        }
      }

      // Action summary from first 2 non-dialogue sentences
      const nonDialogue = chunkLines
        .filter((l) => !l.startsWith('"') && !l.startsWith('“') && !l.startsWith('«'))
        .slice(0, 2)
        .join(' ');
      const actionSummary = nonDialogue.slice(0, 180) || `Key narrative beat in ${location} involving ${participants.join(', ')}.`;

      scenes.push({
        id: sceneId,
        scene_number: sceneNum,
        location,
        time_of_day: /night|ليل|nightfall/i.test(chunkText) ? 'Night' : (/morning|dawn|صباح|فجر/i.test(chunkText) ? 'Morning' : 'Day'),
        participating_characters: participants,
        action_summary: actionSummary,
        dialogue,
        narration: nonDialogue ? [nonDialogue.slice(0, 140)] : [],
        emotional_tone: emotionalTone,
        important_objects: importantObjects,
        powers_techniques: powers,
        continuity_requirements: [`Preserve character appearances in ${location}`],
        story_bible_references: {
          character_ids: charIds,
        },
      });
    });

    return scenes;
  }

  /**
   * Panel Plan Builder: Converts SceneBeats into concrete StoryboardPanels
   * Respects SMART PANEL COUNTING (anti-hardcoded 7 panels).
   */
  private buildPanelPlan(params: {
    novelId: string;
    chapterId: string;
    chapterNumber: number;
    scenes: SceneBeat[];
    refState: any;
    activeStyle: any;
    generationMode: GenerationSpeedMode;
    layoutMode: MangaLayoutMode;
  }): StoryboardPanel[] {
    const { novelId, chapterId, chapterNumber, scenes, refState, activeStyle, generationMode, layoutMode } = params;
    const panels: StoryboardPanel[] = [];
    let globalPanelNum = 1;

    for (const scene of scenes) {
      // Smart panel budgeting based on scene traits:
      // - Combats/Fights: 4-6 panels
      // - Dialogue/Reveals: 3-4 panels
      // - Establishing/Transitions: 1-2 panels
      let panelCountForScene = 3;
      const isFight = scene.emotional_tone.includes('combat') || scene.powers_techniques.length > 0;
      const isDialogueHeavy = scene.dialogue.length >= 4;

      if (generationMode === 'FREE_FAST') {
        panelCountForScene = isFight ? 4 : (isDialogueHeavy ? 3 : 2);
      } else if (generationMode === 'STANDARD') {
        panelCountForScene = isFight ? 5 : (isDialogueHeavy ? 4 : 3);
      } else {
        // HIGH_QUALITY
        panelCountForScene = isFight ? 6 : (isDialogueHeavy ? 5 : 4);
      }

      // Generate distinct panel shots for the scene
      for (let pIdx = 0; pIdx < panelCountForScene; pIdx++) {
        const panelId = `p_ch${chapterNumber}_s${scene.scene_number}_${pIdx + 1}`;
        const pageId = layoutMode === 'manga_page' ? `page_${Math.ceil(globalPanelNum / 5)}` : 'strip_01';

        // Select framing and camera angle to create dynamic visual pacing
        let framing: StoryboardPanel['framing'] = 'medium_shot';
        let cameraAngle: StoryboardPanel['camera_angle'] = 'eye_level';
        let action = scene.action_summary;
        let pose = 'Stance facing forward';
        let expression = 'Determined, focused';
        const panelDialogue: DialogueLine[] = [];
        const panelSfx: StoryboardPanel['sfx'] = [];

        if (pIdx === 0) {
          // Establishing shot for scene
          framing = 'wide_shot';
          cameraAngle = 'eye_level';
          action = `Establishing shot of ${scene.location}. ${scene.participating_characters.join(', ')} positioned in environment.`;
          pose = 'Standing surveying the surroundings';
          expression = 'Composed observation';
        } else if (isFight && pIdx === 1) {
          // Climax / Attack action
          framing = 'medium_shot';
          cameraAngle = 'low_angle';
          action = `${scene.participating_characters[0]} launches dynamic strike with ${scene.powers_techniques[0] || 'weapon'}.`;
          pose = 'Low dynamic combat stance, momentum forward';
          expression = 'Fierce battle cry, sharp intense eyes';
          panelSfx.push({ text: 'SLASH!', placement: 'diagonal across weapon arc', style: 'bold kinetic' });
        } else if (isFight && pIdx === 2) {
          // Impact frame
          framing = 'cut_in';
          cameraAngle = 'dutch_tilt';
          action = `Shockwave impact as blade connects, energy sparks flying.`;
          pose = 'Mid-collision tension';
          expression = 'Strained exertion';
          panelSfx.push({ text: 'BOOM!', placement: 'center burst', style: 'heavy impact' });
        } else if (pIdx === panelCountForScene - 1) {
          // Emotional / reaction close-up
          framing = 'close_up';
          cameraAngle = 'eye_level';
          action = `Close-up reaction on ${scene.participating_characters[0]}.`;
          pose = 'Subtle head turn, hair catching wind';
          expression = scene.emotional_tone.includes('shock') ? 'Eyes wide in disbelief' : 'Firm, stoic resolve';
        } else {
          // Dialogue beat
          framing = 'medium_shot';
          cameraAngle = 'eye_level';
          action = `${scene.participating_characters[0]} speaking with intensity.`;
          pose = 'Expressive conversational posture';
          expression = 'Earnest, speaking';
        }

        // Assign corresponding dialogue line if available
        if (scene.dialogue.length > pIdx) {
          panelDialogue.push(scene.dialogue[pIdx]);
        }

        // Pull Character Lock IDs for participating characters
        const charLockIds: string[] = [];
        const characters = scene.participating_characters.map((name) => {
          const charId = name.toLowerCase().replace(/\s+/g, '_');
          if (refState.character_locks[charId]) {
            charLockIds.push(charId);
          }
          return {
            name,
            role: 'Participant',
            character_lock_id: refState.character_locks[charId] ? charId : undefined,
          };
        });

        // Compile prompt payload using Stage 4 Reference Lock dual-track conditioning
        const promptConstraints = this.referenceLock.buildStructuredPromptConstraints({
          novelId,
          chapterNumber,
          novelCharacterIds: charLockIds,
          sceneText: `${action} [${scene.location}]`,
          panelNumber: globalPanelNum,
        });

        const positivePrompt = [
          `Masterpiece comic panel, ${framing.replace(/_/g, ' ')}, ${cameraAngle.replace(/_/g, ' ')}.`,
          `Scene: ${action}.`,
          `Characters: ${characters.map((c) => c.name).join(', ')}. Expression: ${expression}. Pose: ${pose}.`,
          `Environment: ${scene.location}, ${scene.time_of_day} lighting. ${scene.emotional_tone} mood.`,
          promptConstraints.characterLockBlock,
          promptConstraints.styleProfileBlock,
        ].join('\n');

        const negativePrompt = 'blurry, distorted anatomy, missing limbs, altered costume colors, deformed eyes, flat lighting, amateur line art, style drift';

        panels.push({
          id: panelId,
          chapter_id: chapterId,
          chapter_number: chapterNumber,
          scene_id: scene.id,
          page_or_strip_id: pageId,
          panel_number_in_page: ((globalPanelNum - 1) % 5) + 1,
          global_panel_number: globalPanelNum++,
          characters,
          character_lock_ids: charLockIds,
          style_lock_id: activeStyle.style_id,
          style_version: activeStyle.version,
          location: scene.location,
          story_bible_references: scene.story_bible_references.character_ids,
          action,
          pose,
          facial_expression: expression,
          camera_angle: cameraAngle,
          framing,
          background_detail: `${scene.location} with atmospheric perspective and perspective depth`,
          lighting: scene.time_of_day === 'Night' ? 'Dramatic moonlit rim lighting with deep cast shadows' : 'Clean key light with soft fill',
          dialogue: panelDialogue,
          narration_boxes: pIdx === 0 && scene.narration.length > 0 ? [scene.narration[0]] : [],
          sfx: panelSfx,
          composition_notes: `${framing} focusing on visual storytelling with clean speech bubble clearance`,
          prompt_payload: {
            positive_prompt: positivePrompt,
            negative_prompt: negativePrompt,
            character_lock_block: promptConstraints.characterLockBlock,
            style_lock_block: promptConstraints.styleProfileBlock,
          },
          status: 'PLANNED',
          user_edited: false,
          created_at: Date.now(),
          updated_at: Date.now(),
        });
      }
    }

    return panels;
  }

  /**
   * Group flat list of panels into pages or webtoon strips
   */
  private groupPanelsIntoPages(panels: StoryboardPanel[], layoutMode: MangaLayoutMode): StoryboardPage[] {
    if (layoutMode === 'vertical_webtoon') {
      return [
        {
          page_id: 'strip_01',
          page_number: 1,
          panels,
        },
      ];
    }

    // Manga Page mode: group 4 to 5 panels per page
    const pages: StoryboardPage[] = [];
    const pageSize = 5;
    for (let i = 0; i < panels.length; i += pageSize) {
      const pageNum = Math.floor(i / pageSize) + 1;
      const pagePanels = panels.slice(i, i + pageSize);
      pagePanels.forEach((p, idx) => {
        p.page_or_strip_id = `page_${pageNum}`;
        p.panel_number_in_page = idx + 1;
      });
      pages.push({
        page_id: `page_${pageNum}`,
        page_number: pageNum,
        panels: pagePanels,
      });
    }
    return pages;
  }

  /**
   * Storyboard Review: Update specific panel attributes
   */
  updatePanel(params: {
    novelId: string;
    chapterNumber: number;
    panelId: string;
    updates: Partial<StoryboardPanel>;
  }): StoryboardPanel | null {
    const sb = this.getStoryboard(params.novelId, params.chapterNumber);
    if (!sb) return null;

    const panel = sb.panels.find((p) => p.id === params.panelId);
    if (!panel) return null;

    Object.assign(panel, params.updates);
    panel.user_edited = true;
    panel.status = 'EDITED';
    panel.updated_at = Date.now();

    // Re-compile positive prompt if action/dialogue/camera was edited
    if (params.updates.action || params.updates.framing || params.updates.camera_angle || params.updates.facial_expression) {
      panel.prompt_payload.positive_prompt = [
        `Masterpiece comic panel, ${panel.framing.replace(/_/g, ' ')}, ${panel.camera_angle.replace(/_/g, ' ')}.`,
        `Scene: ${panel.action}.`,
        `Characters: ${panel.characters.map((c) => c.name).join(', ')}. Expression: ${panel.facial_expression}. Pose: ${panel.pose}.`,
        `Environment: ${panel.location}.`,
        panel.prompt_payload.character_lock_block,
        panel.prompt_payload.style_lock_block,
      ].join('\n');
    }

    // Sync in pages structure
    for (const page of sb.pages) {
      const pIdx = page.panels.findIndex((p) => p.id === params.panelId);
      if (pIdx !== -1) {
        page.panels[pIdx] = { ...panel };
        break;
      }
    }

    this.saveStoryboard(params.novelId, sb);
    return panel;
  }

  /**
   * Storyboard Review: Add a new panel to the plan
   */
  addPanel(params: {
    novelId: string;
    chapterNumber: number;
    sceneId: string;
    afterPanelId?: string;
    panelData?: Partial<StoryboardPanel>;
  }): StoryboardPanel | null {
    const sb = this.getStoryboard(params.novelId, params.chapterNumber);
    if (!sb) return null;

    const insertIndex = params.afterPanelId
      ? sb.panels.findIndex((p) => p.id === params.afterPanelId) + 1
      : sb.panels.length;

    const newPanelNumber = insertIndex + 1;
    const newPanelId = `p_ch${params.chapterNumber}_s_custom_${Date.now().toString(36)}`;

    const newPanel: StoryboardPanel = {
      id: newPanelId,
      chapter_id: sb.chapter_id,
      chapter_number: params.chapterNumber,
      scene_id: params.sceneId || sb.scenes[0]?.id || 'scene_01',
      page_or_strip_id: 'page_custom',
      panel_number_in_page: 1,
      global_panel_number: newPanelNumber,
      characters: [{ name: 'Character', role: 'Protagonist' }],
      character_lock_ids: [],
      style_lock_id: sb.panels[0]?.style_lock_id || 'default_style',
      style_version: sb.panels[0]?.style_version || 1,
      location: 'Scene location',
      story_bible_references: [],
      action: 'Additional narrative beat added by user',
      pose: 'Dynamic stance',
      facial_expression: 'Attentive',
      camera_angle: 'eye_level',
      framing: 'medium_shot',
      background_detail: 'Detailed environment',
      lighting: 'Balanced cinematic lighting',
      dialogue: [],
      narration_boxes: [],
      sfx: [],
      composition_notes: 'User-inserted panel',
      prompt_payload: {
        positive_prompt: 'Masterpiece comic panel, medium shot, eye level. Dynamic scene.',
        negative_prompt: 'blurry, bad anatomy, distorted',
        character_lock_block: sb.panels[0]?.prompt_payload?.character_lock_block || '',
        style_lock_block: sb.panels[0]?.prompt_payload?.style_lock_block || '',
      },
      status: 'EDITED',
      user_edited: true,
      created_at: Date.now(),
      updated_at: Date.now(),
      ...params.panelData,
    };

    sb.panels.splice(insertIndex, 0, newPanel);

    // Renumber global panels
    sb.panels.forEach((p, idx) => {
      p.global_panel_number = idx + 1;
    });

    // Re-group into pages
    sb.pages = this.groupPanelsIntoPages(sb.panels, sb.layout_mode);
    this.saveStoryboard(params.novelId, sb);
    return newPanel;
  }

  /**
   * Storyboard Review: Delete redundant panel
   */
  deletePanel(params: {
    novelId: string;
    chapterNumber: number;
    panelId: string;
  }): boolean {
    const sb = this.getStoryboard(params.novelId, params.chapterNumber);
    if (!sb) return false;

    const pIdx = sb.panels.findIndex((p) => p.id === params.panelId);
    if (pIdx === -1) return false;

    sb.panels.splice(pIdx, 1);

    // Renumber global panels
    sb.panels.forEach((p, idx) => {
      p.global_panel_number = idx + 1;
    });

    sb.pages = this.groupPanelsIntoPages(sb.panels, sb.layout_mode);
    this.saveStoryboard(params.novelId, sb);
    return true;
  }

  /**
   * Approve storyboard for image generation
   */
  approveStoryboard(novelId: string, chapterNumber: number, approved: boolean = true): ChapterStoryboard | null {
    const sb = this.getStoryboard(novelId, chapterNumber);
    if (!sb) return null;

    sb.approved = approved;
    sb.panels.forEach((p) => {
      if (p.status === 'PLANNED' || p.status === 'EDITED') {
        p.status = approved ? 'APPROVED' : 'PLANNED';
      }
    });
    this.saveStoryboard(novelId, sb);
    return sb;
  }
}
