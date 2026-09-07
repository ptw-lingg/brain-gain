// An uploaded learning-material file of any type. Downloaded and opened in the learner's installed
// apps — never previewed in the app. The bytes live on the server keyed by `id`.
export interface MaterialFile {
  id: string;
  name: string;
  size: number;
  type: string;
}

// One locale's version of a learning material: its own label and its own content — a web link or an
// uploaded file (exactly one; the server keeps the file when both are sent).
export interface MaterialVariant {
  locale: string; // code from Settings.materialLocales
  label: string;
  url?: string;
  file?: MaterialFile;
}

// A learning material is a GROUP of per-locale variants — at least one, at most one per locale.
// Learners resolve it to their chosen language, falling back to English; when English is missing
// too, every variant is offered.
export interface Material {
  id: string; // server-assigned when saved with an empty id
  variants: MaterialVariant[];
}

// A per-language string: locale code → text. At least one locale is filled; display resolves
// chosen → English → all filled values (the material fallback logic, applied per string).
export type LocalizedText = Record<string, string>;

export interface Question {
  id: string;
  // Localized question text — at least one language filled.
  text: LocalizedText;
  // Localized answer options; the option list itself (count/order/answer key) is shared across
  // languages, only the strings vary.
  options: LocalizedText[];
  // The answer key: indices of every correct option, at least one. Present only for owners/admins —
  // a learner's payload omits it entirely, so for a multiple-choice question they cannot tell how
  // many answers are correct either.
  correctIndices?: number[];
  // 'single' = radio buttons, exactly one correct answer; 'multiple' = checkboxes. Absent on
  // records saved before the field existed — treated as 'multiple'.
  type?: 'single' | 'multiple';
}

// The work-in-progress content of a training (see backend TrainingDraft): a complete snapshot of
// the materials/questions the editor is preparing. Present only on editor-facing payloads —
// learners never receive it; they see the published content until the draft is published.
export interface TrainingDraft {
  materials: Material[];
  questions: Question[];
  // Staged SCORM package id. Present = the draft is SCORM-backed (the package replaces the quiz).
  scormPackageId?: string;
  savedAt: string;
}

// ── SCORM (see backend/src/types.ts for the full rationale on every field) ───────────────────────

export type ScormVersion = '1.2' | '2004';
export type ScormCompletionRule = 'status' | 'exit' | 'time';

// An imported SCORM package descriptor — trainer/admin payloads only.
export interface ScormPackageRef {
  packageId: string;
  // From the manifest — UNTRUSTED text. Render with {{ }} only; never v-html, never into
  // :href/:src/:style, never into pdfmake markup.
  title: string;
  version: ScormVersion;
  entryHref: string;
  launchParameters?: string;
  masteryScore: number | null; // normalized 0–1; advisory (the SCO grades itself with it)
  dataFromLms?: string;
  manifestIdentifier: string;
  fileCount: number;
  bytes: number;
  sha256: string;
  originalFileName: string;
  // Cover candidate found in the package at import (vendor conventions — no SCORM element defines
  // one). Offered to the trainer in the editor; fetched via /scorm-packages/:id/thumbnail.
  thumbnailHref?: string | null;
  uploadedBy: string;
  uploadedAt: string;
  completionRule: ScormCompletionRule;
  allowExternal: boolean;
}

/** What a LEARNER sees of a SCORM-backed training — deliberately nothing else. */
export interface PublicScormInfo {
  version: ScormVersion;
  title: string;
}

/** Response of POST /api/sessions/scorm/launch — everything the player needs for one run. */
export interface ScormLaunch {
  attemptId: string;
  resumed: boolean;
  contentOrigin: string; // the exact origin every postMessage is pinned to, both directions
  url: string; // wrapper URL on the content origin, token in the path
  nonce: string; // per-launch bridge secret
  version: ScormVersion;
  cmi: Record<string, string>; // the COMPLETE seed — shim reads never hit the network
  readOnly: readonly string[];
  preview: boolean;
  completionRule: ScormCompletionRule;
  masteryScore: number | null;
  expiresAt: string;
}

/** One row of the trainer diagnostics list (GET /api/trainings/:id/scorm-attempts). */
export interface ScormAttemptSummary {
  id: string;
  userId: string;
  userEmail: string;
  status: 'in-progress' | 'completed' | 'failed' | 'abandoned';
  preview: boolean;
  startedAt: string;
  lastActivityAt: string;
  activeSec: number;
  terminated: boolean;
  completion: string;
  success: string;
  scoreScaled: number | null;
  setValuesCount: number;
}

// One published content update of a training (see backend TrainingUpdate): the editor changed
// materials and/or the quiz and decided that prior completers must act on it.
export interface TrainingUpdate {
  id: string;
  publishedAt: string;
  deadline: string; // end-of-day UTC of the chosen day
  // 'retake' = a new passing session is required; 'confirm' = reviewing + confirming suffices.
  mode: 'retake' | 'confirm';
  note?: string;
  publishedBy: string;
  version: number; // the training version this publish created (2, 3, 4, …)
}

export interface Training {
  id: string;
  // Localized training master data — per-language maps like Question.text. The name keeps at least
  // one language (enforced by the server); description/category may be empty in every language.
  name: LocalizedText;
  description: LocalizedText;
  durationMinutes: number;
  category: LocalizedText;
  ownerId: string;
  cycleYears: number;
  windowBeforeMonths: number;
  windowAfterMonths: number;
  order: number;
  // PUBLISHED learning content — what trainees see and are graded against.
  materials: Material[];
  questions: Question[];
  // Content version shown on the card: 0 = never published ("in preparation"), the first publish
  // creates 1, every further publish increments. Server-managed.
  version: number;
  publishedAt?: string; // when the current version was published — set by every publish; server-managed
  updates?: TrainingUpdate[]; // published updates, append-only, server-managed
  draft?: TrainingDraft; // WIP content — editor-facing payloads only, never sent to learners
  // SCORM: owner/admin payloads carry the raw published package id (+ resolved descriptors on the
  // single-training view); learner payloads carry ONLY the `scorm` summary. In the EDITOR copy this
  // field holds the WIP value sent on save — an explicit null detaches the package (undefined would
  // be stripped by JSON and read as "keep").
  scormPackageId?: string | null;
  // Cover image of the learner's training card — master data applied immediately on save (never
  // staged). Uploaded through the material upload endpoint; the card fetches the bytes with the
  // Authorization header. In the EDITOR copy an explicit null removes it (undefined = keep).
  previewImage?: MaterialFile | null;
  scormPackages?: { published: ScormPackageRef | null; draft: ScormPackageRef | null };
  scorm?: PublicScormInfo;
  createdAt: string;
}

export interface JobRole {
  id: string;
  name: string;
  description: string;
  trainingIds: string[];
}

export interface OrgUnit {
  id: string;
  name: string;
  parentId: string | null; // null = root (company) unit
  headUserId: string; // responsible head (User id); '' when unassigned
}

export interface SafeUser {
  id: string;
  email: string;
  name: string;
  roleIds: string[];
  orgUnitId?: string; // the org unit this user belongs to
  isAdmin: boolean;
  isTrainer: boolean;
  isHead?: boolean; // derived: true when this user heads at least one org unit (drives "My Team")
  hasPassword?: boolean; // derived: whether a local password exists (drives the signature dialog)
  isDisabled?: boolean; // true while an imported account is pending activation (cannot sign in)
  // Persisted profile locale (UI language, en/de); absent until the user first picks a language.
  // Applied at sign-in and used as the default material language in a training session.
  locale?: string;
  // Persisted per-user UI preferences — the "show only due" filter flags per view.
  prefs?: Partial<Record<UiPrefKey, boolean>>;
  createdAt: string;
}

/** Keys of persisted per-user UI preferences — the "show only due" filter flags per view. */
export const UI_PREF_KEYS = ['dashboardOnlyDue', 'myTeamOnlyDue', 'traineesOnlyDue'] as const;
export type UiPrefKey = (typeof UI_PREF_KEYS)[number];

// Head oversight payload from GET /api/org-units/my-team.
export interface TeamMember {
  user: SafeUser;
  orgUnitName: string;
  // `name` is the training's localized name, passed through unchanged — the UI resolves it.
  trainings: { id: string; name: LocalizedText; status: DueStatus; dueDate: string | null }[];
}

export interface MyTeam {
  units: OrgUnit[];
  members: TeamMember[];
}

export interface TrainingSession {
  id: string;
  userId: string;
  trainingId: string;
  completedAt: string;
  scorePct: number;
  scormAttemptId?: string; // SCORM completions: the server-side attempt behind this session
}

export interface EntraSsoSettings {
  enabled: boolean;
  tenantId: string;
  clientId: string;
  allowedDomains: string[];
}

export interface TlsSettings {
  source: 'self-signed' | 'uploaded';
  subject: string;
  issuer: string;
  validFrom: string;
  validTo: string;
  fingerprint: string;
  updatedAt: string;
}

// Outbound email (SMTP). The password is write-only: the API never returns it, exposing only
// `passwordSet` so the UI can show whether one is stored.
export interface SmtpSettings {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password?: string; // sent when changing it; never returned by the API
  passwordSet?: boolean; // returned by the API: whether a password is stored
  fromName: string;
  fromAddress: string;
}

// Automatic scheduled backups: when enabled the server snapshots all data every `intervalDays`
// days and keeps only the newest `keep` automatic backups (other backup sources are never pruned).
export interface AutoBackupSettings {
  enabled: boolean;
  intervalDays: number;
  keep: number;
}

export interface Settings {
  passThreshold: number;
  // When on, a failed attempt's grade response names the wrongly answered questions (default off).
  revealWrongQuestions: boolean;
  companyName: string;
  entra: EntraSsoSettings;
  tls: TlsSettings | null;
  smtp: SmtpSettings;
  autoBackup: AutoBackupSettings;
}

// 'updated' = the cycle is satisfied but a published training update is pending for this user —
// a different sort of due, caused by a content update rather than the recurrence cycle.
export type DueStatus = 'never' | 'up-to-date' | 'due' | 'overdue' | 'updated';

export interface DueTraining {
  training: Training;
  status: DueStatus;
  dueDate: string | null;
  lastPassedAt: string | null;
  // Non-null exactly when status === 'updated': the pending update the learner must act on.
  pendingUpdate: TrainingUpdate | null;
}

export interface TraineeGroup {
  training: Training;
  trainees: {
    user: SafeUser;
    status: DueStatus;
    dueDate: string | null;
  }[];
}

/** POST /api/trainings/:id/publish-update response — a silent publish carries only the version. */
export interface PublishUpdateResponse {
  version: number;
  update?: TrainingUpdate;
  affected?: number;
  email?: { sent: number } | { skipped: 'not-configured' | 'no-recipients' } | { failed: true };
}

export interface GradeResult {
  scorePct: number;
  passed: boolean;
  passThreshold: number;
  // Quiz gradings only — a SCORM grading carries success/completion instead.
  correct?: number;
  total?: number;
  // Indices of wrongly answered questions — present only on a FAILED attempt and only when the
  // admin has enabled revealWrongQuestions in Settings.
  wrongIndices?: number[];
  // SCORM gradings only: the course's own verdict as recorded server-side.
  success?: string;
  completion?: string;
}

/** A server-side backup archive of all app data (see backend/src/services/backup.ts). */
export interface BackupMeta {
  id: string;
  fileName: string;
  createdAt: string;
  size: number;
  source: 'manual' | 'pre-restore' | 'upload' | 'auto';
  contents: { users: number; trainings: number; materials: number };
}

// ── Audit trail (see backend/src/services/audit.ts) ──────────────────────────────────────────────

export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'import'
  | 'login'
  | 'login-failed'
  | 'sso-login'
  | 'activate'
  | 'impersonate'
  | 'backup-create'
  | 'backup-upload'
  | 'backup-delete'
  | 'backup-restore'
  | 'backup-restore-failed'
  | 'materials-confirmed'
  | 'training-completed'
  | 'training-update-published'
  | 'training-update-confirmed'
  | 'training-update-cancelled'
  | 'training-draft-discarded';

export type AuditEntityType =
  | 'user'
  | 'role'
  | 'training'
  | 'material'
  | 'orgUnit'
  | 'settings'
  | 'backup'
  | 'auth'
  | 'session';

/** One changed field on an update; secret values arrive masked as '***'. */
export interface AuditChange {
  field: string;
  from: unknown;
  to: unknown;
}

export interface AuditEntry {
  id: string;
  timestamp: string;
  actor: {
    id: string;
    email: string;
    impersonatorId?: string;
    impersonatorEmail?: string;
  } | null;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: string;
  entityName: string;
  changes?: AuditChange[];
  details?: string;
}

/** GET /api/audit response: one filtered page, newest first, plus the filtered total for paging. */
export interface AuditListResponse {
  total: number;
  entries: AuditEntry[];
}

/**
 * GET /api/trainings/:id/trainer — the owning trainer's contact card, shown to trainees so
 * questions reach the right person. Name, org unit and email identify the trainer in the company
 * address list.
 */
export interface TrainerContact {
  name: string;
  email: string;
  orgUnitName: string;
}
