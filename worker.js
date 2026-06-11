// ========================
// OGEN U - Cloudflare Worker (v1.2)
// Routes: /, /campus, /verify, /cdn/*, /api/deploy, /api/rollback
// ========================

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname;

    // ----- LANDING -----
    if (path === '/') {
      return htmlResponse(LANDING_HTML);
    }

    // ----- CAMPUS PWA (KV or fallback) -----
    if (path === '/campus') {
      const html = (await kvGet(env, 'build:current')) || CAMPUS_HTML;
      return htmlResponse(html);
    }

    // ----- VERIFY LEDGER -----
    if (path === '/verify') {
      return htmlResponse(VERIFY_HTML);
    }

    // ----- CDN ASSETS (same-origin) -----
    if (path.startsWith('/cdn/')) {
      const asset = path.slice(5);
      const map = {
        'sw.js': { data: SW_JS, type: 'application/javascript; charset=utf-8' },
        'manifest.json': { data: MANIFEST_JSON, type: 'application/json; charset=utf-8' },
        'icon-192.png': { data: ICON_192_B64, type: 'image/png', encoding: 'base64' },
        'icon-512.png': { data: ICON_512_B64, type: 'image/png', encoding: 'base64' },
        'curricula/FUSION_ENERGY_SOVEREIGNTY_100.json': { data: FUSION_SYLLABUS_JSON, type: 'application/json; charset=utf-8' },
        'curricula/HYDRO_L1_EN.json': { data: HYDRO_JSON, type: 'application/json; charset=utf-8' },
      };

      if (map[asset]) {
        const { data, type, encoding } = map[asset];
        const body = encoding === 'base64' ? Uint8Array.from(atob(data), c => c.charCodeAt(0)) : data;
        return new Response(body, {
          headers: {
            'Content-Type': type,
            'Cache-Control': 'public, max-age=31536000, immutable',
          },
        });
      }
    }

    // ----- DEPLOY API (authenticated) -----
    if (path === '/api/deploy' && req.method === 'POST') {
      try {
        const { html, ts, token } = await req.json();
        const authError = validateDeployAuth(env, token, ts);
        if (authError) return authError;
        if (typeof html !== 'string' || !html.trim()) {
          return new Response('Missing html', { status: 400 });
        }

        const current = await kvGet(env, 'build:current');
        if (current) await kvPut(env, 'build:previous', current);
        await kvPut(env, 'build:current', html);
        const hash = await sha256(html);
        await kvPut(env, `build:${hash}`, html);

        return jsonResponse({ deployed: true, hash });
      } catch (error) {
        return new Response(`Deploy failed: ${error.message}`, { status: 500 });
      }
    }

    // ----- ROLLBACK API (authenticated) -----
    if (path === '/api/rollback' && req.method === 'POST') {
      try {
        const { ts, token } = await req.json();
        const authError = validateDeployAuth(env, token, ts);
        if (authError) return authError;

        const prev = await kvGet(env, 'build:previous');
        if (!prev) return new Response('No previous build', { status: 404 });
        const current = await kvGet(env, 'build:current');
        if (current) await kvPut(env, 'build:previous', current);
        await kvPut(env, 'build:current', prev);
        return new Response('Rolled back', { status: 200 });
      } catch (error) {
        return new Response(`Rollback failed: ${error.message}`, { status: 500 });
      }
    }

    return new Response('Not found', { status: 404 });
  },
};

// ========== STATIC ASSETS ==========
const LANDING_HTML = `<!DOCTYPE html>
<html>
<head><title>Veritas Mechanica OrgComplex</title></head>
<body style="background:#0f172a;color:#fff;font-family:system-ui;text-align:center;padding:10vh 5vw">
  <h1>⚡ Veritas Mechanica OrgComplex</h1>
  <p>No tuition. No barriers. Reason alone matters.</p>
  <a href="/campus" style="display:inline-block;margin-top:2rem;padding:1rem 2rem;background:#2563eb;border-radius:8px;color:#fff;text-decoration:none;font-weight:bold">
    Enter Campus →
  </a>
  <p style="margin-top:4rem;font-size:12px;color:#64748b">Offline-first. Verifiable. Sovereign. Seed phrase = your degree.</p>
</body>
</html>`;

const VERIFY_HTML = `<!DOCTYPE html>
<html>
<head><title>OGEN Ledger Verifier</title></head>
<body style="background:#0f172a;color:#fff;font-family:monospace;padding:20px;">
  <h1>📜 OGEN Ledger Verifier</h1>
  <textarea id="ledger" rows="10" style="width:100%;background:#1e293b;color:#fff;"></textarea>
  <button onclick="verify()">Verify & Replay</button>
  <pre id="output"></pre>
  <script>
    async function verify() {
      let entries;
      try {
        entries = JSON.parse(document.getElementById('ledger').value);
      } catch(e) {
        alert('Invalid JSON');
        return;
      }
      let state = { scores: {}, lastHash: 'GENESIS', corrupted: false, track: null };
      for (let e of entries) {
        if (e.prev_hash !== state.lastHash) {
          state.corrupted = true;
          break;
        }
        state.lastHash = e.hash;
        if (e.type === 'probe' && e.step === 'ENERGY_SOVEREIGNTY' && e.choice === 'A') state.scores.sovereignty = (state.scores.sovereignty || 0) + 2;
        if (e.type === 'probe' && e.step === 'FUSION_FOUNDATIONS' && e.choice === 'A') state.scores.fusion = (state.scores.fusion || 0) + 2;
        if (e.type === 'probe' && e.step === 'GRID_DEPLOYMENT' && e.choice === 'A') state.scores.deployment = (state.scores.deployment || 0) + 2;
        if (e.type === 'final') state.track = (state.scores.fusion >= 2 && state.scores.deployment >= 2) ? 'Fusion & Energy Sovereignty' : 'Energy Sovereignty Foundations';
      }
      let out = state.corrupted ? '❌ Ledger corrupted' : '✅ Valid. Track: ' + state.track + '\\nScores: ' + JSON.stringify(state.scores);
      document.getElementById('output').innerText = out;
    }
  </script>
</body>
</html>`;

const SW_JS = `const CACHE='ogen-v1.2';
const ASSETS=['/','/campus','/verify','/cdn/manifest.json','/cdn/icon-192.png','/cdn/icon-512.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS))));
self.addEventListener('fetch',e=>e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request))));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))));`;

const MANIFEST_JSON = JSON.stringify({
  name: 'OGEN University - Dialectic Campus',
  short_name: 'OGEN_U',
  start_url: '/campus',
  display: 'standalone',
  background_color: '#0f172a',
  theme_color: '#0f172a',
  icons: [
    { src: '/cdn/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/cdn/icon-512.png', sizes: '512x512', type: 'image/png' },
  ],
});

const FUSION_SYLLABUS = {
  presetId: 'fusion_energy_sovereignty_100',
  title: 'Fusion & Energy Sovereignty: 100-Query Foundational Syllabus',
  version: 1,
  seed: 42,
  queries: [
    { id: 'Q001', prompt: "Define 'energy sovereignty' in one sentence.", tags: ['foundations', 'definition'] },
    { id: 'Q002', prompt: 'List three historical energy transitions (e.g., biomass -> coal -> oil).', tags: ['history'] },
    { id: 'Q003', prompt: 'Explain why centralized grids create political leverage.', tags: ['politics', 'grid'] },
    { id: 'Q004', prompt: 'Compare baseload vs. variable generation in one paragraph.', tags: ['grid', 'engineering'] },
    { id: 'Q005', prompt: 'Describe the difference between fission and fusion in under 150 words.', tags: ['nuclear', 'foundations'] },
    { id: 'Q006', prompt: 'What is the Lawson criterion and why does it matter?', tags: ['fusion', 'physics'] },
    { id: 'Q007', prompt: 'Summarize the role of confinement in fusion (magnetic vs. inertial).', tags: ['fusion', 'confinement'] },
    { id: 'Q008', prompt: "Explain 'Q > 1' in fusion and its practical meaning.", tags: ['fusion', 'metrics'] },
    { id: 'Q009', prompt: 'List three major fusion approaches (tokamak, stellarator, laser ICF, etc.).', tags: ['fusion', 'taxonomy'] },
    { id: 'Q010', prompt: 'Describe a tokamak in terms of geometry and field configuration.', tags: ['fusion', 'tokamak'] },
    { id: 'Q011', prompt: 'Explain what plasma is and how it differs from gas.', tags: ['plasma', 'foundations'] },
    { id: 'Q012', prompt: "Define 'plasma beta' and why engineers care about it.", tags: ['plasma', 'engineering'] },
    { id: 'Q013', prompt: 'List three key plasma instabilities relevant to fusion devices.', tags: ['plasma', 'instabilities'] },
    { id: 'Q014', prompt: 'Explain the role of superconducting magnets in modern fusion designs.', tags: ['hardware', 'magnets'] },
    { id: 'Q015', prompt: 'Compare high-temperature superconductors vs. conventional superconductors for fusion.', tags: ['materials', 'magnets'] },
    { id: 'Q016', prompt: "Describe the concept of a 'blanket' in fusion reactors.", tags: ['fusion', 'engineering'] },
    { id: 'Q017', prompt: 'Explain tritium breeding and why it is a bottleneck.', tags: ['fuel', 'tritium'] },
    { id: 'Q018', prompt: 'List the main fuel cycles (D-T, D-D, D-He3, p-B11) and one tradeoff each.', tags: ['fuel', 'tradeoffs'] },
    { id: 'Q019', prompt: 'Describe neutron flux and its impact on materials and shielding.', tags: ['neutrons', 'materials'] },
    { id: 'Q020', prompt: 'Explain how fusion heat is converted to electricity in a typical plant design.', tags: ['systems', 'conversion'] },
    { id: 'Q021', prompt: 'Sketch the high-level architecture of a fusion power plant (blocks + flows).', tags: ['systems', 'architecture'] },
    { id: 'Q022', prompt: 'Define capacity factor and estimate realistic ranges for fusion.', tags: ['metrics', 'capacity_factor'] },
    { id: 'Q023', prompt: 'Compare fusion to solar PV on land use, intermittency, and grid integration.', tags: ['comparison', 'solar'] },
    { id: 'Q024', prompt: 'Compare fusion to fission on waste, safety, and proliferation risk.', tags: ['comparison', 'fission'] },
    { id: 'Q025', prompt: 'Explain why time-to-deployment matters more than theoretical efficiency.', tags: ['strategy', 'deployment'] },
    { id: 'Q026', prompt: 'List three non-technical bottlenecks to fusion deployment.', tags: ['policy', 'bottlenecks'] },
    { id: 'Q027', prompt: 'Describe the typical regulatory path for a new nuclear technology.', tags: ['regulation', 'nuclear'] },
    { id: 'Q028', prompt: 'Explain how public perception shapes nuclear and fusion policy.', tags: ['society', 'perception'] },
    { id: 'Q029', prompt: "Define 'social license to operate' in the context of energy projects.", tags: ['policy', 'social_license'] },
    { id: 'Q030', prompt: 'Design a one-sentence narrative that makes fusion emotionally legible to non-experts.', tags: ['communication', 'narrative'] },
    { id: 'Q031', prompt: 'Explain grid inertia and why high-renewables grids struggle with it.', tags: ['grid', 'inertia'] },
    { id: 'Q032', prompt: 'Describe how fusion could act as synthetic inertia or firm capacity.', tags: ['fusion', 'grid'] },
    { id: 'Q033', prompt: "List three grid services beyond 'energy' that matter (e.g., frequency regulation).", tags: ['grid', 'services'] },
    { id: 'Q034', prompt: 'Explain the difference between transmission and distribution networks.', tags: ['grid', 'structure'] },
    { id: 'Q035', prompt: 'Describe one scenario where fusion is deployed off-grid (e.g., remote industry).', tags: ['deployment', 'offgrid'] },
    { id: 'Q036', prompt: "Define 'microgrid' and how fusion could integrate into one.", tags: ['microgrid', 'integration'] },
    { id: 'Q037', prompt: 'Explain why energy storage is still relevant in a fusion-heavy grid.', tags: ['storage', 'fusion'] },
    { id: 'Q038', prompt: 'Compare batteries vs. thermal storage for coupling with fusion.', tags: ['storage', 'comparison'] },
    { id: 'Q039', prompt: 'Describe a fusion + desalination co-located plant concept.', tags: ['co-benefits', 'water'] },
    { id: 'Q040', prompt: 'Describe a fusion + hydrogen production co-located plant concept.', tags: ['co-benefits', 'hydrogen'] },
    { id: 'Q041', prompt: 'Explain levelized cost of energy (LCOE) and its limitations.', tags: ['economics', 'LCOE'] },
    { id: 'Q042', prompt: 'List three cost drivers specific to fusion plants.', tags: ['economics', 'fusion_costs'] },
    { id: 'Q043', prompt: "Describe how learning curves (Wright's law) might apply to fusion.", tags: ['economics', 'learning_curve'] },
    { id: 'Q044', prompt: 'Explain why modularity matters for cost reduction.', tags: ['design', 'modularity'] },
    { id: 'Q045', prompt: 'Sketch a modular fusion plant product line (S, M, L) and target markets.', tags: ['product', 'markets'] },
    { id: 'Q046', prompt: "Define 'balance of plant' and list its main components.", tags: ['systems', 'BoP'] },
    { id: 'Q047', prompt: 'Explain how financing structures (PPAs, project finance) affect deployment speed.', tags: ['finance', 'deployment'] },
    { id: 'Q048', prompt: 'Describe one fusion business model that prioritizes sovereignty over profit.', tags: ['business_model', 'sovereignty'] },
    { id: 'Q049', prompt: 'List three metrics a sovereign energy ministry should track for fusion rollout.', tags: ['governance', 'metrics'] },
    { id: 'Q050', prompt: 'Design a simple dashboard for national fusion deployment status.', tags: ['governance', 'dashboard'] },
    { id: 'Q051', prompt: 'Explain how supply chains for magnets and vacuum systems can become chokepoints.', tags: ['supply_chain', 'hardware'] },
    { id: 'Q052', prompt: 'List three critical materials for fusion and their geopolitical risks.', tags: ['materials', 'geopolitics'] },
    { id: 'Q053', prompt: 'Describe strategies for localizing fusion component manufacturing.', tags: ['industrial_policy', 'localization'] },
    { id: 'Q054', prompt: 'Explain how export controls could affect fusion technology sharing.', tags: ['policy', 'export_controls'] },
    { id: 'Q055', prompt: 'Design a bilateral fusion cooperation agreement in three bullet points.', tags: ['diplomacy', 'cooperation'] },
    { id: 'Q056', prompt: "Describe how fusion could reshape petrostates' economic models.", tags: ['geopolitics', 'petrostates'] },
    { id: 'Q057', prompt: "Explain the concept of 'energy weaponization' with one historical example.", tags: ['geopolitics', 'history'] },
    { id: 'Q058', prompt: 'Describe how fusion could reduce energy weaponization globally.', tags: ['geopolitics', 'fusion_impact'] },
    { id: 'Q059', prompt: 'List three risks of fusion being captured by incumbents.', tags: ['risk', 'incumbents'] },
    { id: 'Q060', prompt: 'Propose one governance mechanism to keep fusion aligned with public interest.', tags: ['governance', 'mechanisms'] },
    { id: 'Q061', prompt: 'Explain why measurement and verification are central to energy policy.', tags: ['M&V', 'policy'] },
    { id: 'Q062', prompt: 'Describe how an IPFS-backed ledger could store plant performance data.', tags: ['ledger', 'IPFS'] },
    { id: 'Q063', prompt: 'Design a minimal schema for recording fusion plant verdicts on-chain.', tags: ['schema', 'ledger'] },
    { id: 'Q064', prompt: 'Explain how hash-chained student verdicts could become regulatory evidence.', tags: ['education', 'regulation'] },
    { id: 'Q065', prompt: 'Describe a workflow where engineers submit fusion incident reports to a hash chain.', tags: ['safety', 'ledger'] },
    { id: 'Q066', prompt: 'List three privacy concerns with public energy ledgers.', tags: ['privacy', 'ledger'] },
    { id: 'Q067', prompt: 'Propose one privacy-preserving pattern for publishing plant data.', tags: ['privacy', 'design'] },
    { id: 'Q068', prompt: "Explain the difference between 'verifiable' and 'trustless' in this context.", tags: ['concepts', 'verification'] },
    { id: 'Q069', prompt: 'Describe how deterministic reasoning blocks can reduce regulatory ambiguity.', tags: ['reasoning', 'regulation'] },
    { id: 'Q070', prompt: 'Design a simple probe that tests understanding of fusion risk tradeoffs.', tags: ['probe_design', 'risk'] },
    { id: 'Q071', prompt: 'Explain why offline-first tools matter for sovereign education.', tags: ['education', 'offline_first'] },
    { id: 'Q072', prompt: "Describe how a seed phrase backup can secure a student's academic ledger.", tags: ['security', 'identity'] },
    { id: 'Q073', prompt: 'List three failure modes for cloud-dependent universities.', tags: ['education', 'failure_modes'] },
    { id: 'Q074', prompt: 'Explain how deterministic verdicts differ from traditional grading.', tags: ['assessment', 'determinism'] },
    { id: 'Q075', prompt: "Design a rubric for evaluating a student's fusion deployment plan.", tags: ['assessment', 'rubric'] },
    { id: 'Q076', prompt: "Describe how students could earn 'deployment credits' instead of grades.", tags: ['assessment', 'credits'] },
    { id: 'Q077', prompt: 'Explain how WebLLM at temp=0 changes the nature of exam questions.', tags: ['LLM', 'determinism'] },
    { id: 'Q078', prompt: 'Propose one way to detect reasoning shortcuts in drag-and-drop verdicts.', tags: ['quality', 'reasoning'] },
    { id: 'Q079', prompt: 'Describe how rollback of campus builds could be used pedagogically.', tags: ['infra', 'pedagogy'] },
    { id: 'Q080', prompt: 'Design a probe that tests whether a student understands infra vs. content.', tags: ['probe_design', 'infra'] },
    { id: 'Q081', prompt: 'Explain how fusion interacts with climate targets (1.5C, 2C).', tags: ['climate', 'fusion'] },
    { id: 'Q082', prompt: 'List three sectors beyond electricity that benefit from abundant fusion energy.', tags: ['sectors', 'abundance'] },
    { id: 'Q083', prompt: 'Describe a scenario where fusion enables radical water security.', tags: ['water', 'security'] },
    { id: 'Q084', prompt: 'Describe a scenario where fusion enables radical food security.', tags: ['agriculture', 'security'] },
    { id: 'Q085', prompt: "Explain 'Jevons paradox' and how it might apply to cheap fusion.", tags: ['economics', 'Jevons'] },
    { id: 'Q086', prompt: 'Propose one policy to avoid rebound effects from cheap energy.', tags: ['policy', 'rebound'] },
    { id: 'Q087', prompt: 'Describe how fusion could reshape urban design (density, transport, heat).', tags: ['urbanism', 'fusion'] },
    { id: 'Q088', prompt: "Explain why 'abundance' can be politically destabilizing.", tags: ['politics', 'abundance'] },
    { id: 'Q089', prompt: 'List three ethical questions raised by global fusion deployment.', tags: ['ethics', 'fusion'] },
    { id: 'Q090', prompt: 'Design a deliberative process for deciding fusion rollout priorities.', tags: ['governance', 'deliberation'] },
    { id: 'Q091', prompt: 'Explain how students in this major could directly influence real deployments.', tags: ['pathways', 'impact'] },
    { id: 'Q092', prompt: "Describe one concrete role: 'fusion deployment architect'.", tags: ['roles', 'career'] },
    { id: 'Q093', prompt: "Describe one concrete role: 'sovereign energy policy engineer'.", tags: ['roles', 'career'] },
    { id: 'Q094', prompt: 'Explain how their hash-chained work could become part of a hiring pipeline.', tags: ['credentials', 'hiring'] },
    { id: 'Q095', prompt: 'Design a degree certificate that references an IPFS hash chain.', tags: ['credentials', 'design'] },
    { id: 'Q096', prompt: 'List three signals that a student is ready to lead a fusion project.', tags: ['assessment', 'signals'] },
    { id: 'Q097', prompt: 'Describe how cross-major collaboration (energy + water + agriculture) could work.', tags: ['collaboration', 'majors'] },
    { id: 'Q098', prompt: "Explain how to extend this syllabus into a second-year 'deployment studio'.", tags: ['curriculum', 'studio'] },
    { id: 'Q099', prompt: 'Propose one capstone: design a fusion-enabled sovereign city energy plan.', tags: ['capstone', 'city'] },
    { id: 'Q100', prompt: 'Write a personal manifesto on why you care about energy sovereignty.', tags: ['reflection', 'manifesto'] },
  ],
};

const FUSION_SYLLABUS_JSON = JSON.stringify(FUSION_SYLLABUS);

const HYDRO_JSON = JSON.stringify({
  name: 'Hydro-Sovereignty L1',
  steps: [
    { id: 'SEDIMENTATION', question: 'Which force makes suspended particles settle in still water?' },
    { id: 'PATHOGEN', question: 'Which risk must a drinking-water system treat as adversarial?' },
  ],
});

// 1x1 transparent PNG base64
const ICON_192_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const ICON_512_B64 = ICON_192_B64;

// ========== CAMPUS HTML with deterministic onboarding + WebLLM judge ==========
const CAMPUS_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=yes">
  <title>OGEN U - Dialectic Campus</title>
  <link rel="manifest" href="/cdn/manifest.json">
  <link rel="apple-touch-icon" href="/cdn/icon-192.png">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <script src="https://cdn.tailwindcss.com"></script>
  <script type="importmap">
    {
      "imports": {
        "@mlc-ai/web-llm": "https://esm.run/@mlc-ai/web-llm"
      }
    }
  </script>
  <style>
    .panel { display: none; }
    .panel.active { display: block; }
    button, .tap-target { min-height: 48px; min-width: 48px; touch-action: manipulation; }
  </style>
</head>
<body class="bg-slate-950 text-white">

<!-- Onboarding overlay -->
<div id="onboardingOverlay" style="position:fixed; inset:0; background:#0f172a; z-index:100; overflow:auto; padding:20px;">
  <div class="max-w-xl mx-auto">
    <div id="screen_intent" class="bg-slate-800 p-6 rounded-lg">
      <h2 class="text-2xl font-bold mb-4">⚡ Enter Hypercube U</h2>
      <p class="mb-2">State the problem you are driven to solve:</p>
      <textarea id="intent_input" rows="4" class="w-full p-3 bg-slate-900 border border-slate-700 rounded"></textarea>
      <button onclick="processIntent()" class="mt-4 w-full bg-blue-600 p-3 rounded tap-target">Analyze</button>
    </div>
    <div id="intent_confirm" class="hidden bg-slate-800 p-6 rounded-lg">
      <p>Target: <span id="proposed_intent" class="text-blue-400 font-bold"></span></p>
      <button onclick="confirmIntent(true)" class="mt-4 w-full bg-green-700 p-3 rounded tap-target">✓ Yes</button>
      <button onclick="confirmIntent(false)" class="mt-2 w-full bg-red-700 p-3 rounded tap-target">✗ No</button>
    </div>
    <div id="probe_block" class="hidden bg-slate-800 p-6 rounded-lg">
      <p id="q_text" class="text-lg font-bold my-4"></p>
      <div id="choices_container" class="space-y-2"></div>
    </div>
  </div>
</div>

<!-- Main Campus UI -->
<div id="campusUI" style="display:none;">
  <header class="border-b border-slate-800 sticky top-0 bg-slate-950/95 backdrop-blur z-20">
    <nav class="max-w-6xl mx-auto px-4 py-3 flex flex-wrap justify-between items-center gap-2">
      <div class="text-xl font-bold">⚡ OGEN U</div>
      <div class="flex flex-wrap gap-2">
        <button id="btnVerdict" class="px-3 py-2 hover:text-blue-400">📐 Verdict Designer</button>
        <button id="btnUniversity" class="px-3 py-2 hover:text-blue-400">🎓 Degree Path</button>
        <button id="btnWord" class="px-3 py-2 hover:text-blue-400">📝 Word</button>
        <button id="btnImage" class="px-3 py-2 hover:text-blue-400">🖼️ Image</button>
        <button id="backupBtn" class="px-3 py-2 bg-slate-700 rounded">💾 Backup seed</button>
      </div>
    </nav>
  </header>
  <main class="max-w-6xl mx-auto px-4 py-6">
    <div id="verdictPanel" class="panel">
      <h2 class="text-3xl font-bold mb-4">📐 Verdict Designer</h2>
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div class="bg-slate-800 p-4 rounded-lg">
          <h3 class="text-xl font-semibold mb-3">Reasoning Blocks</h3>
          <div class="space-y-2">
            <button data-verdict="firstprinciples" class="w-full text-left px-3 py-2 bg-slate-700 rounded tap-target">🔍 FirstPrinciples</button>
            <button data-verdict="premortem" class="w-full text-left px-3 py-2 bg-slate-700 rounded tap-target">💀 PreMortem</button>
            <button data-verdict="inversion" class="w-full text-left px-3 py-2 bg-slate-700 rounded tap-target">🔄 Inversion</button>
            <button data-verdict="redteam" class="w-full text-left px-3 py-2 bg-slate-700 rounded tap-target">⚔️ RedTeam</button>
            <button data-verdict="secondorder" class="w-full text-left px-3 py-2 bg-slate-700 rounded tap-target">🌊 SecondOrder</button>
          </div>
          <hr class="my-4 border-slate-700">
          <button id="clearVerdicts" class="w-full px-3 py-2 bg-red-700 rounded tap-target">Clear</button>
          <button id="exportHypercase" class="w-full mt-2 px-3 py-2 bg-green-700 rounded tap-target">📦 Export .hypercase</button>
        </div>
        <div class="lg:col-span-2 bg-slate-800 p-4 rounded-lg">
          <div id="verdictCanvas" class="bg-white text-black rounded-lg p-4 min-h-[300px]"></div>
        </div>
      </div>
      <div class="mt-4 bg-slate-800 p-3 rounded">
        <p class="text-sm"><span class="font-bold">Judge preview:</span> <span id="judgePreview">No verdict yet</span></p>
      </div>
    </div>
    <div id="universityPanel" class="panel">
      <h2 class="text-3xl font-bold mb-4">🎓 Founding Major: Fusion & Energy Sovereignty</h2>
      <div class="bg-slate-800 p-6 rounded-lg">
        <p id="assignedTrack" class="text-blue-400 font-mono mb-4"></p>
        <p id="thesisReq" class="text-slate-300 mb-4"></p>
        <div class="bg-slate-900 border border-slate-700 rounded-lg p-4 mb-4">
          <p id="fusionQueryMeta" class="text-xs uppercase tracking-wide text-slate-400 mb-2"></p>
          <p id="fusionQueryPrompt" class="text-lg font-semibold"></p>
          <p id="fusionQueryTags" class="text-sm text-blue-300 mt-2"></p>
          <div class="flex flex-wrap gap-2 mt-4">
            <button id="prevFusionQuery" class="px-4 py-2 bg-slate-700 rounded tap-target">Previous Query</button>
            <button id="nextFusionQuery" class="px-4 py-2 bg-blue-600 rounded tap-target">Next Query</button>
            <button id="exportFusionSyllabus" class="px-4 py-2 bg-green-700 rounded tap-target">Export 100-Query JSON</button>
          </div>
        </div>
        <button id="enrollBtn" class="px-6 py-3 bg-green-600 rounded tap-target">✅ Start Verdict Studio</button>
      </div>
    </div>
    <div id="wordPanel" class="panel">
      <div class="bg-slate-800 p-4 rounded-lg">
        <div id="richEditor" contenteditable class="bg-black p-4 rounded min-h-[200px]"></div>
        <button id="saveWordDoc" class="mt-2 bg-blue-600 p-2 rounded">Save</button>
      </div>
    </div>
    <div id="imagePanel" class="panel">
      <div class="bg-slate-800 p-4 rounded-lg">
        <input type="file" id="imageUpload" accept="image/*">
        <canvas id="imageCanvas" class="mt-2 hidden" style="max-width:100%; border:1px solid #475569;"></canvas>
        <button id="downloadImage" class="mt-2 bg-blue-600 p-2 rounded">Download</button>
      </div>
    </div>
  </main>
</div>

<script type="module">
  import { CreateMLCEngine } from "@mlc-ai/web-llm";

  window.judgeEngine = null;
  window.judgeReady = false;
  window.lastJudgeResult = null;

  async function initJudge() {
    if (window.judgeEngine) return;
    const appConfig = {
      model_list: [
        {
          model: "https://huggingface.co/mlc-ai/Llama-3.2-1B-Instruct-q4f32_1-MLC/resolve/main/",
          model_id: "Llama-3.2-1B-Instruct-q4f32_1-MLC",
          model_lib_url: "/libs/llm.wasm"
        }
      ]
    };
    window.judgeEngine = await CreateMLCEngine(
      "Llama-3.2-1B-Instruct-q4f32_1-MLC",
      { appConfig, temperature: 0, seed: 42 }
    );
    window.judgeReady = true;
    console.log("Judge ready");
  }

  async function runJudge(verdictText) {
    if (!window.judgeReady) await initJudge();
    const prompt = 'You are a deterministic judge. Evaluate this verdict for reasoning quality. Output ONLY JSON: {"confidence":0.0-1.0, "contradictions":int, "redteam_score":0.0-1.0}. Verdict: ' + verdictText;
    const reply = await window.judgeEngine.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      seed: 42,
    });
    const content = reply.choices[0].message.content;
    try {
      return JSON.parse(content);
    } catch(e) {
      return { confidence: 0.5, contradictions: 1, redteam_score: 0.0 };
    }
  }

  window.runJudge = runJudge;
  window.initJudge = initJudge;
</script>

<script>
  // ---------- Deterministic Onboarding ----------
  const FUSION_SYLLABUS = ${FUSION_SYLLABUS_JSON};

  const ONBOARDING = {
    tracks: {
      fusion: {
        label: 'Fusion & Energy Sovereignty',
        thesis: 'Complete 100 fusion sovereignty verdicts. Judge average >0.85, contradictions <5%.',
        keywords: ['fusion', 'energy', 'power', 'grid', 'plasma', 'tokamak', 'stellarator', 'electricity', 'nuclear', 'sovereignty'],
      },
      energy: {
        label: 'Energy Sovereignty Foundations',
        thesis: 'Complete the 100-query founding syllabus and produce a sovereign deployment plan.',
        keywords: ['water', 'health', 'agriculture', 'city', 'industry', 'climate', 'storage', 'desalination'],
      },
    },
    probes: [
      {
        step: 'ENERGY_SOVEREIGNTY',
        text: 'What is the core aim of energy sovereignty?',
        choices: [
          { id: 'A', label: 'A polity can secure reliable power without coercive dependency.', score: { sovereignty: 2 } },
          { id: 'B', label: 'One vendor controls generation, fuel, and pricing.', score: { sovereignty: -2 } },
          { id: 'C', label: 'Energy policy is only a household budgeting problem.', score: { sovereignty: -1 } },
        ],
      },
      {
        step: 'FUSION_FOUNDATIONS',
        text: 'Which claim best separates fusion from conventional combustion?',
        choices: [
          { id: 'A', label: 'Fusion releases nuclear binding energy by combining light nuclei.', score: { fusion: 2 } },
          { id: 'B', label: 'Fusion burns hydrocarbons more efficiently.', score: { fusion: -2 } },
          { id: 'C', label: 'Fusion is just a larger battery.', score: { fusion: -1 } },
        ],
      },
      {
        step: 'GRID_DEPLOYMENT',
        text: 'Why does grid integration matter even if fusion becomes technically viable?',
        choices: [
          { id: 'A', label: 'Firm power still needs transmission, services, financing, and public legitimacy.', score: { deployment: 2 } },
          { id: 'B', label: 'A reactor automatically solves every grid bottleneck.', score: { deployment: -2 } },
          { id: 'C', label: 'Deployment is unrelated to politics or supply chains.', score: { deployment: -1 } },
        ],
      },
    ],
  };

  let onboardingState = {
    intent: '',
    proposedTrack: ONBOARDING.tracks.fusion.label,
    probeIndex: 0,
    scores: {},
    ledger: JSON.parse(localStorage.getItem('ogen_ledger') || '[]'),
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function getLastHash() {
    if (!onboardingState.ledger.length) return 'GENESIS';
    return onboardingState.ledger[onboardingState.ledger.length - 1].hash;
  }

  async function browserSha256(value) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function appendLedger(entry) {
    const unsigned = Object.assign({}, entry, {
      ts: Date.now(),
      prev_hash: getLastHash(),
    });
    unsigned.hash = await browserSha256(JSON.stringify(unsigned));
    onboardingState.ledger.push(unsigned);
    localStorage.setItem('ogen_ledger', JSON.stringify(onboardingState.ledger));
    return unsigned;
  }

  function inferTrack(intent) {
    const text = intent.toLowerCase();
    const fusionHits = ONBOARDING.tracks.fusion.keywords.filter(word => text.includes(word)).length;
    const energyHits = ONBOARDING.tracks.energy.keywords.filter(word => text.includes(word)).length;
    return fusionHits >= energyHits ? ONBOARDING.tracks.fusion.label : ONBOARDING.tracks.energy.label;
  }

  async function processIntent() {
    const intent = byId('intent_input').value.trim();
    if (!intent) {
      alert('State the problem first.');
      return;
    }
    onboardingState.intent = intent;
    onboardingState.proposedTrack = inferTrack(intent);
    await appendLedger({ type: 'intent', text: intent, proposed_track: onboardingState.proposedTrack });
    byId('proposed_intent').innerText = onboardingState.proposedTrack;
    byId('screen_intent').classList.add('hidden');
    byId('intent_confirm').classList.remove('hidden');
  }

  async function confirmIntent(accepted) {
    await appendLedger({ type: 'intent_confirm', accepted, track: onboardingState.proposedTrack });
    if (!accepted) {
      byId('intent_confirm').classList.add('hidden');
      byId('screen_intent').classList.remove('hidden');
      return;
    }
    byId('intent_confirm').classList.add('hidden');
    byId('probe_block').classList.remove('hidden');
    renderProbe();
  }

  function renderProbe() {
    const probe = ONBOARDING.probes[onboardingState.probeIndex];
    if (!probe) {
      finalizeOnboarding();
      return;
    }
    byId('q_text').innerText = probe.text;
    const container = byId('choices_container');
    container.innerHTML = '';
    probe.choices.forEach(choice => {
      const button = document.createElement('button');
      button.className = 'w-full text-left p-3 bg-slate-700 rounded tap-target';
      button.innerText = choice.id + '. ' + choice.label;
      button.onclick = () => selectProbeChoice(probe, choice);
      container.appendChild(button);
    });
  }

  async function selectProbeChoice(probe, choice) {
    Object.entries(choice.score).forEach(([key, value]) => {
      onboardingState.scores[key] = (onboardingState.scores[key] || 0) + value;
    });
    await appendLedger({
      type: 'probe',
      step: probe.step,
      choice: choice.id,
      scores: Object.assign({}, onboardingState.scores),
    });
    onboardingState.probeIndex += 1;
    renderProbe();
  }

  async function finalizeOnboarding() {
    const track = (onboardingState.scores.fusion || 0) >= 2 && (onboardingState.scores.deployment || 0) >= 2
      ? ONBOARDING.tracks.fusion.label
      : onboardingState.proposedTrack;
    const thesis = track === ONBOARDING.tracks.fusion.label
      ? ONBOARDING.tracks.fusion.thesis
      : ONBOARDING.tracks.energy.thesis;
    await appendLedger({ type: 'final', track, scores: Object.assign({}, onboardingState.scores) });
    localStorage.setItem('ogen_track', track);
    localStorage.setItem('ogen_thesis', thesis);
    localStorage.setItem('ogen_onboarded', 'true');
    localStorage.setItem('ogen_student_hash', await browserSha256(onboardingState.intent + ':' + getLastHash()));
    showCampus(track, thesis);
  }

  function showCampus(track, thesis) {
    byId('onboardingOverlay').style.display = 'none';
    byId('campusUI').style.display = 'block';
    byId('assignedTrack').innerText = track || localStorage.getItem('ogen_track') || ONBOARDING.tracks.fusion.label;
    byId('thesisReq').innerText = thesis || localStorage.getItem('ogen_thesis') || ONBOARDING.tracks.fusion.thesis;
    renderFusionQuery();
    showPanel('verdict');
  }

  let fusionQueryIndex = Number(localStorage.getItem('ogen_fusion_query_index') || '0');

  function clampFusionQueryIndex(index) {
    return Math.max(0, Math.min(FUSION_SYLLABUS.queries.length - 1, index));
  }

  function renderFusionQuery() {
    fusionQueryIndex = clampFusionQueryIndex(fusionQueryIndex);
    const query = FUSION_SYLLABUS.queries[fusionQueryIndex];
    if (!query || !byId('fusionQueryPrompt')) return;
    byId('fusionQueryMeta').innerText = FUSION_SYLLABUS.title + ' - ' + query.id + ' of ' + FUSION_SYLLABUS.queries.length;
    byId('fusionQueryPrompt').innerText = query.prompt;
    byId('fusionQueryTags').innerText = 'Tags: ' + query.tags.join(', ');
    localStorage.setItem('ogen_fusion_query_index', String(fusionQueryIndex));
  }

  function moveFusionQuery(delta) {
    fusionQueryIndex = clampFusionQueryIndex(fusionQueryIndex + delta);
    renderFusionQuery();
  }

  function exportFusionSyllabus() {
    const blob = new Blob([JSON.stringify(FUSION_SYLLABUS, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = FUSION_SYLLABUS.presetId + '.json';
    a.click();
  }

  window.processIntent = processIntent;
  window.confirmIntent = confirmIntent;

  // ---------- Verdict Designer with deterministic Judge ----------
  let verdicts = [];
  const canvasDiv = document.getElementById('verdictCanvas');
  function renderVerdicts() {
    canvasDiv.innerHTML = verdicts.length ? '' : '<div class="text-gray-400 text-center py-10">Tap a block to add</div>';
    verdicts.forEach((v, i) => {
      let div = document.createElement('div');
      div.className = 'bg-gray-100 p-2 rounded relative mb-2';
      div.innerHTML = '<b>' + v.type + '</b><br>' + v.content + '<button class="absolute top-1 right-1 bg-red-500 text-white w-6 h-6 rounded-full">✕</button>';
      div.querySelector('button').onclick = () => { verdicts.splice(i,1); renderVerdicts(); updateJudge(); };
      canvasDiv.appendChild(div);
    });
  }

  function addVerdict(type) {
    let def = { firstprinciples:'Core axioms', premortem:'1. Failure mode A', inversion:'To not fail, do X', redteam:'Attack: your solution fails because...', secondorder:'Unintended consequence: ...' };
    verdicts.push({ type, content: def[type] || 'Add reasoning' });
    renderVerdicts();
    updateJudge();
  }

  async function updateJudge() {
    if (!verdicts.length) {
      document.getElementById('judgePreview').innerText = 'No verdict yet';
      return;
    }
    const verdictText = verdicts.map(v => v.type + ': ' + v.content).join('\\n');
    document.getElementById('judgePreview').innerText = 'Judge thinking...';
    try {
      const result = await window.runJudge(verdictText);
      window.lastJudgeResult = result;
      document.getElementById('judgePreview').innerHTML = 'Judge: confidence ' + result.confidence + ', contradictions ' + result.contradictions + ', redteam ' + result.redteam_score;
    } catch(e) {
      document.getElementById('judgePreview').innerHTML = 'Judge error: ' + e.message;
    }
  }

  document.querySelectorAll('[data-verdict]').forEach(btn => btn.onclick = () => addVerdict(btn.getAttribute('data-verdict')));
  document.getElementById('clearVerdicts').onclick = () => { verdicts = []; renderVerdicts(); updateJudge(); };
  document.getElementById('exportHypercase').onclick = () => {
    const hypercase = {
      timestamp: Date.now(),
      verdicts: verdicts,
      judge: window.lastJudgeResult || null,
      studentHash: localStorage.getItem('ogen_student_hash') || 'anonymous',
    };
    const blob = new Blob([JSON.stringify(hypercase, null, 2)], {type: 'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'hypercase_' + Date.now() + '.json';
    a.click();
    let legacy = JSON.parse(localStorage.getItem('ogen_legacy_hall') || '[]');
    legacy.push(hypercase);
    localStorage.setItem('ogen_legacy_hall', JSON.stringify(legacy));
    alert('Verdict saved with Judge score.');
  };
  document.getElementById('backupBtn').onclick = () => {
    let data = btoa(JSON.stringify({ ledger: JSON.parse(localStorage.getItem('ogen_ledger')||'[]'), track: localStorage.getItem('ogen_track') }));
    let seed = data.match(/.{1,4}/g).slice(0,12).join(' ');
    alert('Recovery seed:\\n' + seed);
  };
  function showPanel(name) { document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active')); document.getElementById(name+'Panel').classList.add('active'); }
  document.getElementById('btnVerdict').onclick = () => showPanel('verdict');
  document.getElementById('btnUniversity').onclick = () => showPanel('university');
  document.getElementById('btnWord').onclick = () => showPanel('word');
  document.getElementById('btnImage').onclick = () => showPanel('image');
  document.getElementById('enrollBtn').onclick = () => showPanel('verdict');
  document.getElementById('prevFusionQuery').onclick = () => moveFusionQuery(-1);
  document.getElementById('nextFusionQuery').onclick = () => moveFusionQuery(1);
  document.getElementById('exportFusionSyllabus').onclick = exportFusionSyllabus;

  // Fixed image upload & download
  document.getElementById('imageUpload').onchange = e => {
    let img = new Image();
    img.src = URL.createObjectURL(e.target.files[0]);
    img.onload = () => {
      let canvas = document.getElementById('imageCanvas');
      canvas.width = img.width;
      canvas.height = img.height;
      canvas.getContext('2d').drawImage(img, 0, 0);
      canvas.classList.remove('hidden');
    };
  };
  document.getElementById('downloadImage').onclick = () => {
    let canvas = document.getElementById('imageCanvas');
    if (canvas.width) {
      let a = document.createElement('a');
      a.href = canvas.toDataURL();
      a.download = 'ogen_image.png';
      a.click();
    }
  };
  document.getElementById('saveWordDoc').onclick = () => {
    let blob = new Blob([document.getElementById('richEditor').innerHTML], {type:'text/html'});
    let a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'ogen_doc.html';
    a.click();
  };

  // Restore onboarding state if already completed
  if (localStorage.getItem('ogen_onboarded') === 'true') {
    showCampus(localStorage.getItem('ogen_track') || ONBOARDING.tracks.fusion.label, localStorage.getItem('ogen_thesis') || ONBOARDING.tracks.fusion.thesis);
  } else {
    renderVerdicts();
  }

  // Preload Judge in background
  if (window.initJudge) window.initJudge().catch(error => console.warn('Judge preload failed:', error));

  // Service worker registration
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/cdn/sw.js');
</script>
</body>
</html>`;

const fallbackKv = new Map();

function validateDeployAuth(env, token, ts) {
  if (token !== env.DEPLOY_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  if (typeof ts !== 'number' || Date.now() - ts > 300000 || ts - Date.now() > 300000) {
    return new Response('Expired (older than 5 minutes)', { status: 401 });
  }

  return null;
}

async function kvGet(env, key) {
  if (env.KV) return env.KV.get(key);
  return fallbackKv.get(key) || null;
}

async function kvPut(env, key, value) {
  if (env.KV) {
    await env.KV.put(key, value);
    return;
  }
  fallbackKv.set(key, value);
}

function htmlResponse(html) {
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache',
    },
  });
}

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...(init.headers || {}),
    },
  });
}

// Helper
async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
