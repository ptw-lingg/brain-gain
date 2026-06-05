<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { KeyRound, Lock, Save, SlidersHorizontal } from 'lucide-vue-next';
import client from '@/api/client';
import { useToastStore } from '@/stores/toast';
import type { Settings, TlsSettings } from '@/types';

const toast = useToastStore();

const pct = ref(80);
const loading = ref(true);
const saving = ref(false);

const pctLabel = computed(() => `${pct.value}%`);

// Microsoft Entra ID SSO config (admin-editable).
const ssoEnabled = ref(false);
const tenantId = ref('');
const clientId = ref('');
const domains = ref(''); // comma-separated in the input; stored as an array
const savingSso = ref(false);
const redirectUri = window.location.origin; // what to register in the Azure app

// TLS certificate (HTTPS delivery).
const tls = ref<TlsSettings | null>(null);
const certPem = ref('');
const keyPem = ref('');
const chainPem = ref('');
const certName = ref('');
const keyName = ref('');
const savingCert = ref(false);
const regenerating = ref(false);

const tlsWarn = computed(() => {
  if (!tls.value) return '';
  if (tls.value.source === 'self-signed') return 'Self-signed certificate — browsers will warn. Upload a CA-issued certificate for production.';
  if (new Date(tls.value.validTo).getTime() < Date.now()) return 'This certificate has expired.';
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
    const e = data.entra;
    if (e) {
      ssoEnabled.value = e.enabled;
      tenantId.value = e.tenantId;
      clientId.value = e.clientId;
      domains.value = (e.allowedDomains ?? []).join(', ');
    }
    tls.value = data.tls ?? null;
  } finally {
    loading.value = false;
  }
}

async function saveCertificate(): Promise<void> {
  if (!certPem.value.trim() || !keyPem.value.trim()) {
    toast.error('Choose both a certificate and a private key file');
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
    toast.success('Certificate installed — applies to new connections (reload to use it)');
  } catch (err: unknown) {
    const msg =
      typeof err === 'object' && err && 'response' in err
        ? ((err as { response?: { data?: { error?: string } } }).response?.data?.error ?? '')
        : '';
    toast.error(msg || 'Could not install certificate');
  } finally {
    savingCert.value = false;
  }
}

async function regenerateSelfSigned(): Promise<void> {
  regenerating.value = true;
  try {
    const { data } = await client.post<TlsSettings>('/settings/certificate/self-signed', {});
    tls.value = data;
    toast.success('Reverted to a self-signed certificate');
  } catch {
    toast.error('Could not regenerate certificate');
  } finally {
    regenerating.value = false;
  }
}

async function save(): Promise<void> {
  saving.value = true;
  try {
    await client.put('/settings', { passThreshold: pct.value / 100 });
    toast.success('Pass threshold updated for all trainings');
  } catch {
    toast.error('Could not save settings');
  } finally {
    saving.value = false;
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
    toast.success('Microsoft SSO settings saved');
  } catch {
    toast.error('Could not save SSO settings');
  } finally {
    savingSso.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="mx-auto max-w-xl">
    <header>
      <h1 class="page-title">Settings</h1>
      <p class="mt-1 font-mono text-xs text-ink-light">// applies to every training at once</p>
    </header>

    <div v-if="loading" class="mt-6 card h-40 animate-pulse bg-pastel-slate/30" />

    <div v-else class="mt-6 flex flex-col gap-6">
      <!-- Global pass threshold -->
      <div class="card p-6">
        <div class="flex items-center gap-3">
          <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-pastel-sky/60">
            <SlidersHorizontal class="h-5 w-5 text-accent" />
          </div>
          <div>
            <h2 class="font-sans text-sm font-bold text-ink">Global pass threshold</h2>
            <p class="font-mono text-xs text-ink-light">
              Minimum score a user must reach to pass any training's test.
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

        <div class="mt-6">
          <button class="btn-primary" :disabled="saving" @click="save">
            <Save class="h-4 w-4" /> {{ saving ? 'Saving…' : 'Save changes' }}
          </button>
        </div>
      </div>

      <!-- Microsoft Entra ID single sign-on -->
      <div class="card p-6">
        <div class="flex items-center gap-3">
          <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-pastel-sky/60">
            <KeyRound class="h-5 w-5 text-accent" />
          </div>
          <div class="min-w-0 flex-1">
            <h2 class="font-sans text-sm font-bold text-ink">Microsoft Entra ID (SSO)</h2>
            <p class="font-mono text-xs text-ink-light">
              Let users sign in with their Microsoft work account.
            </p>
          </div>
          <label class="flex cursor-pointer items-center gap-2 font-mono text-xs text-ink-muted">
            <input v-model="ssoEnabled" type="checkbox" class="accent-accent" />
            Enabled
          </label>
        </div>

        <div class="mt-6 flex flex-col gap-4">
          <label class="flex flex-col gap-1">
            <span class="font-sans text-xs font-semibold text-ink-muted">Directory (tenant) ID</span>
            <input
              v-model="tenantId"
              class="bg-input"
              placeholder="00000000-0000-0000-0000-000000000000"
            />
          </label>
          <label class="flex flex-col gap-1">
            <span class="font-sans text-xs font-semibold text-ink-muted">Application (client) ID</span>
            <input
              v-model="clientId"
              class="bg-input"
              placeholder="00000000-0000-0000-0000-000000000000"
            />
          </label>
          <label class="flex flex-col gap-1">
            <span class="font-sans text-xs font-semibold text-ink-muted">Allowed email domains</span>
            <input v-model="domains" class="bg-input" placeholder="ptwdosimetry.com, example.com" />
            <span class="font-mono text-[11px] text-ink-light">
              New users from these domains are auto-created as members. Others must already exist.
            </span>
          </label>
        </div>

        <div class="mt-4 rounded-md border border-line bg-pastel-sky/10 px-3 py-2">
          <p class="font-mono text-[11px] text-ink-light">
            In your Azure app registration, register a
            <span class="font-semibold">Single-page application</span> redirect URI:
            <span class="text-ink">{{ redirectUri }}</span>
          </p>
        </div>

        <div class="mt-6">
          <button class="btn-primary" :disabled="savingSso" @click="saveSso">
            <Save class="h-4 w-4" /> {{ savingSso ? 'Saving…' : 'Save SSO settings' }}
          </button>
        </div>
      </div>

      <!-- HTTPS / TLS certificate -->
      <div class="card p-6">
        <div class="flex items-center gap-3">
          <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-pastel-sky/60">
            <Lock class="h-5 w-5 text-accent" />
          </div>
          <div class="min-w-0 flex-1">
            <h2 class="font-sans text-sm font-bold text-ink">HTTPS / TLS certificate</h2>
            <p class="font-mono text-xs text-ink-light">
              The site is served over HTTPS only. Upload the certificate that secures it.
            </p>
          </div>
        </div>

        <!-- Current certificate -->
        <div class="mt-6 rounded-md border border-line bg-pastel-sky/10 px-3 py-3">
          <p class="font-sans text-xs font-semibold text-ink-muted">Active certificate</p>
          <div v-if="tls" class="mt-1 grid grid-cols-1 gap-0.5 font-mono text-[11px] text-ink-light sm:grid-cols-2">
            <span>source: <span class="text-ink">{{ tls.source }}</span></span>
            <span>fingerprint: <span class="text-ink">{{ tls.fingerprint.slice(0, 24) }}…</span></span>
            <span>subject: <span class="text-ink">{{ tls.subject.replace(/\n/g, ', ') }}</span></span>
            <span>issuer: <span class="text-ink">{{ tls.issuer.replace(/\n/g, ', ') }}</span></span>
            <span>valid from: <span class="text-ink">{{ fmtDate(tls.validFrom) }}</span></span>
            <span>valid to: <span class="text-ink">{{ fmtDate(tls.validTo) }}</span></span>
          </div>
          <p v-else class="mt-1 font-mono text-[11px] text-ink-light">No certificate metadata available.</p>
          <p v-if="tlsWarn" class="mt-2 font-mono text-[11px] text-amber-600">⚠ {{ tlsWarn }}</p>
        </div>

        <!-- Upload -->
        <div class="mt-4 flex flex-col gap-4">
          <label class="flex flex-col gap-1">
            <span class="font-sans text-xs font-semibold text-ink-muted">Certificate (PEM)</span>
            <input type="file" accept=".pem,.crt,.cer" class="text-xs" @change="onFile($event, 'cert')" />
            <span v-if="certName" class="font-mono text-[11px] text-ink-light">{{ certName }}</span>
          </label>
          <label class="flex flex-col gap-1">
            <span class="font-sans text-xs font-semibold text-ink-muted">Private key (PEM)</span>
            <input type="file" accept=".pem,.key" class="text-xs" @change="onFile($event, 'key')" />
            <span v-if="keyName" class="font-mono text-[11px] text-ink-light">{{ keyName }}</span>
          </label>
          <label class="flex flex-col gap-1">
            <span class="font-sans text-xs font-semibold text-ink-muted">Chain / intermediates (PEM, optional)</span>
            <input type="file" accept=".pem,.crt,.cer" class="text-xs" @change="onFile($event, 'chain')" />
          </label>
          <p class="font-mono text-[11px] text-ink-light">
            The private key is stored on the server and is never sent back to the browser. A new certificate
            applies to new connections; reload to use it.
          </p>
        </div>

        <div class="mt-6 flex flex-wrap gap-2">
          <button class="btn-primary" :disabled="savingCert" @click="saveCertificate">
            <Save class="h-4 w-4" /> {{ savingCert ? 'Installing…' : 'Install certificate' }}
          </button>
          <button class="btn-ghost" :disabled="regenerating" @click="regenerateSelfSigned">
            {{ regenerating ? 'Regenerating…' : 'Regenerate self-signed' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
