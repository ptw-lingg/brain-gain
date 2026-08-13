import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import type { JobRole, Training, User } from './types';
import { readSettings, readStore, writeStore } from './services/fileStore';

/**
 * Seed a demo dataset on first run (only when there are no users yet):
 * one admin, one trainer, one regular user, a role, and a training the trainer owns.
 */
export async function seed(): Promise<void> {
  await readSettings(); // ensures settings.json exists with { passThreshold: 0.8 }

  const users = await readStore<User>('users');
  if (users.length > 0) return;

  const now = new Date().toISOString();

  const admin: User = {
    id: randomUUID(),
    email: 'admin@braingain.app',
    passwordHash: await bcrypt.hash('admin123', 10),
    name: 'Ada Admin',
    roleIds: [],
    isAdmin: true,
    isTrainer: false,
    createdAt: now,
  };

  const trainer: User = {
    id: randomUUID(),
    email: 'trainer@braingain.app',
    passwordHash: await bcrypt.hash('trainer123', 10),
    name: 'Tom Trainer',
    roleIds: [],
    isAdmin: false,
    isTrainer: true,
    createdAt: now,
  };

  const safetyTraining: Training = {
    id: randomUUID(),
    name: { en: 'Laboratory Safety Basics' },
    description: { en: 'Core safety procedures for working in the dosimetry lab.' },
    durationMinutes: 120,
    category: { en: 'Safety' },
    ownerId: trainer.id,
    cycleYears: 1,
    windowBeforeMonths: 2,
    windowAfterMonths: 1,
    order: 0,
    materials: [
      {
        id: randomUUID(),
        variants: [
          { locale: 'en', label: 'Lab Safety Handbook', url: 'https://docs.example.com/lab-safety-handbook' },
        ],
      },
      {
        id: randomUUID(),
        variants: [
          { locale: 'en', label: 'Emergency Procedures', url: 'https://docs.example.com/emergency-procedures' },
        ],
      },
    ],
    questions: [
      {
        id: randomUUID(),
        text: { en: 'What should you do first in case of a chemical spill?' },
        options: [{ en: 'Ignore it' }, { en: 'Alert others and contain the area' }, { en: 'Take a photo' }, { en: 'Leave the building' }],
        correctIndices: [1],
      },
      {
        id: randomUUID(),
        text: { en: 'Where is personal protective equipment (PPE) stored?' },
        options: [{ en: 'At home' }, { en: 'In the designated PPE cabinet' }, { en: 'Anywhere convenient' }, { en: 'It is optional' }],
        correctIndices: [1],
      },
      {
        id: randomUUID(),
        text: { en: 'How often must this training be repeated?' },
        options: [{ en: 'Never' }, { en: 'Every month' }, { en: 'Every year' }, { en: 'Every 10 years' }],
        correctIndices: [2],
      },
    ],
    createdAt: now,
  };

  const qualityTraining: Training = {
    id: randomUUID(),
    name: { en: 'Quality Management Intro' },
    description: { en: 'Introduction to ISO quality processes used across the company.' },
    durationMinutes: 180,
    category: { en: 'Compliance' },
    ownerId: trainer.id,
    cycleYears: 3,
    windowBeforeMonths: 3,
    windowAfterMonths: 3,
    order: 1,
    materials: [
      {
        id: randomUUID(),
        variants: [{ locale: 'en', label: 'QM Handbook', url: 'https://docs.example.com/qm-handbook' }],
      },
    ],
    questions: [
      {
        id: randomUUID(),
        text: { en: 'What does ISO 9001 primarily address?' },
        options: [{ en: 'Quality management systems' }, { en: 'Environmental policy' }, { en: 'IT security' }, { en: 'Payroll' }],
        correctIndices: [0],
      },
      {
        id: randomUUID(),
        text: { en: 'Who is responsible for quality?' },
        options: [{ en: 'Only managers' }, { en: 'Only auditors' }, { en: 'Everyone' }, { en: 'No one' }],
        correctIndices: [2],
      },
    ],
    createdAt: now,
  };

  const labRole: JobRole = {
    id: randomUUID(),
    name: 'Lab Technician',
    description: 'Works hands-on in the dosimetry laboratory.',
    trainingIds: [safetyTraining.id, qualityTraining.id],
  };

  const learner: User = {
    id: randomUUID(),
    email: 'user@braingain.app',
    passwordHash: await bcrypt.hash('user123', 10),
    name: 'Uma User',
    roleIds: [labRole.id],
    isAdmin: false,
    isTrainer: false,
    createdAt: now,
  };

  await writeStore('users', [admin, trainer, learner]);
  await writeStore('roles', [labRole]);
  await writeStore('trainings', [safetyTraining, qualityTraining]);
  await writeStore('sessions', []);

  console.log('🌱 Seeded demo data:');
  console.log('   admin@braingain.app / admin123');
  console.log('   trainer@braingain.app / trainer123');
  console.log('   user@braingain.app / user123');
}
