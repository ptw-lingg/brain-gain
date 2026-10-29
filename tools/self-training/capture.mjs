// Captures the screenshots the self-training slide decks embed — once per UI language. Boots an
// ISOLATED BrainGain instance (fresh temp data dir → seed.ts demo data, like the e2e global-setup),
// seeds the trainee training with the current deck PDFs (EN + DE variants), then walks the learner
// and trainer flows in headless Edge with an en-US and a de-DE browser context and writes PNGs into
// ./shots/<locale>/. Never touches the tracked backend/src/data.
//
//   node tools/self-training/capture.mjs [--no-build]
//
// --no-build skips the SPA build (frontend/dist must be current).

import { spawn, execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { LOCALES, TRAINEE } from './content.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const frontendRoot = join(root, 'frontend');
const backendRoot = join(root, 'backend');
const shotsRoot = join(here, 'shots');
const outDir = join(here, 'out');

const require = createRequire(join(frontendRoot, 'package.json'));
const pw = await import(pathToFileURL(require.resolve('@playwright/test')).href);
const chromium = pw.chromium ?? pw.default?.chromium;
const { buildScorm12 } = await import(pathToFileURL(join(backendRoot, 'tests', 'helpers', 'scormFixture.mjs')).href);

// The app's own UI strings, so locators follow the language under test.
const MESSAGES = Object.fromEntries(
  LOCALES.map((l) => [l, JSON.parse(readFileSync(join(frontendRoot, 'src', 'i18n', 'locales', `${l}.json`), 'utf-8'))]),
);
const BROWSER_LOCALE = { en: 'en-US', de: 'de-DE' };

const HTTPS_PORT = 4553;
const HTTP_PORT = 4552;
const SCORM_PORT = 4554;
const base = `https://localhost:${HTTPS_PORT}`;
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const CREDS = {
  admin: { email: 'admin@braingain.app', password: 'admin123' },
  trainer: { email: 'trainer@braingain.app', password: 'trainer123' },
  member: { email: 'user@braingain.app', password: 'user123' },
};

// German names for the seeded demo trainings, so German screenshots read German.
const SEEDED_DE = {
  'Laboratory Safety Basics': { name: 'Grundlagen Laborsicherheit', description: 'Grundlegende Sicherheitsregeln für die Arbeit im Dosimetrielabor.' },
  'Quality Management Intro': { name: 'Einführung Qualitätsmanagement', description: 'Einführung in die ISO-Qualitätsprozesse des Unternehmens.' },
};
const SCORM_DEMO = {
  name: { en: 'Dosimetry Basics (SCORM course)', de: 'Grundlagen der Dosimetrie (SCORM-Kurs)' },
  description: { en: 'Interactive course exported from Articulate Storyline.', de: 'Interaktiver Kurs, exportiert aus Articulate Storyline.' },
  category: { en: 'Physics', de: 'Physik' },
};

// ── backend ──────────────────────────────────────────────────────────────────────────────────────
if (!process.argv.includes('--no-build')) {
  console.log('[capture] building the SPA…');
  execSync('npx vite build', { cwd: frontendRoot, stdio: 'inherit' });
}
const dataDir = mkdtempSync(join(tmpdir(), 'bg-shots-'));
const proc = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
  cwd: backendRoot,
  env: {
    ...process.env,
    DATA_DIR: dataDir,
    HTTPS_PORT: String(HTTPS_PORT),
    HTTP_PORT: String(HTTP_PORT),
    SCORM_CONTENT_PORT: String(SCORM_PORT),
    APP_ORIGIN: base,
    JWT_SECRET: 'shots-secret',
  },
  stdio: 'pipe',
});
let log = '';
proc.stdout?.on('data', (d) => (log += d));
proc.stderr?.on('data', (d) => (log += d));
const cleanup = () => {
  try { proc.kill(); } catch { /* gone */ }
  try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* best effort */ }
};
process.on('exit', cleanup);

const deadline = Date.now() + 60_000;
let ready = false;
while (Date.now() < deadline) {
  if (proc.exitCode !== null) throw new Error(`[capture] backend exited early:\n${log}`);
  try {
    if ((await fetch(`${base}/api/health`)).ok) { ready = true; break; }
  } catch { /* not up yet */ }
  await sleep(300);
}
if (!ready) throw new Error(`[capture] backend not ready:\n${log}`);
console.log(`[capture] backend ready at ${base}`);

// ── API helpers ──────────────────────────────────────────────────────────────────────────────────
async function api(method, path, token, body, contentType = 'application/json') {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'content-type': contentType },
    body: body === undefined ? undefined : contentType === 'application/json' ? JSON.stringify(body) : body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}
const tokenFor = async (creds) => (await api('POST', '/auth/login', null, creds)).token;

const adminToken = await tokenFor(CREDS.admin);
const trainerToken = await tokenFor(CREDS.trainer);

const browser = await chromium.launch({ channel: 'msedge', headless: true });

// The trainee deck PDFs (previous render) are the material of the seeded trainee training — so the
// viewer screenshot shows the real slides. First run: a one-page stand-in.
mkdirSync(outDir, { recursive: true });
async function uploadDeck(locale) {
  let pdfPath = join(outDir, TRAINEE.pdf[locale]);
  if (!existsSync(pdfPath)) {
    const p = await browser.newPage();
    await p.setContent(`<html><body style="font-family:sans-serif;padding:80px"><h1>${TRAINEE.name[locale]}</h1><p>Slides are rendered on the next build.</p></body></html>`);
    pdfPath = join(outDir, `stand-in.${locale}.pdf`);
    await p.pdf({ path: pdfPath, width: '13.333in', height: '7.5in' });
    await p.close();
  }
  return api(
    'POST',
    `/trainings/materials?name=${encodeURIComponent(TRAINEE.pdf[locale])}&type=application/pdf`,
    trainerToken,
    readFileSync(pdfPath),
    'application/pdf',
  );
}
const variants = [];
for (const locale of LOCALES) {
  variants.push({ locale, label: TRAINEE.materialLabel[locale], file: await uploadDeck(locale) });
}

// The trainee training, published as v1 and required by the seeded "Lab Technician" role so the
// seeded member sees it.
const traineeTraining = await api('POST', '/trainings', trainerToken, {
  name: TRAINEE.name,
  description: TRAINEE.description,
  category: TRAINEE.category,
  durationMinutes: TRAINEE.durationMinutes,
  cycleYears: TRAINEE.cycleYears,
  windowBeforeMonths: TRAINEE.windowBeforeMonths,
  windowAfterMonths: TRAINEE.windowAfterMonths,
  materials: [{ variants }],
  questions: TRAINEE.questions,
  assignment: { everyone: true, orgUnits: [] },
});
await api('POST', `/trainings/${traineeTraining.id}/publish-update`, trainerToken, { kind: 'silent' });
const roles = await api('GET', '/roles', adminToken);
const labRole = roles.find((r) => r.name === 'Lab Technician');
await api('PUT', `/roles/${labRole.id}`, adminToken, { ...labRole, trainingIds: [...labRole.trainingIds, traineeTraining.id] });

// German names for the seeded trainings; a staged draft on the QM training → the "Draft" pill and
// the publish dialog.
const all = await api('GET', '/trainings', trainerToken);
const lab = all.find((t) => t.name.en === 'Laboratory Safety Basics');
const qm = all.find((t) => t.name.en === 'Quality Management Intro');
await api('PUT', `/trainings/${lab.id}`, trainerToken, {
  ...lab,
  name: { ...lab.name, de: SEEDED_DE[lab.name.en].name },
  description: { ...lab.description, de: SEEDED_DE[lab.name.en].description },
});
await api('PUT', `/trainings/${qm.id}`, trainerToken, {
  ...qm,
  name: { ...qm.name, de: SEEDED_DE[qm.name.en].name },
  description: { ...qm.description, de: SEEDED_DE[qm.name.en].description },
  questions: [
    ...qm.questions,
    {
      text: { en: 'Which document describes the company’s quality processes?', de: 'Welches Dokument beschreibt die Qualitätsprozesse des Unternehmens?' },
      options: [{ en: 'The QM Handbook', de: 'Das QM-Handbuch' }, { en: 'The phone book', de: 'Das Telefonbuch' }, { en: 'The cafeteria menu', de: 'Der Kantinenplan' }],
      correctIndices: [0],
      type: 'single',
    },
  ],
});
// Saving Lab Safety's master data must not leave it with a draft (it is the "clean" seeded one).
await api('DELETE', `/trainings/${lab.id}/draft`, trainerToken).catch(() => {});

// An unpublished SCORM-backed training → the SCORM section with its manifest card.
const pkgBytes = await buildScorm12({ masteryScore: 80, extraFiles: { 'js/app.js': '// app', 'css/app.css': '/* app */' } });
const pkg = await api('POST', '/trainings/scorm-packages?name=Dosimetry-Basics-SCORM12.zip', trainerToken, pkgBytes, 'application/octet-stream');
await api('POST', '/trainings', trainerToken, {
  ...SCORM_DEMO,
  durationMinutes: 45,
  cycleYears: 2,
  windowBeforeMonths: 1,
  windowAfterMonths: 1,
  scormPackageId: pkg.packageId,
});

// ── browser ──────────────────────────────────────────────────────────────────────────────────────
const settle = (page, ms = 400) => page.waitForTimeout(ms);

async function loginUi(page, creds) {
  await page.goto('/login');
  await page.fill('input[type="email"]', creds.email);
  await page.fill('input[type="password"]', creds.password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard');
  await settle(page);
}

async function captureLocale(locale) {
  const shotsDir = join(shotsRoot, locale);
  mkdirSync(shotsDir, { recursive: true });
  const shot = (page, name) => page.screenshot({ path: join(shotsDir, `${name}.png`) });
  const newContext = () => browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1.5,
    ignoreHTTPSErrors: true,
    baseURL: base,
    locale: BROWSER_LOCALE[locale],
  });
  // UI string lookup by i18n key, e.g. L('trainingForm.sectionBasics').
  const L = (key) => key.split('.').reduce((o, k) => o?.[k], MESSAGES[locale]) ?? key;
  const seededName = (t) => (locale === 'de' ? SEEDED_DE[t.name.en].name : t.name.en);

  // Login page — with Microsoft sign-in active (the production setup) and the admin-only form.
  await api('PUT', '/settings', adminToken, {
    companyName: 'PTW-Freiburg GmbH',
    entra: { enabled: true, tenantId: '11111111-2222-3333-4444-555555555555', clientId: '66666666-7777-8888-9999-000000000000', allowedDomains: ['ptwdosimetry.com'] },
  });
  {
    const ctx = await newContext();
    const page = await ctx.newPage();
    await page.goto('/login');
    await page.getByTestId('sso-button').waitFor();
    await settle(page);
    await shot(page, 'login-sso');
    await page.getByTestId('login-break-glass').click();
    await page.getByTestId('login-form').waitFor();
    await settle(page);
    await shot(page, 'login-admin');
    await ctx.close();
  }
  await api('PUT', '/settings', adminToken, { entra: { enabled: false, tenantId: '', clientId: '', allowedDomains: [] } });

  // Learner flow.
  {
    const ctx = await newContext();
    const page = await ctx.newPage();
    await loginUi(page, CREDS.member);
    await shot(page, 'dashboard');
    await page.getByRole('button', { name: L('nav.userMenu') }).click();
    await settle(page);
    await shot(page, 'user-menu');
    await page.keyboard.press('Escape');

    await page.goto(`/session/${traineeTraining.id}`);
    await page.getByTestId('session-material').waitFor();
    await settle(page);
    await shot(page, 'session-material');

    await page.getByTestId('material-open').first().click();
    await page.getByTestId('content-viewer').waitFor();
    await page.getByTestId('viewer-pages').locator('img, canvas').first().waitFor({ timeout: 20_000 }).catch(() => {});
    await settle(page, 1500);
    await shot(page, 'viewer');
    await page.getByTestId('viewer-close').click();
    await settle(page);

    await page.getByTestId('session-start').click();
    await page.getByTestId('confirm-materials-dialog').waitFor();
    await settle(page);
    await shot(page, 'confirm-materials');
    await page.getByTestId('confirm-materials-ok').click();
    await page.getByTestId('session-quiz').waitFor();

    // The quiz is shot UNANSWERED — the slides must never show the answer key. Then every correct
    // option is ticked (by its text) so the result slide shows a pass.
    await settle(page);
    await shot(page, 'quiz');
    const quiz = page.getByTestId('session-quiz');
    for (const question of TRAINEE.questions) {
      for (const idx of question.correctIndices) {
        await quiz.getByText(question.options[idx][locale], { exact: true }).click();
      }
    }
    await page.getByRole('button', { name: L('session.submitTest') }).click();
    await page.getByTestId('signature-dialog').waitFor();
    await page.getByTestId('signature-password').fill(CREDS.member.password);
    await page.getByTestId('signature-ok').click();
    await page.getByTestId('session-result').waitFor();
    await settle(page);
    await shot(page, 'result');

    await page.goto('/dashboard');
    await settle(page, 800);
    await shot(page, 'dashboard-after');

    // The signature dialog is shot over the seeded Lab Safety quiz — never over the trainee quiz,
    // whose ticked answers would show through the backdrop.
    await page.goto(`/session/${lab.id}`);
    await page.getByTestId('session-start').click();
    await page.getByTestId('confirm-materials-ok').click();
    await page.getByTestId('session-quiz').waitFor();
    // Submit is enabled only once every question is answered — pick an option per seeded question
    // (the seeded options are English-only, so they read English in every language).
    for (const option of ['Ignore it', 'At home', 'Never']) {
      await page.getByTestId('session-quiz').getByText(option, { exact: true }).click();
    }
    await page.mouse.wheel(0, -10_000);
    await page.getByRole('button', { name: L('session.submitTest') }).click();
    await page.getByTestId('signature-dialog').waitFor();
    await settle(page);
    await shot(page, 'signature');
    await ctx.close();
  }

  // Trainer flow.
  {
    const ctx = await newContext();
    const page = await ctx.newPage();
    await loginUi(page, CREDS.trainer);
    await page.goto('/trainings');
    const addButton = page.getByRole('button', { name: L('trainings.add') });
    await addButton.waitFor();
    await settle(page, 800);
    await shot(page, 'trainings');

    await addButton.click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    await settle(page);
    await shot(page, 'editor-new');
    await dialog.getByRole('button', { name: L('common.cancel') }).click();
    await settle(page);

    // The trainee training: basics, schedule, materials, questions, versions.
    const section = (key) => dialog.getByRole('button', { name: L(key) });
    await page.getByText(TRAINEE.name[locale], { exact: true }).first().click();
    await dialog.waitFor();
    await settle(page);
    await shot(page, 'editor-basics');
    await section('trainingForm.sectionBasics').click();
    await section('trainingForm.sectionSchedule').click();
    await settle(page);
    await shot(page, 'editor-schedule');
    await section('trainingForm.sectionSchedule').click();
    await section('trainingForm.assignment.section').click();
    await settle(page);
    await shot(page, 'editor-assignment');
    await section('trainingForm.assignment.section').click();
    await section('trainingForm.material').click();
    await settle(page);
    await shot(page, 'editor-materials');
    await section('trainingForm.material').click();
    await section('trainingForm.questions').click();
    await settle(page);
    await shot(page, 'editor-questions');
    await page.getByTestId('manage-updates').click();
    await settle(page, 600);
    await shot(page, 'versions');
    await page.keyboard.press('Escape');
    await settle(page);
    await dialog.getByRole('button', { name: L('common.cancel') }).click().catch(() => {});
    await settle(page);

    // The seeded training with a staged draft: Versions → the publish dialog offers the draft.
    await page.getByText(seededName(qm), { exact: true }).first().click();
    await dialog.waitFor();
    await settle(page);
    await page.getByTestId('manage-updates').click();
    await page.getByTestId('publish-update-dialog').waitFor();
    await page.getByTestId('publish-kind-notify').check().catch(() => {});
    await settle(page);
    await shot(page, 'publish');
    await page.getByTestId('publish-update-skip').click();
    await settle(page);
    await dialog.getByRole('button', { name: L('common.cancel') }).click().catch(() => {});
    await settle(page);

    // The SCORM-backed training: content type + manifest card.
    await page.getByText(SCORM_DEMO.name[locale], { exact: true }).first().click();
    await dialog.waitFor();
    await settle(page);
    await section('trainingForm.sectionBasics').click();
    await section('trainingForm.scorm.section').click();
    await page.getByTestId('scorm-manifest-card').waitFor();
    await settle(page);
    await shot(page, 'editor-scorm');
    await dialog.getByRole('button', { name: L('common.cancel') }).click();
    await settle(page);

    await page.goto('/trainees');
    await settle(page, 800);
    await shot(page, 'trainees');
    await ctx.close();
  }

  // Admin: how trainings reach people.
  {
    const ctx = await newContext();
    const page = await ctx.newPage();
    await loginUi(page, CREDS.admin);
    await page.goto('/roles');
    await settle(page, 800);
    await shot(page, 'roles');
    await page.goto('/users');
    await settle(page, 800);
    await shot(page, 'users');
    await ctx.close();
  }
  console.log(`[capture] ${locale}: screenshots written to ${shotsDir}`);
}

// The member's pass in one language would show the trainee training green in the next — so every
// further language runs with a fresh member in the same role.
for (const locale of LOCALES) {
  if (locale !== LOCALES[0]) {
    // A fresh member for every further language, in the same role, so the dashboard starts "Due now".
    const created = await api('POST', '/users', adminToken, {
      name: locale === 'de' ? 'Ulla Nutzerin' : `Member ${locale}`,
      email: `member-${locale}@braingain.app`,
      password: CREDS.member.password,
      roleIds: [labRole.id],
      orgUnitId: (await api('GET', '/org-units', adminToken))[0]?.id,
      isAdmin: false,
      isTrainer: false,
    });
    CREDS.member = { email: created.email, password: CREDS.member.password };
  }
  await captureLocale(locale);
}

await browser.close();
cleanup();
