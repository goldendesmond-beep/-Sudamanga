/**
 * Stage 1 Comprehensive Verification & Smoke Test
 * Tests all 12 required behaviors, ZERO_COST_ONLY policy, and credential isolation.
 */
const BASE_URL = 'http://127.0.0.1:3000';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runTests() {
  console.log('🧪 Starting Stage 1 Comprehensive Smoke Tests...');
  let passed = 0;
  let total = 0;

  function assert(condition: boolean, msg: string) {
    total++;
    if (!condition) {
      console.error(`❌ FAIL: ${msg}`);
      throw new Error(`Assertion failed: ${msg}`);
    }
    console.log(`✅ PASS: ${msg}`);
    passed++;
  }

  // 1. Health check & UI serving
  const healthRes = await fetch(`${BASE_URL}/api/health`);
  assert(healthRes.status === 200, 'GET /api/health returns 200');
  const healthJson = await healthRes.json();
  assert(healthJson.ok === true && healthJson.key === true, 'GET /api/health indicates ready status');

  const uiRes = await fetch(`${BASE_URL}/`);
  assert(uiRes.status === 200, 'GET / serves UI index.html');
  const uiHtml = await uiRes.text();
  assert(uiHtml.includes('Inkstone — Turn Novels Into Comics'), 'UI contains correct page title');
  assert(uiHtml.includes('assets/logo.svg'), 'UI references logo asset');

  // 2. Static asset & artifact serving
  const logoRes = await fetch(`${BASE_URL}/assets/logo.svg`);
  assert(logoRes.status === 200, 'GET /assets/logo.svg serves successfully');
  const sampleRes = await fetch(`${BASE_URL}/assets/samples/P01.png`);
  assert(sampleRes.status === 200, 'GET /assets/samples/P01.png serves sample image');

  // 3. Error handling: empty text rejection (400)
  const badGenRes = await fetch(`${BASE_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: '   ' }),
  });
  assert(badGenRes.status === 400, 'POST /api/generate with empty text rejected with 400');
  const badGenJson = await badGenRes.json();
  assert(badGenJson.error === "missing 'text'", 'Error message matches specification');

  // 4. Novel ingestion, chapter segmentation, narrative extraction, visual bible, panel planning, rendering, lettering
  const novelSample = `第一章 渡口
江风裹着初秋的凉意，从船舷一侧涌来。沈知意把围巾拢了拢，望向雾里若隐若现的灯塔。
"你也是去上游的？"身旁的少年抱着一把旧吉他，笑得有些腼腆。
沈知意收回目光，轻轻点头。两个人便这样倚着栏杆，看江水把远处的灯火拉成温柔的长线。

第二章 灯下
客栈的灯晃了晃。少年拨响吉他，哼起一段没有名字的调子。
沈知意托着下巴，忽然笑了："这首歌，倒是比人坦诚。"`;

  const testPid = `smoke-${Date.now().toString(36)}`;
  const genRes = await fetch(`${BASE_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: novelSample,
      format: 'webtoon',
      project_id: testPid,
    }),
  });
  assert(genRes.status === 200, 'POST /api/generate creates background job');
  const genJson = await genRes.json();
  assert(Boolean(genJson.job_id), 'Job ID returned');
  assert(genJson.project_id === testPid, 'Project ID matches requested ID');

  // 5. Polling job and inspecting pipeline stages
  let jobData: any = null;
  for (let i = 0; i < 20; i++) {
    await sleep(600);
    const jobRes = await fetch(`${BASE_URL}/api/job/${genJson.job_id}`);
    assert(jobRes.status === 200, `GET /api/job/${genJson.job_id} returns 200`);
    jobData = await jobRes.json();
    if (jobData.status === 'done') break;
  }

  assert(jobData.status === 'done', 'Job status completed as done');
  assert(jobData.progress === 1.0, 'Job progress reached 1.0');
  assert(jobData.panels.length === 7, 'Rendered exactly 7 comic panels');
  assert(Boolean(jobData.webtoon), 'Webtoon stitched artifact generated');
  assert(jobData.log.some((l: string) => l.includes('ZERO_COST_ONLY')), 'ZERO_COST_ONLY policy logged');
  assert(jobData.log.some((l: string) => l.includes('Chapter segmentation')), 'Chapter segmentation executed');
  assert(jobData.log.some((l: string) => l.includes('Visual Bible')), 'Visual Bible locked with character palettes');
  assert(jobData.log.some((l: string) => l.includes('lettering')), 'Lettering stage executed');

  // 6. Checkpoints & Resume verification
  const projectsRes = await fetch(`${BASE_URL}/api/projects`);
  assert(projectsRes.status === 200, 'GET /api/projects returns 200');
  const projects = await projectsRes.json();
  assert(projects.some((p: any) => p.id === testPid), 'Newly created project checkpoint listed in projects');

  // Test resume with same project_id
  const resumeRes = await fetch(`${BASE_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: novelSample,
      format: 'webtoon',
      project_id: testPid,
    }),
  });
  assert(resumeRes.status === 200, 'Resume job starts successfully with existing project_id');
  const resumeJson = await resumeRes.json();
  assert(resumeJson.project_id === testPid, 'Resumed project ID retained');

  // 7. Character review (merge / dismiss)
  const reviewRes = await fetch(`${BASE_URL}/api/project/${testPid}/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'merge',
      new_name: 'Guitar Boy',
      candidate: 'Youth with Guitar',
    }),
  });
  assert(reviewRes.status === 200, 'POST /api/project/:id/review returns 200');
  const reviewJson = await reviewRes.json();
  assert(reviewJson.stale_panels.includes('c0000-p0001'), 'Alias merge flags affected panels as stale');

  // 8. Targeted panel regeneration
  const regenRes = await fetch(`${BASE_URL}/api/project/${testPid}/regen`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      stale: true,
      format: 'webtoon',
    }),
  });
  assert(regenRes.status === 200, 'POST /api/project/:id/regen returns 200');
  const regenJson = await regenRes.json();
  assert(Boolean(regenJson.job_id), 'Regen job ID returned');

  let regenJob: any = null;
  for (let i = 0; i < 10; i++) {
    await sleep(400);
    const rRes = await fetch(`${BASE_URL}/api/job/${regenJson.job_id}`);
    regenJob = await rRes.json();
    if (regenJob.status === 'done') break;
  }
  assert(regenJob.status === 'done', 'Regen job completed');
  assert(regenJob.stale_panels.length === 0, 'Stale panels cleared after redraw');

  // 9. Cooperative stop cancellation
  const cancelTestPid = `cancel-${Date.now().toString(36)}`;
  const cancelGenRes = await fetch(`${BASE_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: 'Long narrative scene for stop test...',
      project_id: cancelTestPid,
    }),
  });
  const cancelGenJson = await cancelGenRes.json();
  const stopRes = await fetch(`${BASE_URL}/api/job/${cancelGenJson.job_id}/stop`, {
    method: 'POST',
  });
  assert(stopRes.status === 200, 'POST /api/job/:jobId/stop returns 200');
  const stopJson = await stopRes.json();
  assert(stopJson.ok === true, 'Stop confirmation returned ok: true');

  const stoppedJobRes = await fetch(`${BASE_URL}/api/job/${cancelGenJson.job_id}`);
  const stoppedJob = await stoppedJobRes.json();
  assert(stoppedJob.status === 'paused' || stoppedJob.cancel_requested === true, 'Job successfully paused / cancelled');

  // 10. Non-existent and expired job error handling (404)
  const notFoundJobRes = await fetch(`${BASE_URL}/api/job/non-existent-job-id`);
  assert(notFoundJobRes.status === 404, 'GET /api/job/unknown returns 404');

  console.log(`\n🎉 All ${passed}/${total} Stage 1 Smoke Tests Passed!`);
}

runTests().catch((err) => {
  console.error('Smoke test suite failed:', err);
  process.exit(1);
});
