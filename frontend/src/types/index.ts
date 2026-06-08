export interface MaterialLink {
  label: string;
  url: string;
}

export interface Question {
  id: string;
  text: string;
  options: string[];
  correctIndex?: number; // present only for owners/admins
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
  materialLinks: MaterialLink[];
  questions: Question[];
  createdAt: string;
}

export interface JobRole {
  id: string;
  name: string;
  description: string;
  trainingIds: string[];
}

export interface SafeUser {
  id: string;
  email: string;
  name: string;
  roleIds: string[];
  isAdmin: boolean;
  isTrainer: boolean;
  isDisabled?: boolean; // true while an imported account is pending activation (cannot sign in)
  createdAt: string;
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

export interface Settings {
  passThreshold: number;
  entra: EntraSsoSettings;
  tls: TlsSettings | null;
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
}
