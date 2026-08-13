// Builds the "Training Plan" controlled document: the company's trainings, a roles × trainings matrix
// (which trainings each job role requires) and a members × roles matrix (which roles each member
// holds), scoped to the members the generating user is responsible for. It carries a controlled-
// document header (id, date, prepared/reviewed/approved signature lines) so it can be reviewed and
// filed in a DMS, mirroring the Training Status Report. Pure function (pdfmake document definition +
// file name); the page lazy-imports it with pdf.ts/pdfPreview.ts so pdfmake/pdf.js stay out of the
// initial bundle.
import type { Content, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces';
import type { JobRole, SafeUser, Training } from '@/types';
import { cycleLabel, formatDuration } from './display';

type TFn = (key: string, named?: Record<string, unknown>) => string;

export interface TrainingPlanData {
  trainings: Training[];
  roles: JobRole[];
  members: SafeUser[]; // the members the generating user is responsible for
}

export interface TrainingPlanMeta {
  company: string;
  preparedBy: string;
  generatedOn: string; // yyyy-mm-dd
  responsibleFor: string; // human label for the scope (units, or "entire organization")
}

export const TRAINING_PLAN_DOC_ID = 'TP-BRAINGAIN-001';

const ACCENT = '#156A6E';
const INK = '#1A1A1A';
const MUTED = '#46595A';
const LINE = '#D8E0E0';
const GREEN = '#047857';

export function buildTrainingPlan(
  data: TrainingPlanData,
  meta: TrainingPlanMeta,
  t: TFn,
): { def: TDocumentDefinitions; fileName: string; docId: string; title: string } {
  const title = t('trainingPlan.title');
  const th = (s: string): Content => ({ text: s, bold: true, fontSize: 8, color: ACCENT });
  const td = (s: string): Content => ({ text: s || '—', fontSize: 8, color: INK });
  const h2 = (s: string): Content => ({ text: s, style: 'h2', margin: [0, 14, 0, 6] });
  const note = (s: string): Content => ({ text: s, fontSize: 9, color: MUTED, italics: true, margin: [0, 2, 0, 6] });

  const escapeXml = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // Each table's chapter title is its own first (spanning) header row, so the title is always on the
  // same page as the table — and repeats with the column header if the table spans pages. Row 0 = title
  // (no fill/border), row 1 = column header (filled, accent rule under it), the rest = body. `vLine`/
  // `pad` differ for the plain list (no vertical rules, roomy) vs the dense checkmark matrices.
  const sectionLayout = (vLine: number, pad: number) => ({
    hLineWidth: (i: number, node: { table: { body: unknown[] } }) =>
      i <= 1 ? 0 : i === 2 || i === node.table.body.length ? 0.7 : 0.3,
    vLineWidth: () => vLine,
    hLineColor: (i: number) => (i === 2 ? ACCENT : LINE),
    vLineColor: () => LINE,
    paddingTop: (i: number) => (i === 0 ? 10 : pad),
    paddingBottom: (i: number) => (i === 0 ? 5 : pad),
    paddingLeft: () => pad + 2,
    paddingRight: () => pad + 2,
    fillColor: (rowIndex: number) => (rowIndex === 1 ? '#EAF2FF' : null),
  });

  // The spanning chapter-title row: a single borderless cell across `span` columns.
  const titleRow = (text: string, span: number): TableCell[] => [
    { text, colSpan: span, bold: true, fontSize: 13, color: INK, border: [false, false, false, false], fillColor: '#FFFFFF' },
    ...Array.from({ length: span - 1 }, () => ({})),
  ];

  // Approx height a chapter-title row adds.
  const TITLE_H = 28;

  // Available content height on a landscape A4 page (height 595 − top/bottom margins), with a little
  // slack for the section heading above the table. A table estimated to fit within this is marked
  // `unbreakable` so it is never split across pages; a taller one (e.g. the full member list) breaks.
  // Kept comfortably below the true page height so an unbreakable block always places on a fresh page.
  const PAGE_AVAIL = 445;

  // Balance a label into (at most) two lines so the rotated header is about half as tall. The split
  // point between words is chosen to minimise the longer line; a single long word is split in half.
  const wrapTwo = (name: string): string[] => {
    const words = name.split(/\s+/).filter(Boolean);
    if (words.length <= 1) {
      if (name.length <= 16) return [name];
      const mid = Math.ceil(name.length / 2);
      return [name.slice(0, mid), name.slice(mid)];
    }
    let best: { lines: [string, string]; longest: number } | null = null;
    for (let k = 1; k < words.length; k += 1) {
      const l1 = words.slice(0, k).join(' ');
      const l2 = words.slice(k).join(' ');
      const longest = Math.max(l1.length, l2.length);
      if (!best || longest < best.longest) best = { lines: [l1, l2], longest };
    }
    return best!.lines;
  };

  // A matrix whose full column names are rotated into a multi-line header (no codes/legend): each name
  // is wrapped onto up to two stacked, rotated lines so the header stays short while every column is
  // self-labelled. Rotated text is drawn via an SVG cell. Marks assignments with a green cross.
  function matrix(
    title: string,
    cornerLabel: string,
    rows: { label: string; on: (colId: string) => boolean }[],
    cols: { id: string; name: string }[],
    emptyMsg: string,
  ): Content[] {
    if (!rows.length || !cols.length) return [h2(title), note(emptyMsg)];
    const FS = 7;
    const LINE_GAP = FS + 2; // horizontal spacing between stacked (rotated) header lines
    const wrapped = cols.map((c) => wrapTwo(c.name));
    const maxLines = Math.max(...wrapped.map((w) => w.length));
    const longestLine = Math.max(...wrapped.flat().map((s) => s.length));
    const headerH = Math.min(170, Math.round(longestLine * FS * 0.55) + 12);
    const colW = Math.max(16, maxLines * LINE_GAP + 4);

    // SVG header cell: each wrapped line is a vertical (rotate 270) strip; lines sit side by side and
    // the block is centred in the column.
    const rotated = (lines: string[]): Content => {
      const blockW = lines.length * LINE_GAP;
      const startX = (colW - blockW) / 2 + LINE_GAP * 0.7;
      const texts = lines
        .map(
          (ln, i) =>
            `<text font-family="Helvetica" font-size="${FS}" fill="${ACCENT}" ` +
            `transform="translate(${(startX + i * LINE_GAP).toFixed(1)}, ${headerH - 4}) rotate(270)">${escapeXml(ln)}</text>`,
        )
        .join('');
      return {
        svg: `<svg width="${colW}" height="${headerH}" xmlns="http://www.w3.org/2000/svg">${texts}</svg>`,
        width: colW,
        height: headerH,
        alignment: 'center',
      };
    };

    const crossLeft = Math.max(0, (colW - 6 - 8) / 2); // centre the ~8pt cross in the cell content box
    const cross = (on: boolean): Content =>
      on
        ? {
            canvas: [
              { type: 'line', x1: 0, y1: 0, x2: 8, y2: 8, lineWidth: 1.4, lineColor: GREEN },
              { type: 'line', x1: 8, y1: 0, x2: 0, y2: 8, lineWidth: 1.4, lineColor: GREEN },
            ],
            margin: [crossLeft, 1, 0, 1],
          }
        : { text: '' };

    const headerRow: TableCell[] = [
      { text: cornerLabel, bold: true, fontSize: 8, color: ACCENT, margin: [0, headerH - 12, 0, 0] },
      ...wrapped.map((lines) => rotated(lines)),
    ];
    const body: TableCell[][] = rows.map((r) => [td(r.label), ...cols.map((c) => cross(r.on(c.id)))]);
    const estHeight = TITLE_H + headerH + rows.length * 12.5 + 18;
    return [
      {
        table: {
          headerRows: 2,
          widths: [130, ...cols.map(() => colW)],
          body: [titleRow(title, 1 + cols.length), headerRow, ...body],
        },
        layout: sectionLayout(0.3, 1),
        unbreakable: estHeight <= PAGE_AVAIL,
        margin: [0, 12, 0, 8],
      },
    ];
  }

  // 1 — Trainings (sorted by display order then name).
  const trainings = [...data.trainings].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  const trainingRows: TableCell[][] = trainings.map((tr) => [
    td(tr.name),
    td(tr.category),
    td(formatDuration(tr.durationMinutes)),
    td(cycleLabel(t, tr.cycleYears)),
  ]);
  const trainingsTitle = t('trainingPlan.sectionTrainings', { count: trainings.length });
  const trainingsTable: Content = trainings.length
    ? {
        table: {
          headerRows: 2,
          widths: ['*', 'auto', 'auto', 'auto'],
          body: [
            titleRow(trainingsTitle, 4),
            [th(t('trainingPlan.colTraining')), th(t('trainingPlan.colCategory')), th(t('trainingPlan.colDuration')), th(t('trainingPlan.colCycle'))],
            ...trainingRows,
          ],
        },
        layout: sectionLayout(0, 3),
        unbreakable: TITLE_H + 16 + trainingRows.length * 14 <= PAGE_AVAIL,
        margin: [0, 12, 0, 8],
      }
    : { stack: [h2(trainingsTitle), note(t('trainingPlan.noTrainings'))] };

  // 2 — Roles × trainings matrix (rows = roles, columns = trainings).
  const roles = [...data.roles].sort((a, b) => a.name.localeCompare(b.name));
  const rolesMatrix = matrix(
    t('trainingPlan.sectionRoles', { count: roles.length }),
    t('trainingPlan.colRole'),
    roles.map((r) => ({ label: r.name, on: (trainingId: string) => r.trainingIds.includes(trainingId) })),
    trainings.map((tr) => ({ id: tr.id, name: tr.name })),
    t('trainingPlan.noRoles'),
  );

  // 3 — Members × roles matrix (rows = members the user is responsible for, columns = roles).
  const members = [...data.members].sort((a, b) => a.name.localeCompare(b.name));
  const membersMatrix = matrix(
    t('trainingPlan.sectionMembers', { count: members.length }),
    t('trainingPlan.colMember'),
    members.map((u) => ({ label: u.name, on: (roleId: string) => u.roleIds.includes(roleId) })),
    roles.map((r) => ({ id: r.id, name: r.name })),
    t('trainingPlan.noMembers'),
  );

  const label = (s: string): Content => ({ text: s, bold: true, fontSize: 8, color: MUTED });
  const val = (s: string): Content => ({ text: s, fontSize: 9, color: INK });
  const metaTable: Content = {
    table: {
      widths: ['auto', '*', 'auto', '*'],
      body: [
        [label(t('trainingPlan.document')), val(title), label(t('trainingPlan.documentId')), val(TRAINING_PLAN_DOC_ID)],
        [label(t('trainingPlan.company')), val(meta.company || '—'), label(t('trainingPlan.generatedOn')), val(meta.generatedOn)],
        [label(t('trainingPlan.preparedByLabel')), val(meta.preparedBy || '—'), label(t('trainingPlan.responsibleFor')), val(meta.responsibleFor || '—')],
        [label(t('trainingPlan.scope')), { text: t('trainingPlan.scopeValue', { trainings: trainings.length, roles: roles.length, members: members.length }), colSpan: 3, fontSize: 9, color: INK }, {}, {}],
      ],
    },
    layout: {
      hLineWidth: () => 0.5,
      vLineWidth: () => 0.5,
      hLineColor: () => LINE,
      vLineColor: () => LINE,
      paddingTop: () => 4,
      paddingBottom: () => 4,
      paddingLeft: () => 6,
      paddingRight: () => 6,
    },
    margin: [0, 0, 0, 10],
  };

  const signatureCell = (role: string): Content => ({
    stack: [
      { text: role, bold: true, fontSize: 8, color: MUTED, margin: [0, 0, 0, 18] },
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 150, y2: 0, lineWidth: 0.5, lineColor: INK }] },
      { text: t('trainingPlan.signatureLine'), fontSize: 7, color: MUTED, margin: [0, 3, 0, 0] },
    ],
  });
  const signatureBlock: Content = {
    table: {
      widths: ['*', '*', '*'],
      body: [[signatureCell(t('trainingPlan.preparedBy')), signatureCell(t('trainingPlan.reviewedBy')), signatureCell(t('trainingPlan.approvedBy'))]],
    },
    layout: 'noBorders',
    margin: [0, 16, 0, 0],
  };

  const def: TDocumentDefinitions = {
    pageSize: 'A4',
    pageOrientation: 'landscape', // the checkmark matrices read better across the wider page
    pageMargins: [40, 78, 40, 50],
    info: { title: `${TRAINING_PLAN_DOC_ID} ${title}`, author: meta.company },
    header: (currentPage: number) =>
      currentPage === 1
        ? { text: '' }
        : {
            margin: [40, 24, 40, 0],
            columns: [
              { text: meta.company || title, fontSize: 8, color: MUTED },
              { text: `${title}  ·  ${TRAINING_PLAN_DOC_ID}`, fontSize: 8, color: MUTED, alignment: 'right' },
            ],
          },
    footer: (currentPage: number, pageCount: number) => ({
      margin: [40, 8, 40, 0],
      columns: [
        { text: t('trainingPlan.footer'), fontSize: 7, color: MUTED },
        { text: `${currentPage} / ${pageCount}`, fontSize: 7, color: MUTED, alignment: 'right' },
      ],
    }),
    content: [
      { text: meta.company || ' ', color: ACCENT, bold: true, fontSize: 12 },
      { text: title, style: 'h1', margin: [0, 2, 0, 10] },
      metaTable,
      trainingsTable,
      ...rolesMatrix,
      ...membersMatrix,
      signatureBlock,
    ],
    styles: {
      h1: { fontSize: 18, bold: true, color: INK },
      h2: { fontSize: 13, bold: true, color: INK },
    },
    defaultStyle: { fontSize: 9, color: INK },
  };

  const safeName = (meta.company || 'training-plan').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '');
  return { def, fileName: `Training-Plan-${safeName}-${meta.generatedOn}.pdf`, docId: TRAINING_PLAN_DOC_ID, title };
}
