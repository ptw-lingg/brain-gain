// Types for the generated requirements dataset (requirements/requirements.json →
// frontend/src/data/requirements.generated.json). Mirrors requirements/schema/requirements.schema.json.

export type RequirementType = 'stakeholder' | 'system';
export type LinkType = 'derivedFrom' | 'relatedTo' | 'supersedes';

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
  specRefs?: SpecRef[];
}

export interface RequirementsDoc {
  meta: { project: string; version: string; updated: string; specDoc?: string; description?: string };
  enums: { priority: EnumItem[]; source: EnumItem[]; status: EnumItem[]; linkType: LinkTypeItem[] };
  actors: Actor[];
  outOfScope?: { id: string; text: string }[];
  requirements: Requirement[];
}
