<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Search, Link2, FileCode2, CheckCircle2, ClipboardCheck, ListOrdered, FlaskConical, FileText, Download, X } from 'lucide-vue-next';
import rawData from '@/data/requirements.generated.json';
import rawResults from '@/data/test-results.generated.json';
import type { Requirement, RequirementsDoc, TestCase, TestCaseRecord, TestResultsDoc } from '@/types/requirements';
import type { TCreatedPdf } from 'pdfmake/interfaces';
import { buildDocument, DOC_CATALOG, DOC_GROUPS, type DocInfo, type DocKind } from '@/utils/dmsDocuments';
// pdfmake is heavy (~800 kB gzip) and only needed when a document is generated, so it is imported
// lazily — keeping it out of the initial app bundle (which is itself internal-only; see the router).

const { t } = useI18n();

const data = rawData as unknown as RequirementsDoc;
const results = rawResults as unknown as TestResultsDoc;
const reqs = data.requirements;
const tests = data.tests ?? []; // validation tests (VT)
const testCases = data.testCases ?? []; // concrete automated + manual test cases
const coverage = data.meta.coverage;
const iec = data.meta.iec62304;

// ---- controlled documents (preview inline, then download for the DMS)
const docGroups = DOC_GROUPS;
const docModal = ref<{ info: DocInfo } | null>(null);
const docBuilding = ref<DocKind | null>(null);
const previewPages = ref<string[]>([]); // PNG data URLs, one per rendered page
let currentPdf: TCreatedPdf | null = null;

async function openDocument(kind: DocKind): Promise<void> {
  docBuilding.value = kind;
  docModal.value = null;
  previewPages.value = [];
  const { def, info } = buildDocument(kind, data, results);
  const { createPdf } = await import('@/utils/pdf');
  currentPdf = createPdf(def);
  // Render the PDF to page images IN-APP (pdf.js) so the document is reviewed inline — no browser
  // download/save is needed just to preview it.
  const bytes = await (await currentPdf.getBlob()).arrayBuffer();
  const { renderPdfToImages } = await import('@/utils/pdfPreview');
  previewPages.value = await renderPdfToImages(bytes);
  docModal.value = { info };
  docBuilding.value = null;
}
// Download is a separate, explicit action reachable only from the open preview (view-before-download).
function downloadDocument(): void {
  if (currentPdf && docModal.value) currentPdf.download(docModal.value.info.fileName);
}
function closeDocument(): void {
  currentPdf = null;
  docModal.value = null;
  docBuilding.value = null;
  previewPages.value = [];
}
const fmtDate = (iso?: string | null) => (iso ? new Date(iso).toISOString().slice(0, 10) : null);

// ---- item model (requirements + validation tests + test cases) all searchable together
type Item = Requirement | TestCase | TestCaseRecord;
const isCase = (i: Item): i is TestCaseRecord => 'covers' in i;
const isVt = (i: Item): i is TestCase => 'testType' in i;
const titleFor = (i: Item) => (isCase(i) ? i.name : i.title);

const byId = new Map<string, { title: string }>([...reqs, ...tests].map((i) => [i.id, { title: i.title }]));
for (const c of testCases) byId.set(c.id, { title: c.name });
const titleOf = (id: string) => byId.get(id)?.title ?? id;

// id → test cases that cover it (reverse lookup)
const coveringCases = new Map<string, TestCaseRecord[]>();
for (const c of testCases) for (const id of c.covers ?? []) coveringCases.set(id, [...(coveringCases.get(id) ?? []), c]);
const casesFor = (id: string) => coveringCases.get(id) ?? [];

// SR id → SYS ids that satisfy it; SR id → VT ids that validate it
const satisfiedBy = new Map<string, string[]>();
const validatedBy = new Map<string, string[]>();
for (const r of reqs) for (const l of r.links ?? []) if (l.type === 'derivedFrom') satisfiedBy.set(l.target, [...(satisfiedBy.get(l.target) ?? []), r.id]);
for (const t of tests) for (const l of t.links ?? []) if (l.type === 'validates') validatedBy.set(l.target, [...(validatedBy.get(l.target) ?? []), t.id]);

const labelOf = (list: { id: string; label: string }[] | undefined, id?: string) => list?.find((e) => e.id === id)?.label ?? id ?? '';
const priorityLabel = (id?: string) => labelOf(data.enums.priority, id);
const sourceLabel = (id?: string) => labelOf(data.enums.source, id);
const statusLabel = (id?: string) => labelOf(data.enums.status, id);
const testTypeLabel = (id?: string) => labelOf(data.enums.testType, id);
const methodLabel = (id?: string) => labelOf(data.enums.method, id);

const counts = computed(() => ({
  stakeholder: reqs.filter((r) => r.type === 'stakeholder').length,
  system: reqs.filter((r) => r.type === 'system').length,
  tests: tests.length,
  cases: testCases.length,
}));

// ---- results
const resultOf = (id: string) => results.results?.[id];
const resultClass = (r?: string) =>
  r === 'pass' ? 'bg-pastel-mint/60 text-emerald-700' : r === 'fail' ? 'bg-rose-100 text-rose-600' : r === 'skip' ? 'bg-amber-100 text-amber-700' : 'bg-pastel-slate/50 text-ink-light';
const resultLabel = (r?: string) => r ?? t('requirements.notRun');

// ---- filters
const q = ref('');
const fType = ref<'all' | 'stakeholder' | 'system' | 'test' | 'case'>('all');
const fStatus = ref('all');
const fPriority = ref('all');
const fCategory = ref('all');

const catOf = (i: Item) => (isCase(i) ? i.kind : isVt(i) ? testTypeLabel(i.testType) : i.category);

const baseList = computed<Item[]>(() => {
  if (fType.value === 'test') return tests;
  if (fType.value === 'case') return testCases;
  if (fType.value === 'all') return [...reqs, ...tests, ...testCases];
  return reqs.filter((r) => r.type === fType.value);
});
const categories = computed(() => [...new Set(baseList.value.map(catOf))].sort((a, b) => a.localeCompare(b)));

const filtered = computed<Item[]>(() => {
  const needle = q.value.trim().toLowerCase();
  return baseList.value.filter((i) => {
    if (fCategory.value !== 'all' && catOf(i) !== fCategory.value) return false;
    if (fStatus.value !== 'all' && !(!isCase(i) && !isVt(i) && i.status === fStatus.value)) return false;
    if (fPriority.value !== 'all' && !(!isCase(i) && !isVt(i) && i.priority === fPriority.value)) return false;
    if (needle) {
      const extra = isCase(i) ? `${i.covers.join(' ')} ${i.manual?.expected ?? ''}` : isVt(i) ? `${i.steps.join(' ')} ${i.expected}` : i.text;
      if (!`${i.id} ${titleFor(i)} ${extra}`.toLowerCase().includes(needle)) return false;
    }
    return true;
  });
});

interface Row {
  id: string;
  title: string;
  kind: 'requirement' | 'test' | 'case';
  rtype?: string;
  priority?: string;
  status?: string;
  testType?: string;
  caseKind?: string;
  result?: string;
}
const rows = computed<Row[]>(() =>
  filtered.value.map((i) =>
    isCase(i)
      ? { id: i.id, title: i.name, kind: 'case', caseKind: i.kind, result: resultOf(i.id) }
      : isVt(i)
        ? { id: i.id, title: i.title, kind: 'test', testType: i.testType }
        : { id: i.id, title: i.title, kind: 'requirement', rtype: i.type, priority: i.priority, status: i.status },
  ),
);

const selectedId = ref<string>(reqs[0]?.id ?? '');
const selectedReq = computed<Requirement | undefined>(() => reqs.find((r) => r.id === selectedId.value));
const selectedTest = computed<TestCase | undefined>(() => tests.find((t) => t.id === selectedId.value));
const selectedCase = computed<TestCaseRecord | undefined>(() => testCases.find((c) => c.id === selectedId.value));
const select = (id: string) => { if (byId.has(id)) selectedId.value = id; };

const derivedFrom = (r: Requirement) => (r.links ?? []).filter((l) => l.type === 'derivedFrom').map((l) => l.target);
const validatesOf = (t: TestCase) => (t.links ?? []).filter((l) => l.type === 'validates').map((l) => l.target);

const statusClass = (status?: string) =>
  status === 'verified' ? 'bg-pastel-mint/60 text-emerald-700'
    : status === 'implemented' ? 'bg-pastel-sky/70 text-accent'
      : status === 'superseded' ? 'bg-rose-100 text-rose-600'
        : 'bg-pastel-slate/60 text-ink-muted';
const typeClass = (type?: string) =>
  type === 'stakeholder' ? 'bg-pastel-blue/50 text-ink' : type === 'system' ? 'bg-pastel-cyan/50 text-ink' : 'bg-pastel-mint/50 text-emerald-700';
const testTypeClass = (tt?: string) =>
  tt === 'usability' ? 'bg-pastel-blue/50 text-ink' : tt === 'accessibility' ? 'bg-pastel-cyan/50 text-ink' : 'bg-pastel-slate/60 text-ink-muted';
const testKindClass = (k?: string) =>
  k === 'backend' ? 'bg-pastel-cyan/60 text-ink' : k === 'e2e' ? 'bg-pastel-mint/60 text-emerald-700' : 'bg-pastel-slate/60 text-ink-muted';
</script>

<template>
  <div>
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="page-title">{{ t('requirements.title') }}</h1>
        <p class="mt-1 font-mono text-xs text-ink-light">
          {{ t('requirements.subtitle', { stakeholder: counts.stakeholder, system: counts.system, tests: counts.tests, cases: counts.cases }) }}
        </p>
      </div>
    </header>

    <!-- Coverage + safety class + controlled-document generation -->
    <div class="mt-4 card flex flex-wrap items-center gap-x-4 gap-y-3 p-4">
      <div class="flex flex-wrap items-center gap-2">
        <span v-if="iec" class="pill bg-accent-light/60 text-accent">{{ t('requirements.safetyClass', { class: iec.safetyClass }) }}</span>
        <span v-if="coverage" class="pill bg-pastel-mint/60 text-emerald-700">
          <CheckCircle2 class="h-3.5 w-3.5" /> {{ t('requirements.covered', { covered: coverage.covered, total: coverage.total }) }}
        </span>
        <span v-if="coverage" class="font-mono text-[11px] text-ink-light">
          {{ t('requirements.coverageBreakdown', { backend: coverage.backend, e2e: coverage.e2e, manual: coverage.manual }) }}
          <span :class="coverage.gaps.length ? 'text-amber-600' : 'text-emerald-700'">{{ t('requirements.gaps', { count: coverage.gaps.length }) }}</span>
        </span>
        <span v-if="results.summary" class="pill bg-pastel-sky/60 text-accent" :title="results.ranAt ? t('requirements.testsRunLabel') : t('requirements.testsRunHint')">
          {{ t('requirements.testsDate', { date: fmtDate(results.ranAt) ?? t('requirements.notRun') }) }}
          <template v-if="results.ranAt">
            · <span class="text-emerald-700">{{ results.summary.passed }}✓</span>
            <span :class="results.summary.failed ? 'text-rose-600' : ''"> {{ results.summary.failed }}✗</span>
          </template>
        </span>
      </div>
      <div class="flex-1" />
      <div class="flex flex-col gap-1.5">
        <div v-for="g in docGroups" :key="g.label" class="flex flex-wrap items-center gap-1.5">
          <span class="w-32 shrink-0 font-mono text-[10px] text-ink-light">{{ g.label }}</span>
          <button
            v-for="k in g.kinds"
            :key="k"
            class="btn-ghost !w-[4.5rem] !px-0 !py-1 !text-xs"
            :title="DOC_CATALOG[k].title + (DOC_CATALOG[k].clause ? ' · ' + DOC_CATALOG[k].clause : '')"
            :disabled="docBuilding !== null"
            @click="openDocument(k)"
          >
            <FileText class="h-3.5 w-3.5" /> {{ DOC_CATALOG[k].abbr }}<span v-if="docBuilding === k"> …</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Filters -->
    <div class="mt-6 flex flex-wrap items-center gap-2">
      <div class="relative min-w-[200px] flex-1">
        <Search class="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-ink-light" />
        <input v-model="q" class="bg-input w-full !pl-9" :placeholder="t('requirements.searchPlaceholder')" />
      </div>
      <select v-model="fType" class="bg-input" @change="fCategory = 'all'">
        <option value="all">{{ t('requirements.allTypes') }}</option>
        <option value="stakeholder">{{ t('requirements.stakeholder') }}</option>
        <option value="system">{{ t('requirements.system') }}</option>
        <option value="test">{{ t('requirements.validationTests') }}</option>
        <option value="case">{{ t('requirements.testCases') }}</option>
      </select>
      <select v-model="fCategory" class="bg-input">
        <option value="all">{{ t('requirements.allCategories') }}</option>
        <option v-for="c in categories" :key="c" :value="c">{{ c }}</option>
      </select>
      <select v-model="fStatus" class="bg-input">
        <option value="all">{{ t('requirements.anyStatus') }}</option>
        <option v-for="s in data.enums.status" :key="s.id" :value="s.id">{{ s.label }}</option>
      </select>
      <select v-model="fPriority" class="bg-input">
        <option value="all">{{ t('requirements.anyPriority') }}</option>
        <option v-for="p in data.enums.priority" :key="p.id" :value="p.id">{{ p.label }}</option>
      </select>
    </div>

    <div class="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      <!-- List -->
      <div class="card max-h-[70vh] overflow-y-auto p-2">
        <p class="px-2 py-1 font-mono text-[11px] text-ink-light">{{ t('requirements.shown', { count: rows.length }) }}</p>
        <button
          v-for="r in rows"
          :key="r.id"
          class="flex w-full flex-col gap-1 rounded-lg px-3 py-2 text-left transition hover:bg-pastel-sky/20"
          :class="r.id === selectedId ? 'bg-pastel-sky/40' : ''"
          @click="select(r.id)"
        >
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-mono text-xs font-semibold text-ink">{{ r.id }}</span>
            <span v-if="r.kind === 'requirement'" class="pill pill-col" :class="typeClass(r.rtype)">{{ r.rtype }}</span>
            <span v-else-if="r.kind === 'test'" class="pill pill-col" :class="testTypeClass(r.testType)">{{ testTypeLabel(r.testType) }}</span>
            <span v-else class="pill pill-col" :class="testKindClass(r.caseKind)">{{ r.caseKind }}</span>
            <span v-if="r.priority" class="pill min-w-[3rem] bg-white text-ink-light">{{ r.priority }}</span>
            <span v-if="r.status" class="pill pill-col" :class="statusClass(r.status)">{{ statusLabel(r.status) }}</span>
            <span v-if="r.kind === 'case'" class="pill min-w-[5rem]" :class="resultClass(r.result)">{{ resultLabel(r.result) }}</span>
          </div>
          <div class="text-sm font-medium text-ink">{{ r.title }}</div>
        </button>
        <p v-if="rows.length === 0" class="px-3 py-6 text-center font-mono text-xs text-ink-light">{{ t('requirements.noItems') }}</p>
      </div>

      <!-- Detail: requirement -->
      <div v-if="selectedReq" class="card p-5">
        <div class="flex flex-wrap items-center gap-2">
          <span class="font-mono text-sm font-bold text-ink">{{ selectedReq.id }}</span>
          <span class="pill" :class="typeClass(selectedReq.type)">{{ selectedReq.type }}</span>
          <span class="pill" :class="statusClass(selectedReq.status)">{{ statusLabel(selectedReq.status) }}</span>
          <span v-if="selectedReq.priority" class="pill bg-white text-ink-light">{{ t('requirements.priority', { p: selectedReq.priority, label: priorityLabel(selectedReq.priority) }) }}</span>
          <span class="pill bg-pastel-slate/50 text-ink-muted">{{ selectedReq.category }}</span>
        </div>
        <h2 class="mt-3 font-sans text-lg font-bold text-ink">{{ selectedReq.title }}</h2>
        <p class="mt-1 text-sm text-ink-muted">{{ selectedReq.text }}</p>
        <p v-if="selectedReq.source" class="mt-3 font-mono text-xs text-ink-light">
          {{ t('requirements.source', { source: sourceLabel(selectedReq.source) }) }}<span v-if="selectedReq.sourceNote"> ({{ selectedReq.sourceNote }})</span>
        </p>

        <div v-if="derivedFrom(selectedReq).length" class="mt-4">
          <p class="trace-h"><Link2 class="h-3.5 w-3.5" /> {{ t('requirements.derivedFrom') }}</p>
          <div class="mt-1 flex flex-wrap gap-1.5">
            <button v-for="id in derivedFrom(selectedReq)" :key="id" class="trace-chip" @click="select(id)">{{ id }} · {{ titleOf(id) }}</button>
          </div>
        </div>
        <div v-if="(satisfiedBy.get(selectedReq.id) ?? []).length" class="mt-4">
          <p class="trace-h"><Link2 class="h-3.5 w-3.5" /> {{ t('requirements.satisfiedBy') }}</p>
          <div class="mt-1 flex flex-wrap gap-1.5">
            <button v-for="id in satisfiedBy.get(selectedReq.id)" :key="id" class="trace-chip" @click="select(id)">{{ id }} · {{ titleOf(id) }}</button>
          </div>
        </div>
        <div v-if="(validatedBy.get(selectedReq.id) ?? []).length" class="mt-4">
          <p class="trace-h"><ClipboardCheck class="h-3.5 w-3.5" /> {{ t('requirements.validatedBy') }}</p>
          <div class="mt-1 flex flex-wrap gap-1.5">
            <button v-for="id in validatedBy.get(selectedReq.id)" :key="id" class="trace-chip" @click="select(id)">{{ id }} · {{ titleOf(id) }}</button>
          </div>
        </div>
        <div v-if="(selectedReq.implementedBy ?? []).length" class="mt-4">
          <p class="trace-h"><FileCode2 class="h-3.5 w-3.5" /> {{ t('requirements.implementedBy') }}</p>
          <ul class="mt-1 flex flex-col gap-1">
            <li v-for="(c, i) in selectedReq.implementedBy" :key="i" class="font-mono text-xs text-ink-muted">
              <span class="text-ink">{{ c.path }}</span><span v-if="c.symbol"> · {{ c.symbol }}</span>
            </li>
          </ul>
        </div>
        <div v-if="casesFor(selectedReq.id).length" class="mt-4">
          <p class="trace-h"><FlaskConical class="h-3.5 w-3.5" /> {{ t('requirements.testedBy') }}</p>
          <div class="mt-1 flex flex-col gap-1">
            <button v-for="c in casesFor(selectedReq.id)" :key="c.id" class="flex items-center gap-2 text-left" @click="select(c.id)">
              <span class="pill" :class="testKindClass(c.kind)">{{ c.kind }}</span>
              <span class="pill" :class="resultClass(resultOf(c.id))">{{ resultLabel(resultOf(c.id)) }}</span>
              <span class="font-mono text-[11px] text-ink-muted hover:text-accent">{{ c.name }}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Detail: validation test (VT) -->
      <div v-else-if="selectedTest" class="card p-5">
        <div class="flex flex-wrap items-center gap-2">
          <span class="font-mono text-sm font-bold text-ink">{{ selectedTest.id }}</span>
          <span class="pill" :class="testTypeClass(selectedTest.testType)">{{ testTypeLabel(selectedTest.testType) }}</span>
          <span class="pill bg-white text-ink-light">{{ methodLabel(selectedTest.method) }}</span>
          <span class="pill" :class="selectedTest.automated ? 'bg-pastel-mint/60 text-emerald-700' : 'bg-pastel-slate/60 text-ink-muted'">
            {{ selectedTest.automated ? t('requirements.automated') : t('requirements.manual') }}
          </span>
        </div>
        <h2 class="mt-3 font-sans text-lg font-bold text-ink">{{ selectedTest.title }}</h2>
        <div class="mt-4">
          <p class="trace-h"><Link2 class="h-3.5 w-3.5" /> {{ t('requirements.validates') }}</p>
          <div class="mt-1 flex flex-wrap gap-1.5">
            <button v-for="id in validatesOf(selectedTest)" :key="id" class="trace-chip" @click="select(id)">{{ id }} · {{ titleOf(id) }}</button>
          </div>
        </div>
        <p v-if="selectedTest.preconditions" class="mt-4 text-sm text-ink-muted">
          <span class="font-sans text-xs font-semibold text-ink-muted">{{ t('requirements.preconditions') }} </span>{{ selectedTest.preconditions }}
        </p>
        <div class="mt-4">
          <p class="trace-h"><ListOrdered class="h-3.5 w-3.5" /> {{ t('requirements.steps') }}</p>
          <ol class="mt-1 list-decimal pl-5 text-sm text-ink-muted"><li v-for="(s, i) in selectedTest.steps" :key="i">{{ s }}</li></ol>
        </div>
        <p class="mt-4 text-sm"><span class="font-sans text-xs font-semibold text-ink-muted">{{ t('requirements.expected') }} </span><span class="text-ink-muted">{{ selectedTest.expected }}</span></p>
        <p v-if="selectedTest.metric" class="mt-2 text-sm"><span class="font-sans text-xs font-semibold text-ink-muted">{{ t('requirements.acceptanceMetric') }} </span><span class="text-ink-muted">{{ selectedTest.metric }}</span></p>
        <div v-if="casesFor(selectedTest.id).length" class="mt-4">
          <p class="trace-h"><FlaskConical class="h-3.5 w-3.5" /> {{ t('requirements.testCasesSection') }}</p>
          <div class="mt-1 flex flex-col gap-1">
            <button v-for="c in casesFor(selectedTest.id)" :key="c.id" class="flex items-center gap-2 text-left" @click="select(c.id)">
              <span class="pill" :class="testKindClass(c.kind)">{{ c.kind }}</span>
              <span class="pill" :class="resultClass(resultOf(c.id))">{{ resultLabel(resultOf(c.id)) }}</span>
              <span class="font-mono text-[11px] text-ink-muted hover:text-accent">{{ c.name }}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Detail: test case -->
      <div v-else-if="selectedCase" class="card p-5">
        <div class="flex flex-wrap items-center gap-2">
          <span class="font-mono text-sm font-bold text-ink">{{ selectedCase.id }}</span>
          <span class="pill" :class="testKindClass(selectedCase.kind)">{{ selectedCase.kind }}</span>
          <span class="pill" :class="resultClass(resultOf(selectedCase.id))">{{ resultLabel(resultOf(selectedCase.id)) }}</span>
        </div>
        <h2 class="mt-3 font-sans text-base font-bold text-ink">{{ selectedCase.name }}</h2>
        <p v-if="selectedCase.file" class="mt-1 font-mono text-xs text-ink-light">{{ selectedCase.file }}</p>
        <div v-if="(selectedCase.covers ?? []).length" class="mt-4">
          <p class="trace-h"><Link2 class="h-3.5 w-3.5" /> {{ t('requirements.covers') }}</p>
          <div class="mt-1 flex flex-wrap gap-1.5">
            <button v-for="id in selectedCase.covers" :key="id" class="trace-chip" @click="select(id)">{{ id }} · {{ titleOf(id) }}</button>
          </div>
        </div>
        <template v-if="selectedCase.manual">
          <div class="mt-4">
            <p class="trace-h"><ListOrdered class="h-3.5 w-3.5" /> {{ t('requirements.manualProcedure') }}</p>
            <ol class="mt-1 list-decimal pl-5 text-sm text-ink-muted"><li v-for="(s, i) in selectedCase.manual.steps" :key="i">{{ s }}</li></ol>
          </div>
          <p class="mt-3 text-sm"><span class="font-sans text-xs font-semibold text-ink-muted">{{ t('requirements.expected') }} </span><span class="text-ink-muted">{{ selectedCase.manual.expected }}</span></p>
          <p v-if="selectedCase.manual.rationale" class="mt-2 font-mono text-[11px] text-ink-light">{{ t('requirements.whyManual', { reason: selectedCase.manual.rationale }) }}</p>
        </template>
      </div>
    </div>

    <!-- Controlled-document preview → gated download -->
    <Transition name="fade-slide">
      <div v-if="docModal || docBuilding" class="fixed inset-0 z-40 flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-ink/40" @click="closeDocument" />
        <div class="relative z-10 flex h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-lift">
          <div class="flex items-center justify-between border-b border-line px-5 py-3">
            <div>
              <h2 class="font-sans text-base font-bold text-ink">{{ docModal?.info.title ?? t('requirements.docGenerating') }}</h2>
              <p class="font-mono text-[11px] text-ink-light">
                <span v-if="docModal">{{ t('requirements.docPagesInfo', { docId: docModal.info.docId, pages: previewPages.length }) }}</span>
                <span v-else>{{ t('requirements.renderingPreview') }}</span>
              </p>
            </div>
            <div class="flex items-center gap-2">
              <button class="btn-primary !px-3 !py-1.5 !text-xs" :disabled="!docModal" @click="downloadDocument">
                <Download class="h-4 w-4" /> {{ t('requirements.downloadPdf') }}
              </button>
              <button class="text-ink-light hover:text-ink" :title="t('common.close')" @click="closeDocument"><X class="h-5 w-5" /></button>
            </div>
          </div>
          <div class="flex-1 overflow-y-auto bg-pastel-slate/20 p-4">
            <div v-if="docModal && previewPages.length" class="mx-auto flex max-w-3xl flex-col items-center gap-3">
              <img v-for="(p, i) in previewPages" :key="i" :src="p" data-pdf-page class="w-full rounded shadow-soft" :alt="t('requirements.pageAlt', { n: i + 1 })" />
            </div>
            <div v-else class="flex h-full items-center justify-center font-mono text-sm text-ink-light">{{ t('requirements.renderingPreview') }}</div>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.trace-h {
  @apply flex items-center gap-1.5 font-sans text-xs font-semibold text-ink-muted;
}
.trace-chip {
  @apply rounded-md border border-line bg-white px-2 py-1 font-mono text-[11px] text-ink-muted transition hover:border-accent hover:text-accent;
}
</style>
