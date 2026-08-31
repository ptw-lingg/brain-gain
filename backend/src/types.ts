// Shared domain types for the BrainGain backend.

// An uploaded learning-material file of any type. The bytes live on disk under DATA_DIR/materials
// keyed by `id`; only this descriptor is stored on the training. Files are downloaded and opened in
// the learner's installed apps — the app never previews them.
export interface MaterialFile {
  id: string; // server-assigned storage key (UUID); also the download path segment
  name: string; // original filename, including extension
  size: number; // bytes
  type: string; // MIME type as reported by the browser ('' when unknown)
}

// One locale's version of a learning material: its own label and its own content. Exactly one of
// url|file survives sanitization (the file wins when both arrive) — see services/materials.ts.
export interface MaterialVariant {
  locale: string; // code from Settings.materialLocales, validated on write
  label: string; // per-locale display label; a file variant defaults to file.name
  url?: string;
  file?: MaterialFile;
}

// A learning material is a GROUP of per-locale variants — at least one, at most one per locale.
// Learners resolve a material to their chosen locale, falling back to English; when English is
// missing too, every variant is offered. Legacy materialLinks/materialFiles records are migrated
// to single-English-variant materials by services/materials.ts#migrateMaterials.
export interface Material {
  id: string; // stable id; server-assigned (UUID) when missing
  variants: MaterialVariant[];
}

// A per-language string: locale code → text. At least one locale is filled; display resolves
// chosen → English → all filled values (the material fallback logic, applied per string).
export type LocalizedText = Record<string, string>;

export interface Question {
  id: string;
  // Localized question text — at least one language filled (legacy plain strings migrate to en).
  text: LocalizedText;
  // Localized answer options. Structure is language-independent: one entry per option, shared
  // across languages, so correctIndices and grading never depend on the display language.
  options: LocalizedText[];
  // Indices into options of every correct answer — always at least one. A question with several is
  // answered correctly only by selecting exactly that set (see the grading in routes/sessions.ts).
  // Legacy records carrying a single `correctIndex` are migrated on boot by services/questions.ts.
  correctIndices: number[];
  // Absent = 'multiple' (legacy records predate the field). 'single' implies exactly one correct
  // index — enforced on write by sanitizeQuestions, re-checked on read by questionType().
  type?: 'single' | 'multiple';
}

// The work-in-progress content of a training: a complete SNAPSHOT (never a delta) of the
// materials/questions the editor is preparing. Staged by PUT /trainings/:id whenever the saved
// content differs from the published content, promoted into the published fields by
// publish-update, discarded via DELETE /trainings/:id/draft — and stripped from every learner
// payload (toPublic), so trainees only ever see the last published version.
export interface TrainingDraft {
  materials: Material[];
  questions: Question[];
  // Staged SCORM package (id into the scormPackages store). Its presence makes the DRAFT
  // SCORM-backed: the package replaces the quiz, so `questions` are kept but unused. Absent/null =
  // a classic training. Like materials/questions this is staged by PUT and promoted by
  // publish-update; the id is validated against the store on write — never trusted as an object.
  scormPackageId?: string;
  savedAt: string; // ISO 8601 — the last content-bearing save
}

// One published content update of a training: the editor changed materials and/or the quiz and
// explicitly decided that assignees who already completed the training must act on it. Appended by
// POST /trainings/:id/publish-update only — never written from a client-supplied training body.
export interface TrainingUpdate {
  id: string; // server-assigned UUID
  publishedAt: string; // ISO 8601, server clock at publish time
  // ISO 8601, normalized to end-of-day UTC of the chosen day, so "due by Aug 31" includes Aug 31.
  deadline: string;
  // 'retake' = a new passing session is required (materials + quiz); 'confirm' = reviewing the
  // updated materials and confirming suffices — the regular cycle clock is not touched.
  mode: 'retake' | 'confirm';
  note?: string; // optional editor note shown to learners
  publishedBy: string; // User id; the audit log is the authoritative record of who published
  version: number; // the training version this publish created (2, 3, 4, …)
}

export interface Training {
  id: string;
  // Localized training master data — per-language maps like Question.text. The name keeps at least
  // one language (enforced on write); description/category may be empty in every language. Legacy
  // plain-string records are wrapped as the English entry at boot (migrateTrainingTexts).
  name: LocalizedText;
  description: LocalizedText;
  // Duration in MINUTES (legacy records stored hours; migrateDurations converts them ×60 at boot).
  durationMinutes: number;
  category: LocalizedText;
  ownerId: string; // trainer (User id) who owns & manages this training
  cycleYears: number; // 1–5: how often a user must repeat the session
  windowBeforeMonths: number; // 0–3: months before the due date the window opens
  windowAfterMonths: number; // 0–3: grace months after the due date before overdue
  order: number; // admin-defined display order across all views (ascending)
  // PUBLISHED learning content — what trainees see and are graded against. Written ONLY by
  // publish-update (which promotes the draft); PUT stages content edits into `draft` instead.
  materials: Material[];
  questions: Question[];
  // Simple content version shown on the card: 0 = never published ("in preparation" — not
  // startable or completable by trainees), the first publish creates 1, each further publish
  // increments. Monotonic — cancelling an update never decrements it (numbers are never reused).
  // Legacy records WITHOUT the field read as published v1 (backfilled by migrateTrainingVersions,
  // which deliberately never coerces an explicit 0 upward).
  version: number;
  // When the current version was published (ISO 8601) — set by EVERY publish, silent ones
  // included (notify updates additionally carry their own publishedAt). Server-managed; absent on
  // legacy records and on never-published trainings, where the publish date is simply unknown.
  publishedAt?: string;
  // Published content updates, append-only and SERVER-MANAGED like `order`: PUT /trainings/:id
  // never reads this from the body. Optional because legacy records lack it; readers use `?? []`.
  updates?: TrainingUpdate[];
  // Work-in-progress content, invisible to learners (stripped by toPublic; masked in audit diffs
  // because it carries the answer key). Absent = no unpublished changes.
  draft?: TrainingDraft;
  // PUBLISHED SCORM package (id into the scormPackages store). Server-managed like `materials`:
  // written ONLY by publish-update (promoting draft.scormPackageId), never read from a PUT body.
  // Presence makes the training SCORM-backed — POST /api/sessions/grade refuses quiz answers for
  // it, and completion runs through the SCORM attempt arm instead. Stripped from learner payloads
  // (toPublic emits only the non-revealing `scorm` summary).
  scormPackageId?: string;
  createdAt: string;
}

// A learner's persisted acknowledgement of a confirm-mode training update — the evidence that the
// updated materials were reviewed. Retake-mode updates are satisfied by a new passing session
// instead and never produce an ack.
export interface UpdateAck {
  id: string;
  userId: string;
  trainingId: string; // denormalized so pruning/filtering never needs to resolve updateId → training
  updateId: string;
  confirmedAt: string; // ISO 8601
}

export interface JobRole {
  id: string;
  name: string;
  description: string;
  trainingIds: string[]; // which trainings this role requires
}

// Organizational unit. Units form a tree via `parentId` (null = the root/company unit). Each unit
// has at most one head (a User id) who is responsible for everyone in that unit and all sub-units.
export interface OrgUnit {
  id: string;
  name: string;
  parentId: string | null; // null = root unit; its name mirrors Settings.companyName
  headUserId: string; // responsible head (User id); '' when not yet assigned
}

export interface User {
  id: string;
  email: string;
  passwordHash?: string; // bcrypt hash (never sent to frontend); absent for SSO-only users
  name: string;
  roleIds: string[];
  // The org unit this user belongs to. Required going forward (enforced on create/import); existing
  // accounts are backfilled to the root unit by migrateOrgUnits(), so it is optional on the stored type.
  orgUnitId?: string;
  isAdmin: boolean;
  isTrainer: boolean;
  entraOid?: string; // Microsoft Entra ID object id, set when an account is linked via SSO
  // Imported users start disabled (cannot sign in via password or SSO) until they activate.
  isDisabled?: boolean;
  // One-time secret for the activation link; present only while the account is pending, removed
  // on activation. Like passwordHash, it is a secret and never leaves the server in a SafeUser.
  activationToken?: string;
  // Profile locale (UI language, en/de) — set the first time the user touches the language switch
  // (PUT /api/auth/me); absent until then, the client falls back to its own detection. Also the
  // default material language in a training session.
  locale?: string;
  // Persisted per-user UI preferences — the "show only due" filter flags. Whitelisted keys only
  // (UI_PREF_KEYS); merged per-key by PUT /api/auth/me so each view updates just its own flag.
  prefs?: Partial<Record<UiPrefKey, boolean>>;
  createdAt: string;
}

/** Keys of persisted per-user UI preferences — the "show only due" filter flags per view. */
export const UI_PREF_KEYS = ['dashboardOnlyDue', 'myTeamOnlyDue', 'traineesOnlyDue'] as const;
export type UiPrefKey = (typeof UI_PREF_KEYS)[number];

// Only PASSED attempts are persisted.
export interface TrainingSession {
  id: string;
  userId: string;
  trainingId: string;
  completedAt: string;
  scorePct: number; // 0–1, fraction correct (>= passThreshold)
  // For a SCORM completion: the server-side attempt this session was signed from — the completion
  // evidence (the attempt file holds the full cmi the course reported). Absent on quiz sessions.
  scormAttemptId?: string;
}

// Microsoft Entra ID (Azure AD) single sign-on configuration — admin-editable via Settings.
// Holds no secrets: this flow validates ID tokens only (no client secret / auth-code exchange).
export interface EntraSsoSettings {
  enabled: boolean;
  tenantId: string; // Directory (tenant) ID
  clientId: string; // Application (client) ID
  allowedDomains: string[]; // email domains permitted to auto-provision a new member
}

// TLS certificate metadata shown in the UI. The private key and cert PEM are NEVER stored here or
// returned by any API — only this non-secret metadata, derived from the active certificate.
export interface TlsSettings {
  source: 'self-signed' | 'uploaded';
  subject: string;
  issuer: string;
  validFrom: string;
  validTo: string;
  fingerprint: string; // SHA-256
  updatedAt: string;
}

// Automatic scheduled backups — admin-editable via Settings. When enabled, the server creates a
// backup whenever the newest AUTOMATIC backup is older than `intervalDays` (checked hourly and at
// boot, so a missed run is caught up), and keeps only the newest `keep` automatic backups. Manual,
// uploaded and pre-restore backups are never touched by that retention (see services/autoBackup.ts).
export interface AutoBackupSettings {
  enabled: boolean; // off by default — automatic snapshots are the admin's choice
  intervalDays: number; // days between automatic backups (integer, clamped 1..365)
  keep: number; // how many automatic backups to retain (integer, clamped 1..100)
}

// Outbound email (SMTP) configuration — admin-editable via Settings. `password` is a secret and is
// NEVER returned by the API (GET /settings redacts it to '' and exposes only `passwordSet`).
export interface SmtpSettings {
  enabled: boolean;
  host: string;
  port: number; // typically 587 (STARTTLS) or 465 (implicit TLS)
  secure: boolean; // true = implicit TLS (port 465); false = STARTTLS/plain
  username: string; // SMTP auth user ('' = no auth)
  password: string; // SMTP auth password — secret, never sent to the client
  fromName: string; // display name on the From header
  fromAddress: string; // From address; required to send
}

export interface Settings {
  passThreshold: number; // 0–1, default 0.8
  // When true, the response to a FAILED attempt names the questions that were answered wrong
  // (indices only — never the correct answers). Off by default: with unlimited retries, telling a
  // learner which questions were wrong makes brute-forcing the quiz easier, so it is an admin choice.
  revealWrongQuestions: boolean;
  companyName: string; // names the root org unit; admin-editable in Settings
  entra: EntraSsoSettings;
  tls: TlsSettings | null; // metadata for the active TLS certificate (managed via /settings/certificate)
  smtp: SmtpSettings; // outbound email configuration
  autoBackup: AutoBackupSettings; // automatic scheduled backups
}

export type SafeUser = Omit<User, 'passwordHash' | 'entraOid' | 'activationToken'>;

// 'updated' = the cycle is satisfied but a published training update is pending for this user —
// a different sort of due, caused by a content update rather than the recurrence cycle.
export type DueStatus = 'never' | 'up-to-date' | 'due' | 'overdue' | 'updated';

// Training with the answer key AND the work-in-progress draft stripped — what a learner is
// allowed to see. The question `type` stays in (the learner UI needs it to pick radio vs checkbox
// controls); for multiple-choice questions the COUNT of correct answers is still withheld, not
// just which ones. A single-choice question discloses "exactly one" by design.
// `scormPackageId` is stripped too: a learner gets only the non-revealing `scorm` summary — never
// the package id, entry file, mastery score or manifest internals.
export type PublicTraining = Omit<Training, 'questions' | 'draft' | 'scormPackageId'> & {
  questions: Omit<Question, 'correctIndices'>[];
  scorm?: PublicScormInfo;
};

export interface DueTraining {
  training: PublicTraining;
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

// ── Audit trail ──────────────────────────────────────────────────────────────────────────────────

// Every kind of event the audit trail records. Reads are never audited; see services/audit.ts for
// the full scope (and the deliberate exclusions).
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
  | 'training-draft-discarded'
  | 'scorm-imported'
  | 'scorm-rejected';

export type AuditEntityType =
  | 'user'
  | 'role'
  | 'training'
  | 'material'
  | 'orgUnit'
  | 'settings'
  | 'backup'
  | 'auth'
  | 'session'
  | 'scormPackage';

// One changed field on an update. Secret fields are recorded as '***' → '***' — the CHANGE is
// visible, the values never are (see REDACT_FIELDS in services/audit.ts).
export interface AuditChange {
  field: string; // top-level field name, or a dot-path for nested settings (e.g. 'smtp.host')
  from: unknown;
  to: unknown;
}

// One line of the append-only audit log (data/audit.ndjson). Entries are written once and never
// rewritten or pruned.
export interface AuditEntry {
  id: string; // UUID
  timestamp: string; // ISO 8601
  // Who acted. null = no authenticated actor (failed sign-in, account activation, automatic backup).
  // Carries the impersonator when the action happened inside an impersonation session.
  actor: {
    id: string;
    email: string;
    impersonatorId?: string;
    impersonatorEmail?: string;
  } | null;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: string; // '' when no single entity applies (e.g. a reorder)
  entityName: string; // human-readable label captured at event time
  changes?: AuditChange[]; // field-level diffs on updates (redacted)
  details?: string; // free text: score, counts, failure reason, safety backup id…
}

// ── SCORM ────────────────────────────────────────────────────────────────────────────────────────

/** Which SCORM data model a package speaks. '2004' covers the tolerated 3rd/4th-edition subset. */
export type ScormVersion = '1.2' | '2004';

/** Trainer-chosen rule for when a SCORM attempt counts as completable — enforced SERVER-side.
 *  'status' = the course must report completed/passed (spec-correct default);
 *  'exit'   = a clean Terminate/LMSFinish suffices, whatever the status (covers courses that
 *             report 'incomplete' forever);
 *  'time'   = signable after the training's duration of SERVER-clocked in-content time (covers
 *             courses that report nothing at all). The rule relied upon is recorded in the audit
 *             trail with every completion. */
export type ScormCompletionRule = 'status' | 'exit' | 'time';

/**
 * An imported SCORM package — the descriptor only. The extracted files live on disk under
 * DATA_DIR/scorm/<packageId>/ with their ORIGINAL relative paths preserved: an SCO's HTML resolves
 * its assets relatively, so unlike uploaded materials these names cannot be flattened (see
 * services/scorm/import.ts for the zip-slip guard that makes that safe). Records are immutable
 * after import apart from the two trainer options: a new course build is a NEW package, staged in
 * the training's draft and promoted by publish-update, exactly like material files.
 */
export interface ScormPackageRef {
  packageId: string; // server-assigned UUID; also the directory name and content-URL segment
  // From the manifest — UNTRUSTED text. Render with {{ }} only; never v-html, never into
  // :href/:src/:style, never into pdfmake markup.
  title: string;
  version: ScormVersion; // detected from the manifest, never client-supplied
  entryHref: string; // POSIX-relative launch path of the single SCO, URL-decoded and validated
  launchParameters?: string; // <item parameters="…"> — appended to the launch URL
  // Manifest mastery score normalized to 0–1 (1.2 adlcp:masteryscore /100, 2004
  // minNormalizedMeasure as-is). ADVISORY only — it is handed to the SCO (which grades itself
  // with it); the pass decision uses the SCO's success verdict plus Settings.passThreshold.
  masteryScore: number | null;
  dataFromLms?: string; // manifest <adlcp:datafromlms> — seeded as cmi.launch_data
  manifestIdentifier: string; // <manifest identifier="…"> — traceability in the audit trail
  fileCount: number; // extracted files (directories excluded)
  bytes: number; // total uncompressed size on disk
  sha256: string; // hash of the uploaded ZIP — dedupe + traceability evidence
  originalFileName: string; // sanitized upload name, for the editor UI and the audit trail
  uploadedBy: string; // User id
  uploadedAt: string; // ISO 8601
  completionRule: ScormCompletionRule;
  // Widens the content-origin CSP connect-src/img-src/font-src/media-src to https: for packages
  // that genuinely need a CDN or telemetry endpoint. Default false — packages talk to no one.
  allowExternal: boolean;
}

/** What a LEARNER may know about a SCORM-backed training: that it is one, and how it is titled. */
export interface PublicScormInfo {
  version: ScormVersion;
  title: string;
}

export type ScormCompletionStatus = 'unknown' | 'not attempted' | 'incomplete' | 'completed';
export type ScormSuccessStatus = 'unknown' | 'passed' | 'failed';
export type ScormAttemptStatus = 'in-progress' | 'completed' | 'failed' | 'abandoned';

/**
 * The internal, version-neutral cmi model. Both the 1.2 element names (cmi.core.*) and the 2004
 * names map onto THIS — see scorm/model.ts for the single mapping table used in both directions.
 * Interactions/objectives and tolerated unmodelled writable elements are kept as VERBATIM
 * key→value maps (capped): they are evidence of what the learner answered, round-trip exactly,
 * and are never re-encoded.
 */
export interface ScormCmi {
  location: string; // 1.2 cmi.core.lesson_location | 2004 cmi.location
  // Opaque course bookmark blob. Capped at 64k chars for BOTH dialects — the 1.2 spec says 4096,
  // but Storyline routinely exceeds it and expects a byte-exact read-back; truncating breaks
  // resume. Over-cap writes are REJECTED (SCORM error), never silently truncated.
  suspendData: string;
  completion: ScormCompletionStatus;
  success: ScormSuccessStatus;
  entry: 'ab-initio' | 'resume' | '';
  exit: '' | 'time-out' | 'suspend' | 'logout' | 'normal';
  score: { raw: number | null; min: number | null; max: number | null; scaled: number | null };
  progressMeasure: number | null; // 2004 only
  sessionTimeSec: number; // the LAST reported session_time of the current browser session
  totalTimeSec: number; // accumulated across sessions — SERVER-computed, read-only for content
  // cmi.interactions.N.* / cmi.objectives.N.* exactly as written (key → value), capped.
  interactions: Record<string, string>;
  objectives: Record<string, string>;
  // Tolerated but unmodelled writable elements (comments, vendor extensions), verbatim, capped.
  extra: Record<string, string>;
}

/**
 * A learner's run of a SCORM package. The per-attempt FILE (DATA_DIR/scorm-attempts/<id>.json,
 * shape ScormAttemptFile) is the source of truth for `cmi`; this index record is denormalized for
 * resume lookup, launch-token revocation, trainer diagnostics and GC, refreshed on lifecycle
 * transitions only. The completion arm always re-reads the FILE and never trusts the index.
 */
export interface ScormAttempt {
  id: string;
  userId: string;
  trainingId: string;
  packageId: string; // pins the attempt to the package build it launched against
  trainingVersion: number; // a later publish invalidates resume (suspend_data is build-specific)
  scormVersion: ScormVersion;
  status: ScormAttemptStatus;
  // A trainer/admin trial run, or any attempt launched inside an IMPERSONATION session. Never
  // consumable into a TrainingSession; the SCO sees mode='browse' / credit='no-credit'.
  preview: boolean;
  startedAt: string; // ISO 8601
  lastActivityAt: string; // bumped on every commit; drives the stale-attempt sweep
  // SERVER-clocked in-content seconds (capped deltas between commits) — the 'time' completion
  // rule uses this, never a client-reported total_time.
  activeSec: number;
  terminated: boolean; // a clean Terminate/LMSFinish was received — the 'exit' rule uses this
  completedAt?: string; // when the course first reported completion
  // The TrainingSession this attempt was signed into. Set once; its presence blocks replay and
  // revokes the launch token. A consumed attempt (and its file) is completion evidence — never GC'd.
  consumedBySessionId?: string;
  // Denormalized from the file for list views; advisory only (see the note above).
  completion: ScormCompletionStatus;
  success: ScormSuccessStatus;
  scoreScaled: number | null;
  setValuesCount: number; // diagnostics: how many data-model writes the course made
}

/** The full attempt as persisted on disk: the index record plus the authoritative cmi model. */
export interface ScormAttemptFile {
  attempt: ScormAttempt;
  cmi: ScormCmi;
  rev: number; // monotonic write counter — cheap concurrency/debug aid
}

// JWT payload attached to authenticated requests.
export interface AuthUser {
  id: string;
  email: string;
  isAdmin: boolean;
  isTrainer: boolean;
  // Set only on an impersonation token: the admin who started the session. Lets the backend
  // refuse nested impersonation and audit who is acting as whom; the frontend uses its presence
  // to show the "viewing as" banner.
  impersonatorId?: string;
  impersonatorEmail?: string;
}
