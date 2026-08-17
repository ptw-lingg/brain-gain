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
  savedAt: string;
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
  updates?: TrainingUpdate[]; // published updates, append-only, server-managed
  draft?: TrainingDraft; // WIP content — editor-facing payloads only, never sent to learners
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
  isDisabled?: boolean; // true while an imported account is pending activation (cannot sign in)
  // Persisted profile locale (UI language, en/de); absent until the user first picks a language.
  // Applied at sign-in and used as the default material language in a training session.
  locale?: string;
  createdAt: string;
}

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
  correct: number;
  total: number;
  // Indices of wrongly answered questions — present only on a FAILED attempt and only when the
  // admin has enabled revealWrongQuestions in Settings.
  wrongIndices?: number[];
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
