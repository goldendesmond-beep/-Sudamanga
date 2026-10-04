import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import AdmZip from 'adm-zip';

export type ChapterStatus =
  | 'NOT_PROCESSED'
  | 'READY'
  | 'ANALYZING'
  | 'STORYBOARD_READY'
  | 'GENERATING'
  | 'PARTIAL'
  | 'COMPLETE'
  | 'FAILED'
  | 'PAUSED'
  | 'SAVE_FAILED';

export interface ChapterMeta {
  id: string;
  number: number;
  title: string;
  start_offset: number;
  end_offset: number;
  char_count: number;
  word_count: number;
  status: ChapterStatus;
  last_update: number;
  output_available: boolean;
}

export interface NovelMeta {
  id: string;
  title: string;
  filename: string;
  format: 'txt' | 'md' | 'epub';
  file_size: number;
  language: string;
  detected_chapter_count: number;
  approx_word_count: number;
  approx_char_count: number;
  warnings: string[];
  duplicate_chapters: number[];
  missing_chapters: number[];
  custom_pattern?: string | null;
  created_at: number;
  updated_at: number;
}

export interface ImportResult {
  novel: NovelMeta;
  chapters: ChapterMeta[];
  preview_chapters: ChapterMeta[];
}

// Arabic and English numeral conversion helpers
const ARABIC_INDIC_MAP: Record<string, string> = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
};

const ARABIC_WORD_NUMBERS: Record<string, number> = {
  'الاول': 1, 'الأول': 1, 'اول': 1,
  'الثاني': 2, 'ثاني': 2,
  'الثالث': 3, 'ثالث': 3,
  'الرابع': 4, 'رابع': 4,
  'الخامس': 5, 'خامس': 5,
  'السادس': 6, 'سادس': 6,
  'السابع': 7, 'سابع': 7,
  'الثامن': 8, 'ثامن': 8,
  'التاسع': 9, 'تاسع': 9,
  'العاشر': 10, 'عاشر': 10,
  'الحادي عشر': 11, 'الثاني عشر': 12, 'الثالث عشر': 13,
  'الرابع عشر': 14, 'الخامس عشر': 15, 'السادس عشر': 16,
  'السابع عشر': 17, 'الثامن عشر': 18, 'التاسع عشر': 19,
  'العشرون': 20, 'العشرين': 20,
};

const ENGLISH_WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  hundred: 100, thousand: 1000,
};

const CHINESE_NUM_MAP: Record<string, number> = {
  '零': 0, '〇': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5,
  '六': 6, '七': 7, '八': 8, '九': 9, '十': 10, '百': 100, '千': 1000, '万': 10000,
};

function parseChineseNumber(str: string): number {
  if (/^\d+$/.test(str)) return parseInt(str, 10);
  let total = 0;
  let section = 0;
  let current = 0;
  for (const char of str) {
    const val = CHINESE_NUM_MAP[char];
    if (val === undefined) continue;
    if (val >= 10) {
      if (current === 0) current = 1;
      section += current * val;
      current = 0;
      if (val === 10000) {
        total += section * 10000;
        section = 0;
      }
    } else {
      current = val;
    }
  }
  return total + section + current;
}

function parseArabicIndic(str: string): number | null {
  const norm = str.replace(/[٠-٩]/g, (d) => ARABIC_INDIC_MAP[d] || d);
  const match = norm.match(/\d+/);
  return match ? parseInt(match[0], 10) : null;
}

function parseRomanNumeral(str: string): number | null {
  const romanMap: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  const upper = str.toUpperCase().trim();
  if (!/^[IVXLCDM]+$/.test(upper)) return null;
  let res = 0;
  for (let i = 0; i < upper.length; i++) {
    const cur = romanMap[upper[i]];
    const nxt = romanMap[upper[i + 1]];
    if (nxt && cur < nxt) {
      res -= cur;
    } else {
      res += cur;
    }
  }
  return res > 0 ? res : null;
}

export function detectLanguage(text: string): string {
  let arCount = 0;
  let cjkCount = 0;
  let enCount = 0;
  const sample = text.slice(0, 15000);
  for (const char of sample) {
    const code = char.charCodeAt(0);
    if ((code >= 0x0600 && code <= 0x06ff) || (code >= 0x0750 && code <= 0x077f)) {
      arCount++;
    } else if (code >= 0x4e00 && code <= 0x9fff) {
      cjkCount++;
    } else if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) {
      enCount++;
    }
  }
  if (arCount > enCount && arCount > cjkCount) return 'Arabic (ar)';
  if (cjkCount > enCount && cjkCount > arCount) return 'Chinese (zh)';
  if (enCount > 0) return 'English (en)';
  return 'Undetermined';
}

interface ChapterBoundary {
  number: number;
  title: string;
  start_offset: number;
}

/**
 * Deterministic, scalable multi-language chapter detection patterns
 */
export function buildChapterRegex(customPattern?: string | null): RegExp[] {
  const patterns: RegExp[] = [];

  // Custom user pattern has highest priority
  if (customPattern && customPattern.trim()) {
    try {
      patterns.push(new RegExp(customPattern.trim(), 'gim'));
    } catch (e) {
      console.warn('Invalid custom chapter pattern:', e);
    }
  }

  // 1. English formats:
  // "Chapter 1", "Chapter 001", "CHAPTER 1", "Chapter One", "Ch. 1", "Volume 1 Chapter 1", "Book 1 Chapter 1"
  patterns.push(
    /^(?:[ \t]*)(?:(?:Volume|Vol|Book)\.?\s*\d+\s+)?(?:Chapter|CHAPTER|Ch\.|Chap\.)\s*([0-9]+|[IVXLCDM]+|[A-Za-z]+)(?:[:\.\s—\-]+(.*))?$/gim
  );

  // 2. Arabic formats:
  // "الفصل 1", "الفصل ١", "الفصل الأول", "الفصل 001", "الفصل الأول — العنوان", "الجزء الأول", "الباب الأول"
  patterns.push(
    /^(?:[ \t]*)(?:الفصل|الجزء|الباب|القسم)\s+([0-9\u0660-\u0669]+|[^\n\r:—\-]{1,30})(?:(?:\s*[:—\-]\s*|\s+)(.*))?$/gim
  );

  // 3. Chinese / CJK markers:
  // "第1章", "第一章", "第001回", "卷一", "楔子", "序章", "尾声", "番外", "后记"
  patterns.push(
    /^(?:[ \t]*)(?:第\s*([0-9零一二三四五六七八九十百千万]+)\s*[章回节卷集幕篇]|卷\s*([0-9零一二三四五六七八九十百千万]+)|(楔子|序章|序言|尾声|番外(?:篇)?|后记))(?:(?:\s*[:—\-·\.]\s*|\s+)?(.*))?$/gim
  );

  // 4. Markdown headers:
  // "# Chapter 1", "## الفصل 1", "### 第1章"
  patterns.push(
    /^(?:#{1,4})\s+(?:(?:Volume|Book)\s*\d+\s+)?(?:Chapter|CHAPTER|الفصل|الجزء|الباب|第\s*[0-9零一二三四五六七八九十百千万]+\s*[章回节卷集幕篇])\s*([0-9\u0660-\u0669]+|[^\n\r]+)?/gim
  );

  return patterns;
}

export function extractChapterNumber(rawMatch: string, fallbackIdx: number): number {
  if (!rawMatch) return fallbackIdx;
  const trimmed = rawMatch.trim();

  // Arabic-Indic digits
  if (/[٠-٩]/.test(trimmed)) {
    const val = parseArabicIndic(trimmed);
    if (val !== null) return val;
  }

  // Standard digits
  const digMatch = trimmed.match(/\d+/);
  if (digMatch) {
    return parseInt(digMatch[0], 10);
  }

  // Roman numerals
  const romanVal = parseRomanNumeral(trimmed);
  if (romanVal !== null) return romanVal;

  // Arabic words
  const arClean = trimmed.replace(/^ال/, '');
  for (const [key, num] of Object.entries(ARABIC_WORD_NUMBERS)) {
    if (trimmed.includes(key) || arClean === key) return num;
  }

  // English words
  const enLower = trimmed.toLowerCase();
  if (ENGLISH_WORD_NUMBERS[enLower] !== undefined) {
    return ENGLISH_WORD_NUMBERS[enLower];
  }

  // Chinese numerals
  if (/[零一二两三四五六七八九十百千万]/.test(trimmed)) {
    const chVal = parseChineseNumber(trimmed);
    if (chVal > 0) return chVal;
  }

  return fallbackIdx;
}

/**
 * Scalable parser that scans text and computes chapter offsets without memory explosion.
 */
export function scanChapters(text: string, customPattern?: string | null): ChapterBoundary[] {
  const patterns = buildChapterRegex(customPattern);
  const boundaries: ChapterBoundary[] = [];
  const foundOffsets = new Set<number>();

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const offset = match.index;
      if (foundOffsets.has(offset)) continue;
      foundOffsets.add(offset);

      const rawLine = match[0].trim();
      const numArg = match[1] || match[2] || '';
      const chapNum = extractChapterNumber(numArg, boundaries.length + 1);

      boundaries.push({
        number: chapNum,
        title: rawLine,
        start_offset: offset,
      });
    }
  }

  // Sort boundaries by appearance in file
  boundaries.sort((a, b) => a.start_offset - b.start_offset);

  // If no chapter headers were matched at all, create deterministic chapters by size/scene chunks
  if (boundaries.length === 0) {
    const chunkSize = 4000;
    let curr = 0;
    let idx = 1;
    while (curr < text.length) {
      boundaries.push({
        number: idx,
        title: `Section ${idx}`,
        start_offset: curr,
      });
      curr += chunkSize;
      idx++;
    }
  }

  return boundaries;
}

/**
 * Analyzes boundaries to compile ChapterMeta and check for duplicates or gaps.
 */
export function compileChapterMetas(text: string, boundaries: ChapterBoundary[]): ChapterMeta[] {
  const chapters: ChapterMeta[] = [];
  const now = Date.now();

  for (let i = 0; i < boundaries.length; i++) {
    const b = boundaries[i];
    const nextOffset = i + 1 < boundaries.length ? boundaries[i + 1].start_offset : text.length;
    const charCount = Math.max(0, nextOffset - b.start_offset);
    
    // Approximate word count: sample spaces / CJK characters
    const slice = text.slice(b.start_offset, Math.min(b.start_offset + 300, nextOffset));
    const isCJK = /[\u4e00-\u9fff]/.test(slice);
    const wordCount = isCJK ? charCount : Math.max(1, Math.round(charCount / 5));

    chapters.push({
      id: `ch_${String(b.number).padStart(4, '0')}_${i + 1}`,
      number: b.number,
      title: b.title.slice(0, 100),
      start_offset: b.start_offset,
      end_offset: nextOffset,
      char_count: charCount,
      word_count: wordCount,
      status: 'NOT_PROCESSED',
      last_update: now,
      output_available: false,
    });
  }

  return chapters;
}

export function detectGapsAndDuplicates(chapters: ChapterMeta[]): {
  duplicates: number[];
  missing: number[];
  warnings: string[];
} {
  const seenNumbers = new Map<number, number>();
  const duplicates: number[] = [];
  const numbers: number[] = [];

  for (const ch of chapters) {
    numbers.push(ch.number);
    const count = (seenNumbers.get(ch.number) || 0) + 1;
    seenNumbers.set(ch.number, count);
    if (count === 2) {
      duplicates.push(ch.number);
    }
  }

  const missing: number[] = [];
  if (numbers.length > 0) {
    const min = Math.min(...numbers);
    const max = Math.max(...numbers);
    const numSet = new Set(numbers);
    // Scan for missing numbers in normal ascending sequence
    if (min >= 1 && max - min < 5000) {
      for (let n = min; n <= max; n++) {
        if (!numSet.has(n)) {
          missing.push(n);
          if (missing.length >= 50) break; // Limit report to first 50 missing
        }
      }
    }
  }

  const warnings: string[] = [];
  if (duplicates.length > 0) {
    warnings.push(`Detected ${duplicates.length} duplicate chapter number(s): [${duplicates.slice(0, 5).join(', ')}${duplicates.length > 5 ? '...' : ''}]`);
  }
  if (missing.length > 0) {
    warnings.push(`Detected ${missing.length} missing chapter sequence gap(s): [${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '...' : ''}]`);
  }

  return { duplicates, missing, warnings };
}

/**
 * Extracts raw text from an EPUB buffer
 */
export function extractTextFromEpub(buffer: Buffer): { text: string; title: string } {
  const zip = new AdmZip(buffer);
  const zipEntries = zip.getEntries();
  
  let title = 'EPUB Novel';
  // Attempt to read container.xml to locate rootfile
  const containerEntry = zipEntries.find((e) => e.entryName.toLowerCase().includes('container.xml'));
  let opfPath = '';
  if (containerEntry) {
    const xml = containerEntry.getData().toString('utf-8');
    const match = xml.match(/full-path=["']([^"']+)["']/i);
    if (match) opfPath = match[1];
  }

  // Find all xhtml/html documents and sort by path
  const htmlEntries = zipEntries
    .filter((e) => /\.(x?html|xml)$/i.test(e.entryName) && !e.entryName.includes('container.xml'))
    .sort((a, b) => a.entryName.localeCompare(b.entryName));

  const textChunks: string[] = [];
  for (const entry of htmlEntries) {
    const rawHtml = entry.getData().toString('utf-8');
    // Extract title if present in opf or html
    const titleMatch = rawHtml.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch && title === 'EPUB Novel') {
      title = titleMatch[1].trim();
    }
    // Clean html tags to plain text while preserving headers
    const plain = rawHtml
      .replace(/<\/?(h1|h2|h3|h4|h5|h6)[^>]*>/gi, '\n\n$&\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\r\n/g, '\n');
    textChunks.push(plain.trim());
  }

  return {
    text: textChunks.join('\n\n'),
    title,
  };
}

/**
 * High-performance Large Novel Engine Manager
 */
export class NovelEngine {
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  /**
   * Imports a novel (from raw text, markdown, or epub buffer)
   */
  async importNovel(params: {
    filename: string;
    content: string | Buffer;
    customPattern?: string | null;
    titleOverride?: string;
  }): Promise<ImportResult> {
    const novelId = 'nv_' + crypto.randomUUID().slice(0, 10);
    const novelDir = path.join(this.baseDir, novelId);
    fs.mkdirSync(novelDir, { recursive: true });

    let rawText = '';
    let ext = path.extname(params.filename).toLowerCase();
    let format: 'txt' | 'md' | 'epub' = 'txt';
    let novelTitle = params.titleOverride || path.basename(params.filename, ext);

    if (ext === '.epub' && Buffer.isBuffer(params.content)) {
      format = 'epub';
      const extracted = extractTextFromEpub(params.content);
      rawText = extracted.text;
      if (extracted.title && extracted.title !== 'EPUB Novel') {
        novelTitle = extracted.title;
      }
    } else {
      rawText = typeof params.content === 'string' ? params.content : params.content.toString('utf-8');
      if (ext === '.md' || ext === '.markdown') format = 'md';
    }

    // Save unmodified source text
    const sourcePath = path.join(novelDir, 'source.txt');
    fs.writeFileSync(sourcePath, rawText, 'utf-8');

    // Run deterministic chapter detection
    const boundaries = scanChapters(rawText, params.customPattern);
    const chapters = compileChapterMetas(rawText, boundaries);
    const { duplicates, missing, warnings } = detectGapsAndDuplicates(chapters);
    const lang = detectLanguage(rawText);

    // Compute approx total word & char counts
    const totalChars = rawText.length;
    const isCJK = lang.includes('Chinese') || lang.includes('Japanese');
    const totalWords = isCJK ? totalChars : Math.max(1, Math.round(totalChars / 5));

    const novelMeta: NovelMeta = {
      id: novelId,
      title: novelTitle,
      filename: params.filename,
      format,
      file_size: Buffer.byteLength(rawText, 'utf-8'),
      language: lang,
      detected_chapter_count: chapters.length,
      approx_word_count: totalWords,
      approx_char_count: totalChars,
      warnings,
      duplicate_chapters: duplicates,
      missing_chapters: missing,
      custom_pattern: params.customPattern || null,
      created_at: Date.now(),
      updated_at: Date.now(),
    };

    // Save index metadata
    fs.writeFileSync(path.join(novelDir, 'metadata.json'), JSON.stringify(novelMeta, null, 2), 'utf-8');
    fs.writeFileSync(path.join(novelDir, 'chapters.json'), JSON.stringify(chapters, null, 2), 'utf-8');

    return {
      novel: novelMeta,
      chapters,
      preview_chapters: chapters.slice(0, 10),
    };
  }

  /**
   * Re-indexes an existing novel with a new custom pattern without re-uploading
   */
  async reindexNovel(novelId: string, customPattern?: string | null): Promise<ImportResult> {
    const novelDir = path.join(this.baseDir, novelId);
    if (!fs.existsSync(novelDir)) {
      throw new Error(`Novel ${novelId} not found`);
    }

    const sourcePath = path.join(novelDir, 'source.txt');
    const rawText = fs.readFileSync(sourcePath, 'utf-8');
    const metaPath = path.join(novelDir, 'metadata.json');
    const meta: NovelMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));

    const boundaries = scanChapters(rawText, customPattern);
    const chapters = compileChapterMetas(rawText, boundaries);
    const { duplicates, missing, warnings } = detectGapsAndDuplicates(chapters);

    meta.detected_chapter_count = chapters.length;
    meta.warnings = warnings;
    meta.duplicate_chapters = duplicates;
    meta.missing_chapters = missing;
    meta.custom_pattern = customPattern || null;
    meta.updated_at = Date.now();

    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
    fs.writeFileSync(path.join(novelDir, 'chapters.json'), JSON.stringify(chapters, null, 2), 'utf-8');

    return {
      novel: meta,
      chapters,
      preview_chapters: chapters.slice(0, 10),
    };
  }

  /**
   * List all stored novels
   */
  listNovels(): NovelMeta[] {
    if (!fs.existsSync(this.baseDir)) return [];
    const entries = fs.readdirSync(this.baseDir, { withFileTypes: true });
    const list: NovelMeta[] = [];
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const metaPath = path.join(this.baseDir, ent.name, 'metadata.json');
      if (fs.existsSync(metaPath)) {
        try {
          const m = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
          list.push(m);
        } catch {}
      }
    }
    return list.sort((a, b) => b.created_at - a.created_at);
  }

  /**
   * Get single novel metadata
   */
  getNovel(novelId: string): NovelMeta | null {
    const metaPath = path.join(this.baseDir, novelId, 'metadata.json');
    if (!fs.existsSync(metaPath)) return null;
    try {
      return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    } catch {
      return null;
    }
  }

  /**
   * Get chapters with pagination, search, and status filtering
   */
  getChapters(novelId: string, options?: {
    search?: string;
    status?: ChapterStatus | 'ALL';
    page?: number;
    limit?: number;
  }): { chapters: ChapterMeta[]; total: number; page: number; total_pages: number } {
    const chapPath = path.join(this.baseDir, novelId, 'chapters.json');
    if (!fs.existsSync(chapPath)) {
      return { chapters: [], total: 0, page: 1, total_pages: 1 };
    }

    let chapters: ChapterMeta[] = JSON.parse(fs.readFileSync(chapPath, 'utf-8'));

    // Filter by status
    if (options?.status && options.status !== 'ALL') {
      chapters = chapters.filter((c) => c.status === options.status);
    }

    // Filter by search query
    if (options?.search && options.search.trim()) {
      const q = options.search.trim().toLowerCase();
      chapters = chapters.filter(
        (c) =>
          c.title.toLowerCase().includes(q) ||
          String(c.number).includes(q) ||
          c.id.toLowerCase().includes(q)
      );
    }

    const total = chapters.length;
    const page = Math.max(1, options?.page || 1);
    const limit = Math.max(1, Math.min(200, options?.limit || 50));
    const total_pages = Math.max(1, Math.ceil(total / limit));
    const startIdx = (page - 1) * limit;
    const paginated = chapters.slice(startIdx, startIdx + limit);

    return {
      chapters: paginated,
      total,
      page,
      total_pages,
    };
  }

  /**
   * Lazy load chapter text: reads only the slice from source.txt
   */
  getChapterContent(novelId: string, chapterId: string): {
    meta: ChapterMeta;
    content: string;
    prev_chapter_id: string | null;
    next_chapter_id: string | null;
  } | null {
    const novelDir = path.join(this.baseDir, novelId);
    const chapPath = path.join(novelDir, 'chapters.json');
    const sourcePath = path.join(novelDir, 'source.txt');
    if (!fs.existsSync(chapPath) || !fs.existsSync(sourcePath)) return null;

    const chapters: ChapterMeta[] = JSON.parse(fs.readFileSync(chapPath, 'utf-8'));
    const idx = chapters.findIndex((c) => c.id === chapterId || String(c.number) === chapterId);
    if (idx === -1) return null;

    const meta = chapters[idx];
    const prevId = idx > 0 ? chapters[idx - 1].id : null;
    const nextId = idx + 1 < chapters.length ? chapters[idx + 1].id : null;

    // Read exact slice using file descriptor for minimal memory overhead
    const length = Math.max(0, meta.end_offset - meta.start_offset);
    const buffer = Buffer.alloc(length);
    const fd = fs.openSync(sourcePath, 'r');
    try {
      fs.readSync(fd, buffer, 0, length, meta.start_offset);
    } finally {
      fs.closeSync(fd);
    }

    return {
      meta,
      content: buffer.toString('utf-8'),
      prev_chapter_id: prevId,
      next_chapter_id: nextId,
    };
  }

  /**
   * Update chapter status or metadata
   */
  updateChapterStatus(novelId: string, chapterId: string, status: ChapterStatus): ChapterMeta | null {
    const chapPath = path.join(this.baseDir, novelId, 'chapters.json');
    if (!fs.existsSync(chapPath)) return null;

    const chapters: ChapterMeta[] = JSON.parse(fs.readFileSync(chapPath, 'utf-8'));
    const idx = chapters.findIndex((c) => c.id === chapterId);
    if (idx === -1) return null;

    chapters[idx].status = status;
    chapters[idx].last_update = Date.now();
    if (status === 'COMPLETE') {
      chapters[idx].output_available = true;
    }
    fs.writeFileSync(chapPath, JSON.stringify(chapters, null, 2), 'utf-8');
    return chapters[idx];
  }
}
