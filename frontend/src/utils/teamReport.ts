// Builds the "Training Status Report" PDF for the units a head is responsible for: one row per
// member × required training with its due status, plus a signature line so the head can sign it and
// file it in a DMS. Pure function (pdfmake document definition + file name); the page lazy-imports it
// together with pdf.ts/pdfPreview.ts so pdfmake/pdf.js stay out of the initial bundle.
import type { Content, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces';
import type { DueStatus, LocalizedText, MyTeam } from '@/types';
import { i18n } from '@/i18n';
import { formatDate } from './display';
import { resolveLocalized } from './locales';

type TFn = (key: string, named?: Record<string, unknown>) => string;

export interface TeamReportMeta {
  company: string;
  headName: string;
  generatedOn: string; // yyyy-mm-dd
}

const ACCENT = '#156A6E';
const INK = '#1A1A1A';
const MUTED = '#46595A';
const LINE = '#D8E0E0';
const GREEN = '#047857';
const RED = '#B91C1C';
const AMBER = '#B45309';

const statusColor: Record<DueStatus, string> = {
  overdue: RED,
  never: RED,
  due: AMBER,
  'up-to-date': GREEN,
};

const statusKey: Record<DueStatus, string> = {
  overdue: 'teamReport.statusOverdue',
  never: 'teamReport.statusNever',
  due: 'teamReport.statusDue',
  'up-to-date': 'teamReport.statusUpToDate',
};

const ACTIONABLE: DueStatus[] = ['never', 'due', 'overdue'];

export function buildTeamReport(
  team: MyTeam,
  meta: TeamReportMeta,
  t: TFn,
): { def: TDocumentDefinitions; fileName: string } {
  const th = (s: string): Content => ({ text: s, bold: true, fontSize: 8, color: ACCENT });
  const td = (s: string): Content => ({ text: s || '—', fontSize: 8, color: INK });

  // Localized training names resolved to the language the report is generated in (the current UI
  // locale, English fallback) — the same value the My Team page shows.
  const trainingName = (lt: LocalizedText): string => resolveLocalized(lt, i18n.global.locale.value).value;

  // Members sorted by unit then name; one table row per required training (or a single "—" row).
  const members = [...team.members].sort(
    (a, b) => a.orgUnitName.localeCompare(b.orgUnitName) || a.user.name.localeCompare(b.user.name),
  );
  let dueTotal = 0;
  const rows: TableCell[][] = [];
  for (const m of members) {
    const trainings = [...m.trainings].sort((a, b) => trainingName(a.name).localeCompare(trainingName(b.name)));
    if (trainings.length === 0) {
      rows.push([td(m.user.name), td(m.orgUnitName), td('—'), td('—'), td('—')]);
      continue;
    }
    trainings.forEach((tr, i) => {
      if (ACTIONABLE.includes(tr.status)) dueTotal += 1;
      rows.push([
        td(i === 0 ? m.user.name : ''),
        td(i === 0 ? m.orgUnitName : ''),
        td(trainingName(tr.name)),
        { text: t(statusKey[tr.status]), fontSize: 8, color: statusColor[tr.status], bold: tr.status !== 'up-to-date' },
        td(tr.dueDate ? formatDate(tr.dueDate) : '—'),
      ]);
    });
  }

  const tableLayout = {
    hLineWidth: (i: number, node: { table: { body: unknown[] } }) =>
      i === 0 || i === 1 || i === node.table.body.length ? 0.7 : 0.3,
    vLineWidth: () => 0,
    hLineColor: (i: number) => (i <= 1 ? ACCENT : LINE),
    paddingTop: () => 3,
    paddingBottom: () => 3,
    paddingLeft: () => 5,
    paddingRight: () => 5,
    fillColor: (rowIndex: number) => (rowIndex === 0 ? '#EAF2FF' : null),
  };

  const label = (s: string): Content => ({ text: s, bold: true, fontSize: 8, color: MUTED });
  const val = (s: string): Content => ({ text: s, fontSize: 9, color: INK });
  const metaTable: Content = {
    table: {
      widths: ['auto', '*', 'auto', '*'],
      body: [
        [label(t('teamReport.head')), val(meta.headName), label(t('teamReport.generatedOn')), val(meta.generatedOn)],
        [
          label(t('teamReport.responsibleFor')),
          { text: team.units.map((u) => u.name).join(', ') || '—', colSpan: 3, fontSize: 9, color: INK },
          {},
          {},
        ],
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

  // Prepared / reviewed / approved signature fields — every document filed in the DMS carries all three.
  const signatureCell = (role: string): Content => ({
    stack: [
      { text: role, bold: true, fontSize: 8, color: MUTED, margin: [0, 0, 0, 18] },
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 150, y2: 0, lineWidth: 0.5, lineColor: INK }] },
      { text: t('teamReport.signatureDate'), fontSize: 7, color: MUTED, margin: [0, 3, 0, 0] },
    ],
  });
  const signature: Content = {
    table: {
      widths: ['*', '*', '*'],
      body: [[signatureCell(t('teamReport.preparedBy')), signatureCell(t('teamReport.reviewedBy')), signatureCell(t('teamReport.approvedBy'))]],
    },
    layout: 'noBorders',
    margin: [0, 18, 0, 0],
  };

  const def: TDocumentDefinitions = {
    pageSize: 'A4',
    pageMargins: [40, 72, 40, 50],
    info: { title: t('teamReport.title'), author: meta.company },
    header: (currentPage: number) =>
      currentPage === 1
        ? { text: '' }
        : {
            margin: [40, 22, 40, 0],
            columns: [
              { text: meta.company, fontSize: 8, color: MUTED },
              { text: t('teamReport.title'), fontSize: 8, color: MUTED, alignment: 'right' },
            ],
          },
    footer: (currentPage: number, pageCount: number) => ({
      margin: [40, 8, 40, 0],
      columns: [
        { text: t('teamReport.footer'), fontSize: 7, color: MUTED },
        { text: `${currentPage} / ${pageCount}`, fontSize: 7, color: MUTED, alignment: 'right' },
      ],
    }),
    content: [
      { text: meta.company, color: ACCENT, bold: true, fontSize: 12 },
      { text: t('teamReport.title'), style: 'h1', margin: [0, 2, 0, 10] },
      metaTable,
      {
        text: t('teamReport.summary', { members: members.length, due: dueTotal }),
        fontSize: 9,
        color: dueTotal ? AMBER : GREEN,
        margin: [0, 0, 0, 8],
      },
      rows.length
        ? {
            table: {
              headerRows: 1,
              widths: ['*', 'auto', '*', 'auto', 'auto'],
              body: [
                [
                  th(t('teamReport.colMember')),
                  th(t('teamReport.colUnit')),
                  th(t('teamReport.colTraining')),
                  th(t('teamReport.colStatus')),
                  th(t('teamReport.colDue')),
                ],
                ...rows,
              ],
            },
            layout: tableLayout,
          }
        : { text: t('teamReport.noData'), fontSize: 9, color: MUTED, italics: true },
      signature,
    ],
    styles: { h1: { fontSize: 18, bold: true, color: INK } },
    defaultStyle: { fontSize: 9, color: INK },
  };

  const safeName = (meta.company || 'team').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '');
  return { def, fileName: `Training-Status-Report-${safeName}-${meta.generatedOn}.pdf` };
}
