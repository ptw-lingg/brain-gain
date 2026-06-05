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
}
