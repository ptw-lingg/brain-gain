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

export interface Question {
  id: string;
  text: string;
  options: string[];
  // The answer key: indices of every correct option, at least one. Present only for owners/admins —
  // a learner's payload omits it entirely, so for a multiple-choice question they cannot tell how
  // many answers are correct either.
  correctIndices?: number[];
  // 'single' = radio buttons, exactly one correct answer; 'multiple' = checkboxes. Absent on
  // records saved before the field existed — treated as 'multiple'.
  type?: 'single' | 'multiple';
}

export interface Training {
  id: string;
  name: string;
  description: string;
  durationHours: number;
  category: string;
  ownerId: string;
  cycleYears: number;
  windowBeforeMonths: number;
  windowAfterMonths: number;
  order: number;
  materials: Material[];
  questions: Question[];
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
  trainings: { id: string; name: string; status: DueStatus; dueDate: string | null }[];
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

export interface Settings {
  passThreshold: number;
  // When on, a failed attempt's grade response names the wrongly answered questions (default off).
  revealWrongQuestions: boolean;
  // Languages trainers can provide material in — always contains 'en' (default & fallback).
  materialLocales: string[];
  companyName: string;
  entra: EntraSsoSettings;
  tls: TlsSettings | null;
  smtp: SmtpSettings;
}

export type DueStatus = 'never' | 'up-to-date' | 'due' | 'overdue';

export interface DueTraining {
  training: Training;
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
  source: 'manual' | 'pre-restore' | 'upload';
  contents: { users: number; trainings: number; materials: number };
}
