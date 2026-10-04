import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export type ReferenceMode = 'characters_only' | 'style_only' | 'characters_and_style';

export interface VisualStyleProfile {
  style_id: string;
  version: number;
  reference_series: string;
  series_type: 'manga' | 'manhwa' | 'webtoon' | 'comic';
  line_art: {
    density: string;
    thickness: string;
    cleanliness: string;
  };
  proportions: {
    face: string;
    eyes: string;
    anatomy: string;
  };
  rendering: {
    hair: string;
    clothing: string;
    color_mode: 'black_and_white' | 'full_color' | 'monochrome_screentone';
  };
  shading: {
    technique: string;
    screentone_behavior: string;
    shadows: string;
    contrast: string;
  };
  background: {
    detail_level: string;
    environment_rendering: string;
    lighting: string;
    texture: string;
  };
  effects: {
    motion_lines: string;
    speed_lines: string;
    impact_frames: string;
    fight_effects: string;
    aura_power: string;
  };
  cinematography: {
    shot_selection: string;
    camera_angles: string;
    close_up_frequency: string;
    action_framing: string;
    emotional_framing: string;
    panel_density: string;
    page_webtoon_rhythm: string;
    sfx_presentation: string;
    overall_mood: string;
  };
  active: boolean;
  user_overrides: Record<string, string>;
  provider_notes: string;
  created_at: number;
  updated_at: number;
}

export interface CharacterLockProfile {
  character_id: string;
  canonical_name: string;
  reference_series: string;
  reference_character: string;
  reference_image_url: string | null;
  face_shape: string;
  facial_proportions: string;
  eyes: string;
  eyebrows: string;
  nose: string;
  mouth: string;
  hairstyle: string;
  hair_color: string;
  skin_tone: string;
  body_build: string;
  apparent_age: string;
  height_impression: string;
  signature_outfit: string;
  accessories: string[];
  weapons: string[];
  distinctive_marks: string[];
  recurring_visual_details: string[];
  locked: boolean;
  user_overrides?: Record<string, string>;
  created_at: number;
  updated_at: number;
}

export const PROVIDER_CAPABILITIES = {
  agnes_l2: {
    name: 'Agnes L2 (Reference img2img)',
    type: 'img2img' as const,
    supported: true,
    consistency_mechanism: 'Multi-image character portraits + previous panel context conditioning via latent guide',
    fidelity_notes: 'Strongest available visual identity preservation. Anchors facial features and costumes across panels.',
  },
  agnes_l1: {
    name: 'Agnes L1 (Prompt-only)',
    type: 'prompt_conditioning' as const,
    supported: true,
    consistency_mechanism: 'Dual-track structured prompt conditioning (Canonical Character Lock + Visual Style Profile)',
    fidelity_notes: 'High consistency via structured prompt injection without requiring reference image uploads.',
  },
  gemini_imagen: {
    name: 'Gemini / Imagen 3',
    type: 'prompt_conditioning' as const,
    supported: true,
    consistency_mechanism: 'Semantic narrative prompt constraints with explicit negative prompt anchors',
    fidelity_notes: 'Captures stylistic tone, line art density, and signature outfit accurately.',
  },
};

export interface ConsistencyAuditResult {
  novel_id: string;
  reference_series: string;
  reference_mode: ReferenceMode;
  character_lock_active: boolean;
  style_lock_active: boolean;
  active_style_version: number;
  style_locks_history: Array<{ version: number; series: string; active: boolean; created_at: number }>;
  mapped_characters: Array<{
    novel_character_id: string;
    novel_character_name: string;
    reference_character: string;
    reference_series: string;
    locked: boolean;
    has_overrides: boolean;
  }>;
  unmapped_characters: string[];
  provider_capabilities: typeof PROVIDER_CAPABILITIES;
  active_strategy: string;
  sample_prompt: {
    panel_number: number;
    combined_prompt: string;
    story_bible_block: string;
    character_lock_block: string;
    style_lock_block: string;
  };
  warnings: string[];
}

export interface CharacterMapping {
  novel_character_id: string;
  novel_character_name: string;
  reference_series: string;
  reference_character: string;
  locked: boolean;
  notes?: string;
}

export interface NovelReferenceLockState {
  novel_id: string;
  reference_mode: ReferenceMode;
  character_lock_active: boolean;
  style_lock_active: boolean;
  active_series_title: string;
  character_mappings: Record<string, CharacterMapping>;
  character_locks: Record<string, CharacterLockProfile>;
  style_locks: VisualStyleProfile[];
  active_style_version: number;
  chapter_style_bindings: Record<number, number>;
  updated_at: number;
}

export interface SeriesMetadata {
  title: string;
  alt_titles: string[];
  series_type: 'manga' | 'manhwa' | 'webtoon' | 'comic';
  author?: string;
  genres: string[];
  summary: string;
  characters: Array<{
    name: string;
    role: string;
    description: string;
    visual_traits: Partial<CharacterLockProfile>;
  }>;
  derived_style: Partial<VisualStyleProfile>;
}

// Built-in verified reference series catalog (zero-cost, zero-API dependency, fully cached)
const BUILTIN_SERIES_CATALOG: Record<string, SeriesMetadata> = {
  'solo leveling': {
    title: 'Solo Leveling',
    alt_titles: ['Only I Level Up', 'Na Honjaman Rebeleop', '나 혼자만 레벨업'],
    series_type: 'manhwa',
    genres: ['Action', 'Fantasy', 'Supernatural'],
    summary: 'Dark urban fantasy webtoon featuring sleek glowing auras, sharp ink contours, and cinematic vertical scrolls.',
    characters: [
      {
        name: 'Sung Jinwoo',
        role: 'Protagonist / Shadow Monarch',
        description: 'Tall, lean athletic hunter with sharp angular jaw, glowing violet/blue eyes, sleek dark hair, and long black trench coat with ethereal shadow mist.',
        visual_traits: {
          face_shape: 'Sharp angular V-line jaw, prominent cheekbones',
          facial_proportions: 'Slim anime aesthetic, narrow intense chin',
          eyes: 'Narrow intense piercing gaze, glowing cyan-blue / deep violet under power',
          eyebrows: 'Sharp straight slanted brows',
          nose: 'Subtle clean geometric bridge',
          mouth: 'Firm thin lips, stoic expression',
          hairstyle: 'Layered raven-black fringe parting slightly over forehead',
          hair_color: 'Jet black with subtle blue-gray highlights',
          skin_tone: 'Fair pale porcelain',
          body_build: 'Tall, broad-shouldered, lean muscular athletic build',
          apparent_age: 'Early 20s',
          height_impression: 'Tall (approx 185 cm)',
          signature_outfit: 'Long high-collared dark trench coat over dark fitted turtleneck and combat pants',
          accessories: ['Silver ring', 'Fitted dark gloves'],
          weapons: ["Knight Killer daggers", 'Demon King daggers'],
          distinctive_marks: ['Violet-blue shadow aura trailing from limbs', 'Glowing eye flares'],
          recurring_visual_details: ['Shadow silhouettes rising behind him', 'Dark tendrils of sovereign mana'],
        },
      },
      {
        name: 'Cha Hae-in',
        role: 'S-Rank Swordmaster',
        description: 'Elite swordmaster with bright golden-blonde bob hair, sharp crimson eyes, and elegant silver-trimmed white combat armor.',
        visual_traits: {
          face_shape: 'Graceful oval with sharp delicate jaw',
          facial_proportions: 'Classic manhwa heroine proportions, refined features',
          eyes: 'Bright focused amber-crimson eyes',
          eyebrows: 'Neat arched blonde brows',
          nose: 'Delicate straight nose',
          mouth: 'Soft poised lips',
          hairstyle: 'Short sleek blonde bob curving slightly inward at jawline',
          hair_color: 'Bright golden blonde',
          skin_tone: 'Fair ivory',
          body_build: 'Athletic, graceful, toned agile physique',
          apparent_age: 'Early 20s',
          height_impression: 'Medium (approx 168 cm)',
          signature_outfit: 'Polished silver breastplate with red/white capelet and dark fitted leggings',
          accessories: ['Hankerchief covering face when smelling mana'],
          weapons: ['Ornate longsword with winged crossguard'],
          distinctive_marks: ['Golden sword arcs and radiance trails'],
          recurring_visual_details: ['Dynamic sword glints', 'Clean wind gust lines'],
        },
      },
    ],
    derived_style: {
      line_art: { density: 'Medium-high', thickness: 'Variable crisp tapering ink lines', cleanliness: 'Ultra-clean digital vector-assisted' },
      proportions: { face: 'Elongated angular manhwa aesthetics', eyes: 'Sleek narrow almond', anatomy: 'Heroic elongated athletic manhwa proportions' },
      rendering: { hair: 'Smooth cel-shaded planes with glossy edge highlights', clothing: 'Creased modern streetwear & stylized tactical coats', color_mode: 'full_color' },
      shading: { technique: 'Rich gradient cel-shading with glowing specular highlights', screentone_behavior: 'Digital soft glow & bloom overlays', shadows: 'Deep pitch blacks contrasting neon emissives', contrast: 'High dramatic contrast' },
      background: { detail_level: 'High detailed modern metropolitan ruins & dungeon caverns', environment_rendering: 'Atmospheric volumetric fog and glowing portal runes', lighting: 'Strong directional neon lighting against dark backgrounds', texture: 'Polished digital gloss' },
      effects: { motion_lines: 'Curved digital speed arcs', speed_lines: 'Radial burst lines with particle dispersion', impact_frames: 'High contrast black-and-white inverted impact flashes', fight_effects: 'Violent slashing energy arcs with dissipating sparks', aura_power: 'Swirling ethereal violet and blue smoke tendrils' },
      cinematography: { shot_selection: 'Vertical scrolling webtoon composition with full-body hero shots', camera_angles: 'Extreme low-angle Dutch tilts looking up at towering figures', close_up_frequency: 'Frequent dramatic eye close-ups during power activations', action_framing: 'Sprawling vertical panels with breaking gutters', emotional_framing: 'Isolated dark figure amidst vast cavernous space', panel_density: 'Sparse vertical spacing for pacing flow', page_webtoon_rhythm: 'Expansive vertical scroll pacing', sfx_presentation: 'Stylized glowing Korean/English onomatopoeia integrated into action', overall_mood: 'Dark, thrilling, overpowered, electrifying action' },
    },
  },
  'berserk': {
    title: 'Berserk',
    alt_titles: ['Beruseruku', 'ベルセルク'],
    series_type: 'manga',
    genres: ['Dark Fantasy', 'Horror', 'Action'],
    summary: 'Legendary dark fantasy manga renowned for intricate crosshatch pen work, oppressive gritty texture, and monumental scale.',
    characters: [
      {
        name: 'Guts',
        role: 'The Black Swordsman',
        description: 'Imposing scarred warrior with spiky black hair, closed right eye, mechanical iron left arm, ragged dark mantle, and colossal Dragon Slayer slab sword.',
        visual_traits: {
          face_shape: 'Broad chiseled square jaw, battle-hardened planes',
          facial_proportions: 'Hyper-detailed gritty masculine anatomy',
          eyes: 'One fierce glaring steel-gray eye (right eye closed with jagged scar)',
          eyebrows: 'Heavy jagged furrowed brow',
          nose: 'Broken straight bridge with minor scar across nose',
          mouth: 'Grit-toothed grimace or stoic severe line',
          hairstyle: 'Short spiky jet-black military brush cut',
          hair_color: 'Jet black with possible silver patch at temple',
          skin_tone: 'Tanned weathered battle-worn skin with multiple scars',
          body_build: 'Towering massive hyper-muscular physique',
          apparent_age: 'Late 20s to early 30s',
          height_impression: 'Towering giant (approx 193 cm)',
          signature_outfit: 'Heavy black iron plate armor, spiked tassets, and tattered cowl-neck black mantle',
          accessories: ['Mechanical prosthetic iron arm with cannon', 'Throwing knives on chest strap'],
          weapons: ['Colossal Dragon Slayer iron greatsword', 'Repeater crossbow attached to arm'],
          distinctive_marks: ['Brand of Sacrifice bleeding on side of neck', 'Multiple cross-hatched battle scars'],
          recurring_visual_details: ['Wind-torn ragged cape', 'Crushed blood-spattered iron textures'],
        },
      },
    ],
    derived_style: {
      line_art: { density: 'Dense hyper-detailed', thickness: 'Fine meticulous dip-pen hatching', cleanliness: 'Gritty, textured, organic line work' },
      proportions: { face: 'Realistic bone structure with heavy facial musculature', eyes: 'Fierce expressive realistic eyes', anatomy: 'Muscular anatomical realism with weighted mass' },
      rendering: { hair: 'Individually inked ink strands with heavy shadows', clothing: 'Dented forged iron plate and coarse woven fabric', color_mode: 'black_and_white' },
      shading: { technique: 'Masterful hand-drawn crosshatching and stippling', screentone_behavior: 'Minimal mechanical tones, maximum pen crosshatch', shadows: 'Deep heavy obsidian ink voids', contrast: 'Extreme chiaroscuro contrast' },
      background: { detail_level: 'Museum-grade architectural and organic detail', environment_rendering: 'Gothic stone keeps, twisted bramble forests, apocalyptic skies', lighting: 'Dramatic torchlight and harsh moonlit silhouettes', texture: 'Rough parchment, rust, grit, and blood splatter' },
      effects: { motion_lines: 'Dense parallel hatching depicting sheer momentum', speed_lines: 'Brutal directional blade paths splitting frames', impact_frames: 'Shattered armor, splintered wood, and visceral debris', fight_effects: 'Heavy bone-crunching kinetic weight', aura_power: 'Ominous creeping demonic shadows and heat haze' },
      cinematography: { shot_selection: 'Grand two-page spreads and claustrophobic interior panels', camera_angles: 'Worm-eye views emphasizing sheer towering monstrosity', close_up_frequency: 'Intense macro close-ups on eyes, teeth, and clenched knuckles', action_framing: 'Dynamic panel borders shattered by weapon swings', emotional_framing: 'Bleak expansive horizons with solitary burdened wanderer', panel_density: 'Dense traditional manga grid (5-8 panels per page)', page_webtoon_rhythm: 'Deliberate heavy rhythmic reading pace with jaw-dropping reveal spreads', sfx_presentation: 'Heavy carved ink sound effects integrated into panel art', overall_mood: 'Grim, visceral, monumental, unflinching dark fantasy' },
    },
  },
  'tower of god': {
    title: 'Tower of God',
    alt_titles: ['Sin-ui Tap', '신의 탑'],
    series_type: 'webtoon',
    genres: ['Fantasy', 'Action', 'Mystery'],
    summary: 'Expansive high-fantasy webtoon with colorful shinsu water/energy manifestations, mysterious vertical architectures, and distinct character designs.',
    characters: [
      {
        name: 'Twenty-Fifth Baam',
        role: 'Irregular / Wave Controller',
        description: 'Gentle youth who grows into a powerful wave controller with soft dark hair, glowing golden-brown eyes, and flowing dark robes.',
        visual_traits: {
          face_shape: 'Soft youth transitioning to determined calm jaw',
          facial_proportions: 'Expressive anime/manhwa blend',
          eyes: 'Large radiant golden-amber eyes',
          eyebrows: 'Gentle straight eyebrows',
          nose: 'Small simple defined bridge',
          mouth: 'Calm composed mouth',
          hairstyle: 'Soft straight black hair parted neatly with loose strands',
          hair_color: 'Deep black',
          skin_tone: 'Fair',
          body_build: 'Slender, athletic, agile',
          apparent_age: 'Teens to early 20s',
          height_impression: 'Average to tall (approx 178 cm)',
          signature_outfit: 'Flowing dark martial robe with inner white layers and waist sash',
          accessories: ['Pocket device floating nearby'],
          weapons: ['Black March needle', 'Thorn fragment floating behind back'],
          distinctive_marks: ['Crimson/blue Thorn energy manifestations hovering above shoulder'],
          recurring_visual_details: ['Luminous orbs of water-like Shinsu floating around hands'],
        },
      },
    ],
    derived_style: {
      line_art: { density: 'Medium', thickness: 'Smooth medium line with subtle tapering', cleanliness: 'Crisp digital lines' },
      proportions: { face: 'Expressive anime-influenced proportions', eyes: 'Large expressive and luminescent', anatomy: 'Clean stylized fantasy anatomy' },
      rendering: { hair: 'Solid blocks with subtle gradient tips', clothing: 'Layered fantasy garments with flowing drapery', color_mode: 'full_color' },
      shading: { technique: 'Soft digital gradients with cel-shade outlines', screentone_behavior: 'Atmospheric light blooms and particle speckles', shadows: 'Clean blue-tinted ambient shadows', contrast: 'Vibrant balanced contrast' },
      background: { detail_level: 'Vast otherworldly vertical architectures and starry floors', environment_rendering: 'Floating islands, metallic test halls, boundless seas of shinsu', lighting: 'Ethereal ambient luminescence', texture: 'Smooth digital painterly' },
      effects: { motion_lines: 'Flowing liquid trails and ribbon arcs', speed_lines: 'Soft burst lines and energy ripples', impact_frames: 'Luminous spherical shockwaves', fight_effects: 'Fluid elemental bursts resembling aquatic dragons or energy spears', aura_power: 'Translucent glowing spheres (Baangs) and crystalline wings' },
      cinematography: { shot_selection: 'Long vertical scroll reveals showing sheer height of towers', camera_angles: 'Bird-eye panoramic views and sweeping ascension shots', close_up_frequency: 'Moderate focus on emotional reactions and dialogue pauses', action_framing: 'Expansive vertical canvases allowing energy beams to traverse several screens', emotional_framing: 'Vast emptiness emphasizing scale of separation', panel_density: 'Spacious vertical flow', page_webtoon_rhythm: 'Smooth scroll with breathing pauses between dialogue and action', sfx_presentation: 'Colorful floating glyphs and energetic typography', overall_mood: 'Mysterious, epic, grand fantasy adventure' },
    },
  },
  'demon slayer': {
    title: 'Demon Slayer: Kimetsu no Yaiba',
    alt_titles: ['Kimetsu no Yaiba', '鬼滅の刃'],
    series_type: 'manga',
    genres: ['Action', 'Historical', 'Supernatural'],
    summary: 'Taisho-era dark action manga featuring bold woodblock-inspired contour strokes, calligraphic water and flame sword techniques, and ornate patterned haori.',
    characters: [
      {
        name: 'Tanjiro Kamado',
        role: 'Demon Slayer Swordsman',
        description: 'Kind-hearted swordsman with burgundy-tipped dark spiky hair, flame-shaped scar on forehead, hanafuda earrings, and green-and-black checkered haori.',
        visual_traits: {
          face_shape: 'Round earnest youth jaw with determined chin',
          facial_proportions: 'Large expressive classic shonen proportions',
          eyes: 'Wide dark reddish-brown eyes filled with warmth and resolve',
          eyebrows: 'Thick expressive brows',
          nose: 'Compact neat nose',
          mouth: 'Expressive mouth showing fierce breath techniques or gentle smiles',
          hairstyle: 'Ruffled dark burgundy-red hair swept back from forehead',
          hair_color: 'Black with deep burgundy tips',
          skin_tone: 'Sun-warmed natural tone',
          body_build: 'Compact, muscular, agile build',
          apparent_age: 'Mid to late teens',
          height_impression: 'Average (approx 165 cm)',
          signature_outfit: 'Green and black checkered patterned haori over dark Demon Slayer Corps uniform with white belt and kyahan leg wraps',
          accessories: ['Hanafuda card earrings with rising sun design', 'Wooden box backpack on back'],
          weapons: ['Nichirin black katana with round black tsuba'],
          distinctive_marks: ['Reddish flame-shaped scar on upper-left forehead'],
          recurring_visual_details: ['Calligraphic wave crests and swirling water dragons along blade'],
        },
      },
    ],
    derived_style: {
      line_art: { density: 'Medium-high', thickness: 'Bold dynamic brush-style calligraphic strokes', cleanliness: 'Bold textured ink contouring' },
      proportions: { face: 'Stylized Taisho-era anime proportions', eyes: 'Wide circular expressive irises with bold rim', anatomy: 'Dynamic compact shonen proportions' },
      rendering: { hair: 'Angular blocky clumps with bold outlines', clothing: 'Distinctive geometric textile patterns (ichimatsu checkered)', color_mode: 'black_and_white' },
      shading: { technique: 'Traditional ink hatching combined with dense screentone textures', screentone_behavior: 'Halftone dot patterns for atmospheric mist and kimonos', shadows: 'Deep pitch black solid fills under garments', contrast: 'Bold graphic high contrast' },
      background: { detail_level: 'Traditional Taisho Japanese towns, snowy bamboo mountains, and wisteria groves', environment_rendering: 'Woodblock-inspired ukiyo-e aesthetic clouds and trees', lighting: 'Moonlit snow reflections and glowing lanterns', texture: 'Traditional washi and ink brush grain' },
      effects: { motion_lines: 'Calligraphic sumi-e brush ribbons', speed_lines: 'Sharp radial ink dashes', impact_frames: 'Thick ink burst fractures and wood splintering', fight_effects: 'Traditional Japanese wave crests (Ukiyo-e waves) and blazing sun wheels', aura_power: 'Swirling smoke and concentrated breath vapor puffs' },
      cinematography: { shot_selection: 'Tight kinetic battle exchanges and emotional face-to-face dialogues', camera_angles: 'Dynamic diagonal slice angles following sword arcs', close_up_frequency: 'High frequency on determined expressions and breath intakes', action_framing: 'Sword paths crossing panel gutters diagonally', emotional_framing: 'Gentle side-profiles with tear glints and warm eyes', panel_density: 'Traditional manga grid (4-6 panels per page)', page_webtoon_rhythm: 'Rapid rhythmic slashing sequences balanced with reflective character beats', sfx_presentation: 'Bold hand-brushed kanji sound effects that interact with physical objects', overall_mood: 'Emotional, earnest, kinetic, folkloric' },
    },
  },
  'naruto': {
    title: 'Naruto',
    alt_titles: ['Naruto Shippuden', 'ナルト'],
    series_type: 'manga',
    genres: ['Action', 'Martial Arts', 'Ninja'],
    summary: 'Iconic ninja manga with dynamic fisheye camera angles, fluid martial arts choreography, clean readable line art, and iconic headband insignias.',
    characters: [
      {
        name: 'Naruto Uzumaki',
        role: 'Nine-Tails Jinchuriki / Hokage',
        description: 'Determined blond ninja with spiky hair, blue eyes, whisker marks on cheeks, forehead protector headband, and orange-and-black tracksuit.',
        visual_traits: {
          face_shape: 'Square round determined jawline',
          facial_proportions: 'Classic Masashi Kishimoto anatomical proportions',
          eyes: 'Bright blue circular eyes with bold pupils',
          eyebrows: 'Thick determined blond brows',
          nose: 'Simple stylized triangular nose',
          mouth: 'Wide grinning mouth or sharp open-mouthed battle cry',
          hairstyle: 'Spiky short golden blond hair radiating outward',
          hair_color: 'Bright golden yellow',
          skin_tone: 'Tanned healthy skin',
          body_build: 'Athletic, wiry, muscular ninja physique',
          apparent_age: 'Teens',
          height_impression: 'Average (approx 166 cm)',
          signature_outfit: 'Orange and black tracksuit jacket with high collar, orange pants, weapon holster on right thigh, and ninja sandals',
          accessories: ['Leaf village metal plate forehead protector with long black ties', 'Kunai pouch at lower back'],
          weapons: ['Wind-release Rasenshuriken', 'Standard steel kunai and shuriken'],
          distinctive_marks: ['Three curved whisker marks on each cheek', 'Spiral seal mark on abdomen'],
          recurring_visual_details: ['Spiraling blue chakra sphere (Rasengan) rotating in palm', 'Orange sage-mode eye pigment'],
        },
      },
    ],
    derived_style: {
      line_art: { density: 'Medium', thickness: 'Exceptionally clean uniform g-pen lines with confident curves', cleanliness: 'Pristine, highly legible, aerodynamic' },
      proportions: { face: 'Clean geometric features with expressive mouths', eyes: 'Clean rounded ovals with solid dark pupils', anatomy: 'Superb realistic joint mechanics and foreshortened martial limbs' },
      rendering: { hair: 'Spiky aerodynamic clumps with minimal interior line clutter', clothing: 'Folds following body motion with tactical pouch straps', color_mode: 'black_and_white' },
      shading: { technique: 'Clean screentone shading with solid black shadow pockets', screentone_behavior: 'Smooth 40-60 line screentones for clothing depth and dirt', shadows: 'Crisp shadow edges emphasizing dimensional volume', contrast: 'Balanced high-readability contrast' },
      background: { detail_level: 'Carefully foreshortened forest trees, carved stone Hokage monuments, and dusty arenas', environment_rendering: 'Expansive vistas rendered with precise linear perspective', lighting: 'Clean natural daylight with sharp cast shadows', texture: 'Clean technical comic penwork' },
      effects: { motion_lines: 'Parallel speed streaks and trailing smoke clouds', speed_lines: 'Radial convergence lines focusing on high-speed punches', impact_frames: 'Circular dust rings and cracked earth craters', fight_effects: 'Spinning chakra vortexes, burst explosions, and substitution wood logs', aura_power: 'Bubbling fox shroud or crisp golden flame cloak' },
      cinematography: { shot_selection: 'Famous fisheye / extreme wide-angle lens perspective shots', camera_angles: 'Low-angle running shots and dramatic ground-level sweeps', close_up_frequency: 'Balanced between wide tactical positioning and intense facial close-ups', action_framing: 'Fluid left-to-right kinetic momentum across page spreads', emotional_framing: 'Childhood swing silhouettes and sunset backlighting', panel_density: 'Classic shonen 5-6 panels per page with spacious action beats', page_webtoon_rhythm: 'Masterful choreographic readability with rhythmic impact pauses', sfx_presentation: 'Dynamic hollow-outline sound effects woven between limbs', overall_mood: 'Kinetic, heroic, strategic, heartfelt' },
    },
  },
  'the eternal supreme': {
    title: 'The Eternal Supreme',
    alt_titles: ['Wan Gu Shi Zhen', 'Wangu Shizhen', 'Ancient One', '万古至尊'],
    series_type: 'manhwa',
    genres: ['Action', 'Fantasy', 'Martial Arts', 'Cultivation'],
    summary: 'Masterpiece xianxia cultivation manhua featuring Li Yunxiao (Gu Feiyang). Renowned for regal sovereign aesthetics, soaring spirit pavilions, elegant martial choreography, and radiant primordial flame effects.',
    characters: [
      {
        name: 'Li Yunxiao (Gu Feiyang)',
        role: 'Protagonist / Reborn Martial Sovereign',
        description: 'Peerless martial sovereign reborn in a youth body. Refined aristocratic features, piercing gaze, disdainful confident smirk, flowing dark hair, and elegant daoist robes.',
        visual_traits: {
          face_shape: 'Refined angular jawline with noble aristocratic contours',
          facial_proportions: 'Classic xianxia peerless youth proportions',
          eyes: 'Deep piercing obsidian eyes with sovereign golden glint',
          eyebrows: 'Slanted sword eyebrows',
          nose: 'Straight elegant nose bridge',
          mouth: 'Calm composed lips, frequent calculating smirk',
          hairstyle: 'Long raven hair partially tied with topknot and ornamental jade hairpin, flowing locks framing face',
          hair_color: 'Jet black with subtle glossy sheen',
          skin_tone: 'Fair jade complexion',
          body_build: 'Slender, lithe, deceptively powerful martial frame',
          apparent_age: 'Late teens (retaining sovereign maturity)',
          height_impression: 'Tall and poised (approx 180 cm)',
          signature_outfit: 'Flowing white and deep azure daoist scholar robes with embroidered silver cloud trim and silk sash',
          accessories: ['Ancient divine jade pendant', 'Spatial storage ring'],
          weapons: ['Divine Northern Dark Blade', 'World God Monument'],
          distinctive_marks: ['Subtle golden sovereign eye flare', 'Primordial flame spark in palm'],
          recurring_visual_details: ['Swirling golden flame manifestations', 'Draconic Qi rising in background'],
        },
      },
    ],
    derived_style: {
      line_art: {
        density: 'High-clarity xianxia martial arts line work with sharp dynamic taper',
        thickness: 'Clean variable ink contouring, crisp razor-sharp strokes on weapon edges and robes, subtle interior linework',
        cleanliness: 'Exceptionally clean modern digital manhua line treatment, crisp vector-grade silhouette definition',
      },
      proportions: {
        face: 'Refined, elegant, sharp aristocratic cultivation aesthetics, prominent defined jaw, expressive aristocratic features',
        eyes: 'Piercing phoenix/almond eyes with focused pupils, sharp upper lids, intense majestic aura flare',
        anatomy: 'Heroic, lithe, well-balanced martial artist proportions, fluid dynamic joint mechanics, dramatic foreshortening',
      },
      rendering: {
        hair: 'Silky flowing locks with dynamic wind-blown strands, clean cel clumps, subtle luminous highlights along hair arcs',
        clothing: 'Flowing daoist scholar robes, embroidered martial tunics, ornate silk sashes, fluttering hemlines following body kinetics, sharp fabric creases',
        color_mode: 'full_color',
      },
      shading: {
        technique: 'Dimensional multi-layer cel-shading with glowing emissive rim lighting',
        screentone_behavior: 'Smooth digital gradients with celestial star particle dusting and atmospheric depth',
        shadows: 'Crisp deep cast shadows under robe folds and jawlines, emphasizing volume and dramatic martial tension',
        contrast: 'High dramatic contrast between deep environmental shadows and radiant spiritual energy',
      },
      background: {
        detail_level: 'Highly detailed ancient Chinese imperial palaces, soaring jade pavilions, mystical spirit peaks, carved stone altars, array formations',
        environment_rendering: 'Floating mountain spires amidst swirling spiritual mist, celestial clouds, shattered crystal ground',
        lighting: 'Intense ethereal lighting, spiritual flame backlighting, glowing talismanic runes casting dynamic cast shadows',
        texture: 'Smooth polished jade, weathered stone, polished spirit metal, ethereal elemental mist',
      },
      effects: {
        motion_lines: 'Kinetic sweeping motion arcs, high-velocity phantom afterimages, devastating vacuum blade trails',
        speed_lines: 'Radial convergence lines focused on martial strikes, explosive kinetic shockwave bursts',
        impact_frames: 'Shattered space fissures, cracked jade ground shockwaves, atmospheric ring ripples',
        fight_effects: 'Swirling sovereign spiritual flames, lightning arcs, divine talismanic script halos, draconic phantom auras',
        aura_power: 'Radiant golden and azure primordial sovereign flame aura, swirling vortexes of heavenly essence',
      },
      cinematography: {
        shot_selection: 'Cinematic wide martial arenas, imposing sovereign full-body stances, soaring aerial panoramic views',
        camera_angles: 'Dramatic high-and-low vertical perspective sweeps, extreme dynamic Dutch tilts, sweeping battlefield reveals',
        close_up_frequency: 'Piercing eye close-ups during technique invocation, hand-seal formation close-ups, calculating smirks',
        action_framing: 'Fluid kinetic momentum across martial exchanges, devastating directional energy discharges',
        emotional_framing: 'Solitary sovereign standing atop towering spirit peaks overlooking vast heavens with disdainful calm',
        panel_density: 'Spacious high-impact webtoon pacing with floating technique banners',
        page_webtoon_rhythm: 'Expansive vertical scroll pacing, seamless breathing room preceding explosive ultimate technique releases',
        sfx_presentation: 'Ornate calligraphy-styled sound effects woven into attack trajectories and explosions',
        overall_mood: 'Majestic, domineering, mystical, high-stakes cultivation martial grandeur',
      },
    },
  },
};

// Aliases for The Eternal Supreme
BUILTIN_SERIES_CATALOG['eternal supreme'] = BUILTIN_SERIES_CATALOG['the eternal supreme'];
BUILTIN_SERIES_CATALOG['wangu shizhen'] = BUILTIN_SERIES_CATALOG['the eternal supreme'];
BUILTIN_SERIES_CATALOG['wan gu shi zhen'] = BUILTIN_SERIES_CATALOG['the eternal supreme'];

const eternalSupremeDerived = BUILTIN_SERIES_CATALOG['the eternal supreme'].derived_style;

/**
 * Stage 8 Canonical Default Visual Style Profile: The Eternal Supreme
 */
export const DEFAULT_STYLE_PROFILE: VisualStyleProfile = {
  style_id: 'style_default_eternal_supreme',
  version: 1,
  reference_series: 'The Eternal Supreme',
  series_type: 'manhwa',
  line_art: {
    density: eternalSupremeDerived.line_art?.density || 'High-clarity xianxia martial arts line work with sharp dynamic taper',
    thickness: eternalSupremeDerived.line_art?.thickness || 'Clean variable ink contouring, crisp razor-sharp strokes on weapon edges and robes',
    cleanliness: eternalSupremeDerived.line_art?.cleanliness || 'Exceptionally clean modern digital manhua line treatment',
  },
  proportions: {
    face: eternalSupremeDerived.proportions?.face || 'Refined, elegant, sharp aristocratic cultivation aesthetics',
    eyes: eternalSupremeDerived.proportions?.eyes || 'Piercing phoenix/almond eyes with focused pupils',
    anatomy: eternalSupremeDerived.proportions?.anatomy || 'Heroic, lithe, well-balanced martial artist proportions',
  },
  rendering: {
    hair: eternalSupremeDerived.rendering?.hair || 'Silky flowing locks with dynamic wind-blown strands',
    clothing: eternalSupremeDerived.rendering?.clothing || 'Flowing daoist scholar robes, embroidered martial tunics',
    color_mode: eternalSupremeDerived.rendering?.color_mode || 'full_color',
  },
  shading: {
    technique: eternalSupremeDerived.shading?.technique || 'Dimensional multi-layer cel-shading with glowing emissive rim lighting',
    screentone_behavior: eternalSupremeDerived.shading?.screentone_behavior || 'Smooth digital gradients with celestial star particle dusting',
    shadows: eternalSupremeDerived.shading?.shadows || 'Crisp deep cast shadows under robe folds and jawlines',
    contrast: eternalSupremeDerived.shading?.contrast || 'High dramatic contrast between deep environmental shadows and radiant spiritual energy',
  },
  background: {
    detail_level: eternalSupremeDerived.background?.detail_level || 'Highly detailed ancient Chinese imperial palaces, soaring jade pavilions',
    environment_rendering: eternalSupremeDerived.background?.environment_rendering || 'Floating mountain spires amidst swirling spiritual mist',
    lighting: eternalSupremeDerived.background?.lighting || 'Intense ethereal lighting, spiritual flame backlighting',
    texture: eternalSupremeDerived.background?.texture || 'Smooth polished jade, weathered stone, polished spirit metal',
  },
  effects: {
    motion_lines: eternalSupremeDerived.effects?.motion_lines || 'Kinetic sweeping motion arcs, high-velocity phantom afterimages',
    speed_lines: eternalSupremeDerived.effects?.speed_lines || 'Radial convergence lines focused on martial strikes',
    impact_frames: eternalSupremeDerived.effects?.impact_frames || 'Shattered space fissures, cracked jade ground shockwaves',
    fight_effects: eternalSupremeDerived.effects?.fight_effects || 'Swirling sovereign spiritual flames, lightning arcs',
    aura_power: eternalSupremeDerived.effects?.aura_power || 'Radiant golden and azure primordial sovereign flame aura',
  },
  cinematography: {
    shot_selection: eternalSupremeDerived.cinematography?.shot_selection || 'Cinematic wide martial arenas, imposing sovereign full-body stances',
    camera_angles: eternalSupremeDerived.cinematography?.camera_angles || 'Dramatic high-and-low vertical perspective sweeps',
    close_up_frequency: eternalSupremeDerived.cinematography?.close_up_frequency || 'Piercing eye close-ups during technique invocation',
    action_framing: eternalSupremeDerived.cinematography?.action_framing || 'Fluid kinetic momentum across martial exchanges',
    emotional_framing: eternalSupremeDerived.cinematography?.emotional_framing || 'Solitary sovereign standing atop towering spirit peaks',
    panel_density: eternalSupremeDerived.cinematography?.panel_density || 'Spacious high-impact webtoon pacing',
    page_webtoon_rhythm: eternalSupremeDerived.cinematography?.page_webtoon_rhythm || 'Expansive vertical scroll pacing',
    sfx_presentation: eternalSupremeDerived.cinematography?.sfx_presentation || 'Ornate calligraphy-styled sound effects',
    overall_mood: eternalSupremeDerived.cinematography?.overall_mood || 'Majestic, domineering, mystical, high-stakes cultivation martial grandeur',
  },
  active: true,
  user_overrides: {},
  provider_notes: 'The Eternal Supreme (万古至尊) default visual style profile. Emphasizes refined xianxia linework, martial arts cinematography, and celestial aura effects.',
  created_at: 1700000000000,
  updated_at: 1700000000000,
};

export class ReferenceLockEngine {
  private baseDir: string;
  private cacheFilePath: string;
  private seriesCache: Record<string, SeriesMetadata>;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
    const cacheDir = path.join(this.baseDir, 'cache');
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
    this.cacheFilePath = path.join(cacheDir, 'reference_series_cache.json');
    this.seriesCache = this.loadSeriesCache();
  }

  private loadSeriesCache(): Record<string, SeriesMetadata> {
    const combined: Record<string, SeriesMetadata> = { ...BUILTIN_SERIES_CATALOG };
    if (fs.existsSync(this.cacheFilePath)) {
      try {
        const saved = JSON.parse(fs.readFileSync(this.cacheFilePath, 'utf-8'));
        Object.assign(combined, saved);
      } catch (err) {
        console.warn('Could not read reference cache:', err);
      }
    }
    return combined;
  }

  private saveSeriesCache(): void {
    try {
      fs.writeFileSync(this.cacheFilePath, JSON.stringify(this.seriesCache, null, 2), 'utf-8');
    } catch (err) {
      console.warn('Could not save reference cache:', err);
    }
  }

  private getNovelLockPath(novelId: string): string {
    return path.join(this.baseDir, novelId, 'reference_locks.json');
  }

  /**
   * Search for manga/manhwa/webtoon by title or query without requiring image upload
   */
  async searchReferenceSeries(query: string): Promise<SeriesMetadata[]> {
    const q = query.trim().toLowerCase();
    if (!q) return Object.values(this.seriesCache).slice(0, 10);

    // 1. Check local catalog & cache
    const matched: SeriesMetadata[] = [];
    for (const [key, data] of Object.entries(this.seriesCache)) {
      if (
        key.includes(q) ||
        data.title.toLowerCase().includes(q) ||
        data.alt_titles.some((a) => a.toLowerCase().includes(q))
      ) {
        matched.push(data);
      }
    }

    if (matched.length > 0) {
      return matched;
    }

    // 2. Attempt AniList / public API query if permitted, with strict timeout
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2200);
      const gqlQuery = `
        query ($search: String) {
          Page(page: 1, perPage: 3) {
            media(search: $search, type: MANGA) {
              title { romaji english native }
              format
              genres
              description
              characters(role: MAIN, perPage: 2) {
                nodes {
                  name { full native }
                  description
                  gender
                  age
                }
              }
            }
          }
        }
      `;
      const res = await fetch('https://graphql.anilist.co', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ query: gqlQuery, variables: { search: query } }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const json: any = await res.json();
        const mediaList = json?.data?.Page?.media;
        if (Array.isArray(mediaList) && mediaList.length > 0) {
          const m = mediaList[0];
          const title = m.title?.english || m.title?.romaji || query.trim();
          const altTitles = [m.title?.romaji, m.title?.english, m.title?.native].filter(Boolean);
          const isWebtoon = m.format === 'MANGA' && (m.genres?.includes('Action') || /webtoon|manhwa/i.test(m.description || ''));
          const chars = (m.characters?.nodes || []).map((c: any) => ({
            name: c.name?.full || 'Lead Character',
            role: 'Main',
            description: (c.description || '').slice(0, 160) || `Main figure from ${title}`,
            visual_traits: {
              face_shape: 'Angular defined jaw',
              eyes: 'Sharp expressive anime/manga eyes',
              apparent_age: c.age || 'Young adult',
              signature_outfit: 'Signature series attire',
            },
          }));
          const apiSynthesized: SeriesMetadata = {
            title,
            alt_titles: altTitles,
            series_type: isWebtoon ? 'manhwa' : 'manga',
            genres: m.genres || ['Action'],
            summary: (m.description || '').replace(/<[^>]*>/g, '').slice(0, 200),
            characters: chars.length > 0 ? chars : [{
              name: 'Main Hero',
              role: 'Protagonist',
              description: `Lead protagonist of ${title}`,
              visual_traits: { signature_outfit: 'Signature series attire' },
            }],
            derived_style: {
              line_art: { density: 'Medium-high', thickness: 'Crisp tapered line work', cleanliness: 'High cleanliness' },
              proportions: { face: 'Heroic stylized proportions', eyes: 'Almond expressive irises', anatomy: 'Athletic proportions' },
              rendering: { hair: 'Layered stylized clumps', clothing: 'Creased fabric folds', color_mode: isWebtoon ? 'full_color' : 'black_and_white' },
              shading: { technique: 'Structured cel-shading', screentone_behavior: 'Clean tones and subtle gradients', shadows: 'Defined cast shadows', contrast: 'High visual punch' },
              background: { detail_level: 'High detailed environments', environment_rendering: 'Atmospheric depth perspective', lighting: 'Strong directional key light', texture: 'Clean digital texture' },
              effects: { motion_lines: 'Dynamic speed trails', speed_lines: 'Radial bursts', impact_frames: 'Crisp shockwave arcs', fight_effects: 'Elemental energy trails', aura_power: 'Emissive edge glow' },
              cinematography: { shot_selection: 'Cinematic dynamic framing', camera_angles: 'Low-angle heroism and Dutch tilts', close_up_frequency: 'Periodic eye and weapon close-ups', action_framing: 'Uncluttered readable action beats', emotional_framing: 'Dramatic contrast silhouettes', panel_density: 'Balanced readable flow', page_webtoon_rhythm: 'Natural rhythmic reading speed', sfx_presentation: 'Integrated onomatopoeia', overall_mood: 'Epic, cohesive, visually locked' },
            },
          };
          this.seriesCache[q] = apiSynthesized;
          this.saveSeriesCache();
          return [apiSynthesized];
        }
      }
    } catch {
      // Offline, timeout, or permitted network error: gracefully fall back to deterministic synthesizer
    }

    // 3. Synthesize structured reference metadata based on title conventions (Zero-Cost local heuristic)
    const isManhwa = /manhwa|webtoon|solo|tower|reader|ranker|leveling|reincarnated|reborn|regressor/i.test(q);
    const synthesized: SeriesMetadata = {
      title: query.trim(),
      alt_titles: [],
      series_type: isManhwa ? 'manhwa' : 'manga',
      genres: ['Action', 'Fantasy'],
      summary: `Reference series ${query} with structured visual language conventions.`,
      characters: [
        {
          name: 'Main Hero',
          role: 'Protagonist',
          description: `Signature lead character for ${query}`,
          visual_traits: {
            face_shape: 'Angular defined jaw',
            facial_proportions: 'Classic heroic proportions',
            eyes: 'Intense focused gaze',
            eyebrows: 'Slanted sharp brows',
            nose: 'Clean straight bridge',
            mouth: 'Stoic resolute mouth',
            hairstyle: 'Stylized layered cut with dynamic strands',
            hair_color: 'Dark charcoal',
            skin_tone: 'Fair',
            body_build: 'Athletic, agile, toned',
            apparent_age: 'Young adult',
            height_impression: 'Tall',
            signature_outfit: 'Signature fantasy/tactical tailored jacket and boots',
            accessories: [],
            weapons: ['Signature blade'],
            distinctive_marks: ['Subtle visual energy flare'],
            recurring_visual_details: ['Consistent stylized silhouette'],
          },
        },
      ],
      derived_style: {
        line_art: { density: 'Medium', thickness: 'Crisp tapered line work', cleanliness: 'High cleanliness' },
        proportions: { face: 'Heroic stylized proportions', eyes: 'Almond expressive irises', anatomy: 'Athletic proportions' },
        rendering: { hair: 'Smooth cel-shaded geometry', clothing: 'Dynamic creases and folds', color_mode: isManhwa ? 'full_color' : 'black_and_white' },
        shading: { technique: 'Structured cel-shading', screentone_behavior: 'Clean tones and subtle gradients', shadows: 'Defined cast shadows', contrast: 'High visual punch' },
        background: { detail_level: 'High detailed environments', environment_rendering: 'Atmospheric depth perspective', lighting: 'Strong directional key light', texture: 'Clean digital texture' },
        effects: { motion_lines: 'Dynamic speed trails', speed_lines: 'Radial bursts', impact_frames: 'Crisp shockwave arcs', fight_effects: 'Elemental energy trails', aura_power: 'Emissive edge glow' },
        cinematography: { shot_selection: 'Cinematic dynamic framing', camera_angles: 'Low-angle heroism and Dutch tilts', close_up_frequency: 'Periodic eye and weapon close-ups', action_framing: 'Uncluttered readable action beats', emotional_framing: 'Dramatic contrast silhouettes', panel_density: 'Balanced readable flow', page_webtoon_rhythm: 'Natural rhythmic reading speed', sfx_presentation: 'Integrated onomatopoeia', overall_mood: 'Epic, cohesive, visually locked' },
      },
    };

    // Cache the newly derived profile
    this.seriesCache[q] = synthesized;
    this.saveSeriesCache();

    return [synthesized];
  }

  /**
   * Get or initialize Reference Lock state for a novel
   */
  getNovelReferenceLockState(novelId: string): NovelReferenceLockState {
    const filePath = this.getNovelLockPath(novelId);
    if (fs.existsSync(filePath)) {
      try {
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      } catch (err) {
        console.warn(`Could not read reference locks for novel ${novelId}:`, err);
      }
    }

    const defaultState: NovelReferenceLockState = {
      novel_id: novelId,
      reference_mode: 'style_only', // Stage 8: Default Reference Mode: Style Only
      character_lock_active: false, // Character Lock: Unset / user-configurable
      style_lock_active: true, // Style Lock: ON
      active_series_title: 'The Eternal Supreme', // Stage 8 Default: The Eternal Supreme
      character_mappings: {},
      character_locks: {},
      style_locks: [],
      active_style_version: 1,
      chapter_style_bindings: { 1: 1 },
      updated_at: Date.now(),
    };

    // Initialize with default Style V1 from The Eternal Supreme
    const defaultStyle = this.createStyleLockProfile('The Eternal Supreme', 1);
    defaultState.style_locks.push(defaultStyle);

    this.saveNovelReferenceLockState(novelId, defaultState);
    return defaultState;
  }

  /**
   * Restore The Eternal Supreme as the default visual style reference
   */
  restoreDefaultStyle(novelId: string): NovelReferenceLockState {
    const state = this.getNovelReferenceLockState(novelId);
    state.active_series_title = 'The Eternal Supreme';
    state.style_lock_active = true;

    // Check if a style profile for The Eternal Supreme already exists
    const existing = state.style_locks.find(
      (s) => s.reference_series.toLowerCase() === 'the eternal supreme'
    );

    if (existing) {
      state.active_style_version = existing.version;
      state.style_locks.forEach((s) => {
        s.active = s.version === existing.version;
      });
    } else {
      const nextVer =
        state.style_locks.length > 0
          ? Math.max(...state.style_locks.map((s) => s.version)) + 1
          : 1;
      const newProfile = this.createStyleLockProfile('The Eternal Supreme', nextVer);
      state.style_locks.forEach((s) => {
        s.active = false;
      });
      state.style_locks.push(newProfile);
      state.active_style_version = nextVer;
    }

    this.saveNovelReferenceLockState(novelId, state);
    return state;
  }

  /**
   * Toggle Style Lock active/inactive temporarily without changing the profile
   */
  setStyleLockActive(novelId: string, active: boolean): NovelReferenceLockState {
    const state = this.getNovelReferenceLockState(novelId);
    state.style_lock_active = active;
    this.saveNovelReferenceLockState(novelId, state);
    return state;
  }

  /**
   * Rebuild the active Visual Style Profile from current series reference metadata
   */
  rebuildActiveStyleProfile(novelId: string): VisualStyleProfile {
    const state = this.getNovelReferenceLockState(novelId);
    const activeVer = state.active_style_version || 1;
    const seriesTitle = state.active_series_title || 'The Eternal Supreme';
    const freshProfile = this.createStyleLockProfile(seriesTitle, activeVer);

    const idx = state.style_locks.findIndex((s) => s.version === activeVer);
    if (idx >= 0) {
      freshProfile.user_overrides = state.style_locks[idx].user_overrides || {};
      state.style_locks[idx] = freshProfile;
    } else {
      state.style_locks.push(freshProfile);
    }

    this.saveNovelReferenceLockState(novelId, state);
    return freshProfile;
  }

  /**
   * Create a new Style version (e.g. STYLE_V2) for current or newly selected series
   */
  createNewStyleVersion(novelId: string, seriesTitle?: string, startingFromChapter: number = 1): VisualStyleProfile {
    const state = this.getNovelReferenceLockState(novelId);
    const targetSeries = (seriesTitle || state.active_series_title || 'The Eternal Supreme').trim();
    return this.updateNovelStyleLock(novelId, targetSeries, startingFromChapter);
  }

  /**
   * Query the style version and profile bound to a specific chapter
   */
  getStyleVersionForChapter(novelId: string, chapterNumber: number): { version: number; profile: VisualStyleProfile | null } {
    const state = this.getNovelReferenceLockState(novelId);
    let boundVersion = state.chapter_style_bindings[chapterNumber];
    if (!boundVersion) {
      const thresholds = Object.keys(state.chapter_style_bindings || {})
        .map(Number)
        .sort((a, b) => a - b);
      for (const t of thresholds) {
        if (chapterNumber >= t) {
          boundVersion = state.chapter_style_bindings[t];
        }
      }
    }
    if (!boundVersion) boundVersion = state.active_style_version || 1;
    const profile = state.style_locks.find((s) => s.version === boundVersion) || state.style_locks[0] || null;
    return { version: boundVersion, profile };
  }

  saveNovelReferenceLockState(novelId: string, state: NovelReferenceLockState): void {
    const novelDir = path.join(this.baseDir, novelId);
    if (!fs.existsSync(novelDir)) fs.mkdirSync(novelDir, { recursive: true });
    state.updated_at = Date.now();
    fs.writeFileSync(this.getNovelLockPath(novelId), JSON.stringify(state, null, 2), 'utf-8');
  }

  /**
   * Create a structured Visual Style Profile for a series (Style Lock)
   */
  createStyleLockProfile(seriesTitle: string, version: number): VisualStyleProfile {
    const key = seriesTitle.trim().toLowerCase();
    const meta = this.seriesCache[key] || BUILTIN_SERIES_CATALOG['the eternal supreme'];
    const s = meta.derived_style;

    return {
      style_id: `style_${crypto.randomUUID().slice(0, 8)}`,
      version,
      reference_series: meta.title,
      series_type: meta.series_type,
      line_art: {
        density: s.line_art?.density || 'Medium',
        thickness: s.line_art?.thickness || 'Tapered clean lines',
        cleanliness: s.line_art?.cleanliness || 'Ultra-clean',
      },
      proportions: {
        face: s.proportions?.face || 'Sharp anime/manhwa aesthetic',
        eyes: s.proportions?.eyes || 'Expressive almond',
        anatomy: s.proportions?.anatomy || 'Athletic proportions',
      },
      rendering: {
        hair: s.rendering?.hair || 'Planar cel-shaded clumps with rim light',
        clothing: s.rendering?.clothing || 'Tailored with sharp creases',
        color_mode: s.rendering?.color_mode || (meta.series_type === 'manhwa' || meta.series_type === 'webtoon' ? 'full_color' : 'black_and_white'),
      },
      shading: {
        technique: s.shading?.technique || 'Structured cel-shading with soft ambient gradients',
        screentone_behavior: s.shading?.screentone_behavior || 'Digital glow & clean screentones',
        shadows: s.shading?.shadows || 'Deep contrasting darks',
        contrast: s.shading?.contrast || 'High dynamic contrast',
      },
      background: {
        detail_level: s.background?.detail_level || 'Detailed atmospheric backgrounds',
        environment_rendering: s.background?.environment_rendering || 'Perspective-correct environments',
        lighting: s.background?.lighting || 'Dramatic key lighting with rim lights',
        texture: s.background?.texture || 'Smooth digital polish',
      },
      effects: {
        motion_lines: s.effects?.motion_lines || 'Dynamic curvature streaks',
        speed_lines: s.effects?.speed_lines || 'Radial convergence lines',
        impact_frames: s.effects?.impact_frames || 'High contrast shockwave arcs',
        fight_effects: s.effects?.fight_effects || 'Clean weapon arcs and energy trails',
        aura_power: s.effects?.aura_power || 'Ethereal mist and glowing contours',
      },
      cinematography: {
        shot_selection: s.cinematography?.shot_selection || 'Dynamic paneling with vertical hero reveals',
        camera_angles: s.cinematography?.camera_angles || 'Dramatic low angles and Dutch tilts',
        close_up_frequency: s.cinematography?.close_up_frequency || 'Frequent eye and action close-ups',
        action_framing: s.cinematography?.action_framing || 'Uncluttered dynamic silhouettes',
        emotional_framing: s.cinematography?.emotional_framing || 'Atmospheric negative space',
        panel_density: s.cinematography?.panel_density || 'Balanced rhythmic flow',
        page_webtoon_rhythm: s.cinematography?.page_webtoon_rhythm || 'Smooth vertical pacing',
        sfx_presentation: s.cinematography?.sfx_presentation || 'Integrated dynamic sound typography',
        overall_mood: s.cinematography?.overall_mood || 'Epic, cinematic, highly immersive',
      },
      active: true,
      user_overrides: {},
      provider_notes: 'Standardized provider-independent visual constraints; adaptable to both Agnes L2 img2img and prompt conditioning.',
      created_at: Date.now(),
      updated_at: Date.now(),
    };
  }

  /**
   * Create a canonical Character Lock Profile
   */
  createCharacterLockProfile(params: {
    characterId: string;
    canonicalName: string;
    referenceSeries: string;
    referenceCharacter: string;
    customOverrides?: Partial<CharacterLockProfile>;
  }): CharacterLockProfile {
    const key = params.referenceSeries.trim().toLowerCase();
    const meta = this.seriesCache[key] || BUILTIN_SERIES_CATALOG['solo leveling'];
    const matchedChar = meta.characters.find(
      (c) => c.name.toLowerCase() === params.referenceCharacter.toLowerCase()
    ) || meta.characters[0];

    const v = matchedChar ? matchedChar.visual_traits : {};

    return {
      character_id: params.characterId,
      canonical_name: params.canonicalName,
      reference_series: meta.title,
      reference_character: matchedChar ? matchedChar.name : params.referenceCharacter,
      reference_image_url: null,
      face_shape: v.face_shape || 'Defined angular jawline',
      facial_proportions: v.facial_proportions || 'Classic heroic proportions',
      eyes: v.eyes || 'Sharp intense almond eyes with focused pupils',
      eyebrows: v.eyebrows || 'Straight defined brows',
      nose: v.nose || 'Clean straight geometric bridge',
      mouth: v.mouth || 'Firm composed mouth',
      hairstyle: v.hairstyle || 'Layered stylish cut with natural fringe',
      hair_color: v.hair_color || 'Raven black',
      skin_tone: v.skin_tone || 'Fair pale tone',
      body_build: v.body_build || 'Athletic toned physique',
      apparent_age: v.apparent_age || 'Early 20s',
      height_impression: v.height_impression || 'Tall',
      signature_outfit: v.signature_outfit || 'Tailored high-collared coat over fitted tunic/attire',
      accessories: v.accessories || ['Ring', 'Gauntlets'],
      weapons: v.weapons || ['Signature blade'],
      distinctive_marks: v.distinctive_marks || ['Subtle energy aura glint'],
      recurring_visual_details: v.recurring_visual_details || ['Flowing fabric hem', 'Distinctive eye glow in combat'],
      locked: true,
      user_overrides: {},
      created_at: Date.now(),
      updated_at: Date.now(),
      ...params.customOverrides,
    };
  }

  /**
   * Style Versioning: creates a NEW version when reference manga changes
   * without altering completed earlier chapters!
   */
  updateNovelStyleLock(novelId: string, newSeriesTitle: string, startingFromChapter: number = 1): VisualStyleProfile {
    const state = this.getNovelReferenceLockState(novelId);
    const nextVersion = state.style_locks.length + 1;

    // Deactivate previous active versions
    state.style_locks.forEach((s) => (s.active = false));

    const newProfile = this.createStyleLockProfile(newSeriesTitle, nextVersion);
    state.style_locks.push(newProfile);
    state.active_style_version = nextVersion;
    state.active_series_title = newSeriesTitle;

    // Bind subsequent chapters to this new style version
    state.chapter_style_bindings[startingFromChapter] = nextVersion;

    this.saveNovelReferenceLockState(novelId, state);
    return newProfile;
  }

  /**
   * Set Reference Mode: 'characters_only' | 'style_only' | 'characters_and_style'
   */
  setReferenceMode(novelId: string, mode: ReferenceMode): NovelReferenceLockState {
    const state = this.getNovelReferenceLockState(novelId);
    state.reference_mode = mode;
    state.character_lock_active = mode === 'characters_only' || mode === 'characters_and_style';
    state.style_lock_active = mode === 'style_only' || mode === 'characters_and_style';
    this.saveNovelReferenceLockState(novelId, state);
    return state;
  }

  /**
   * Map Novel Character -> Reference Manga Character
   */
  mapNovelCharacter(novelId: string, params: {
    novelCharacterId: string;
    novelCharacterName: string;
    referenceSeries: string;
    referenceCharacter: string;
    lockImmediately?: boolean;
    customOverrides?: Partial<CharacterLockProfile>;
  }): { mapping: CharacterMapping; lockProfile: CharacterLockProfile } {
    const state = this.getNovelReferenceLockState(novelId);

    const mapping: CharacterMapping = {
      novel_character_id: params.novelCharacterId,
      novel_character_name: params.novelCharacterName,
      reference_series: params.referenceSeries,
      reference_character: params.referenceCharacter,
      locked: params.lockImmediately !== false,
    };
    state.character_mappings[params.novelCharacterId] = mapping;

    const lockProfile = this.createCharacterLockProfile({
      characterId: params.novelCharacterId,
      canonicalName: params.novelCharacterName,
      referenceSeries: params.referenceSeries,
      referenceCharacter: params.referenceCharacter,
      customOverrides: params.customOverrides,
    });
    state.character_locks[params.novelCharacterId] = lockProfile;

    this.saveNovelReferenceLockState(novelId, state);
    return { mapping, lockProfile };
  }

  /**
   * Automatically suggest character mappings for novel characters based on role matching
   */
  suggestCharacterMappings(novelId: string, novelCharacters: Array<{ id: string; name: string; role?: string }>): Array<{
    novel_character_id: string;
    novel_character_name: string;
    suggested_reference_character: string;
    suggested_reference_series: string;
    confidence: string;
    reason: string;
  }> {
    const state = this.getNovelReferenceLockState(novelId);
    const key = state.active_series_title.trim().toLowerCase();
    const meta = this.seriesCache[key] || BUILTIN_SERIES_CATALOG['solo leveling'];
    const refChars = meta.characters;

    const suggestions: Array<{
      novel_character_id: string;
      novel_character_name: string;
      suggested_reference_character: string;
      suggested_reference_series: string;
      confidence: string;
      reason: string;
    }> = [];

    novelCharacters.forEach((nc, idx) => {
      let matchedRef = refChars[0];
      let confidence = 'HIGH';
      let reason = 'Primary protagonist role match';

      const roleLower = (nc.role || '').toLowerCase();
      if (roleLower.includes('protagonist') || roleLower.includes('lead') || roleLower.includes('hero') || idx === 0) {
        matchedRef = refChars[0];
        reason = `Matched protagonist to lead archetype (${matchedRef.name})`;
      } else if (refChars.length > 1) {
        matchedRef = refChars[1];
        confidence = 'MEDIUM';
        reason = `Matched secondary/supporting role to companion archetype (${matchedRef.name})`;
      }

      suggestions.push({
        novel_character_id: nc.id,
        novel_character_name: nc.name,
        suggested_reference_character: matchedRef.name,
        suggested_reference_series: meta.title,
        confidence,
        reason,
      });
    });

    return suggestions;
  }

  /**
   * Lock or unlock a character mapping
   */
  toggleMappingLock(novelId: string, charId: string, locked?: boolean): CharacterMapping | null {
    const state = this.getNovelReferenceLockState(novelId);
    const m = state.character_mappings[charId];
    if (!m) return null;
    m.locked = locked !== undefined ? locked : !m.locked;
    if (state.character_locks[charId]) {
      state.character_locks[charId].locked = m.locked;
    }
    this.saveNovelReferenceLockState(novelId, state);
    return m;
  }

  /**
   * Update or reset user overrides on Character Lock
   */
  updateCharacterLockOverrides(novelId: string, charId: string, overrides: Record<string, string>, reset?: boolean): CharacterLockProfile | null {
    const state = this.getNovelReferenceLockState(novelId);
    const lock = state.character_locks[charId];
    if (!lock) return null;

    if (reset) {
      lock.user_overrides = {};
    } else {
      lock.user_overrides = { ...(lock.user_overrides || {}), ...overrides };
    }
    lock.updated_at = Date.now();
    this.saveNovelReferenceLockState(novelId, state);
    return lock;
  }

  /**
   * Update character lock direct fields
   */
  updateCharacterLock(novelId: string, charId: string, updates: Partial<CharacterLockProfile>): CharacterLockProfile | null {
    const state = this.getNovelReferenceLockState(novelId);
    const lock = state.character_locks[charId];
    if (!lock) return null;
    Object.assign(lock, updates);
    lock.updated_at = Date.now();
    this.saveNovelReferenceLockState(novelId, state);
    return lock;
  }

  /**
   * Provider-Specific Character & Style Consistency Formatter
   * Produces separate structured constraints for image generators
   */
  buildStructuredPromptConstraints(params: {
    novelId: string;
    chapterNumber: number;
    novelCharacterIds: string[];
    sceneText: string;
    panelNumber: number;
  }): {
    storyBibleBlock: string;
    characterLockBlock: string;
    styleProfileBlock: string;
    providerConsistencyStrategy: string;
  } {
    const state = this.getNovelReferenceLockState(params.novelId);

    // 1. Resolve style lock for this chapter (respecting style versioning)
    let boundVersion = state.chapter_style_bindings[params.chapterNumber];
    if (!boundVersion) {
      const thresholds = Object.keys(state.chapter_style_bindings || {})
        .map(Number)
        .sort((a, b) => a - b);
      for (const t of thresholds) {
        if (params.chapterNumber >= t) {
          boundVersion = state.chapter_style_bindings[t];
        }
      }
    }
    if (!boundVersion) boundVersion = state.active_style_version;
    const activeStyle = state.style_locks.find((s) => s.version === boundVersion) || state.style_locks[0];

    // 2. Format Character Lock constraints with User Overrides precedence
    const charConstraints: string[] = [];
    if (state.character_lock_active) {
      for (const charId of params.novelCharacterIds) {
        const charLock = state.character_locks[charId];
        if (charLock && charLock.locked) {
          const ov = charLock.user_overrides || {};
          const hair = ov.hair_color ? `${charLock.hairstyle} (${ov.hair_color} [User Override])` : `${charLock.hairstyle} (${charLock.hair_color})`;
          const outfit = ov.signature_outfit ? `${ov.signature_outfit} [User Override]` : charLock.signature_outfit;
          const weapons = ov.weapons ? `${ov.weapons} [User Override]` : charLock.weapons.join(', ');

          charConstraints.push(
            `[CHARACTER LOCK: ${charLock.canonical_name} (Ref: ${charLock.reference_character} from ${charLock.reference_series})]\n` +
            `• Face & Eyes: ${charLock.face_shape}, ${charLock.eyes}, ${charLock.eyebrows}\n` +
            `• Hair: ${hair}\n` +
            `• Build & Height: ${charLock.body_build}, ${charLock.height_impression}, apparent age ${charLock.apparent_age}\n` +
            `• Signature Attire: ${outfit}\n` +
            `• Weapons & Items: ${weapons}\n` +
            `• Distinctive Traits: ${charLock.distinctive_marks.join(', ')}`
          );
        }
      }
    }

    // 3. Format Style Profile constraints with User Overrides precedence
    let styleBlock = '';
    if (state.style_lock_active && activeStyle) {
      const ov = activeStyle.user_overrides || {};
      const lineThickness = ov.line_thickness ? `${ov.line_thickness} [User Override]` : activeStyle.line_art.thickness;
      const colorMode = ov.color_mode ? `${ov.color_mode.toUpperCase()} [User Override]` : activeStyle.rendering.color_mode.toUpperCase();
      const panelDensity = ov.panel_density ? `${ov.panel_density} [User Override]` : activeStyle.cinematography.panel_density;

      styleBlock =
        `[VISUAL STYLE PROFILE: ${activeStyle.reference_series} (Version ${activeStyle.version})]\n` +
        `• Line Art: ${activeStyle.line_art.density} density, ${lineThickness}, ${activeStyle.line_art.cleanliness}\n` +
        `• Proportions: ${activeStyle.proportions.face}, ${activeStyle.proportions.eyes}, ${activeStyle.proportions.anatomy}\n` +
        `• Color & Rendering: ${colorMode}, ${activeStyle.rendering.hair}, ${activeStyle.rendering.clothing}\n` +
        `• Shading & Contrast: ${activeStyle.shading.technique}, ${activeStyle.shading.shadows}, ${activeStyle.shading.contrast}\n` +
        `• Effects & Energy: ${activeStyle.effects.aura_power}, ${activeStyle.effects.fight_effects}\n` +
        `• Cinematography: ${activeStyle.cinematography.camera_angles}, ${activeStyle.cinematography.shot_selection}, ${activeStyle.cinematography.overall_mood} (Density: ${panelDensity})`;
    }

    return {
      storyBibleBlock: `[SCENE BEAT ${params.panelNumber}]: ${params.sceneText.slice(0, 160)}`,
      characterLockBlock: charConstraints.length > 0 ? charConstraints.join('\n\n') : '[CHARACTER LOCK: Inactive or No Mapped Characters]',
      styleProfileBlock: styleBlock || '[STYLE LOCK: Inactive]',
      providerConsistencyStrategy:
        'Dual-Track Constraint: Canonical Character Lock Profile (Face/Hair/Attire/Weapons) + Structured Visual Style Profile (Line Art/Shading/Cinematography). Guaranteed consistent prompt conditioning with zero required image upload.',
    };
  }

  /**
   * Audit Consistency: Inspects mappings, style versions, provider capabilities,
   * generates a sample combined prompt, and detects style/format conflicts.
   */
  auditConsistency(novelId: string, novelMeta?: any): ConsistencyAuditResult {
    const state = this.getNovelReferenceLockState(novelId);
    const boundVersion = state.active_style_version;
    const activeStyle = state.style_locks.find((s) => s.version === boundVersion) || state.style_locks[0];

    const warnings: string[] = [];

    // Check color/format conflict
    const isColorManhwa = activeStyle && activeStyle.rendering.color_mode === 'full_color';
    const isBwManga = activeStyle && activeStyle.rendering.color_mode === 'black_and_white';
    const novelFormat = novelMeta?.preferred_format || 'webtoon';

    if (novelFormat === 'webtoon' && isBwManga) {
      warnings.push(
        `Style Adaptation Notice: Reference manga (${activeStyle.reference_series}) is black-and-white, but target format is Webtoon strip. Ink hatching will be paired with atmospheric ambient tones.`
      );
    } else if (novelFormat === 'manga' && isColorManhwa) {
      warnings.push(
        `Monochrome Conversion Notice: Reference webtoon (${activeStyle.reference_series}) is full-color, but target format is Manga. Emissive glows will be converted to high-contrast screentones.`
      );
    }

    const charIds = Object.keys(state.character_locks);
    const mappedChars = charIds.map((cid) => {
      const lock = state.character_locks[cid];
      const mapping = state.character_mappings[cid];
      return {
        novel_character_id: cid,
        novel_character_name: lock?.canonical_name || cid,
        reference_character: lock?.reference_character || mapping?.reference_character || 'Hero',
        reference_series: lock?.reference_series || state.active_series_title,
        locked: lock?.locked !== false,
        has_overrides: !!(lock?.user_overrides && Object.keys(lock.user_overrides).length > 0),
      };
    });

    if (state.character_lock_active && mappedChars.length === 0) {
      warnings.push(
        'Character Lock is ACTIVE but no novel characters are mapped yet. Click "Suggest Mappings" or map manually to anchor facial features.'
      );
    }

    const unlocked = mappedChars.filter((m) => !m.locked);
    if (unlocked.length > 0) {
      warnings.push(
        `Continuity Advisory: ${unlocked.length} character mapping(s) are UNLOCKED. Lock them to prevent unintentional re-mapping.`
      );
    }

    // Generate sample prompt
    const sampleConstraints = this.buildStructuredPromptConstraints({
      novelId,
      chapterNumber: 1,
      novelCharacterIds: charIds,
      sceneText: 'The protagonist stands under the moonlight as dark ethereal energy gathers along the blade.',
      panelNumber: 1,
    });

    const combinedPrompt = [
      sampleConstraints.storyBibleBlock,
      sampleConstraints.characterLockBlock,
      sampleConstraints.styleProfileBlock,
      `[NEGATIVE PROMPT]: blurry, deformed anatomy, inconsistent costume, altered eye color, style drift`,
    ].join('\n\n');

    return {
      novel_id: novelId,
      reference_series: state.active_series_title,
      reference_mode: state.reference_mode,
      character_lock_active: state.character_lock_active,
      style_lock_active: state.style_lock_active,
      active_style_version: state.active_style_version,
      style_locks_history: state.style_locks.map((s) => ({
        version: s.version,
        series: s.reference_series,
        active: s.active,
        created_at: s.created_at,
      })),
      mapped_characters: mappedChars,
      unmapped_characters: [],
      provider_capabilities: PROVIDER_CAPABILITIES,
      active_strategy:
        'Dual-Track Constraint: Canonical Character Lock Profile (Face/Hair/Attire/Weapons) + Structured Visual Style Profile (Line Art/Shading/Cinematography). Zero image upload required.',
      sample_prompt: {
        panel_number: 1,
        combined_prompt: combinedPrompt,
        story_bible_block: sampleConstraints.storyBibleBlock,
        character_lock_block: sampleConstraints.characterLockBlock,
        style_lock_block: sampleConstraints.styleProfileBlock,
      },
      warnings,
    };
  }
}
