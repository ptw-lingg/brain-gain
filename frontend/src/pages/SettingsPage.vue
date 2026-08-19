<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Building2, DatabaseBackup, KeyRound, Lock, Mail, Save, Send, SlidersHorizontal } from 'lucide-vue-next';
import client from '@/api/client';
import PasswordInput from '@/components/PasswordInput.vue';
import { useToastStore } from '@/stores/toast';
import type { Settings, TlsSettings } from '@/types';

const toast = useToastStore();
const { t } = useI18n();

const pct = ref(80);
// Off by default: naming the wrong questions helps honest learners, but with unlimited retries it
// also helps guessing — so revealing them is the admin's call.
const revealWrong = ref(false);
const loading = ref(true);
const saving = ref(false);


// Company name — names the root org unit (admin-editable).
const companyName = ref('');
const savingCompany = ref(false);

const pctLabel = computed(() => `${pct.value}%`);

// Microsoft Entra ID SSO config (admin-editable).
const ssoEnabled = ref(false);
const tenantId = ref('');
const clientId = ref('');
const domains = ref(''); // comma-separated in the input; stored as an array
const savingSso = ref(false);
const redirectUri = window.location.origin; // what to register in the Azure app

// Automatic scheduled backups (admin-editable; retention applies to automatic backups only).
const autoBackupEnabled = ref(false);
const autoBackupIntervalDays = ref(7);
const autoBackupKeep = ref(5);
const savingAutoBackup = ref(false);

// TLS certificate (HTTPS delivery).
const tls = ref<TlsSettings | null>(null);
const certPem = ref('');
const keyPem = ref('');
const chainPem = ref('');
const certName = ref('');
const keyName = ref('');
const savingCert = ref(false);
const regenerating = ref(false);

// Outbound email (SMTP). The password is write-only — blank means "keep the stored one".
const smtpEnabled = ref(false);
const smtpHost = ref('');
const smtpPort = ref(587);
const smtpSecure = ref(false);
const smtpUser = ref('');
const smtpPassword = ref('');
const smtpPasswordSet = ref(false);
const smtpFromName = ref('');
const smtpFromAddress = ref('');
const savingSmtp = ref(false);
const testingSmtp = ref(false);

const tlsWarn = computed(() => {
  if (!tls.value) return '';
  if (tls.value.source === 'self-signed') return t('settings.warnSelfSigned');
  if (new Date(tls.value.validTo).getTime() < Date.now()) return t('settings.warnExpired');
  return '';
});

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

function onFile(e: Event, target: 'cert' | 'key' | 'chain'): void {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const text = String(reader.result ?? '');
    if (target === 'cert') {
      certPem.value = text;
      certName.value = file.name;
    } else if (target === 'key') {
      keyPem.value = text;
      keyName.value = file.name;
    } else {
      chainPem.value = text;
    }
  };
  reader.readAsText(file);
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const { data } = await client.get<Settings>('/settings');
    pct.value = Math.round(data.passThreshold * 100);
    revealWrong.value = data.revealWrongQuestions ?? false;
    companyName.value = data.companyName ?? '';
    const e = data.entra;
    if (e) {
      ssoEnabled.value = e.enabled;
      tenantId.value = e.tenantId;
      clientId.value = e.clientId;
      domains.value = (e.allowedDomains ?? []).join(', ');
    }
    const ab = data.autoBackup;
    if (ab) {
      autoBackupEnabled.value = ab.enabled;
      autoBackupIntervalDays.value = ab.intervalDays;
      autoBackupKeep.value = ab.keep;
    }
    tls.value = data.tls ?? null;
    const m = data.smtp;
    if (m) {
      smtpEnabled.value = m.enabled;
      smtpHost.value = m.host;
      smtpPort.value = m.port;
      smtpSecure.value = m.secure;
      smtpUser.value = m.username;
      smtpFromName.value = m.fromName;
      smtpFromAddress.value = m.fromAddress;
      smtpPasswordSet.value = Boolean(m.passwordSet);
      smtpPassword.value = '';
    }
  } finally {
    loading.value = false;
  }
}

async function saveCertificate(): Promise<void> {
  if (!certPem.value.trim() || !keyPem.value.trim()) {
    toast.error(t('settings.toasts.certBothRequired'));
    return;
  }
  savingCert.value = true;
  try {
    const { data } = await client.post<TlsSettings>('/settings/certificate', {
      cert: certPem.value,
      key: keyPem.value,
      chain: chainPem.value.trim() || undefined,
    });
    tls.value = data;
    certPem.value = keyPem.value = chainPem.value = '';
    certName.value = keyName.value = '';
    toast.success(t('settings.toasts.certInstalled'));
  } catch (err: unknown) {
    const msg =
      typeof err === 'object' && err && 'response' in err
        ? ((err as { response?: { data?: { error?: string } } }).response?.data?.error ?? '')
        : '';
    toast.error(msg || t('settings.toasts.certInstallError'));
  } finally {
    savingCert.value = false;
  }
}

async function regenerateSelfSigned(): Promise<void> {
  regenerating.value = true;
  try {
    const { data } = await client.post<TlsSettings>('/settings/certificate/self-signed', {});
    tls.value = data;
    toast.success(t('settings.toasts.certReverted'));
  } catch {
    toast.error(t('settings.toasts.certRegenError'));
  } finally {
    regenerating.value = false;
  }
}

async function save(): Promise<void> {
  saving.value = true;
  try {
    await client.put('/settings', { passThreshold: pct.value / 100, revealWrongQuestions: revealWrong.value });
    toast.success(t('settings.toasts.thresholdSaved'));
  } catch {
    toast.error(t('settings.toasts.settingsError'));
  } finally {
    saving.value = false;
  }
}

async function saveCompany(): Promise<void> {
  if (!companyName.value.trim()) {
    toast.error(t('settings.toasts.companyNameRequired'));
    return;
  }
  savingCompany.value = true;
  try {
    await client.put('/settings', { companyName: companyName.value.trim() });
    toast.success(t('settings.toasts.companySaved'));
  } catch {
    toast.error(t('settings.toasts.settingsError'));
  } finally {
    savingCompany.value = false;
  }
}

async function saveSso(): Promise<void> {
  savingSso.value = true;
  try {
    await client.put('/settings', {
      entra: {
        enabled: ssoEnabled.value,
        tenantId: tenantId.value.trim(),
        clientId: clientId.value.trim(),
        allowedDomains: domains.value
          .split(',')
          .map((d) => d.trim())
          .filter(Boolean),
      },
    });
    toast.success(t('settings.toasts.ssoSaved'));
  } catch {
    toast.error(t('settings.toasts.ssoError'));
  } finally {
    savingSso.value = false;
  }
}

async function saveAutoBackup(): Promise<void> {
  savingAutoBackup.value = true;
  try {
    // The server clamps out-of-range values (interval 1..365, keep 1..100) — reflect what it kept.
    const { data } = await client.put<Settings>('/settings', {
      autoBackup: {
        enabled: autoBackupEnabled.value,
        intervalDays: autoBackupIntervalDays.value,
        keep: autoBackupKeep.value,
      },
    });
    autoBackupEnabled.value = data.autoBackup.enabled;
    autoBackupIntervalDays.value = data.autoBackup.intervalDays;
    autoBackupKeep.value = data.autoBackup.keep;
    toast.success(t('settings.toasts.autoBackupSaved'));
  } catch {
    toast.error(t('settings.toasts.settingsError'));
  } finally {
    savingAutoBackup.value = false;
  }
}

async function saveSmtp(): Promise<void> {
  savingSmtp.value = true;
  try {
    await client.put('/settings', {
      smtp: {
        enabled: smtpEnabled.value,
        host: smtpHost.value.trim(),
        port: smtpPort.value,
        secure: smtpSecure.value,
        username: smtpUser.value.trim(),
        fromName: smtpFromName.value.trim(),
        fromAddress: smtpFromAddress.value.trim(),
        // Only send a password when the user typed a new one; blank keeps the stored secret.
        ...(smtpPassword.value ? { password: smtpPassword.value } : {}),
      },
    });
    if (smtpPassword.value) smtpPasswordSet.value = true;
    smtpPassword.value = '';
    toast.success(t('settings.toasts.smtpSaved'));
  } catch {
    toast.error(t('settings.toasts.settingsError'));
  } finally {
    savingSmtp.value = false;
  }
}

async function sendTestEmail(): Promise<void> {
  testingSmtp.value = true;
  try {
    const { data } = await client.post<{ to: string }>('/mail/test', {});
    toast.success(t('settings.toasts.testSent', { email: data.to }));
  } catch (err: unknown) {
    const msg =
      typeof err === 'object' && err && 'response' in err
        ? ((err as { response?: { data?: { error?: string } } }).response?.data?.error ?? '')
        : '';
    toast.error(msg || t('settings.toasts.testError'));
  } finally {
    testingSmtp.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div>
    <header>
      <h1 class="page-title">{{ t('settings.title') }}</h1>
      <p class="mt-1 font-mono text-xs text-ink-light">{{ t('settings.subtitle') }}</p>
    </header>

    <div v-if="loading" class="mt-6 card h-40 animate-pulse bg-pastel-slate/30" />

    <!-- Four columns on xl (two on lg, one below). Default grid stretch equalizes heights: the
         single cards in columns 2-4 fill the row, and column 1's inner grid distributes any
         extra space across its three cards. -->
    <div v-else class="mt-6 grid gap-6 lg:grid-cols-2 xl:grid-cols-4">
      <!-- Column 1: company name, pass threshold, automatic backups -->
      <div class="grid gap-6">
        <!-- Company name (names the root org unit) -->
        <div class="card p-6">
          <div class="flex items-center gap-3">
            <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-pastel-sky/60">
              <Building2 class="h-5 w-5 text-accent" />
            </div>
            <div class="min-w-0 flex-1">
              <h2 class="font-sans text-sm font-bold text-ink">{{ t('settings.companyTitle') }}</h2>
              <p class="font-mono text-xs text-ink-light">{{ t('settings.companyDesc') }}</p>
            </div>
          </div>
          <div class="mt-6 flex flex-wrap items-end gap-3">
            <input v-model="companyName" class="bg-input flex-1" :placeholder="t('settings.companyTitle')" />
            <button class="btn-primary" :disabled="savingCompany" @click="saveCompany">
              <Save class="h-4 w-4" /> {{ savingCompany ? t('common.saving') : t('settings.saveCompany') }}
            </button>
          </div>
        </div>

        <!-- Global pass threshold -->
        <div class="card p-6">
          <div class="flex items-center gap-3">
            <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-pastel-sky/60">
              <SlidersHorizontal class="h-5 w-5 text-accent" />
            </div>
            <div>
              <h2 class="font-sans text-sm font-bold text-ink">{{ t('settings.thresholdTitle') }}</h2>
              <p class="font-mono text-xs text-ink-light">
                {{ t('settings.thresholdDesc') }}
              </p>
            </div>
          </div>

          <div class="mt-6 flex items-center gap-4">
            <input
              v-model.number="pct"
              type="range"
              min="50"
              max="100"
              step="5"
              class="flex-1 accent-accent"
            />
            <span class="w-16 text-right font-sans text-2xl font-bold text-accent">{{ pctLabel }}</span>
          </div>

          <label class="mt-5 flex cursor-pointer items-start gap-2 font-mono text-xs text-ink-muted">
            <input v-model="revealWrong" type="checkbox" class="mt-0.5 accent-accent" />
            <span>
              {{ t('settings.revealWrong') }}
              <span class="block text-[11px] text-ink-light">{{ t('settings.revealWrongHint') }}</span>
            </span>
          </label>

          <div class="mt-6">
            <button class="btn-primary" :disabled="saving" @click="save">
              <Save class="h-4 w-4" /> {{ saving ? t('common.saving') : t('settings.saveChanges') }}
            </button>
          </div>
        </div>

        <!-- Automatic scheduled backups -->
        <div class="card p-6">
          <div class="flex items-center gap-3">
            <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-pastel-sky/60">
              <DatabaseBackup class="h-5 w-5 text-accent" />
            </div>
            <div class="min-w-0 flex-1">
              <h2 class="font-sans text-sm font-bold text-ink">{{ t('settings.autoBackupTitle') }}</h2>
              <p class="font-mono text-xs text-ink-light">{{ t('settings.autoBackupDesc') }}</p>
            </div>
            <label class="flex cursor-pointer items-center gap-2 font-mono text-xs text-ink-muted">
              <input v-model="autoBackupEnabled" type="checkbox" class="accent-accent" />
              {{ t('settings.enabled') }}
            </label>
          </div>

          <div class="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label class="flex flex-col gap-1">
              <span class="form-label">{{ t('settings.autoBackupInterval') }}</span>
              <input v-model.number="autoBackupIntervalDays" type="number" min="1" max="365" class="bg-input" />
            </label>
            <label class="flex flex-col gap-1">
              <span class="form-label">{{ t('settings.autoBackupKeep') }}</span>
              <input v-model.number="autoBackupKeep" type="number" min="1" max="100" class="bg-input" />
            </label>
          </div>
          <p class="mt-2 font-mono text-[11px] text-ink-light">{{ t('settings.autoBackupRetentionHint') }}</p>

          <div class="mt-6">
            <button class="btn-primary" :disabled="savingAutoBackup" @click="saveAutoBackup">
              <Save class="h-4 w-4" /> {{ savingAutoBackup ? t('common.saving') : t('settings.saveAutoBackup') }}
            </button>
          </div>
        </div>
      </div>

      <!-- Column 2: HTTPS / TLS certificate -->
      <div class="card p-6">
        <div class="flex items-center gap-3">
          <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-pastel-sky/60">
            <Lock class="h-5 w-5 text-accent" />
          </div>
          <div class="min-w-0 flex-1">
            <h2 class="font-sans text-sm font-bold text-ink">{{ t('settings.tlsTitle') }}</h2>
            <p class="font-mono text-xs text-ink-light">
              {{ t('settings.tlsDesc') }}
            </p>
          </div>
        </div>

        <!-- Current certificate -->
        <div class="mt-6 rounded-md border border-line bg-pastel-sky/10 px-3 py-3">
          <p class="form-label">{{ t('settings.activeCert') }}</p>
          <div v-if="tls" class="mt-1 grid grid-cols-1 gap-0.5 font-mono text-[11px] text-ink-light sm:grid-cols-2">
            <span>{{ t('settings.certSource') }} <span class="text-ink">{{ tls.source }}</span></span>
            <span>{{ t('settings.certFingerprint') }} <span class="text-ink">{{ tls.fingerprint.slice(0, 24) }}…</span></span>
            <span>{{ t('settings.certSubject') }} <span class="text-ink">{{ tls.subject.replace(/\n/g, ', ') }}</span></span>
            <span>{{ t('settings.certIssuer') }} <span class="text-ink">{{ tls.issuer.replace(/\n/g, ', ') }}</span></span>
            <span>{{ t('settings.certValidFrom') }} <span class="text-ink">{{ fmtDate(tls.validFrom) }}</span></span>
            <span>{{ t('settings.certValidTo') }} <span class="text-ink">{{ fmtDate(tls.validTo) }}</span></span>
          </div>
          <p v-else class="mt-1 font-mono text-[11px] text-ink-light">{{ t('settings.noCertMeta') }}</p>
          <p v-if="tlsWarn" class="mt-2 font-mono text-[11px] text-amber-600">⚠ {{ tlsWarn }}</p>
        </div>

        <!-- Upload -->
        <div class="mt-4 flex flex-col gap-4">
          <label class="flex flex-col gap-1">
            <span class="form-label">{{ t('settings.certPem') }}</span>
            <input type="file" accept=".pem,.crt,.cer" class="text-xs" @change="onFile($event, 'cert')" />
            <span v-if="certName" class="font-mono text-[11px] text-ink-light">{{ certName }}</span>
          </label>
          <label class="flex flex-col gap-1">
            <span class="form-label">{{ t('settings.keyPem') }}</span>
            <input type="file" accept=".pem,.key" class="text-xs" @change="onFile($event, 'key')" />
            <span v-if="keyName" class="font-mono text-[11px] text-ink-light">{{ keyName }}</span>
          </label>
          <label class="flex flex-col gap-1">
            <span class="form-label">{{ t('settings.chainPem') }}</span>
            <input type="file" accept=".pem,.crt,.cer" class="text-xs" @change="onFile($event, 'chain')" />
          </label>
          <p class="font-mono text-[11px] text-ink-light">
            {{ t('settings.keyNote') }}
          </p>
        </div>

        <div class="mt-6 flex flex-wrap gap-2">
          <button class="btn-primary" :disabled="savingCert" @click="saveCertificate">
            <Save class="h-4 w-4" /> {{ savingCert ? t('settings.installing') : t('settings.installCert') }}
          </button>
          <button class="btn-ghost" :disabled="regenerating" @click="regenerateSelfSigned">
            {{ regenerating ? t('settings.regenerating') : t('settings.regenSelfSigned') }}
          </button>
        </div>
      </div>

      <!-- Column 3: outbound email (SMTP) -->
      <div class="card p-6">
        <div class="flex items-center gap-3">
          <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-pastel-sky/60">
            <Mail class="h-5 w-5 text-accent" />
          </div>
          <div class="min-w-0 flex-1">
            <h2 class="font-sans text-sm font-bold text-ink">{{ t('settings.smtpTitle') }}</h2>
            <p class="font-mono text-xs text-ink-light">{{ t('settings.smtpDesc') }}</p>
          </div>
          <label class="flex cursor-pointer items-center gap-2 font-mono text-xs text-ink-muted">
            <input v-model="smtpEnabled" type="checkbox" class="accent-accent" />
            {{ t('settings.enabled') }}
          </label>
        </div>

        <div class="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label class="flex flex-col gap-1 sm:col-span-2">
            <span class="form-label">{{ t('settings.smtpHost') }}</span>
            <input v-model="smtpHost" class="bg-input" placeholder="smtp.example.com" />
          </label>
          <label class="flex flex-col gap-1">
            <span class="form-label">{{ t('settings.smtpPort') }}</span>
            <input v-model.number="smtpPort" type="number" min="1" max="65535" class="bg-input" placeholder="587" />
          </label>
          <label class="flex items-center gap-2 self-end pb-2 font-mono text-sm text-ink-muted">
            <input v-model="smtpSecure" type="checkbox" class="accent-accent" />
            {{ t('settings.smtpSecure') }}
          </label>
          <label class="flex flex-col gap-1">
            <span class="form-label">{{ t('settings.smtpUser') }}</span>
            <input v-model="smtpUser" class="bg-input" autocomplete="off" />
          </label>
          <label class="flex flex-col gap-1">
            <span class="form-label">{{ t('settings.smtpPassword') }}</span>
            <PasswordInput
              v-model="smtpPassword"
              autocomplete="new-password"
              :placeholder="smtpPasswordSet ? t('settings.smtpPasswordStored') : ''"
            />
          </label>
          <label class="flex flex-col gap-1">
            <span class="form-label">{{ t('settings.smtpFromName') }}</span>
            <input v-model="smtpFromName" class="bg-input" :placeholder="t('common.appName')" />
          </label>
          <label class="flex flex-col gap-1">
            <span class="form-label">{{ t('settings.smtpFromAddress') }}</span>
            <input v-model="smtpFromAddress" type="email" class="bg-input" placeholder="no-reply@example.com" />
          </label>
        </div>

        <div class="mt-6 flex flex-wrap gap-2">
          <button class="btn-primary" :disabled="savingSmtp" @click="saveSmtp">
            <Save class="h-4 w-4" /> {{ savingSmtp ? t('common.saving') : t('settings.saveSmtp') }}
          </button>
          <button class="btn-ghost" :disabled="testingSmtp" @click="sendTestEmail">
            <Send class="h-4 w-4" /> {{ testingSmtp ? t('settings.sendingTest') : t('settings.sendTest') }}
          </button>
        </div>
      </div>

      <!-- Column 4: Microsoft Entra ID single sign-on -->
      <div class="card p-6">
        <div class="flex items-center gap-3">
          <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-pastel-sky/60">
            <KeyRound class="h-5 w-5 text-accent" />
          </div>
          <div class="min-w-0 flex-1">
            <h2 class="font-sans text-sm font-bold text-ink">{{ t('settings.ssoTitle') }}</h2>
            <p class="font-mono text-xs text-ink-light">
              {{ t('settings.ssoDesc') }}
            </p>
          </div>
          <label class="flex cursor-pointer items-center gap-2 font-mono text-xs text-ink-muted">
            <input v-model="ssoEnabled" type="checkbox" class="accent-accent" />
            {{ t('settings.enabled') }}
          </label>
        </div>

        <div class="mt-6 flex flex-col gap-4">
          <label class="flex flex-col gap-1">
            <span class="form-label">{{ t('settings.tenantId') }}</span>
            <input
              v-model="tenantId"
              class="bg-input"
              placeholder="00000000-0000-0000-0000-000000000000"
            />
          </label>
          <label class="flex flex-col gap-1">
            <span class="form-label">{{ t('settings.clientId') }}</span>
            <input
              v-model="clientId"
              class="bg-input"
              placeholder="00000000-0000-0000-0000-000000000000"
            />
          </label>
          <label class="flex flex-col gap-1">
            <span class="form-label">{{ t('settings.allowedDomains') }}</span>
            <input v-model="domains" class="bg-input" placeholder="ptwdosimetry.com, example.com" />
            <span class="font-mono text-[11px] text-ink-light">
              {{ t('settings.domainsHint') }}
            </span>
          </label>
        </div>

        <div class="mt-4 rounded-md border border-line bg-pastel-sky/10 px-3 py-2">
          <p class="font-mono text-[11px] text-ink-light">
            {{ t('settings.redirectHint') }}
            <span class="text-ink">{{ redirectUri }}</span>
          </p>
        </div>

        <div class="mt-6">
          <button class="btn-primary" :disabled="savingSso" @click="saveSso">
            <Save class="h-4 w-4" /> {{ savingSso ? t('settings.savingSso') : t('settings.saveSso') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
