// Shared domain types for the BrainGain backend.

export interface MaterialLink {
  label: string;
  url: string;
}

// An uploaded learning-material file of any type. The bytes live on disk under DATA_DIR/materials
// keyed by `id`; only this descriptor is stored on the training. Files are downloaded and opened in
// the learner's installed apps — the app never previews them.
export interface MaterialFile {
  id: string; // server-assigned storage key (UUID); also the download path segment
  name: string; // original filename, including extension
  size: number; // bytes
  type: string; // MIME type as reported by the browser ('' when unknown)
}

export interface Question {
  id: string;
  text: string;
  options: string[];
  // Indices into options of every correct answer — always at least one. A question with several is
  // answered correctly only by selecting exactly that set (see the grading in routes/sessions.ts).
  // Legacy records carrying a single `correctIndex` are migrated on boot by services/questions.ts.
  correctIndices: number[];
  // Absent = 'multiple' (legacy records predate the field). 'single' implies exactly one correct
  // index — enforced on write by sanitizeQuestions, re-checked on read by questionType().
  type?: 'single' | 'multiple';
}

export interface Training {
  id: string;
  name: string;
  description: string;
  durationHours: number;
  category: string;
  ownerId: string; // trainer (User id) who owns & manages this training
  cycleYears: number; // 1–5: how often a user must repeat the session
  windowBeforeMonths: number; // 0–3: months before the due date the window opens
  windowAfterMonths: number; // 0–3: grace months after the due date before overdue
  order: number; // admin-defined display order across all views (ascending)
  materialLinks: MaterialLink[];
  materialFiles: MaterialFile[]; // uploaded files of any type (download-only, no in-app preview)
  questions: Question[];
  createdAt: string;
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
  createdAt: string;
}

// Only PASSED attempts are persisted.
export interface TrainingSession {
  id: string;
  userId: string;
  trainingId: string;
  completedAt: string;
  scorePct: number; // 0–1, fraction correct (>= passThreshold)
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
}

export type SafeUser = Omit<User, 'passwordHash' | 'entraOid' | 'activationToken'>;

export type DueStatus = 'never' | 'up-to-date' | 'due' | 'overdue';

// Training with the answer key stripped — what a learner is allowed to see. The question `type`
// stays in (the learner UI needs it to pick radio vs checkbox controls); for multiple-choice
// questions the COUNT of correct answers is still withheld, not just which ones. A single-choice
// question discloses "exactly one" by design.
export type PublicTraining = Omit<Training, 'questions'> & {
  questions: Omit<Question, 'correctIndices'>[];
};

export interface DueTraining {
  training: PublicTraining;
  status: DueStatus;
  dueDate: string | null;
  lastPassedAt: string | null;
}

export interface TraineeGroup {
  training: Training;
  trainees: {
    user: SafeUser;
    status: DueStatus;
    dueDate: string | null;
  }[];
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
