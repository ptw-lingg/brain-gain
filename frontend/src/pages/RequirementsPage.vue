<script setup lang="ts">
import { computed, ref } from 'vue';
import { Search, Link2, FileCode2, CheckCircle2, BookText } from 'lucide-vue-next';
import rawData from '@/data/requirements.generated.json';
import type { Requirement, RequirementsDoc } from '@/types/requirements';

const data = rawData as unknown as RequirementsDoc;
const reqs = data.requirements;

const byId = new Map(reqs.map((r) => [r.id, r]));
// inverse of derivedFrom: stakeholder id → system ids that satisfy it
const satisfiedBy = new Map<string, string[]>();
for (const r of reqs) {
  for (const l of r.links ?? []) {
    if (l.type === 'derivedFrom') {
      const arr = satisfiedBy.get(l.target) ?? [];
      arr.push(r.id);
      satisfiedBy.set(l.target, arr);
    }
  }
}

const labelOf = (list: { id: string; label: string }[], id?: string) =>
  list.find((e) => e.id === id)?.label ?? id ?? '';
const priorityLabel = (id?: string) => labelOf(data.enums.priority, id);
const sourceLabel = (id?: string) => labelOf(data.enums.source, id);
const statusLabel = (id?: string) => labelOf(data.enums.status, id);

const counts = computed(() => ({
  stakeholder: reqs.filter((r) => r.type === 'stakeholder').length,
  system: reqs.filter((r) => r.type === 'system').length,
}));

// ---- filters
const q = ref('');
const fType = ref<'all' | 'stakeholder' | 'system'>('all');
const fStatus = ref('all');
const fPriority = ref('all');

const categories = computed(() => {
  const set = new Set(
    reqs.filter((r) => fType.value === 'all' || r.type === fType.value).map((r) => r.category),
  );
  return [...set];
});
const fCategory = ref('all');

const filtered = computed(() => {
  const needle = q.value.trim().toLowerCase();
  return reqs.filter((r) => {
    if (fType.value !== 'all' && r.type !== fType.value) return false;
    if (fCategory.value !== 'all' && r.category !== fCategory.value) return false;
    if (fStatus.value !== 'all' && r.status !== fStatus.value) return false;
    if (fPriority.value !== 'all' && r.priority !== fPriority.value) return false;
    if (needle) {
      const hay = `${r.id} ${r.title} ${r.text}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
});

const selectedId = ref<string>(reqs[0]?.id ?? '');
const selected = computed<Requirement | undefined>(() => byId.get(selectedId.value));
function select(id: string): void {
  if (byId.has(id)) selectedId.value = id;
}

const derivedFrom = (r: Requirement) =>
  (r.links ?? []).filter((l) => l.type === 'derivedFrom').map((l) => l.target);
const relatedTo = (r: Requirement) => {
  const out = new Set<string>();
  for (const l of r.links ?? []) if (l.type === 'relatedTo') out.add(l.target);
  for (const o of reqs)
    for (const l of o.links ?? []) if (l.type === 'relatedTo' && l.target === r.id) out.add(o.id);
  return [...out];
};

const statusClass = (status: string) =>
  status === 'verified'
    ? 'bg-pastel-mint/60 text-emerald-700'
    : status === 'implemented'
      ? 'bg-pastel-sky/70 text-accent'
      : status === 'superseded'
        ? 'bg-rose-100 text-rose-600'
        : 'bg-pastel-slate/60 text-ink-muted';
const typeClass = (type: string) =>
  type === 'stakeholder' ? 'bg-pastel-blue/50 text-ink' : 'bg-pastel-cyan/50 text-ink';
</script>

<template>
  <div>
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="page-title">Requirements</h1>
        <p class="mt-1 font-mono text-xs text-ink-light">
          // {{ counts.stakeholder }} stakeholder · {{ counts.system }} system · linked &amp; traceable
        </p>
      </div>
    </header>

    <!-- Filters -->
    <div class="mt-6 flex flex-wrap items-center gap-2">
      <div class="relative flex-1 min-w-[200px]">
        <Search class="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-ink-light" />
        <input v-model="q" class="bg-input w-full !pl-9" placeholder="Search id, title, text…" />
      </div>
      <select v-model="fType" class="bg-input" @change="fCategory = 'all'">
        <option value="all">All types</option>
        <option value="stakeholder">Stakeholder</option>
        <option value="system">System</option>
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
        <p class="px-2 py-1 font-mono text-[11px] text-ink-light">{{ filtered.length }} shown</p>
        <button
          v-for="r in filtered"
          :key="r.id"
          class="flex w-full flex-col gap-1 rounded-lg px-3 py-2 text-left transition hover:bg-pastel-sky/20"
          :class="r.id === selectedId ? 'bg-pastel-sky/40' : ''"
          @click="select(r.id)"
        >
          <div class="flex items-center gap-2">
            <span class="font-mono text-xs font-semibold text-ink">{{ r.id }}</span>
            <span class="pill text-[10px]" :class="typeClass(r.type)">{{ r.type }}</span>
            <span v-if="r.priority" class="pill bg-white text-[10px] text-ink-light">{{ r.priority }}</span>
            <span class="pill text-[10px]" :class="statusClass(r.status)">{{ statusLabel(r.status) }}</span>
          </div>
          <div class="text-sm font-medium text-ink">{{ r.title }}</div>
        </button>
        <p v-if="filtered.length === 0" class="px-3 py-6 text-center font-mono text-xs text-ink-light">
          No requirements match.
        </p>
      </div>

      <!-- Detail -->
      <div v-if="selected" class="card p-5">
        <div class="flex flex-wrap items-center gap-2">
          <span class="font-mono text-sm font-bold text-ink">{{ selected.id }}</span>
          <span class="pill text-[10px]" :class="typeClass(selected.type)">{{ selected.type }}</span>
          <span class="pill text-[10px]" :class="statusClass(selected.status)">{{ statusLabel(selected.status) }}</span>
          <span v-if="selected.priority" class="pill bg-white text-[10px] text-ink-light">
            priority {{ selected.priority }} · {{ priorityLabel(selected.priority) }}
          </span>
          <span class="pill bg-pastel-slate/50 text-[10px] text-ink-muted">{{ selected.category }}</span>
        </div>

        <h2 class="mt-3 font-sans text-lg font-bold text-ink">{{ selected.title }}</h2>
        <p class="mt-1 text-sm text-ink-muted">{{ selected.text }}</p>

        <p v-if="selected.source" class="mt-3 font-mono text-xs text-ink-light">
          source: {{ sourceLabel(selected.source) }}<span v-if="selected.sourceNote"> ({{ selected.sourceNote }})</span>
        </p>

        <!-- Traces -->
        <div v-if="derivedFrom(selected).length" class="mt-4">
          <p class="trace-h"><Link2 class="h-3.5 w-3.5" /> Derived from</p>
          <div class="mt-1 flex flex-wrap gap-1.5">
            <button v-for="id in derivedFrom(selected)" :key="id" class="trace-chip" @click="select(id)">
              {{ id }} · {{ byId.get(id)?.title }}
            </button>
          </div>
        </div>

        <div v-if="(satisfiedBy.get(selected.id) ?? []).length" class="mt-4">
          <p class="trace-h"><Link2 class="h-3.5 w-3.5" /> Satisfied by</p>
          <div class="mt-1 flex flex-wrap gap-1.5">
            <button
              v-for="id in satisfiedBy.get(selected.id)"
              :key="id"
              class="trace-chip"
              @click="select(id)"
            >
              {{ id }} · {{ byId.get(id)?.title }}
            </button>
          </div>
        </div>

        <div v-if="relatedTo(selected).length" class="mt-4">
          <p class="trace-h"><Link2 class="h-3.5 w-3.5" /> Related to</p>
          <div class="mt-1 flex flex-wrap gap-1.5">
            <button v-for="id in relatedTo(selected)" :key="id" class="trace-chip" @click="select(id)">
              {{ id }} · {{ byId.get(id)?.title }}
            </button>
          </div>
        </div>

        <div v-if="(selected.implementedBy ?? []).length" class="mt-4">
          <p class="trace-h"><FileCode2 class="h-3.5 w-3.5" /> Implemented by</p>
          <ul class="mt-1 flex flex-col gap-1">
            <li v-for="(c, i) in selected.implementedBy" :key="i" class="font-mono text-xs text-ink-muted">
              <span class="text-ink">{{ c.path }}</span><span v-if="c.symbol"> · {{ c.symbol }}</span>
            </li>
          </ul>
        </div>

        <div v-if="(selected.verifiedBy ?? []).length" class="mt-4">
          <p class="trace-h"><CheckCircle2 class="h-3.5 w-3.5" /> Verified by</p>
          <ul class="mt-1 flex flex-col gap-1">
            <li v-for="(v, i) in selected.verifiedBy" :key="i" class="font-mono text-xs text-ink-muted">
              {{ v.method }}<span v-if="v.note"> — {{ v.note }}</span>
            </li>
          </ul>
        </div>

        <div v-if="(selected.specRefs ?? []).length" class="mt-4">
          <p class="trace-h"><BookText class="h-3.5 w-3.5" /> Spec</p>
          <ul class="mt-1 flex flex-col gap-1">
            <li v-for="(s, i) in selected.specRefs" :key="i" class="font-mono text-xs text-ink-muted">
              {{ s.doc }} › {{ s.section }}
            </li>
          </ul>
        </div>
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
