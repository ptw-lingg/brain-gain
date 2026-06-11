// Builders for the controlled documents generated from the requirements dataset and offered for
// transfer to a DMS. Each returns a pdfmake document definition + a file name, with a controlled-
// document header (id, revision, date, safety class, prepared/reviewed/approved signature lines) and
// cites the medical-device standards. Documents are kept short and human-reviewable. Pure functions.
import type { Content, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces';
import type { Requirement, RequirementsDoc, TestCaseRecord, TestResultsDoc } from '@/types/requirements';

export type DocKind =
  | 'srs' | 'rtm' | 'vnv' | 'review'
  | 'sdp' | 'ssc' | 'sad' | 'srr' | 'scmp' | 'spr' | 'smp' | 'srmf';

export interface DocInfo {
  kind: DocKind;
  title: string;
  docId: string;
  fileName: string;
}

export const DOC_CATALOG: Record<DocKind, { title: string; docId: string; abbr: string; clause?: string }> = {
  srs: { title: 'Software Requirements Specification', docId: 'SRS-BRAINGAIN-001', abbr: 'SRS', clause: 'IEC 62304 §5.2' },
  rtm: { title: 'Requirements Traceability Matrix', docId: 'RTM-BRAINGAIN-001', abbr: 'RTM', clause: 'IEC 62304 §5.1.1' },
  vnv: { title: 'Software Verification & Validation Report', docId: 'SVVR-BRAINGAIN-001', abbr: 'SVVR', clause: 'IEC 62304 §5.5–5.7' },
  review: { title: 'Design & Requirements Review Record', docId: 'DRR-BRAINGAIN-001', abbr: 'DRR', clause: 'ISO 13485 §7.3.5' },
  sdp: { title: 'Software Development Plan', docId: 'SDP-BRAINGAIN-001', abbr: 'SDP', clause: 'IEC 62304 §5.1' },
  ssc: { title: 'Software Safety Classification', docId: 'SSC-BRAINGAIN-001', abbr: 'SSC', clause: 'IEC 62304 §4.3' },
  sad: { title: 'Software Architecture', docId: 'SAD-BRAINGAIN-001', abbr: 'SAD', clause: 'IEC 62304 §5.3' },
  srr: { title: 'Software Release Record', docId: 'SRR-BRAINGAIN-001', abbr: 'SRR', clause: 'IEC 62304 §5.8' },
  scmp: { title: 'Software Configuration Management Plan', docId: 'SCMP-BRAINGAIN-001', abbr: 'SCMP', clause: 'IEC 62304 §8' },
  spr: { title: 'Software Problem Resolution Record', docId: 'SPR-BRAINGAIN-001', abbr: 'SPR', clause: 'IEC 62304 §9' },
  smp: { title: 'Software Maintenance Plan', docId: 'SMP-BRAINGAIN-001', abbr: 'SMP', clause: 'IEC 62304 §6' },
  srmf: { title: 'Software Risk Management File', docId: 'SRMF-BRAINGAIN-001', abbr: 'SRMF', clause: 'IEC 62304 §7 · ISO 14971' },
};

export const DOC_GROUPS: { label: string; kinds: DocKind[] }[] = [
  { label: 'Requirements & review', kinds: ['srs', 'rtm', 'vnv', 'review'] },
  { label: 'IEC 62304 lifecycle', kinds: ['sdp', 'ssc', 'sad', 'srr', 'scmp', 'spr', 'smp', 'srmf'] },
];

const STANDARDS = 'ISO 13485:2016 · EU MDR 2017/745 · MDSAP · IEC 62304:2006+A1:2015';
const ACCENT = '#156A6E';
const INK = '#1A1A1A';
const MUTED = '#46595A';
const LINE = '#D8E0E0';
const GREEN = '#047857';
const RED = '#B91C1C';
const AMBER = '#B45309';

const fmtDate = (iso?: string) => (iso ? new Date(iso).toISOString().slice(0, 10) : '');

// ── shared building blocks ───────────────────────────────────────────────────────────────────────
const label = (t: string): Content => ({ text: t, bold: true, fontSize: 8, color: MUTED });
const val = (t: string): Content => ({ text: t, fontSize: 9, color: INK });
const h2 = (t: string): Content => ({ text: t, style: 'h2', margin: [0, 12, 0, 6] });
const h3 = (t: string): Content => ({ text: t, bold: true, fontSize: 10, color: ACCENT, margin: [0, 8, 0, 4] });
const para = (t: string): Content => ({ text: t, fontSize: 9, color: MUTED, margin: [0, 2, 0, 6] });
const th = (t: string): Content => ({ text: t, bold: true, fontSize: 8, color: ACCENT });
const td = (t: string): Content => ({ text: t || '—', fontSize: 8, color: INK });

const metaLayout = {
  hLineWidth: () => 0.5, vLineWidth: () => 0.5, hLineColor: () => LINE, vLineColor: () => LINE,
  paddingTop: () => 4, paddingBottom: () => 4, paddingLeft: () => 6, paddingRight: () => 6,
};
const tableLayout = {
  hLineWidth: (i: number, node: { table: { body: unknown[] } }) => (i === 0 || i === 1 || i === node.table.body.length ? 0.7 : 0.3),
  vLineWidth: () => 0,
  hLineColor: (i: number) => (i <= 1 ? ACCENT : LINE),
  paddingTop: () => 3, paddingBottom: () => 3, paddingLeft: () => 5, paddingRight: () => 5,
  fillColor: (rowIndex: number) => (rowIndex === 0 ? '#EAF2FF' : null),
};
const blankRows = (n: number, cols: number): Content[][] =>
  Array.from({ length: n }, () => Array.from({ length: cols }, () => td(' ')));
const dataTable = (heads: string[], rows: Content[][], widths: (string | number)[]): Content => ({
  table: { headerRows: 1, widths, body: [heads.map(th), ...rows] }, layout: tableLayout, margin: [0, 2, 0, 8],
});

function metadataTable(doc: RequirementsDoc, info: { title: string; docId: string }, generatedOn: string): Content {
  const cls = doc.meta.iec62304;
  const body: TableCell[][] = [
    [label('Document'), val(info.title), label('Document ID'), val(info.docId)],
    [label('Revision'), val(`Rev ${doc.meta.version}`), label('Date'), val(generatedOn)],
    [label('Product'), val(`${doc.meta.project} v${doc.meta.version}`), label('Baseline'), val(fmtDate(doc.meta.updated))],
  ];
  if (cls) body.push([label('Safety class'), val(`IEC 62304 Class ${cls.safetyClass}`), label('Std'), { text: cls.standard, fontSize: 8, color: INK }]);
  body.push([label('Standards'), { text: STANDARDS, colSpan: 3, fontSize: 8, color: MUTED }, {}, {}]);
  return { table: { widths: ['auto', '*', 'auto', '*'], body }, layout: metaLayout, margin: [0, 0, 0, 12] };
}

function signatureBlock(): Content {
  const cell = (role: string): Content => ({
    stack: [
      { text: role, bold: true, fontSize: 8, color: MUTED, margin: [0, 0, 0, 18] },
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 150, y2: 0, lineWidth: 0.5, lineColor: INK }] },
      { text: 'Name / Signature / Date', fontSize: 7, color: MUTED, margin: [0, 3, 0, 0] },
    ],
  });
  return { table: { widths: ['*', '*', '*'], body: [[cell('Prepared by'), cell('Reviewed by'), cell('Approved by')]] }, layout: 'noBorders', margin: [0, 14, 0, 0] };
}

const derivedFrom = (r: Requirement) => (r.links ?? []).filter((l) => l.type === 'derivedFrom').map((l) => l.target).join(', ');
const reqText = (r: Requirement): Content => ({ stack: [{ text: r.title, bold: true, fontSize: 8, color: INK }, { text: r.text, fontSize: 7.5, color: MUTED }] });
const byCategory = <T extends { category?: string }>(items: T[]) => {
  const out: Record<string, T[]> = {};
  for (const i of items) (out[i.category ?? '—'] ??= []).push(i);
  return out;
};
function coverageCallout(doc: RequirementsDoc): Content {
  const c = doc.meta.coverage;
  if (!c) return { text: '' };
  return {
    table: { widths: ['*'], body: [[{ text: `Traceability coverage: ${c.covered}/${c.total} requirement & test ids — ${c.backend} backend, ${c.e2e} e2e, ${c.manual} manual. Gaps: ${c.gaps.length ? c.gaps.join(', ') : 'none'}.`, fontSize: 8.5, color: c.gaps.length ? AMBER : GREEN }]] },
    layout: { hLineWidth: () => 0, vLineWidth: () => 0, paddingTop: () => 6, paddingBottom: () => 6, paddingLeft: () => 8, paddingRight: () => 8, fillColor: () => '#EAF2FF' },
    margin: [0, 0, 0, 8],
  };
}

// ── document bodies ──────────────────────────────────────────────────────────────────────────────
function srsBody(doc: RequirementsDoc): Content[] {
  const sr = doc.requirements.filter((r) => r.type === 'stakeholder');
  const sys = doc.requirements.filter((r) => r.type === 'system');
  const out: Content[] = [];
  out.push(h2('1  Purpose & Scope'));
  out.push(para(`Stakeholder needs (${sr.length}) and system requirements (${sys.length}) for ${doc.meta.project}. Controlled input to design, verification and validation per IEC 62304 §5.2 and EU MDR Annex II.`));
  out.push(h2('2  Stakeholder Requirements'));
  for (const [cat, items] of Object.entries(byCategory(sr))) {
    out.push(h3(cat));
    out.push(dataTable(['ID', 'Requirement', 'Pri', 'Status'], items.map((r) => [td(r.id), reqText(r), td(r.priority ?? ''), td(r.status)]), ['auto', '*', 'auto', 'auto']));
  }
  out.push({ text: '3  System Requirements', style: 'h2', pageBreak: 'before', margin: [0, 12, 0, 6] });
  for (const [cat, items] of Object.entries(byCategory(sys))) {
    out.push(h3(cat));
    out.push(dataTable(['ID', 'Requirement', 'From', 'Status'], items.map((r) => [td(r.id), reqText(r), td(derivedFrom(r)), td(r.status)]), ['auto', '*', 'auto', 'auto']));
  }
  return out;
}

function rtmBody(doc: RequirementsDoc): Content[] {
  const sr = doc.requirements.filter((r) => r.type === 'stakeholder');
  const sysById = new Map(doc.requirements.filter((r) => r.type === 'system').map((r) => [r.id, r]));
  const satisfiedBy = new Map<string, string[]>();
  const validatedBy = new Map<string, string[]>();
  for (const r of doc.requirements) for (const l of r.links ?? []) if (l.type === 'derivedFrom') satisfiedBy.set(l.target, [...(satisfiedBy.get(l.target) ?? []), r.id]);
  for (const t of doc.tests) for (const l of t.links ?? []) if (l.type === 'validates') validatedBy.set(l.target, [...(validatedBy.get(l.target) ?? []), t.id]);
  const out: Content[] = [];
  out.push(para('Bidirectional traceability — stakeholder need → system requirement → implementation → verification (IEC 62304 §5.1.1, ISO 13485 §7.3).'));
  out.push(coverageCallout(doc));
  const rows = sr.map((s) => {
    const sysIds = satisfiedBy.get(s.id) ?? [];
    const paths = [...new Set(sysIds.flatMap((id) => (sysById.get(id)?.implementedBy ?? []).map((c) => c.path)))];
    return [td(s.id), td(sysIds.join(', ')), td(paths.join(', ')), td((validatedBy.get(s.id) ?? []).join(', '))];
  });
  out.push(dataTable(['SR', 'Satisfied by (SYS)', 'Implemented by', 'Validated by (VT)'], rows, ['auto', 'auto', '*', 'auto']));
  return out;
}

function vnvBody(doc: RequirementsDoc, results: TestResultsDoc): Content[] {
  const cases = doc.testCases ?? [];
  const auto = cases.filter((c) => c.kind !== 'manual');
  const manual = cases.filter((c) => c.kind === 'manual');
  const res = (id: string) => results.results[id];
  const n = (s: string) => auto.filter((c) => res(c.id) === s).length;
  const passed = n('pass'), failed = n('fail'), skipped = n('skip');
  const unrun = auto.length - passed - failed - skipped;
  const out: Content[] = [];
  out.push(para('Verification & validation evidence (IEC 62304 §5.5–5.7). Automated cases are executed by the CI suites; manual cases are documented procedures executed and recorded by a tester.'));
  out.push(coverageCallout(doc));
  out.push(h3('Automated test summary'));
  out.push(dataTable(['Run', 'Automated cases', 'Pass', 'Fail', 'Skip', 'Not run'],
    [[td(results.ranAt ? fmtDate(results.ranAt) : 'not yet run'), td(String(auto.length)),
      { text: String(passed), fontSize: 8, color: GREEN }, { text: String(failed), fontSize: 8, color: failed ? RED : INK },
      td(String(skipped)), td(String(unrun))]],
    ['auto', 'auto', 'auto', 'auto', 'auto', 'auto']));
  const failedCases = auto.filter((c) => res(c.id) === 'fail');
  if (failedCases.length) {
    out.push(h3('Failed cases'));
    out.push(dataTable(['Case', 'Covers'], failedCases.map((c) => [td(c.name), td(c.covers.join(', '))]), ['*', 'auto']));
  }
  out.push(h3(`Manual verification checklist (${manual.length})`));
  out.push(dataTable(['Manual check', 'Covers', 'Expected', 'Result'],
    manual.map((c) => [{ text: c.name, fontSize: 7.5, color: INK }, td(c.covers.join(', ')), { text: c.manual?.expected ?? '', fontSize: 7.5, color: MUTED }, td(' ')]),
    ['*', 'auto', '*', 'auto']));
  out.push(para('The full automated case list and live results are maintained in the requirements dataset and the in-app Requirements view.'));
  return out;
}

function srrBody(doc: RequirementsDoc, results: TestResultsDoc): Content[] {
  const auto = (doc.testCases ?? []).filter((c) => c.kind !== 'manual');
  const failed = auto.filter((c) => results.results[c.id] === 'fail').length;
  const c = doc.meta.coverage;
  const out: Content[] = [];
  out.push(para('Software release record (IEC 62304 §5.8): confirms the released version, verification status and residual anomalies.'));
  out.push(dataTable(['Item', 'Value'], [
    [td('Product / version'), td(`${doc.meta.project} v${doc.meta.version}`)],
    [td('Requirements baseline'), td(fmtDate(doc.meta.updated))],
    [td('Verification'), { text: failed ? `${failed} failing automated case(s) — NOT releasable` : `All ${auto.length} automated cases pass${results.ranAt ? ` (run ${fmtDate(results.ranAt)})` : ' (run pending)'}`, fontSize: 8, color: failed ? RED : GREEN }],
    [td('Traceability coverage'), td(c ? `${c.covered}/${c.total} ids, ${c.gaps.length} gaps` : '—')],
    [td('Residual anomalies'), td('None recorded (see Problem Resolution record)')],
  ], ['auto', '*']));
  out.push(para(failed ? 'Verification incomplete — resolve failing cases before release.' : 'Verification activities are complete for this release; the residual-anomaly list is empty.'));
  return out;
}

function reviewBody(doc: RequirementsDoc): Content[] {
  const sr = doc.requirements.filter((r) => r.type === 'stakeholder').length;
  const sys = doc.requirements.length - sr;
  const c = doc.meta.coverage;
  const out: Content[] = [];
  out.push(para('Formal design & requirements review record (ISO 13485 §7.3.5). Complete and sign at the review meeting.'));
  out.push(h3('Review details'));
  out.push({ table: { widths: ['auto', '*', 'auto', '*'], body: [[label('Review date'), val(' '), label('Chair'), val(' ')], [label('Attendees'), { text: ' ', colSpan: 3 }, {}, {}]] }, layout: metaLayout, margin: [0, 0, 0, 8] });
  out.push(h3('Scope'));
  out.push({ ul: [`${sr} stakeholder, ${sys} system requirements, ${doc.tests.length} validation tests`, `Coverage: ${c ? `${c.covered}/${c.total} ids (gaps: ${c.gaps.length})` : 'see RTM'}`, 'Inputs: SRS / RTM / SVVR / SAD'], fontSize: 9, color: INK, margin: [0, 0, 0, 8] });
  out.push(h3('Findings & actions'));
  out.push(dataTable(['#', 'Finding / action', 'Owner', 'Due'], blankRows(6, 4).map((r, i) => [td(String(i + 1)), ...r.slice(1)]), ['auto', '*', 'auto', 'auto']));
  out.push(h3('Decision'));
  out.push({ text: '☐  Approved          ☐  Approved with actions          ☐  Rejected', fontSize: 11, color: INK, margin: [0, 2, 0, 4] });
  return out;
}

// ── IEC 62304 lifecycle bodies (short, human-reviewable) ───────────────────────────────────────────
function sdpBody(doc: RequirementsDoc): Content[] {
  const cls = doc.meta.iec62304;
  const out: Content[] = [];
  out.push(para('Software development plan (IEC 62304 §5.1) for the lifecycle activities, deliverables and supporting processes.'));
  out.push(h3('Plan'));
  out.push(dataTable(['Item', 'Value'], [
    [td('Safety classification'), td(cls ? `Class ${cls.safetyClass} (${cls.standard})` : '—')],
    [td('Lifecycle model'), td('Iterative; requirements → architecture → implementation → verification → release, traced in this dataset')],
    [td('Standards'), td(STANDARDS)],
    [td('Configuration management'), td('See SCMP-BRAINGAIN-001 (§8)')],
    [td('Problem resolution'), td('See SPR-BRAINGAIN-001 (§9)')],
    [td('Maintenance'), td('See SMP-BRAINGAIN-001 (§6)')],
    [td('Risk management'), td('See SRMF-BRAINGAIN-001 (§7, ISO 14971)')],
  ], ['auto', '*']));
  out.push(h3('Planned deliverables'));
  out.push(dataTable(['Document', 'ID', 'Clause'], DOC_GROUPS.flatMap((g) => g.kinds).map((k) => [td(DOC_CATALOG[k].title), td(DOC_CATALOG[k].docId), td(DOC_CATALOG[k].clause ?? '')]), ['*', 'auto', 'auto']));
  return out;
}

function sscBody(doc: RequirementsDoc): Content[] {
  const cls = doc.meta.iec62304;
  const out: Content[] = [];
  out.push(para('Software safety classification (IEC 62304 §4.3). The class determines which lifecycle activities and documents are required.'));
  out.push(dataTable(['Item', 'Value'], [
    [td('Classification'), { text: cls ? `Class ${cls.safetyClass}` : 'TBD', fontSize: 9, bold: true, color: ACCENT }],
    [td('Standard'), td(cls?.standard ?? '')],
    [td('Rationale'), { text: cls?.rationale ?? 'To be determined via ISO 14971 risk analysis.', fontSize: 8, color: INK }],
  ], ['auto', '*']));
  out.push(h3('Class B obligations (this product)'));
  out.push({ ul: [
    'Software development plan (§5.1) and SRS (§5.2)',
    'Software architecture (§5.3) — see SAD',
    'Integration & system testing and verification (§5.5–5.7) — see SVVR',
    'Configuration management (§8) and problem resolution (§9)',
    'Risk management (§7, ISO 14971) and release record (§5.8)',
    'Unit-level Detailed Design (§5.4) is NOT required for Class B',
  ], fontSize: 8.5, color: INK, margin: [0, 0, 0, 6] });
  return out;
}

function sadBody(doc: RequirementsDoc): Content[] {
  const cats = ['Architecture & Technology', 'Data Model & Persistence', 'Authorization & Access Control'];
  const arch = doc.requirements.filter((r) => r.type === 'system' && cats.includes(r.category));
  const out: Content[] = [];
  out.push(para('Software architecture (IEC 62304 §5.3): the major software items, their interfaces and the segregation relevant to risk control, traced to requirements.'));
  out.push(h3('Architecture items'));
  for (const [cat, items] of Object.entries(byCategory(arch))) {
    out.push({ text: cat, bold: true, fontSize: 9, color: INK, margin: [0, 6, 0, 2] });
    out.push(dataTable(['ID', 'Item', 'From'], items.map((r) => [td(r.id), reqText(r), td(derivedFrom(r))]), ['auto', '*', 'auto']));
  }
  return out;
}

// ── concise controlled templates (no risk/anomaly/CM data exists yet) ──────────────────────────────
const templateNote = (clause: string): Content => ({ text: `Controlled template (${clause}) — complete the highlighted fields in the DMS.`, fontSize: 8, italics: true, color: AMBER, margin: [0, 2, 0, 8] });

function scmpBody(doc: RequirementsDoc): Content[] {
  const items = [...new Set((doc.requirements.flatMap((r) => (r.implementedBy ?? []).map((c) => c.path.split('/').slice(0, 2).join('/')))))].filter((p) => p.includes('/')).slice(0, 12);
  return [
    templateNote('IEC 62304 §8'),
    h3('Configuration items'),
    dataTable(['Item', 'Control'], items.map((p) => [td(p), td('Git version control')]), ['*', 'auto']),
    h3('Version & change control'),
    { ul: ['Repository: Git; baselines tagged per release (see SRR).', 'Changes via reviewed commits/PRs; linked to problem reports (SPR).', 'Released configuration recorded in the Software Release Record.'], fontSize: 8.5, color: INK, margin: [0, 0, 0, 6] },
  ];
}

function sprBody(): Content[] {
  return [
    templateNote('IEC 62304 §9'),
    para('Log of software problem reports, their evaluation (incl. safety relevance) and resolution.'),
    dataTable(['#', 'Problem / report', 'Severity', 'Safety?', 'Resolution', 'Status'], blankRows(8, 6).map((r, i) => [td(String(i + 1)), ...r.slice(1)]), ['auto', '*', 'auto', 'auto', '*', 'auto']),
  ];
}

function smpBody(): Content[] {
  return [
    templateNote('IEC 62304 §6'),
    para('Maintenance process: how feedback and problems are received, evaluated for safety, and implemented through the change process.'),
    { ul: ['Feedback & problems captured in the Problem Resolution record (SPR).', 'Each item is risk-evaluated (SRMF) and, if accepted, implemented under configuration control (SCMP).', 'Maintenance releases follow the same verification + release process (SVVR, SRR).'], fontSize: 8.5, color: INK, margin: [0, 0, 0, 6] },
    h3('Maintenance log'),
    dataTable(['Date', 'Change', 'Linked problem', 'Release'], blankRows(5, 4), ['auto', '*', 'auto', 'auto']),
  ];
}

function srmfBody(): Content[] {
  return [
    templateNote('IEC 62304 §7 · ISO 14971'),
    para('Software contribution to hazardous situations, risk control measures and residual risk. Complete per the ISO 14971 risk-management process.'),
    h3('Software risk analysis'),
    dataTable(['#', 'Hazardous situation', 'Software cause', 'Risk control measure', 'Verified by', 'Residual'], blankRows(8, 6).map((r, i) => [td(String(i + 1)), ...r.slice(1)]), ['auto', '*', '*', '*', 'auto', 'auto']),
    para('Risk control measures implemented in software shall be traced to system requirements and verified in the SVVR.'),
  ];
}

// ── public API ───────────────────────────────────────────────────────────────────────────────────
export function buildDocument(
  kind: DocKind,
  doc: RequirementsDoc,
  results: TestResultsDoc = { results: {} },
): { def: TDocumentDefinitions; info: DocInfo } {
  const cat = DOC_CATALOG[kind];
  const generatedOn = new Date().toISOString().slice(0, 10);
  const bodies: Record<DocKind, () => Content[]> = {
    srs: () => srsBody(doc),
    rtm: () => rtmBody(doc),
    vnv: () => vnvBody(doc, results),
    review: () => reviewBody(doc),
    sdp: () => sdpBody(doc),
    ssc: () => sscBody(doc),
    sad: () => sadBody(doc),
    srr: () => srrBody(doc, results),
    scmp: () => scmpBody(doc),
    spr: () => sprBody(),
    smp: () => smpBody(),
    srmf: () => srmfBody(),
  };

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
      { text: cat.title, style: 'h1', margin: [0, 2, 0, 2] },
      { text: cat.clause ?? '', fontSize: 8, color: MUTED, margin: [0, 0, 0, 10] },
      metadataTable(doc, cat, generatedOn),
      ...bodies[kind](),
      signatureBlock(),
    ],
    styles: { h1: { fontSize: 18, bold: true, color: INK }, h2: { fontSize: 13, bold: true, color: INK } },
    defaultStyle: { fontSize: 9, color: INK },
  };
  return { def, info: { kind, title: cat.title, docId: cat.docId, fileName: `${cat.docId}-Rev${doc.meta.version}.pdf` } };
}
