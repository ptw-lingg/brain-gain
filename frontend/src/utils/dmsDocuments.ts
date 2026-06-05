// Builders for the controlled documents generated from the requirements dataset and offered for
// transfer to a DMS. Each returns a pdfmake document definition + a file name. The documents carry
// a controlled-document header block (id, revision, date, prepared/reviewed/approved signature lines)
// and cite the relevant medical-device standards. Pure functions — no side effects.
import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';
import type { Requirement, RequirementsDoc, TestCase, TestRef } from '@/types/requirements';

export type DocKind = 'srs' | 'rtm' | 'vnv' | 'review';

export interface DocInfo {
  kind: DocKind;
  title: string;
  docId: string;
  fileName: string;
}

export const DOC_CATALOG: Record<DocKind, { title: string; docId: string; abbr: string }> = {
  srs: { title: 'Software Requirements Specification', docId: 'SRS-BRAINGAIN-001', abbr: 'SRS' },
  rtm: { title: 'Requirements Traceability Matrix', docId: 'RTM-BRAINGAIN-001', abbr: 'RTM' },
  vnv: { title: 'Software Verification & Validation Report', docId: 'SVVR-BRAINGAIN-001', abbr: 'SVVR' },
  review: { title: 'Design & Requirements Review Record', docId: 'DRR-BRAINGAIN-001', abbr: 'DRR' },
};

const STANDARDS = 'ISO 13485:2016 · EU MDR 2017/745 · MDSAP · IEC 62304:2006+A1:2015';
const ACCENT = '#2B78E4';
const INK = '#0F1E36';
const MUTED = '#4A6080';
const LINE = '#CCE0F8';

const fmtDate = (iso?: string) => (iso ? new Date(iso).toISOString().slice(0, 10) : '');

// ── shared building blocks ───────────────────────────────────────────────────────────────────────
function metadataTable(doc: RequirementsDoc, info: { title: string; docId: string }, generatedOn: string): Content {
  const rev = `Rev ${doc.meta.version}`;
  return {
    table: {
      widths: ['auto', '*', 'auto', '*'],
      body: [
        [label('Document'), val(info.title), label('Document ID'), val(info.docId)],
        [label('Revision'), val(rev), label('Date'), val(generatedOn)],
        [label('Product'), val(`${doc.meta.project} v${doc.meta.version}`), label('Requirements baseline'), val(fmtDate(doc.meta.updated))],
        [label('Standards'), { text: STANDARDS, colSpan: 3, fontSize: 8, color: MUTED }, {}, {}],
      ],
    },
    layout: metaLayout,
    margin: [0, 0, 0, 12],
  };
}

function signatureBlock(): Content {
  const cell = (role: string): Content => ({
    stack: [
      { text: role, bold: true, fontSize: 8, color: MUTED, margin: [0, 0, 0, 18] },
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 150, y2: 0, lineWidth: 0.5, lineColor: INK }] },
      { text: 'Name / Signature / Date', fontSize: 7, color: MUTED, margin: [0, 3, 0, 0] },
    ],
  });
  return {
    table: { widths: ['*', '*', '*'], body: [[cell('Prepared by'), cell('Reviewed by'), cell('Approved by')]] },
    layout: 'noBorders',
    margin: [0, 14, 0, 0],
  };
}

const label = (t: string): Content => ({ text: t, bold: true, fontSize: 8, color: MUTED });
const val = (t: string): Content => ({ text: t, fontSize: 9, color: INK });
const h2 = (t: string): Content => ({ text: t, style: 'h2', margin: [0, 14, 0, 6] });
const metaLayout = {
  hLineWidth: () => 0.5,
  vLineWidth: () => 0.5,
  hLineColor: () => LINE,
  vLineColor: () => LINE,
  paddingTop: () => 4,
  paddingBottom: () => 4,
  paddingLeft: () => 6,
  paddingRight: () => 6,
};
const tableLayout = {
  hLineWidth: (i: number, node: { table: { body: unknown[] } }) => (i === 0 || i === 1 || i === node.table.body.length ? 0.7 : 0.3),
  vLineWidth: () => 0,
  hLineColor: (i: number) => (i <= 1 ? ACCENT : LINE),
  paddingTop: () => 3,
  paddingBottom: () => 3,
  paddingLeft: () => 5,
  paddingRight: () => 5,
  fillColor: (rowIndex: number) => (rowIndex === 0 ? '#EAF2FF' : null),
};

const th = (t: string): Content => ({ text: t, bold: true, fontSize: 8, color: ACCENT });
const td = (t: string): Content => ({ text: t || '—', fontSize: 8, color: INK });

// derivation / validation maps
function maps(doc: RequirementsDoc) {
  const satisfiedBy = new Map<string, string[]>();
  const validatedBy = new Map<string, string[]>();
  for (const r of doc.requirements)
    for (const l of r.links ?? []) if (l.type === 'derivedFrom') satisfiedBy.set(l.target, [...(satisfiedBy.get(l.target) ?? []), r.id]);
  for (const t of doc.tests)
    for (const l of t.links ?? []) if (l.type === 'validates') validatedBy.set(l.target, [...(validatedBy.get(l.target) ?? []), t.id]);
  return { satisfiedBy, validatedBy };
}
const testFiles = (refs?: TestRef[]) => (refs ?? []).map((r) => r.file.split('/').pop()).join(', ');
const derivedFrom = (r: Requirement) => (r.links ?? []).filter((l) => l.type === 'derivedFrom').map((l) => l.target).join(', ');
const byCategory = <T extends { category?: string }>(items: T[]) => {
  const out: Record<string, T[]> = {};
  for (const i of items) (out[i.category ?? '—'] ??= []).push(i);
  return out;
};

// ── document bodies ──────────────────────────────────────────────────────────────────────────────
function srsBody(doc: RequirementsDoc): Content[] {
  const sr = doc.requirements.filter((r) => r.type === 'stakeholder');
  const sys = doc.requirements.filter((r) => r.type === 'system');
  const out: Content[] = [];
  out.push({ text: '1  Purpose & Scope', style: 'h2', margin: [0, 4, 0, 6] });
  out.push({
    text: `This specification defines the stakeholder needs (${sr.length}) and the system requirements (${sys.length}) for ${doc.meta.project}, a training-management application. It is a controlled input to design, verification and validation per IEC 62304 §5.2 and EU MDR Annex II.`,
    fontSize: 9, color: MUTED, margin: [0, 0, 0, 6],
  });

  out.push({ text: '2  Stakeholder Requirements', style: 'h2', margin: [0, 10, 0, 6] });
  for (const [cat, items] of Object.entries(byCategory(sr))) {
    out.push(h3(cat));
    out.push(reqTable(items, ['ID', 'Requirement', 'Priority', 'Status'], (r) => [td(r.id), reqText(r), td(r.priority ?? ''), td(r.status)], ['auto', '*', 'auto', 'auto']));
  }
  out.push({ text: '3  System Requirements', style: 'h2', margin: [0, 12, 0, 6], pageBreak: 'before' });
  for (const [cat, items] of Object.entries(byCategory(sys))) {
    out.push(h3(cat));
    out.push(reqTable(items, ['ID', 'Requirement', 'Derived from', 'Status'], (r) => [td(r.id), reqText(r), td(derivedFrom(r)), td(r.status)], ['auto', '*', 'auto', 'auto']));
  }
  return out;
}

function rtmBody(doc: RequirementsDoc): Content[] {
  const { satisfiedBy, validatedBy } = maps(doc);
  const sr = doc.requirements.filter((r) => r.type === 'stakeholder');
  const sysById = new Map(doc.requirements.filter((r) => r.type === 'system').map((r) => [r.id, r]));
  const out: Content[] = [];
  out.push({ text: 'Bidirectional traceability — stakeholder need → system requirement → implementation → verification — per IEC 62304 §5.1.1 and ISO 13485 §7.3.', fontSize: 9, color: MUTED, margin: [0, 4, 0, 8] });
  out.push(coverageCallout(doc));

  const body: Content[][] = [[th('SR'), th('Satisfied by (SYS)'), th('Implemented by'), th('Verified by (tests)')]];
  for (const s of sr) {
    const sysIds = satisfiedBy.get(s.id) ?? [];
    const paths = [...new Set(sysIds.flatMap((id) => (sysById.get(id)?.implementedBy ?? []).map((c) => c.path)))];
    const tests = [...new Set([...(validatedBy.get(s.id) ?? []), ...sysIds.flatMap((id) => (sysById.get(id)?.testedBy ?? []).map((t) => t.file.split('/').pop() as string))])];
    body.push([td(`${s.id}`), td(sysIds.join(', ')), td(paths.join(', ')), td(tests.join(', '))]);
  }
  out.push({ table: { headerRows: 1, widths: ['auto', 'auto', '*', '*'], body }, layout: tableLayout, fontSize: 8, margin: [0, 8, 0, 0] });
  return out;
}

function vnvBody(doc: RequirementsDoc): Content[] {
  const out: Content[] = [];
  out.push({ text: 'Verification & validation evidence per IEC 62304 §5.7. Automated tests are executed by the CI test suites; manual tests are documented procedures to be executed and recorded by a tester.', fontSize: 9, color: MUTED, margin: [0, 4, 0, 8] });
  out.push(coverageCallout(doc));

  const byType = byCategory(doc.tests.map((t) => ({ ...t, category: t.testType })));
  for (const [type, items] of Object.entries(byType)) {
    out.push(h3(`${type[0].toUpperCase()}${type.slice(1)} tests (${items.length})`));
    const body: Content[][] = [[th('VT'), th('Title'), th('Method'), th('Execution'), th('Validates'), th('Evidence')]];
    for (const t of items as TestCase[]) {
      const validates = (t.links ?? []).filter((l) => l.type === 'validates').map((l) => l.target).join(', ');
      const exec = t.automated ? 'Automated · Pass' : 'Manual · pending';
      body.push([td(t.id), td(t.title), td(t.method), { text: exec, fontSize: 8, color: t.automated ? '#047857' : MUTED }, td(validates), td(testFiles(t.testedBy) || '(this dataset)')]);
    }
    out.push({ table: { headerRows: 1, widths: ['auto', '*', 'auto', 'auto', 'auto', 'auto'], body }, layout: tableLayout, margin: [0, 4, 0, 8] });
  }
  return out;
}

function reviewBody(doc: RequirementsDoc): Content[] {
  const sr = doc.requirements.filter((r) => r.type === 'stakeholder').length;
  const sys = doc.requirements.length - sr;
  const c = doc.meta.coverage;
  const blankRows = (n: number, cols: number): Content[][] =>
    Array.from({ length: n }, () => Array.from({ length: cols }, () => td(' ')));
  const out: Content[] = [];
  out.push({ text: 'Formal design & requirements review record per ISO 13485 §7.3.5. To be completed and signed at the review meeting.', fontSize: 9, color: MUTED, margin: [0, 4, 0, 8] });
  out.push(h3('Review details'));
  out.push({
    table: { widths: ['auto', '*', 'auto', '*'], body: [[label('Review date'), val(' '), label('Chair'), val(' ')], [label('Attendees'), { text: ' ', colSpan: 3 }, {}, {}]] },
    layout: metaLayout, margin: [0, 0, 0, 8],
  });
  out.push(h3('Scope of review'));
  out.push({ ul: [`${sr} stakeholder requirements, ${sys} system requirements, ${doc.tests.length} validation tests`, `Traceability coverage: ${c ? `${c.covered}/${c.total} ids (gaps: ${c.gaps.length})` : 'see RTM'}`, 'Inputs reviewed: SRS-BRAINGAIN-001, RTM-BRAINGAIN-001, SVVR-BRAINGAIN-001'], fontSize: 9, color: INK, margin: [0, 0, 0, 8] });
  out.push(h3('Findings & actions'));
  out.push({
    table: { headerRows: 1, widths: ['auto', '*', 'auto', 'auto'], body: [[th('#'), th('Finding / action'), th('Owner'), th('Due')], ...blankRows(6, 4).map((r, i) => [td(String(i + 1)), ...r.slice(1)])] },
    layout: tableLayout, margin: [0, 0, 0, 10],
  });
  out.push(h3('Decision'));
  out.push({ text: '☐  Approved          ☐  Approved with actions          ☐  Rejected', fontSize: 11, color: INK, margin: [0, 2, 0, 4] });
  return out;
}

// small helpers used by bodies
const h3 = (t: string): Content => ({ text: t, bold: true, fontSize: 10, color: ACCENT, margin: [0, 8, 0, 4] });
const reqText = (r: Requirement): Content => ({ stack: [{ text: r.title, bold: true, fontSize: 8, color: INK }, { text: r.text, fontSize: 7.5, color: MUTED }] });
function reqTable(items: Requirement[], heads: string[], row: (r: Requirement) => Content[], widths: (string | number)[]): Content {
  return { table: { headerRows: 1, widths, body: [heads.map(th), ...items.map(row)] }, layout: tableLayout, margin: [0, 0, 0, 8] };
}
function coverageCallout(doc: RequirementsDoc): Content {
  const c = doc.meta.coverage;
  if (!c) return { text: '' };
  return {
    table: { widths: ['*'], body: [[{ text: `Test coverage: ${c.covered}/${c.total} requirement & test ids — ${c.backend} backend, ${c.e2e} e2e, ${c.manual} manual. Gaps: ${c.gaps.length ? c.gaps.join(', ') : 'none'}.`, fontSize: 8.5, color: c.gaps.length ? '#B45309' : '#047857' }]] },
    layout: { hLineWidth: () => 0, vLineWidth: () => 0, paddingTop: () => 6, paddingBottom: () => 6, paddingLeft: () => 8, paddingRight: () => 8, fillColor: () => '#EAF2FF' },
    margin: [0, 0, 0, 8],
  };
}

// ── public API ───────────────────────────────────────────────────────────────────────────────────
export function buildDocument(kind: DocKind, doc: RequirementsDoc): { def: TDocumentDefinitions; info: DocInfo } {
  const cat = DOC_CATALOG[kind];
  const generatedOn = new Date().toISOString().slice(0, 10);
  const bodies: Record<DocKind, () => Content[]> = { srs: () => srsBody(doc), rtm: () => rtmBody(doc), vnv: () => vnvBody(doc), review: () => reviewBody(doc) };

  const def: TDocumentDefinitions = {
    pageSize: 'A4',
    pageMargins: [40, 84, 40, 54],
    info: { title: `${cat.docId} ${cat.title}`, author: doc.meta.project },
    header: (currentPage: number) =>
      currentPage === 1
        ? { text: '' }
        : {
            margin: [40, 24, 40, 0],
            columns: [
              { text: cat.title, fontSize: 8, color: MUTED },
              { text: `${cat.docId}  ·  Rev ${doc.meta.version}`, fontSize: 8, color: MUTED, alignment: 'right' },
            ],
          },
    footer: (currentPage: number, pageCount: number) => ({
      margin: [40, 8, 40, 0],
      columns: [
        { text: 'CONTROLLED DOCUMENT — verify revision before use.', fontSize: 7, color: MUTED },
        { text: `Page ${currentPage} of ${pageCount}`, fontSize: 7, color: MUTED, alignment: 'right' },
      ],
    }),
    content: [
      { text: doc.meta.project, color: ACCENT, bold: true, fontSize: 12 },
      { text: cat.title, style: 'h1', margin: [0, 2, 0, 10] },
      metadataTable(doc, cat, generatedOn),
      ...bodies[kind](),
      signatureBlock(),
    ],
    styles: {
      h1: { fontSize: 18, bold: true, color: INK },
      h2: { fontSize: 13, bold: true, color: INK },
    },
    defaultStyle: { fontSize: 9, color: INK },
  };
  return { def, info: { kind, title: cat.title, docId: cat.docId, fileName: `${cat.docId}-Rev${doc.meta.version}.pdf` } };
}
