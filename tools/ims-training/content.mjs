// Training "Jira Issue Management System (IMS)" — master data and quiz, English and German. Slides live
// in decks/ims.html (en) and decks/ims.de.html (de). Source: AA Jira Issue Management System rev.
// 001/06.2026 (roXtra 181298), Workflow and Role concept (roXtra 177290), Confluence QM/RA "Issue
// Management System" incl. Update 1. Jira terms (states, transitions, fields) stay English in both.
//
// Stable id so a rebuild UPDATES the installed training instead of duplicating it.

// q(text [en, de], options [[en, de], …], correct indices, type)
const q = ([en, de], options, correct, type = 'single') => ({
  id: null, // assigned by build.mjs (stable per index)
  text: { en, de },
  options: options.map(([oe, od]) => ({ en: oe, de: od })),
  correctIndices: correct,
  type,
});

export const IMS = {
  id: 'c1a5e0c0-0001-4000-8000-00000000a001',
  decks: [
    { locale: 'en', html: 'ims.html', pdf: 'jira-issue-management-system.pdf', label: 'Jira Issue Management System — slides' },
    { locale: 'de', html: 'ims.de.html', pdf: 'jira-issue-management-system.de.pdf', label: 'Jira Issue Management System — Folien' },
  ],
  name: { en: 'AA Jira Issue Management System (IMS)', de: 'AA Jira Issue Management System (IMS)' },
  description: {
    en: 'How defects and improvements are reported, validated, assessed, approved, implemented and closed in the Jira Issue Management System — workflow, roles and records.',
    de: 'Wie Defects und Improvements im Jira Issue Management System gemeldet, geprüft, bewertet, freigegeben, umgesetzt und abgeschlossen werden — Workflow, Rollen und Nachweise.',
  },
  category: { en: 'Product Life Cycle', de: 'Product Life Cycle' },
  durationMinutes: 25,
  cycleYears: 1,
  windowBeforeMonths: 1,
  windowAfterMonths: 3,
  questions: [
    q(
      ['Who may report an issue in the Jira Issue Management System?', 'Wer darf im Jira Issue Management System ein Issue melden?'],
      [
        ['All employees — everyone has reporter-level access', 'Alle Mitarbeitenden — jeder hat Reporter-Rechte'],
        ['Only Project Leads', 'Nur Project Leads'],
        ['Only the Quality Manager', 'Nur der Quality Manager'],
        ['Only members of R&D', 'Nur Mitarbeitende der Entwicklung'],
      ],
      [0],
    ),
    q(
      ['Which work types does the IMS support?', 'Welche Work Types unterstützt das IMS?'],
      [
        ['Defect', 'Defect'],
        ['Improvement', 'Improvement'],
        ['Epic', 'Epic'],
        ['CAPA', 'CAPA'],
        ['Change Request', 'Change Request'],
      ],
      [0, 1],
      'multiple',
    ),
    q(
      ['Which fields are mandatory in the creation dialog?', 'Welche Felder sind im Dialog zum Anlegen Pflicht?'],
      [
        ['Work type', 'Work type'],
        ['Summary', 'Summary'],
        ['Product', 'Product'],
        ['Severity', 'Severity'],
        ['Risk level', 'Risk level'],
      ],
      [0, 1, 2],
      'multiple',
    ),
    q(
      [
        'You report an issue but do not know the Project Lead of the product. Whom do you assign?',
        'Du meldest ein Issue, kennst aber den Project Lead des Produkts nicht. Wen trägst du als Assignee ein?',
      ],
      [
        ['The Director Research & Development', 'Den Director Research & Development'],
        ['The Quality Manager', 'Den Quality Manager'],
        ['Yourself', 'Dich selbst'],
        ['Nobody — the issue stays unassigned for good', 'Niemanden — das Issue bleibt dauerhaft ohne Assignee'],
      ],
      [0],
    ),
    q(
      [
        'What is the essential difference between the defect and the improvement workflow?',
        'Was ist der wesentliche Unterschied zwischen dem Defect- und dem Improvement-Workflow?',
      ],
      [
        ['The improvement workflow has no Risk Assessment state', 'Der Improvement-Workflow hat keinen Status Risk Assessment'],
        ['Improvements skip the Validity Check', 'Improvements überspringen den Validity Check'],
        ['Defects are closed by the Quality Manager', 'Defects werden vom Quality Manager geschlossen'],
        ['Improvements need no Project Lead', 'Improvements brauchen keinen Project Lead'],
      ],
      [0],
    ),
    q(
      [
        'The Project Lead performs the Validity Check. Which criteria make an issue valid?',
        'Der Project Lead führt den Validity Check durch. Welche Kriterien machen ein Issue gültig?',
      ],
      [
        ['The description is clear and complete', 'Die Beschreibung ist klar und vollständig'],
        ['Steps to reproduce are provided', 'Schritte zum Nachstellen sind angegeben'],
        ['Expected and actual behaviour are clearly defined', 'Erwartetes und tatsächliches Verhalten sind klar beschrieben'],
        ['Supporting evidence demonstrates the issue', 'Nachweise belegen das Problem'],
        ['The reporter has already proposed a fix', 'Der Reporter hat bereits eine Lösung vorgeschlagen'],
      ],
      [0, 1, 2, 3],
      'multiple',
    ),
    q(
      [
        'During the Validity Check the information is not sufficient to decide. What happens?',
        'Beim Validity Check reichen die Informationen für eine Entscheidung nicht aus. Was passiert?',
      ],
      [
        [
          'Improve Issue: the issue goes back to New and is assigned to the Reporter',
          'Improve Issue: Das Issue geht zurück nach New und wird dem Reporter zugewiesen',
        ],
        ['The issue is closed as Invalid', 'Das Issue wird als Invalid geschlossen'],
        ['The issue moves on to Context Assessment anyway', 'Das Issue geht trotzdem ins Context Assessment'],
        ['The Quality Manager decides', 'Der Quality Manager entscheidet'],
      ],
      [0],
    ),
    q(
      [
        'Who performs the Context Assessment, and what does it record among other things?',
        'Wer führt das Context Assessment durch, und was wird dabei unter anderem festgehalten?',
      ],
      [
        [
          'The Product Manager — impact, affected versions, frequency, a Priority, and the Q-Request ID if a released product is affected',
          'Der Product Manager — Auswirkung, betroffene Versionen, Häufigkeit, eine Priority und die Q-Request-ID, wenn ein freigegebenes Produkt betroffen ist',
        ],
        ['The Reporter — a proposed solution', 'Der Reporter — einen Lösungsvorschlag'],
        ['The Quality Manager — the residual risk', 'Der Quality Manager — das Restrisiko'],
        ['The Project Lead — the Change Request', 'Der Project Lead — den Change Request'],
      ],
      [0],
    ),
    q(
      [
        'Which items must be complete before the Quality Manager may approve a defect?',
        'Was muss vollständig vorliegen, bevor der Quality Manager einen Defect freigeben darf?',
      ],
      [
        ['Overall risk level calculated', 'Gesamtrisiko berechnet'],
        ['Acceptance criteria and planned mitigation documented', 'Akzeptanzkriterien und geplante Maßnahmen dokumentiert'],
        ['Residual risk clearly stated', 'Restrisiko klar benannt'],
        ['Supporting evidence and reference links attached', 'Nachweise und Referenzen angehängt'],
        ['The fix is already implemented and tested', 'Der Fix ist bereits umgesetzt und getestet'],
      ],
      [0, 1, 2, 3],
      'multiple',
    ),
    q(
      [
        'The Quality Manager sends a defect back with "Improve Issue". What must the comment contain?',
        'Der Quality Manager schickt einen Defect mit „Improve Issue“ zurück. Was muss der Kommentar enthalten?',
      ],
      [
        [
          'An actionable, bulleted checklist of the missing or unclear items',
          'Eine umsetzbare Checkliste mit Aufzählungspunkten zu den fehlenden oder unklaren Punkten',
        ],
        ['Only the word "rejected"', 'Nur das Wort „abgelehnt“'],
        ['The new risk level', 'Das neue Risikoniveau'],
        ['Nothing — a comment is optional', 'Nichts — ein Kommentar ist optional'],
      ],
      [0],
    ),
    q(
      ['What is required before an approved issue may be implemented?', 'Was ist nötig, bevor ein freigegebenes Issue umgesetzt werden darf?'],
      [
        ['A Change Request according to SOP-10.12 Change Management', 'Ein Change Request nach SOP-10.12 Change Management'],
        ['A new Q-Request', 'Ein neuer Q-Request'],
        ['Approval by the Reporter', 'Die Zustimmung des Reporters'],
        ['Nothing — the Backlog state is enough', 'Nichts — der Status Backlog genügt'],
      ],
      [0],
    ),
    q(
      ['New information arises about a closed issue. What happens?', 'Zu einem geschlossenen Issue gibt es neue Informationen. Was passiert?'],
      [
        [
          'The Project Lead reopens it and it returns to Context Assessment',
          'Der Project Lead öffnet es wieder, und es geht zurück ins Context Assessment',
        ],
        [
          'A new issue must always be created; closed issues cannot change',
          'Es muss immer ein neues Issue angelegt werden; geschlossene Issues sind unveränderlich',
        ],
        ['The Reporter reopens it to New', 'Der Reporter öffnet es wieder nach New'],
        ['The Quality Manager reopens it to Risk Assessment', 'Der Quality Manager öffnet es wieder nach Risk Assessment'],
      ],
      [0],
    ),
    q(
      ['How do you move an issue to its next state?', 'Wie bringst du ein Issue in den nächsten Status?'],
      [
        [
          'Choose the transition (the Status field is read-only), update the assignee and explain the decision in a comment',
          'Transition wählen (das Feld Status ist schreibgeschützt), Assignee anpassen und die Entscheidung im Kommentar begründen',
        ],
        ['Edit the Status field directly', 'Das Feld Status direkt bearbeiten'],
        ['Send an email to the Project Lead', 'Eine E-Mail an den Project Lead schicken'],
        ['Drag the issue on the board only — comments are not needed', 'Das Issue nur auf dem Board verschieben — Kommentare sind unnötig'],
      ],
      [0],
    ),
  ],
};

// Questions are written with the correct answer first; shuffle the options deterministically
// (seeded per question) so the position gives nothing away and rebuilds stay stable.
for (const [qi, item] of IMS.questions.entries()) {
  let seed = 0x811c9dc5;
  for (const ch of `${qi}:${item.text.en}`) seed = Math.imul(seed ^ ch.charCodeAt(0), 16777619) >>> 0;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const order = item.options.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  item.options = order.map((i) => item.options[i]);
  item.correctIndices = item.correctIndices.map((c) => order.indexOf(c)).sort((a, b) => a - b);
}
