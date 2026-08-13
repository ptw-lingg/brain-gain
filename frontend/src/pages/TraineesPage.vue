<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ChevronDown, Mail, Users } from 'lucide-vue-next';
import client from '@/api/client';
import { useToastStore } from '@/stores/toast';
import type { DueStatus, Settings, TraineeGroup } from '@/types';
import { dueLabel, dueClasses, formatDate } from '@/utils/display';
import ListControls from '@/components/ListControls.vue';
import { matchesQuery } from '@/utils/listFilter';
import { resolveLocalized } from '@/utils/locales';

const toast = useToastStore();
const { t, locale } = useI18n();

// A group's display name: the localized training name resolved to the UI language (English
// fallback). Also used in the reminder mail texts and as the alphabetical sort key.
const groupName = (g: TraineeGroup): string => resolveLocalized(g.training.name, locale.value).value;
// The search box matches EVERY language of the training name, whatever is currently displayed.
const nameTexts = (g: TraineeGroup): string[] => Object.values(g.training.name ?? {});

const groups = ref<TraineeGroup[]>([]);
const loading = ref(true);
const onlyDue = ref(true);
const open = ref<Record<string, boolean>>({});
const search = ref('');
const company = ref('');
const sending = ref(false);

const ACTIONABLE: DueStatus[] = ['never', 'due', 'overdue'];

function visibleTrainees(g: TraineeGroup) {
  return onlyDue.value ? g.trainees.filter((t) => ACTIONABLE.includes(t.status)) : g.trainees;
}

// Trainees shown for a group: the onlyDue view, further narrowed by the search box (a match on the
// training name keeps the whole group, since the name is part of every row's searchable text).
function shownTrainees(g: TraineeGroup) {
  return visibleTrainees(g).filter((tr) => matchesQuery(search.value, tr.user.name, tr.user.email, ...nameTexts(g)));
}

const filteredGroups = computed(() =>
  groups.value.filter((g) => shownTrainees(g).length > 0 || matchesQuery(search.value, ...nameTexts(g))),
);

// Expand/collapse every (shown) group at once.
const allExpanded = computed(
  () => filteredGroups.value.length > 0 && filteredGroups.value.every((g) => open.value[g.training.id]),
);
function toggleAll(): void {
  const next = !allExpanded.value;
  for (const g of filteredGroups.value) open.value[g.training.id] = next;
}

function dueTotal(g: TraineeGroup): number {
  return g.trainees.filter((t) => ACTIONABLE.includes(t.status)).length;
}

const grandTotalEmails = computed(() => {
  const set = new Set<string>();
  for (const g of filteredGroups.value) shownTrainees(g).forEach((t) => set.add(t.user.email));
  return [...set];
});

async function load(): Promise<void> {
  loading.value = true;
  try {
    const [trainees, settings] = await Promise.all([
      client.get<TraineeGroup[]>('/trainings/trainees'),
      client.get<Settings>('/settings'),
    ]);
    const data = trainees.data;
    // Groups alphabetical by training, trainees alphabetical by name — fast to locate either.
    data.forEach((g) => g.trainees.sort((a, b) => a.user.name.localeCompare(b.user.name)));
    groups.value = data.sort((a, b) => groupName(a).localeCompare(groupName(b)));
    data.forEach((g) => (open.value[g.training.id] = true));
    company.value = settings.data.companyName ?? '';
  } finally {
    loading.value = false;
  }
}

// Send a reminder email through the system's SMTP server (recipients are bcc'd by the backend).
async function sendMail(emails: string[], subject: string, text: string): Promise<void> {
  if (emails.length === 0) {
    toast.error(t('trainees.toasts.noRecipients'));
    return;
  }
  sending.value = true;
  try {
    const { data } = await client.post<{ sent: number }>('/mail/send', { to: emails, subject, text });
    toast.success(t('trainees.toasts.mailSent', { count: data.sent }, data.sent));
  } catch (err: unknown) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    // 503 = SMTP not configured → point the user to Settings; anything else = a send failure.
    toast.error(status === 503 ? t('trainees.toasts.smtpNotConfigured') : t('trainees.toasts.mailError'));
  } finally {
    sending.value = false;
  }
}

function emailGroup(g: TraineeGroup): void {
  void sendMail(
    shownTrainees(g).map((tr) => tr.user.email),
    t('trainees.mailSubject', { training: groupName(g) }),
    t('trainees.mailBody', { training: groupName(g), company: company.value || t('common.appName') }),
  );
}

function emailAll(): void {
  void sendMail(
    grandTotalEmails.value,
    t('trainees.mailAllSubject'),
    t('trainees.mailAllBody', { company: company.value || t('common.appName') }),
  );
}

onMounted(load);
</script>

<template>
  <div>
    <header class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="page-title">{{ t('trainees.title') }}</h1>
        <p class="mt-1 font-mono text-xs text-ink-light">
          {{ t('trainees.subtitle') }}
        </p>
      </div>
      <div class="flex items-center gap-3">
        <label class="flex cursor-pointer items-center gap-2 font-mono text-xs text-ink-muted">
          <input v-model="onlyDue" type="checkbox" class="accent-accent" />
          {{ t('trainees.onlyDue') }}
        </label>
        <button class="btn-primary" :disabled="sending" @click="emailAll">
          <Mail class="h-4 w-4" /> {{ t('trainees.emailAll') }}
        </button>
      </div>
    </header>

    <div v-if="loading" class="mt-6 flex flex-col gap-3">
      <div v-for="n in 2" :key="n" class="card h-24 animate-pulse bg-pastel-slate/30" />
    </div>

    <div v-else-if="groups.length === 0" class="mt-16 flex flex-col items-center gap-3 text-center">
      <div class="flex h-16 w-16 items-center justify-center rounded-full bg-pastel-sky/50">
        <Users class="h-8 w-8 text-accent" />
      </div>
      <p class="font-mono text-sm text-ink-muted">{{ t('trainees.empty') }}</p>
    </div>

    <div v-else class="mt-6">
      <ListControls
        v-model:query="search"
        :count="filteredGroups.length"
        :total="groups.length"
        expandable
        :all-expanded="allExpanded"
        @toggle-all="toggleAll"
      />
      <div class="flex flex-col gap-3">
      <div v-for="g in filteredGroups" :key="g.training.id" class="card overflow-hidden">
        <!-- Group header -->
        <div class="flex items-center gap-3 px-5 py-4">
          <button
            class="flex min-w-0 flex-1 items-center gap-3 text-left"
            @click="open[g.training.id] = !open[g.training.id]"
          >
            <ChevronDown
              class="h-4 w-4 shrink-0 text-ink-light transition"
              :class="open[g.training.id] ? '' : '-rotate-90'"
            />
            <div class="min-w-0">
              <div class="font-sans text-sm font-semibold text-ink">{{ groupName(g) }}</div>
              <div class="font-mono text-xs text-ink-light">
                {{ t('trainees.assignedDue', { assigned: g.trainees.length, due: dueTotal(g) }) }}
              </div>
            </div>
          </button>
          <button class="btn-ghost btn-sm" :disabled="sending" @click="emailGroup(g)">
            <Mail class="h-3.5 w-3.5" /> {{ t('trainees.emailTrainees') }}
          </button>
        </div>

        <!-- Trainees -->
        <Transition name="list">
          <div v-if="open[g.training.id]" class="border-t border-line">
            <div
              v-for="tr in shownTrainees(g)"
              :key="tr.user.id"
              class="flex items-center gap-3 px-5 py-2.5 even:bg-pastel-sky/10"
            >
              <div class="min-w-0 flex-1">
                <div class="text-sm font-medium text-ink">{{ tr.user.name }}</div>
                <div class="truncate font-mono text-xs text-ink-light" :title="tr.user.email">{{ tr.user.email }}</div>
              </div>
              <span v-if="tr.dueDate" class="hidden font-mono text-[11px] text-ink-light sm:inline">
                {{ t('trainees.dueOn', { date: formatDate(tr.dueDate) }) }}
              </span>
              <span class="pill pill-col shrink-0" :class="dueClasses(tr.status)">
                {{ dueLabel(t, tr.status, tr.dueDate) }}
              </span>
            </div>
            <p
              v-if="shownTrainees(g).length === 0"
              class="px-5 py-3 font-mono text-xs text-ink-light"
            >
              {{ onlyDue ? t('trainees.nobodyDue') : t('trainees.noneAssigned') }}
            </p>
          </div>
        </Transition>
      </div>
      <p v-if="filteredGroups.length === 0" class="font-mono text-sm text-ink-light">{{ t('common.noMatches') }}</p>
      </div>
    </div>
  </div>
</template>
