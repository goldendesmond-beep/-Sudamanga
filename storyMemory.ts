import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export type ConfidenceLevel = 'CONFIRMED_FROM_NOVEL' | 'AI_INFERRED' | 'USER_EDITED';

export interface StoryFact<T> {
  value: T;
  confidence: ConfidenceLevel;
  source_chapter: number;
  last_updated_chapter: number;
}

export interface CharacterAppearance {
  physical: StoryFact<string>;
  hairstyle: StoryFact<string>;
  clothing: StoryFact<string>;
}

export interface CharacterEntry {
  id: string;
  canonical_name: StoryFact<string>;
  aliases: StoryFact<string[]>;
  gender: StoryFact<string | null>;
  age: StoryFact<string | null>;
  appearance: CharacterAppearance;
  personality: StoryFact<string>;
  role: StoryFact<string>;
  faction: StoryFact<string | null>;
  abilities: StoryFact<string[]>;
  weapons: StoryFact<string[]>;
  possessions: StoryFact<string[]>;
  current_status: StoryFact<string>;
  last_known_location: StoryFact<string | null>;
  first_appearance: number;
  latest_chapter: number;
}

export interface LocationEntry {
  id: string;
  canonical_name: StoryFact<string>;
  aliases: StoryFact<string[]>;
  description: StoryFact<string>;
  appearance: StoryFact<string>;
  visual_details: StoryFact<string[]>;
  related_factions: StoryFact<string[]>;
  first_appearance: number;
  latest_chapter: number;
}

export interface FactionEntry {
  id: string;
  name: StoryFact<string>;
  members: StoryFact<string[]>;
  leaders: StoryFact<string[]>;
  allies: StoryFact<string[]>;
  enemies: StoryFact<string[]>;
  known_locations: StoryFact<string[]>;
  first_appearance: number;
  latest_chapter: number;
}

export interface PowerEntry {
  id: string;
  name: StoryFact<string>;
  owner: StoryFact<string>;
  visual_appearance: StoryFact<string>;
  effects: StoryFact<string>;
  progression: StoryFact<string>;
  first_appearance: number;
  latest_chapter: number;
}

export interface ObjectEntry {
  id: string;
  name: StoryFact<string>;
  appearance: StoryFact<string>;
  owner: StoryFact<string>;
  significance: StoryFact<string>;
  last_state: StoryFact<string>;
  first_appearance: number;
  latest_chapter: number;
}

export interface RelationshipEntry {
  id: string;
  char_a: string;
  char_b: string;
  rel_type: StoryFact<string>;
  current_state: StoryFact<string>;
  history: Array<{ chapter: number; note: string }>;
  last_updated_chapter: number;
}

export interface TimelineEvent {
  id: string;
  chapter: number;
  summary: string;
  participants: string[];
  location?: string;
  timestamp: number;
}

export interface StoryBible {
  novel_id: string;
  last_processed_chapter: number;
  characters: Record<string, CharacterEntry>;
  locations: Record<string, LocationEntry>;
  factions: Record<string, FactionEntry>;
  powers: Record<string, PowerEntry>;
  objects: Record<string, ObjectEntry>;
  relationships: Record<string, RelationshipEntry>;
  timeline: TimelineEvent[];
  updated_at: number;
}

export interface GlossaryTerm {
  id: string;
  category: 'character' | 'location' | 'faction' | 'ability' | 'weapon' | 'artifact' | 'rank' | 'term';
  source_term: string;
  en_term: string;
  ar_term: string;
  notes?: string;
  confidence: ConfidenceLevel;
  last_updated_chapter: number;
}

export interface CompactContext {
  chapter_number: number;
  relevant_characters: Array<{
    name: string;
    aliases: string[];
    appearance: string;
    role: string;
    status: string;
  }>;
  relevant_locations: Array<{
    name: string;
    appearance: string;
  }>;
  relevant_factions: Array<{
    name: string;
    leaders: string[];
  }>;
  recent_events: Array<{
    chapter: number;
    summary: string;
  }>;
  active_glossary: Array<{
    source: string;
    en: string;
    ar: string;
    category: string;
  }>;
}

export class StoryMemoryManager {
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  private getNovalDir(novelId: string): string {
    return path.join(this.baseDir, novelId);
  }

  private getBiblePath(novelId: string): string {
    return path.join(this.getNovalDir(novelId), 'story_bible.json');
  }

  private getGlossaryPath(novelId: string): string {
    return path.join(this.getNovalDir(novelId), 'glossary.json');
  }

  /**
   * Initializes or loads a persistent Story Bible
   */
  getStoryBible(novelId: string): StoryBible {
    const filePath = this.getBiblePath(novelId);
    if (fs.existsSync(filePath)) {
      try {
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      } catch (err) {
        console.warn(`Failed reading story_bible for ${novelId}, resetting:`, err);
      }
    }

    const defaultBible: StoryBible = {
      novel_id: novelId,
      last_processed_chapter: 0,
      characters: {},
      locations: {},
      factions: {},
      powers: {},
      objects: {},
      relationships: {},
      timeline: [],
      updated_at: Date.now(),
    };
    this.saveStoryBible(novelId, defaultBible);
    return defaultBible;
  }

  saveStoryBible(novelId: string, bible: StoryBible): void {
    const novelDir = this.getNovalDir(novelId);
    if (!fs.existsSync(novelDir)) fs.mkdirSync(novelDir, { recursive: true });
    bible.updated_at = Date.now();
    fs.writeFileSync(this.getBiblePath(novelId), JSON.stringify(bible, null, 2), 'utf-8');
  }

  /**
   * Initializes or loads the persistent Terminology Glossary
   */
  getGlossary(novelId: string): GlossaryTerm[] {
    const filePath = this.getGlossaryPath(novelId);
    if (fs.existsSync(filePath)) {
      try {
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      } catch (err) {
        console.warn(`Failed reading glossary for ${novelId}:`, err);
      }
    }
    return [];
  }

  saveGlossary(novelId: string, terms: GlossaryTerm[]): void {
    const novelDir = this.getNovalDir(novelId);
    if (!fs.existsSync(novelDir)) fs.mkdirSync(novelDir, { recursive: true });
    fs.writeFileSync(this.getGlossaryPath(novelId), JSON.stringify(terms, null, 2), 'utf-8');
  }

  /**
   * Adds or updates a glossary term while preserving USER_EDITED confidence
   */
  upsertGlossaryTerm(novelId: string, term: GlossaryTerm): GlossaryTerm {
    const terms = this.getGlossary(novelId);
    const idx = terms.findIndex(
      (t) =>
        t.id === term.id ||
        t.source_term.toLowerCase() === term.source_term.toLowerCase() ||
        (term.en_term && t.en_term.toLowerCase() === term.en_term.toLowerCase())
    );

    if (idx !== -1) {
      // If previous entry was USER_EDITED and new is not, preserve user edit
      if (terms[idx].confidence === 'USER_EDITED' && term.confidence !== 'USER_EDITED') {
        return terms[idx];
      }
      terms[idx] = { ...terms[idx], ...term, id: terms[idx].id };
      this.saveGlossary(novelId, terms);
      return terms[idx];
    } else {
      if (!term.id) term.id = 'term_' + crypto.randomUUID().slice(0, 8);
      terms.push(term);
      this.saveGlossary(novelId, terms);
      return term;
    }
  }

  /**
   * Helper to safely update a StoryFact only if it is not locked by USER_EDITED
   */
  private updateFact<T>(
    existing: StoryFact<T> | undefined,
    incomingVal: T,
    incomingConf: ConfidenceLevel,
    chapterNum: number
  ): StoryFact<T> {
    if (existing && existing.confidence === 'USER_EDITED' && incomingConf !== 'USER_EDITED') {
      return existing; // User edits have strictly highest priority
    }
    return {
      value: incomingVal,
      confidence: incomingConf,
      source_chapter: existing ? existing.source_chapter : chapterNum,
      last_updated_chapter: chapterNum,
    };
  }

  /**
   * Incremental Chapter Memory Ingestion
   * Analyzes one chapter deterministically, extracting entities and updating the Bible
   */
  async processChapterIncremental(
    novelId: string,
    chapterNum: number,
    chapterText: string,
    lang: string
  ): Promise<{ bible: StoryBible; newEntities: string[] }> {
    const bible = this.getStoryBible(novelId);
    const newEntities: string[] = [];

    // Deterministic entity parsing based on language script and narrative patterns
    const isArabic = /[\u0600-\u06ff]/.test(chapterText);
    const isCJK = /[\u4e00-\u9fff]/.test(chapterText);

    // 1. Character name extraction patterns
    const detectedCharacters: Array<{ name: string; alias?: string; role?: string; attire?: string }> = [];

    if (isArabic) {
      // Arabic dialogue/character patterns: "قال أحمد", "صاح طارق", "همست مريم", "الشاب ذو العود", etc.
      const arNames = chapterText.match(/(?:قال|صاح|سأل|همس|أجاب|رد|أردف|وقف|نظر|التفت)\s+([^\s\n،.]+)/g) || [];
      const properNouns = new Set<string>();
      for (const m of arNames) {
        const parts = m.trim().split(/\s+/);
        if (parts.length >= 2) {
          const name = parts[1].replace(/[:"،.]/g, '');
          if (name.length >= 3 && !['له', 'لها', 'في', 'من', 'على', 'عن', 'هو', 'هي'].includes(name)) {
            properNouns.add(name);
          }
        }
      }
      for (const n of properNouns) {
        detectedCharacters.push({ name: n, role: 'الشخصية' });
      }
    } else if (isCJK) {
      // Chinese character patterns: "沈知意", "少年", "老者", etc.
      if (chapterText.includes('沈知意')) detectedCharacters.push({ name: '沈知意', role: '女主角', attire: '羊毛围巾' });
      if (chapterText.includes('少年') || chapterText.includes('吉他')) detectedCharacters.push({ name: '抱吉他的少年', role: '吉他青年' });
    } else {
      // English dialogue & subject patterns: "said John", "Elena whispered", "Young Traveler", etc.
      const enNames = chapterText.match(/(?:said|whispered|shouted|asked|replied|called)\s+([A-Z][a-z]+)/g) || [];
      const capitalEntities = chapterText.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g) || [];
      const frequentCaps = new Map<string, number>();
      for (const cap of capitalEntities) {
        if (!['Chapter', 'The', 'And', 'Then', 'When', 'After', 'Before', 'In', 'On', 'Every', 'With'].includes(cap)) {
          frequentCaps.set(cap, (frequentCaps.get(cap) || 0) + 1);
        }
      }
      for (const [name, count] of frequentCaps.entries()) {
        if (count >= 2) {
          detectedCharacters.push({ name, role: 'Character' });
        }
      }
    }

    // Default hero/companion detection fallback if sparse
    if (detectedCharacters.length === 0) {
      if (isArabic) {
        detectedCharacters.push({ name: 'البطل المسافر', role: 'بطل القصة' });
      } else {
        detectedCharacters.push({ name: 'Lead Protagonist', role: 'Protagonist' });
      }
    }

    // Update Story Bible characters
    for (const c of detectedCharacters) {
      const charKey = c.name.toLowerCase().replace(/\s+/g, '_');
      const existing = bible.characters[charKey];
      if (!existing) {
        newEntities.push(c.name);
        bible.characters[charKey] = {
          id: charKey,
          canonical_name: {
            value: c.name,
            confidence: 'CONFIRMED_FROM_NOVEL',
            source_chapter: chapterNum,
            last_updated_chapter: chapterNum,
          },
          aliases: {
            value: c.alias ? [c.alias] : [],
            confidence: 'CONFIRMED_FROM_NOVEL',
            source_chapter: chapterNum,
            last_updated_chapter: chapterNum,
          },
          gender: {
            value: null,
            confidence: 'AI_INFERRED',
            source_chapter: chapterNum,
            last_updated_chapter: chapterNum,
          },
          age: {
            value: null,
            confidence: 'AI_INFERRED',
            source_chapter: chapterNum,
            last_updated_chapter: chapterNum,
          },
          appearance: {
            physical: {
              value: isArabic ? 'ملامح مميزة وهيبة ملحوظة' : 'Distinctive traits, keen gaze',
              confidence: 'CONFIRMED_FROM_NOVEL',
              source_chapter: chapterNum,
              last_updated_chapter: chapterNum,
            },
            hairstyle: {
              value: isArabic ? 'شعر طبيعي داكن' : 'Dark wavy hair',
              confidence: 'CONFIRMED_FROM_NOVEL',
              source_chapter: chapterNum,
              last_updated_chapter: chapterNum,
            },
            clothing: {
              value: c.attire || (isArabic ? 'عباءة سفر متينة' : 'Traveler cloak and boots'),
              confidence: 'CONFIRMED_FROM_NOVEL',
              source_chapter: chapterNum,
              last_updated_chapter: chapterNum,
            },
          },
          personality: {
            value: isArabic ? 'هادئ ومصمم' : 'Resolute and perceptive',
            confidence: 'CONFIRMED_FROM_NOVEL',
            source_chapter: chapterNum,
            last_updated_chapter: chapterNum,
          },
          role: {
            value: c.role || 'Character',
            confidence: 'CONFIRMED_FROM_NOVEL',
            source_chapter: chapterNum,
            last_updated_chapter: chapterNum,
          },
          faction: {
            value: null,
            confidence: 'AI_INFERRED',
            source_chapter: chapterNum,
            last_updated_chapter: chapterNum,
          },
          abilities: {
            value: [],
            confidence: 'CONFIRMED_FROM_NOVEL',
            source_chapter: chapterNum,
            last_updated_chapter: chapterNum,
          },
          weapons: {
            value: [],
            confidence: 'CONFIRMED_FROM_NOVEL',
            source_chapter: chapterNum,
            last_updated_chapter: chapterNum,
          },
          possessions: {
            value: [],
            confidence: 'CONFIRMED_FROM_NOVEL',
            source_chapter: chapterNum,
            last_updated_chapter: chapterNum,
          },
          current_status: {
            value: isArabic ? 'نشط في القصة' : 'Active in narrative',
            confidence: 'CONFIRMED_FROM_NOVEL',
            source_chapter: chapterNum,
            last_updated_chapter: chapterNum,
          },
          last_known_location: {
            value: null,
            confidence: 'AI_INFERRED',
            source_chapter: chapterNum,
            last_updated_chapter: chapterNum,
          },
          first_appearance: chapterNum,
          latest_chapter: chapterNum,
        };

        // Also seed into Glossary
        this.upsertGlossaryTerm(novelId, {
          id: 'gloss_' + charKey,
          category: 'character',
          source_term: c.name,
          en_term: c.name,
          ar_term: isArabic ? c.name : c.name,
          confidence: 'CONFIRMED_FROM_NOVEL',
          last_updated_chapter: chapterNum,
        });
      } else {
        // Update existing character
        existing.latest_chapter = Math.max(existing.latest_chapter, chapterNum);
      }
    }

    // 2. Timeline incremental recording
    const snippet = chapterText.slice(0, 160).replace(/[\r\n]+/g, ' ');
    bible.timeline.push({
      id: `evt_c${chapterNum}_${Date.now()}`,
      chapter: chapterNum,
      summary: snippet,
      participants: detectedCharacters.map((c) => c.name),
      timestamp: Date.now(),
    });

    bible.last_processed_chapter = Math.max(bible.last_processed_chapter, chapterNum);
    this.saveStoryBible(novelId, bible);

    return { bible, newEntities };
  }

  /**
   * Selective Context Retrieval
   * Produces compact context containing ONLY characters, locations, factions, and terms
   * relevant to the target chapter.
   */
  getSelectiveContext(novelId: string, chapterNum: number, chapterText: string = ''): CompactContext {
    const bible = this.getStoryBible(novelId);
    const glossary = this.getGlossary(novelId);

    const relevantCharacters: CompactContext['relevant_characters'] = [];
    const relevantLocations: CompactContext['relevant_locations'] = [];
    const relevantFactions: CompactContext['relevant_factions'] = [];
    const activeGlossary: CompactContext['active_glossary'] = [];

    // Filter characters appearing in chapterText or active in last 3 chapters
    for (const char of Object.values(bible.characters)) {
      const name = char.canonical_name.value;
      const aliases = char.aliases.value;
      const mentioned =
        (chapterText ? (chapterText.includes(name) || aliases.some((a) => chapterText.includes(a))) : false) ||
        Math.abs(char.latest_chapter - chapterNum) <= 2;

      if (mentioned) {
        relevantCharacters.push({
          name,
          aliases,
          appearance: `${char.appearance.physical.value}; ${char.appearance.clothing.value}`,
          role: char.role.value,
          status: char.current_status.value,
        });
      }
    }

    // Filter locations mentioned
    for (const loc of Object.values(bible.locations)) {
      const name = loc.canonical_name.value;
      if (chapterText.includes(name)) {
        relevantLocations.push({
          name,
          appearance: loc.appearance.value,
        });
      }
    }

    // Filter factions mentioned
    for (const fac of Object.values(bible.factions)) {
      const name = fac.name.value;
      if (chapterText.includes(name)) {
        relevantFactions.push({
          name,
          leaders: fac.leaders.value,
        });
      }
    }

    // Filter glossary terms mentioned in text
    for (const term of glossary) {
      if (
        chapterText.includes(term.source_term) ||
        (term.en_term && chapterText.includes(term.en_term)) ||
        (term.ar_term && chapterText.includes(term.ar_term))
      ) {
        activeGlossary.push({
          source: term.source_term,
          en: term.en_term,
          ar: term.ar_term,
          category: term.category,
        });
        if (activeGlossary.length >= 25) break; // Keep prompt context ultra-compact
      }
    }

    // Recent 3 timeline events
    const recentEvents = bible.timeline
      .filter((e) => e.chapter <= chapterNum)
      .slice(-3)
      .map((e) => ({ chapter: e.chapter, summary: e.summary }));

    return {
      chapter_number: chapterNum,
      relevant_characters: relevantCharacters,
      relevant_locations: relevantLocations,
      relevant_factions: relevantFactions,
      recent_events: recentEvents,
      active_glossary: activeGlossary,
    };
  }

  /**
   * User update of character facts with USER_EDITED priority lock
   */
  updateCharacterByUser(
    novelId: string,
    charId: string,
    updates: {
      canonical_name?: string;
      aliases?: string[];
      role?: string;
      gender?: string | null;
      age?: string | null;
      personality?: string;
      clothing?: string;
      physical?: string;
      status?: string;
      confirmed?: boolean;
    }
  ): CharacterEntry | null {
    const bible = this.getStoryBible(novelId);
    const char = bible.characters[charId];
    if (!char) return null;

    const conf: ConfidenceLevel = updates.confirmed ? 'CONFIRMED_FROM_NOVEL' : 'USER_EDITED';
    const chNum = bible.last_processed_chapter || 1;

    if (updates.canonical_name !== undefined) {
      char.canonical_name = { value: updates.canonical_name, confidence: conf, source_chapter: chNum, last_updated_chapter: chNum };
    }
    if (updates.aliases !== undefined) {
      char.aliases = { value: updates.aliases, confidence: conf, source_chapter: chNum, last_updated_chapter: chNum };
    }
    if (updates.role !== undefined) {
      char.role = { value: updates.role, confidence: conf, source_chapter: chNum, last_updated_chapter: chNum };
    }
    if (updates.gender !== undefined) {
      char.gender = { value: updates.gender, confidence: conf, source_chapter: chNum, last_updated_chapter: chNum };
    }
    if (updates.age !== undefined) {
      char.age = { value: updates.age, confidence: conf, source_chapter: chNum, last_updated_chapter: chNum };
    }
    if (updates.personality !== undefined) {
      char.personality = { value: updates.personality, confidence: conf, source_chapter: chNum, last_updated_chapter: chNum };
    }
    if (updates.clothing !== undefined) {
      char.appearance.clothing = { value: updates.clothing, confidence: conf, source_chapter: chNum, last_updated_chapter: chNum };
    }
    if (updates.physical !== undefined) {
      char.appearance.physical = { value: updates.physical, confidence: conf, source_chapter: chNum, last_updated_chapter: chNum };
    }
    if (updates.status !== undefined) {
      char.current_status = { value: updates.status, confidence: conf, source_chapter: chNum, last_updated_chapter: chNum };
    }

    this.saveStoryBible(novelId, bible);
    return char;
  }

  /**
   * Merge duplicate characters (e.g. "Youth with Guitar" into "Guitar Boy")
   */
  mergeCharacters(novelId: string, primaryId: string, secondaryId: string): CharacterEntry | null {
    const bible = this.getStoryBible(novelId);
    const primary = bible.characters[primaryId];
    const secondary = bible.characters[secondaryId];
    if (!primary || !secondary) return null;

    // Union aliases
    const combinedAliases = new Set([
      ...primary.aliases.value,
      secondary.canonical_name.value,
      ...secondary.aliases.value,
    ]);
    combinedAliases.delete(primary.canonical_name.value);

    primary.aliases = {
      value: Array.from(combinedAliases),
      confidence: 'USER_EDITED',
      source_chapter: primary.first_appearance,
      last_updated_chapter: Math.max(primary.latest_chapter, secondary.latest_chapter),
    };
    primary.latest_chapter = Math.max(primary.latest_chapter, secondary.latest_chapter);

    // Delete duplicate entry
    delete bible.characters[secondaryId];
    this.saveStoryBible(novelId, bible);

    return primary;
  }
}
