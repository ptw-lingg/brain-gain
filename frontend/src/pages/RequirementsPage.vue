<script setup lang="ts">
import { computed, ref } from 'vue';
import { Search, Link2, FileCode2, CheckCircle2, BookText, ClipboardCheck, ListOrdered } from 'lucide-vue-next';
import rawData from '@/data/requirements.generated.json';
import type { Requirement, RequirementsDoc, TestCase } from '@/types/requirements';

const data = rawData as unknown as RequirementsDoc;
const reqs = data.requirements;
const tests = data.tests ?? [];

type Item = Requirement | TestCase;
const isTest = (i: Item): i is TestCase => 'testType' in i;

const byId = new Map<string, Item>([...reqs, ...tests].map((i) => [i.id, i]));

// SR id → SYS ids that satisfy it
const satisfiedBy = new Map<string, string[]>();
for (const r of reqs)
  for (const l of r.links ?? [])
    if (l.type === 'derivedFrom') satisfiedBy.set(l.target, [...(satisfiedBy.get(l.target) ?? []), r.id]);
// SR id → VT ids that validate it
const validatedBy = new Map<string, string[]>();
for (const t of tests)
  for (const l of t.links ?? [])
    if (l.type === 'validates') validatedBy.set(l.target, [...(validatedBy.get(l.target) ?? []), t.id]);

const labelOf = (list: { id: string; label: string }[] | undefined, id?: string) =>
  list?.find((e) => e.id === id)?.label ?? id ?? '';
const priorityLabel = (id?: string) => labelOf(data.enums.priority, id);
const sourceLabel = (id?: string) => labelOf(data.enums.source, id);
const statusLabel = (id?: string) => labelOf(data.enums.status, id);
const testTypeLabel = (id?: string) => labelOf(data.enums.testType, id);
const methodLabel = (id?: string) => labelOf(data.enums.method, id);
const titleOf = (id: string) => byId.get(id)?.title ?? id;

const counts = computed(() => ({
  stakeholder: reqs.filter((r) => r.type === 'stakeholder').length,
  system: reqs.filter((r) => r.type === 'system').length,
  tests: tests.length,
}));

// ---- filters
const q = ref('');
const fType = ref<'all' | 'stakeholder' | 'system' | 'test'>('all');
const fStatus = ref('all');
const fPriority = ref('all');
const fCategory = ref('all');

const catOf = (i: Item) => (isTest(i) ? testTypeLabel(i.testType) : i.category);

const baseList = computed<Item[]>(() => {
  if (fType.value === 'test') return tests;
  if (fType.value === 'all') return [...reqs, ...tests];
  return reqs.filter((r) => r.type === fType.value);
});
const categories = computed(() => [...new Set(baseList.value.map(catOf))]);

const filtered = computed<Item[]>(() => {
  const needle = q.value.trim().toLowerCase();
  return baseList.value.filter((i) => {
    if (fCategory.value !== 'all' && catOf(i) !== fCategory.value) return false;
    if (fStatus.value !== 'all' && (isTest(i) || i.status !== fStatus.value)) return false;
    if (fPriority.value !== 'all' && (isTest(i) || i.priority !== fPriority.value)) return false;
    if (needle) {
      const extra = isTest(i) ? `${i.steps.join(' ')} ${i.expected}` : i.text;
      if (!`${i.id} ${i.title} ${extra}`.toLowerCase().includes(needle)) return false;
    }
    return true;
  });
});

// flat display rows so the template never touches union-only fields
interface Row {
  id: string;
  title: string;
  kind: 'requirement' | 'test';
  rtype?: string;
  priority?: string;
  status?: string;
  testType?: string;
}
const rows = computed<Row[]>(() =>
  filtered.value.map((i) =>
    isTest(i)
      ? { id: i.id, title: i.title, kind: 'test', testType: i.testType }
      : { id: i.id, title: i.title, kind: 'requirement', rtype: i.type, priority: i.priority, status: i.status },
  ),
);

const selectedId = ref<string>(reqs[0]?.id ?? '');
const selectedReq = computed<Requirement | undefined>(() => reqs.find((r) => r.id === selectedId.value));
const selectedTest = computed<TestCase | undefined>(() => tests.find((t) => t.id === selectedId.value));
const select = (id: string) => {
  if (byId.has(id)) selectedId.value = id;
};

const derivedFrom = (r: Requirement) =>
  (r.links ?? []).filter((l) => l.type === 'derivedFrom').map((l) => l.target);
const validatesOf = (t: TestCase) =>
  (t.links ?? []).filter((l) => l.type === 'validates').map((l) => l.target);

const statusClass = (status?: string) =>
  status === 'verified'
    ? 'bg-pastel-mint/60 text-emerald-700'
    : status === 'implemented'
      ? 'bg-pastel-sky/70 text-accent'
      : status === 'superseded'
        ? 'bg-rose-100 text-rose-600'
        : 'bg-pastel-slate/60 text-ink-muted';
const typeClass = (type?: string) =>
  type === 'stakeholder'
    ? 'bg-pastel-blue/50 text-ink'
    : type === 'system'
      ? 'bg-pastel-cyan/50 text-ink'
      : 'bg-pastel-mint/50 text-emerald-700'; // test
const testTypeClass = (tt?: string) =>
  tt === 'usability'
    ? 'bg-pastel-blue/50 text-ink'
    : tt === 'accessibility'
      ? 'bg-pastel-cyan/50 text-ink'
      : 'bg-pastel-slate/60 text-ink-muted';
</script>

<template>
  <div>
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="page-title">Requirements</h1>
        <p class="mt-1 font-mono text-xs text-ink-light">
          // {{ counts.stakeholder }} stakeholder · {{ counts.system }} system · {{ counts.tests }} validation
          tests · linked &amp; traceable
        </p>
      </div>
    </header>

    <!-- Filters -->
    <div class="mt-6 flex flex-wrap items-center gap-2">
      <div class="relative min-w-[200px] flex-1">
        <Search class="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-ink-light" />
        <input v-model="q" class="bg-input w-full !pl-9" placeholder="Search id, title, text…" />
      </div>
      <select v-model="fType" class="bg-input" @change="fCategory = 'all'">
        <option value="all">All types</option>
        <option value="stakeholder">Stakeholder</option>
        <option value="system">System</option>
        <option value="test">Validation tests</option>
      </select>
      <select v-model="fCategory" class="bg-input">
        <option value="all">All categories</option>
        <option v-for="c in categories" :key="c" :value="c">{{ c }}</option>
      </select>
      <select v-model="fStatus" class="bg-input">
        <option value="all">Any status</option>
        <option v-for="s in data.enums.status" :key="s.id" :value="s.id">{{ s.label }}</option>
      </select>
      <select v-model="fPriority" class="bg-input">
        <option value="all">Any priority</option>
        <option v-for="p in data.enums.priority" :key="p.id" :value="p.id">{{ p.label }}</option>
      </select>
    </div>

    <div class="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      <!-- List -->
      <div class="card max-h-[70vh] overflow-y-auto p-2">
        <p class="px-2 py-1 font-mono text-[11px] text-ink-light">{{ rows.length }} shown</p>
        <button
          v-for="r in rows"
          :key="r.id"
          class="flex w-full flex-col gap-1 rounded-lg px-3 py-2 text-left transition hover:bg-pastel-sky/20"
          :class="r.id === selectedId ? 'bg-pastel-sky/40' : ''"
          @click="select(r.id)"
        >
          <div class="flex items-center gap-2">
            <span class="font-mono text-xs font-semibold text-ink">{{ r.id }}</span>
            <span v-if="r.kind === 'requirement'" class="pill text-[10px]" :class="typeClass(r.rtype)">{{ r.rtype }}</span>
            <span v-else class="pill text-[10px]" :class="testTypeClass(r.testType)">{{ testTypeLabel(r.testType) }}</span>
            <span v-if="r.priority" class="pill bg-white text-[10px] text-ink-light">{{ r.priority }}</span>
            <span v-if="r.status" class="pill text-[10px]" :class="statusClass(r.status)">{{ statusLabel(r.status) }}</span>
          </div>
          <div class="text-sm font-medium text-ink">{{ r.title }}</div>
        </button>
        <p v-if="rows.length === 0" class="px-3 py-6 text-center font-mono text-xs text-ink-light">
          No items match.
        </p>
      </div>

      <!-- Detail: requirement -->
      <div v-if="selectedReq" class="card p-5">
        <div class="flex flex-wrap items-center gap-2">
          <span class="font-mono text-sm font-bold text-ink">{{ selectedReq.id }}</span>
          <span class="pill text-[10px]" :class="typeClass(selectedReq.type)">{{ selectedReq.type }}</span>
          <span class="pill text-[10px]" :class="statusClass(selectedReq.status)">{{ statusLabel(selectedReq.status) }}</span>
          <span v-if="selectedReq.priority" class="pill bg-white text-[10px] text-ink-light">
            priority {{ selectedReq.priority }} · {{ priorityLabel(selectedReq.priority) }}
          </span>
          <span class="pill bg-pastel-slate/50 text-[10px] text-ink-muted">{{ selectedReq.category }}</span>
        </div>

        <h2 class="mt-3 font-sans text-lg font-bold text-ink">{{ selectedReq.title }}</h2>
        <p class="mt-1 text-sm text-ink-muted">{{ selectedReq.text }}</p>

        <p v-if="selectedReq.source" class="mt-3 font-mono text-xs text-ink-light">
          source: {{ sourceLabel(selectedReq.source) }}<span v-if="selectedReq.sourceNote"> ({{ selectedReq.sourceNote }})</span>
        </p>

        <div v-if="derivedFrom(selectedReq).length" class="mt-4">
          <p class="trace-h"><Link2 class="h-3.5 w-3.5" /> Derived from</p>
          <div class="mt-1 flex flex-wrap gap-1.5">
            <button v-for="id in derivedFrom(selectedReq)" :key="id" class="trace-chip" @click="select(id)">
              {{ id }} · {{ titleOf(id) }}
            </button>
          </div>
        </div>

        <div v-if="(satisfiedBy.get(selectedReq.id) ?? []).length" class="mt-4">
          <p class="trace-h"><Link2 class="h-3.5 w-3.5" /> Satisfied by</p>
          <div class="mt-1 flex flex-wrap gap-1.5">
            <button v-for="id in satisfiedBy.get(selectedReq.id)" :key="id" class="trace-chip" @click="select(id)">
              {{ id }} · {{ titleOf(id) }}
            </button>
          </div>
        </div>

        <div v-if="(validatedBy.get(selectedReq.id) ?? []).length" class="mt-4">
          <p class="trace-h"><ClipboardCheck class="h-3.5 w-3.5" /> Validated by</p>
          <div class="mt-1 flex flex-wrap gap-1.5">
            <button v-for="id in validatedBy.get(selectedReq.id)" :key="id" class="trace-chip" @click="select(id)">
              {{ id }} · {{ titleOf(id) }}
            </button>
          </div>
        </div>

        <div v-if="(selectedReq.implementedBy ?? []).length" class="mt-4">
          <p class="trace-h"><FileCode2 class="h-3.5 w-3.5" /> Implemented by</p>
          <ul class="mt-1 flex flex-col gap-1">
            <li v-for="(c, i) in selectedReq.implementedBy" :key="i" class="font-mono text-xs text-ink-muted">
              <span class="text-ink">{{ c.path }}</span><span v-if="c.symbol"> · {{ c.symbol }}</span>
            </li>
          </ul>
        </div>

        <div v-if="(selectedReq.verifiedBy ?? []).length" class="mt-4">
          <p class="trace-h"><CheckCircle2 class="h-3.5 w-3.5" /> Verified by</p>
          <ul class="mt-1 flex flex-col gap-1">
            <li v-for="(v, i) in selectedReq.verifiedBy" :key="i" class="font-mono text-xs text-ink-muted">
              {{ v.method }}<span v-if="v.note"> — {{ v.note }}</span>
            </li>
          </ul>
        </div>

        <div v-if="(selectedReq.specRefs ?? []).length" class="mt-4">
          <p class="trace-h"><BookText class="h-3.5 w-3.5" /> Spec</p>
          <ul class="mt-1 flex flex-col gap-1">
            <li v-for="(s, i) in selectedReq.specRefs" :key="i" class="font-mono text-xs text-ink-muted">
              {{ s.doc }} › {{ s.section }}
            </li>
          </ul>
        </div>
      </div>

      <!-- Detail: validation test -->
      <div v-else-if="selectedTest" class="card p-5">
        <div class="flex flex-wrap items-center gap-2">
          <span class="font-mono text-sm font-bold text-ink">{{ selectedTest.id }}</span>
          <span class="pill text-[10px]" :class="testTypeClass(selectedTest.testType)">{{ testTypeLabel(selectedTest.testType) }}</span>
          <span class="pill bg-white text-[10px] text-ink-light">{{ methodLabel(selectedTest.method) }}</span>
        </div>

        <h2 class="mt-3 font-sans text-lg font-bold text-ink">{{ selectedTest.title }}</h2>

        <div class="mt-4">
          <p class="trace-h"><Link2 class="h-3.5 w-3.5" /> Validates</p>
          <div class="mt-1 flex flex-wrap gap-1.5">
            <button v-for="id in validatesOf(selectedTest)" :key="id" class="trace-chip" @click="select(id)">
              {{ id }} · {{ titleOf(id) }}
            </button>
          </div>
        </div>

        <p v-if="selectedTest.preconditions" class="mt-4 text-sm text-ink-muted">
          <span class="font-sans text-xs font-semibold text-ink-muted">Preconditions: </span>{{ selectedTest.preconditions }}
        </p>

        <div class="mt-4">
          <p class="trace-h"><ListOrdered class="h-3.5 w-3.5" /> Steps</p>
          <ol class="mt-1 list-decimal pl-5 text-sm text-ink-muted">
            <li v-for="(s, i) in selectedTest.steps" :key="i">{{ s }}</li>
          </ol>
        </div>

        <p class="mt-4 text-sm">
          <span class="font-sans text-xs font-semibold text-ink-muted">Expected: </span>
          <span class="text-ink-muted">{{ selectedTest.expected }}</span>
        </p>
        <p v-if="selectedTest.metric" class="mt-2 text-sm">
          <span class="font-sans text-xs font-semibold text-ink-muted">Acceptance metric: </span>
          <span class="text-ink-muted">{{ selectedTest.metric }}</span>
        </p>
      </div>
    </div>
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
