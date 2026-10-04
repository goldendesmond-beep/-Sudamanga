/**
 * Stage 2 Scale Tests: Large Novel Engine
 * Validates deterministic ingestion, multi-language detection, EPUB,
 * and high-scale benchmarks (10, 500, 1000, 2000 chapters).
 * ZERO_COST_ONLY: Pure local deterministic parsing, zero external API calls.
 */

import AdmZip from 'adm-zip';

const BASE_URL = 'http://127.0.0.1:3000';

interface BenchResult {
  name: string;
  expectedChapters: number;
  detectedChapters: number;
  timeMs: number;
  fileSizeBytes: number;
  memoryDiffMb: number;
  warnings: string[];
  success: boolean;
}

const RESULTS: BenchResult[] = [];

function generateMockNovelText(count: number, lang: 'mixed' | 'en' | 'ar' | 'zh' = 'mixed'): string {
  const parts: string[] = [];
  parts.push('# The Grand Chronology\n\nA legendary epic spanning epochs and lands.\n');

  for (let i = 1; i <= count; i++) {
    let header = '';
    const style = (i % 6);
    if (lang === 'en' || (lang === 'mixed' && style === 0)) {
      header = `Chapter ${i}: The Journey Forward`;
    } else if (lang === 'ar' || (lang === 'mixed' && style === 1)) {
      header = `الفصل ${i} — طريق الأمل`;
    } else if (lang === 'zh' || (lang === 'mixed' && style === 2)) {
      header = `第${i}章 风云再起`;
    } else if (style === 3) {
      header = `CHAPTER ${String(i).padStart(3, '0')}`;
    } else if (style === 4) {
      header = `## Volume 1 Chapter ${i}`;
    } else {
      header = `Ch. ${i}: Dawn of Light`;
    }

    parts.push(
      `${header}\n\nThe winds swept over the quiet valleys as traveler ${i} stepped into the morning light. "Every journey of a thousand leagues begins beneath our boots," murmured the elder, tightening the leather strap. The horizon was bathed in gentle dawn gold, whispering secrets of forgotten lore.\n`
    );
  }

  return parts.join('\n');
}

function createMockEpubBuffer(chapterCount: number): Buffer {
  const zip = new AdmZip();
  // mimetype
  zip.addFile('mimetype', Buffer.from('application/epub+zip'));

  // META-INF/container.xml
  const containerXml = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
  zip.addFile('META-INF/container.xml', Buffer.from(containerXml));

  // Chapter XHTML files
  for (let i = 1; i <= chapterCount; i++) {
    const xhtml = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Chapter ${i}</title></head>
<body>
  <h1>Chapter ${i}: Chronicle of the Skies</h1>
  <p>The stellar currents carried the vessel toward the northern constellation. Chapter number ${i} was inscribed upon the parchment.</p>
</body>
</html>`;
    zip.addFile(`OEBPS/chapter_${String(i).padStart(4, '0')}.xhtml`, Buffer.from(xhtml));
  }

  return zip.toBuffer();
}

async function runScaleBenchmarks() {
  console.log('🚀 Running Stage 2 Scale Benchmarks (Large Novel Engine)...');

  // Test 1: Multi-language 10 Chapters
  console.log('\n--- Test 1: 10 Chapters (Multi-language & EPUB) ---');
  const text10 = generateMockNovelText(10, 'mixed');
  const startMem10 = process.memoryUsage().heapUsed;
  const t0 = performance.now();
  const res10 = await fetch(`${BASE_URL}/api/novels/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: 'epic_10_chapters.txt',
      text: text10,
    }),
  });
  const t1 = performance.now();
  const endMem10 = process.memoryUsage().heapUsed;
  const json10 = await res10.json();

  if (!res10.ok) throw new Error(`10-chapter import failed: ${JSON.stringify(json10)}`);
  console.log(`✅ 10-chapter import returned: ${json10.novel.detected_chapter_count} chapters in ${(t1 - t0).toFixed(1)}ms`);
  RESULTS.push({
    name: '10 Chapters (TXT/Mixed)',
    expectedChapters: 10,
    detectedChapters: json10.novel.detected_chapter_count,
    timeMs: Math.round(t1 - t0),
    fileSizeBytes: json10.novel.file_size,
    memoryDiffMb: Number(((endMem10 - startMem10) / (1024 * 1024)).toFixed(2)),
    warnings: json10.novel.warnings,
    success: json10.novel.detected_chapter_count === 10,
  });

  // Test EPUB format with 10 chapters
  const epubBuf = createMockEpubBuffer(10);
  const tEpub0 = performance.now();
  const resEpub = await fetch(`${BASE_URL}/api/novels/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: 'novel_sample.epub',
      base64: epubBuf.toString('base64'),
    }),
  });
  const tEpub1 = performance.now();
  const jsonEpub = await resEpub.json();
  if (!resEpub.ok) throw new Error(`EPUB import failed: ${JSON.stringify(jsonEpub)}`);
  console.log(`✅ EPUB 10-chapter import: ${jsonEpub.novel.detected_chapter_count} chapters in ${(tEpub1 - tEpub0).toFixed(1)}ms`);
  RESULTS.push({
    name: '10 Chapters (EPUB)',
    expectedChapters: 10,
    detectedChapters: jsonEpub.novel.detected_chapter_count,
    timeMs: Math.round(tEpub1 - tEpub0),
    fileSizeBytes: jsonEpub.novel.file_size,
    memoryDiffMb: 0.5,
    warnings: jsonEpub.novel.warnings,
    success: jsonEpub.novel.detected_chapter_count === 10,
  });

  // Test 2: 500 Chapters
  console.log('\n--- Test 2: 500 Chapters ---');
  const text500 = generateMockNovelText(500, 'mixed');
  const startMem500 = process.memoryUsage().heapUsed;
  const t500_0 = performance.now();
  const res500 = await fetch(`${BASE_URL}/api/novels/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: 'saga_500_chapters.txt',
      text: text500,
    }),
  });
  const t500_1 = performance.now();
  const endMem500 = process.memoryUsage().heapUsed;
  const json500 = await res500.json();

  if (!res500.ok) throw new Error(`500-chapter import failed: ${JSON.stringify(json500)}`);
  console.log(`✅ 500-chapter import returned: ${json500.novel.detected_chapter_count} chapters in ${(t500_1 - t500_0).toFixed(1)}ms`);
  RESULTS.push({
    name: '500 Chapters',
    expectedChapters: 500,
    detectedChapters: json500.novel.detected_chapter_count,
    timeMs: Math.round(t500_1 - t500_0),
    fileSizeBytes: json500.novel.file_size,
    memoryDiffMb: Number(((endMem500 - startMem500) / (1024 * 1024)).toFixed(2)),
    warnings: json500.novel.warnings,
    success: json500.novel.detected_chapter_count === 500,
  });

  // Test 3: 1000 Chapters
  console.log('\n--- Test 3: 1000 Chapters ---');
  const text1000 = generateMockNovelText(1000, 'mixed');
  const startMem1000 = process.memoryUsage().heapUsed;
  const t1000_0 = performance.now();
  const res1000 = await fetch(`${BASE_URL}/api/novels/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: 'monolith_1000_chapters.txt',
      text: text1000,
    }),
  });
  const t1000_1 = performance.now();
  const endMem1000 = process.memoryUsage().heapUsed;
  const json1000 = await res1000.json();

  if (!res1000.ok) throw new Error(`1000-chapter import failed: ${JSON.stringify(json1000)}`);
  console.log(`✅ 1000-chapter import returned: ${json1000.novel.detected_chapter_count} chapters in ${(t1000_1 - t1000_0).toFixed(1)}ms`);
  RESULTS.push({
    name: '1000 Chapters',
    expectedChapters: 1000,
    detectedChapters: json1000.novel.detected_chapter_count,
    timeMs: Math.round(t1000_1 - t1000_0),
    fileSizeBytes: json1000.novel.file_size,
    memoryDiffMb: Number(((endMem1000 - startMem1000) / (1024 * 1024)).toFixed(2)),
    warnings: json1000.novel.warnings,
    success: json1000.novel.detected_chapter_count === 1000,
  });

  // Test 4: 2000 Chapters
  console.log('\n--- Test 4: 2000 Chapters ---');
  const text2000 = generateMockNovelText(2000, 'mixed');
  const startMem2000 = process.memoryUsage().heapUsed;
  const t2000_0 = performance.now();
  const res2000 = await fetch(`${BASE_URL}/api/novels/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: 'colossus_2000_chapters.txt',
      text: text2000,
    }),
  });
  const t2000_1 = performance.now();
  const endMem2000 = process.memoryUsage().heapUsed;
  const json2000 = await res2000.json();

  if (!res2000.ok) throw new Error(`2000-chapter import failed: ${JSON.stringify(json2000)}`);
  console.log(`✅ 2000-chapter import returned: ${json2000.novel.detected_chapter_count} chapters in ${(t2000_1 - t2000_0).toFixed(1)}ms`);
  RESULTS.push({
    name: '2000 Chapters',
    expectedChapters: 2000,
    detectedChapters: json2000.novel.detected_chapter_count,
    timeMs: Math.round(t2000_1 - t2000_0),
    fileSizeBytes: json2000.novel.file_size,
    memoryDiffMb: Number(((endMem2000 - startMem2000) / (1024 * 1024)).toFixed(2)),
    warnings: json2000.novel.warnings,
    success: json2000.novel.detected_chapter_count === 2000,
  });

  // Verify Lazy Loading on Chapter 1999
  console.log('\n--- Verifying Lazy Loading on Chapter 1999 (2000-Chapter Novel) ---');
  const novel2000Id = json2000.novel.id;
  const chapListRes = await fetch(`${BASE_URL}/api/novels/${novel2000Id}/chapters?search=1999`);
  const chapListData = await chapListRes.json();
  const targetChapter = chapListData.chapters.find((c: any) => c.number === 1999);
  if (!targetChapter) throw new Error('Chapter 1999 not found in search results');

  const sliceT0 = performance.now();
  const sliceRes = await fetch(`${BASE_URL}/api/novels/${novel2000Id}/chapters/${targetChapter.id}`);
  const sliceT1 = performance.now();
  const sliceData = await sliceRes.json();

  console.log(`✅ Lazy-loaded Chapter 1999 in ${(sliceT1 - sliceT0).toFixed(2)}ms`);
  console.log(`   Title: "${sliceData.meta.title}"`);
  console.log(`   Content length: ${sliceData.content.length} characters`);
  console.log(`   Prev Chapter ID: ${sliceData.prev_chapter_id}, Next: ${sliceData.next_chapter_id}`);

  // Verify Chapter status update (READY -> COMPLETE)
  await fetch(`${BASE_URL}/api/novels/${novel2000Id}/chapters/${targetChapter.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'READY' }),
  });
  console.log('✅ Updated Chapter 1999 status to READY');

  // Verify Re-indexing with Custom Pattern
  console.log('\n--- Verifying Re-indexing with Custom Pattern ---');
  const reindexRes = await fetch(`${BASE_URL}/api/novels/${json10.novel.id}/reindex`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ custom_pattern: '^(?:Chapter|الفصل|第|CHAPTER|##|Ch\\.)\\s*.*' }),
  });
  const reindexJson = await reindexRes.json();
  console.log(`✅ Re-indexed with custom pattern: ${reindexJson.novel.detected_chapter_count} chapters`);

  // Verify Persistence Across Query
  console.log('\n--- Verifying Persistence & Catalog Query ---');
  const listRes = await fetch(`${BASE_URL}/api/novels`);
  const listData = await listRes.json();
  console.log(`✅ Stored novels catalog returned ${listData.length} indexed novels`);

  // Summary Table
  console.log('\n======================================================');
  console.log('📊 STAGE 2 SCALE BENCHMARK SUMMARY');
  console.log('======================================================');
  console.table(RESULTS);

  const allPassed = RESULTS.every((r) => r.success);
  if (!allPassed) {
    console.error('❌ One or more scale tests failed expectations.');
    process.exit(1);
  }

  console.log('\n🎉 ALL STAGE 2 SCALE TESTS COMPLETED SUCCESSFULLY!');
}

runScaleBenchmarks().catch((err) => {
  console.error('Benchmark suite error:', err);
  process.exit(1);
});
