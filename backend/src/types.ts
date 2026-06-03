// Shared domain types for the BrainGain backend.

export interface MaterialLink {
  label: string;
  url: string;
}

export interface Question {
  id: string;
  text: string;
  options: string[];
  correctIndex: number; // index into options of the single correct answer
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
  questions: Question[];
  createdAt: string;
}

export interface JobRole {
  id: string;
  name: string;
  description: string;
  trainingIds: string[]; // which trainings this role requires
}

export interface User {
  id: string;
  email: string;
  passwordHash: string; // bcrypt hash (never sent to frontend)
  name: string;
  roleIds: string[];
  isAdmin: boolean;
  isTrainer: boolean;
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

export interface Settings {
  passThreshold: number; // 0–1, default 0.8
}

export type SafeUser = Omit<User, 'passwordHash'>;

export type DueStatus = 'never' | 'up-to-date' | 'due' | 'overdue';

// Training with correctIndex stripped — what a learner is allowed to see.
export type PublicTraining = Omit<Training, 'questions'> & {
  questions: Omit<Question, 'correctIndex'>[];
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
}
