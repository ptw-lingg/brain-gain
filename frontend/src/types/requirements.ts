// Types for the generated requirements dataset (requirements/requirements.json →
// frontend/src/data/requirements.generated.json). Mirrors requirements/schema/requirements.schema.json.

export type RequirementType = 'stakeholder' | 'system';
export type LinkType = 'derivedFrom' | 'relatedTo' | 'supersedes' | 'validates';
export type TestType = 'acceptance' | 'usability' | 'accessibility';

export interface EnumItem {
  id: string;
  label: string;
}
export interface LinkTypeItem extends EnumItem {
  inverse?: string;
}
export interface Actor {
  id: string;
  name: string;
  description: string;
}
export interface RequirementLink {
  type: LinkType;
  target: string;
}
export interface CodeRef {
  path: string;
  symbol?: string;
}
export interface VerifyRef {
  method: string;
  note?: string;
}
export interface SpecRef {
  doc: string;
  section: string;
}
export type TestKind = 'backend' | 'e2e' | 'manual';
export interface TestRef {
  kind: TestKind;
  file: string;
}
export interface Coverage {
  total: number;
  covered: number;
  backend: number;
  e2e: number;
  manual: number;
  gaps: string[];
}

// A concrete test case: an automated case parsed from the suites, or an authored manual case.
export interface TestCaseRecord {
  id: string;
  name: string;
  kind: TestKind;
  file?: string;
  covers: string[];
  manual?: { steps: string[]; expected: string; rationale?: string };
}

export type TestResult = 'pass' | 'fail' | 'skip';
export interface TestResultsDoc {
  ranAt?: string;
  summary?: { total: number; passed: number; failed: number; skipped: number; backend: number; e2e: number };
  results: Record<string, TestResult>;
}

export interface Iec62304Meta {
  safetyClass: 'A' | 'B' | 'C';
  standard: string;
  rationale: string;
}

export interface Requirement {
  id: string;
  type: RequirementType;
  category: string;
  title: string;
  text: string;
  status: string;
  priority?: 'M' | 'S' | 'C';
  source?: string;
  sourceNote?: string;
  tags?: string[];
  links?: RequirementLink[];
  implementedBy?: CodeRef[];
  verifiedBy?: VerifyRef[];
  testedBy?: TestRef[];
  specRefs?: SpecRef[];
}

export interface TestCase {
  id: string;
  testType: TestType;
  title: string;
  method: string;
  preconditions?: string;
  links: RequirementLink[]; // type: 'validates' → stakeholder requirement id
  steps: string[];
  expected: string;
  metric?: string;
  automated?: boolean;
  testedBy?: TestRef[];
}

export interface RequirementsDoc {
  meta: {
    project: string;
    version: string;
    updated: string;
    specDoc?: string;
    description?: string;
    coverage?: Coverage;
    iec62304?: Iec62304Meta;
  };
  enums: {
    priority: EnumItem[];
    source: EnumItem[];
    status: EnumItem[];
    linkType: LinkTypeItem[];
    testType?: EnumItem[];
    method?: EnumItem[];
  };
  actors: Actor[];
  outOfScope?: { id: string; text: string }[];
  requirements: Requirement[];
  tests: TestCase[];
  testCases?: TestCaseRecord[];
}
