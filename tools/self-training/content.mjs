// The two BrainGain self-trainings — master data and quizzes in English and German, shared by
// capture.mjs (which seeds the trainee training into the screenshot instance) and install.mjs
// (which writes both into the tracked data set). Slide content lives in decks/*.html.
//
// Stable ids so a rebuild UPDATES the installed trainings instead of duplicating them.
// Every text is a LocalizedText ({ en, de }); options are authored with the correct answers FIRST
// (easy to review) and shuffled below with a stable, text-seeded order.

export const LOCALES = ['en', 'de'];

// q(textEn, textDe, [[optEn, optDe], …], correctIndices, type)
const q = (en, de, options, correct, type = 'single') => ({
  id: null, // assigned by install.mjs (stable per training + index)
  text: { en, de },
  options: options.map(([oen, ode]) => ({ en: oen, de: ode })),
  correctIndices: correct,
  type,
});

export const TRAINEE = {
  id: 'b7a1e0c0-0001-4000-8000-00000000a001',
  deck: 'trainee',
  pdf: { en: 'braingain-for-trainees.pdf', de: 'braingain-fuer-trainees.pdf' },
  materialLabel: { en: 'BrainGain for Trainees — slides', de: 'BrainGain für Trainees — Folien' },
  name: { en: 'BrainGain for Trainees', de: 'BrainGain für Trainees' },
  description: {
    en: 'How to use BrainGain as a learner: signing in, reading your training dashboard, working through the materials, passing the test and signing your completion.',
    de: 'BrainGain als Lernende/r nutzen: anmelden, das Schulungs-Dashboard lesen, die Materialien durcharbeiten, den Test bestehen und den Abschluss signieren.',
  },
  category: { en: 'BrainGain', de: 'BrainGain' },
  durationMinutes: 20,
  cycleYears: 3,
  windowBeforeMonths: 2,
  windowAfterMonths: 1,
  questions: [
    q(
      'What is the regular way to sign in to BrainGain?',
      'Wie meldet man sich regulär bei BrainGain an?',
      [
        ['Sign in with Microsoft', 'Mit Microsoft anmelden'],
        ['The email and password form on the login page', 'Über das E-Mail/Passwort-Formular auf der Anmeldeseite'],
        ['A link your trainer sends you for every training', 'Über einen Link, den der Trainer für jede Schulung schickt'],
        ['There is no sign-in — the dashboard is public', 'Es gibt keine Anmeldung — das Dashboard ist öffentlich'],
      ],
      [0],
    ),
    q(
      'Who decides which trainings appear on your dashboard?',
      'Wer bestimmt, welche Schulungen auf Ihrem Dashboard erscheinen?',
      [
        ['The trainings required by your job roles, assigned by an administrator', 'Die Schulungen, die Ihre Funktionen verlangen — zugewiesen von einem Administrator'],
        ['You pick them yourself from a catalog', 'Sie wählen sie selbst aus einem Katalog'],
        ['Everyone sees every training', 'Alle sehen alle Schulungen'],
        ['Your unit head picks them per month', 'Ihre Bereichsleitung wählt sie monatlich aus'],
      ],
      [0],
    ),
    q(
      'A training card shows "Due now". What does that mean?',
      'Eine Schulungskarte zeigt „Jetzt fällig“. Was bedeutet das?',
      [
        ['You have never taken it, or its repeat cycle has come around — complete it now', 'Sie haben sie noch nie bestanden oder der Wiederholungszyklus ist erreicht — jetzt absolvieren'],
        ['The training was deleted', 'Die Schulung wurde gelöscht'],
        ['You already passed it this year', 'Sie haben sie dieses Jahr bereits bestanden'],
        ['Only your trainer can see it', 'Nur Ihr Trainer kann sie sehen'],
      ],
      [0],
    ),
    q(
      'Which statuses can a training card show?',
      'Welche Status kann eine Schulungskarte anzeigen?',
      [
        ['Due now', 'Jetzt fällig'],
        ['Overdue', 'Überfällig'],
        ['Up to date', 'Aktuell'],
        ['Updated', 'Aktualisiert'],
        ['Archived', 'Archiviert'],
      ],
      [0, 1, 2, 3],
      'multiple',
    ),
    q(
      'What happens before the test starts?',
      'Was passiert, bevor der Test beginnt?',
      [
        ['You confirm that you are aware of all materials and have reviewed them', 'Sie bestätigen, dass Sie alle Materialien kennen und durchgesehen haben'],
        ['Your trainer must unlock the test by email', 'Ihr Trainer muss den Test per E-Mail freischalten'],
        ['Nothing — the test opens immediately', 'Nichts — der Test öffnet sich sofort'],
        ['You download every material first; the app checks it', 'Sie laden zuerst jedes Material herunter; die App prüft das'],
      ],
      [0],
    ),
    q(
      'What does a multiple-choice question require to count as correct?',
      'Wann gilt eine Mehrfachauswahl-Frage als richtig beantwortet?',
      [
        ['Exactly the full set of correct answers — no more, no less', 'Genau die vollständige Menge der richtigen Antworten — nicht mehr, nicht weniger'],
        ['At least one correct answer ticked', 'Mindestens eine richtige Antwort angekreuzt'],
        ['Any answer, as long as something is ticked', 'Irgendeine Antwort, Hauptsache etwas ist angekreuzt'],
        ['The first option is always correct', 'Die erste Option ist immer richtig'],
      ],
      [0],
    ),
    q(
      'What must you do when you submit the test?',
      'Was müssen Sie tun, wenn Sie den Test abgeben?',
      [
        ['Confirm your identity with your password or a fresh Microsoft sign-in', 'Ihre Identität mit Ihrem Passwort oder einer erneuten Microsoft-Anmeldung bestätigen'],
        ['Enter your trainer’s name', 'Den Namen Ihres Trainers eingeben'],
        ['Print the result', 'Das Ergebnis ausdrucken'],
        ['Wait for the administrator to approve', 'Auf die Freigabe durch den Administrator warten'],
      ],
      [0],
    ),
    q(
      'You did not reach the pass threshold. What is true?',
      'Sie haben die Bestehensgrenze nicht erreicht. Was trifft zu?',
      [
        ['The failed attempt is not recorded and you can retry right away', 'Der fehlgeschlagene Versuch wird nicht gespeichert und Sie können sofort erneut antreten'],
        ['The training is locked for 30 days', 'Die Schulung ist 30 Tage gesperrt'],
        ['Your previous completion is deleted', 'Ihr bisheriger Abschluss wird gelöscht'],
        ['Your administrator is notified automatically', 'Ihr Administrator wird automatisch benachrichtigt'],
      ],
      [0],
    ),
    q(
      'A training you already completed shows "Updated". Which actions can it require?',
      'Eine bereits abgeschlossene Schulung zeigt „Aktualisiert“. Welche Aktionen kann sie verlangen?',
      [
        ['Retake the training (materials and test)', 'Die Schulung erneut absolvieren (Material und Test)'],
        ['Review the materials and confirm', 'Das Material sichten und bestätigen'],
        ['Sign in again with a new password', 'Sich mit einem neuen Passwort erneut anmelden'],
        ['Delete and recreate your account', 'Ihr Konto löschen und neu anlegen'],
      ],
      [0, 1],
      'multiple',
    ),
    q(
      'Where do you find the contact of the trainer responsible for a training?',
      'Wo finden Sie den Kontakt des für eine Schulung verantwortlichen Trainers?',
      [
        ['In the materials confirmation dialog and on the result page', 'Im Dialog zur Materialbestätigung und auf der Ergebnisseite'],
        ['Only in the Users list', 'Nur in der Benutzerliste'],
        ['In the Settings page', 'Auf der Einstellungsseite'],
        ['Nowhere — trainers are anonymous', 'Nirgends — Trainer sind anonym'],
      ],
      [0],
    ),
  ],
};

export const TRAINER = {
  id: 'b7a1e0c0-0002-4000-8000-00000000a002',
  deck: 'trainer',
  pdf: { en: 'braingain-for-trainers.pdf', de: 'braingain-fuer-trainer.pdf' },
  materialLabel: { en: 'BrainGain for Trainers — slides', de: 'BrainGain für Trainer — Folien' },
  name: { en: 'BrainGain for Trainers', de: 'BrainGain für Trainer' },
  description: {
    en: 'Authoring trainings in BrainGain: creating a training with materials and a quiz, importing a SCORM course, working with drafts and published versions, and following up with your trainees.',
    de: 'Schulungen in BrainGain erstellen: eine Schulung mit Materialien und Quiz anlegen, einen SCORM-Kurs importieren, mit Entwürfen und veröffentlichten Versionen arbeiten und die Teilnehmenden im Blick behalten.',
  },
  category: { en: 'BrainGain', de: 'BrainGain' },
  durationMinutes: 45,
  cycleYears: 3,
  windowBeforeMonths: 2,
  windowAfterMonths: 1,
  questions: [
    q(
      'You changed the quiz of a published training and clicked Save, but did not publish. What do trainees see?',
      'Sie haben das Quiz einer veröffentlichten Schulung geändert und gespeichert, aber nicht veröffentlicht. Was sehen die Teilnehmenden?',
      [
        ['The last published version — your change is staged as a draft', 'Die zuletzt veröffentlichte Version — Ihre Änderung liegt als Entwurf bereit'],
        ['Your new quiz immediately', 'Sofort Ihr neues Quiz'],
        ['Nothing — the training disappears until you publish', 'Nichts — die Schulung verschwindet bis zur Veröffentlichung'],
        ['A warning that the training is being edited', 'Einen Hinweis, dass die Schulung gerade bearbeitet wird'],
      ],
      [0],
    ),
    q(
      'A training card says "Not published" (version 0). What does that mean for trainees?',
      'Eine Schulung zeigt „Unveröffentlicht“ (Version 0). Was heißt das für die Teilnehmenden?',
      [
        ['They cannot see or start the training until version 1 is published', 'Sie können die Schulung weder sehen noch starten, bis Version 1 veröffentlicht ist'],
        ['They can study the materials but not take the test', 'Sie können die Materialien lernen, aber den Test nicht machen'],
        ['They see it only if it is due', 'Sie sehen sie nur, wenn sie fällig ist'],
        ['They can complete it by confirmation', 'Sie können sie per Bestätigung abschließen'],
      ],
      [0],
    ),
    q(
      'Which content types can a BrainGain training have?',
      'Welche Inhaltstypen kann eine BrainGain-Schulung haben?',
      [
        ['Material & quiz', 'Material & Test'],
        ['SCORM course', 'SCORM-Kurs'],
        ['Classroom attendance list', 'Anwesenheitsliste für Präsenzschulungen'],
        ['Video call', 'Videokonferenz'],
      ],
      [0, 1],
      'multiple',
    ),
    q(
      'Which SCORM packages does BrainGain accept?',
      'Welche SCORM-Pakete akzeptiert BrainGain?',
      [
        ['SCORM 1.2 or SCORM 2004 packages with a single launchable lesson (single SCO)', 'SCORM-1.2- oder SCORM-2004-Pakete mit genau einer startbaren Lektion (Single SCO)'],
        ['Any zip file that contains HTML', 'Jede ZIP-Datei, die HTML enthält'],
        ['cmi5 / xAPI packages', 'cmi5-/xAPI-Pakete'],
        ['Multi-SCO packages with several lessons', 'Multi-SCO-Pakete mit mehreren Lektionen'],
      ],
      [0],
    ),
    q(
      'Which reasons make BrainGain refuse a SCORM package?',
      'Aus welchen Gründen lehnt BrainGain ein SCORM-Paket ab?',
      [
        ['No imsmanifest.xml in the zip', 'Keine imsmanifest.xml im ZIP'],
        ['Several launchable lessons (multi-SCO)', 'Mehrere startbare Lektionen (Multi-SCO)'],
        ['An encrypted zip archive', 'Ein verschlüsseltes ZIP-Archiv'],
        ['More than 500 MB unpacked', 'Mehr als 500 MB entpackt'],
        ['A package larger than 10 MB', 'Ein Paket größer als 10 MB'],
      ],
      [0, 1, 2, 3],
      'multiple',
    ),
    q(
      'Which publish option creates an obligation with a deadline and emails everyone who already completed the training?',
      'Welche Veröffentlichungsoption erzeugt eine Pflicht mit Frist und benachrichtigt alle, die die Schulung bereits abgeschlossen haben, per E-Mail?',
      [
        ['Publish and notify', 'Veröffentlichen und benachrichtigen'],
        ['Publish silently', 'Still veröffentlichen'],
        ['Save', 'Speichern'],
        ['Discard draft', 'Entwurf verwerfen'],
      ],
      [0],
    ),
    q(
      'When you publish and notify, which mode restarts the trainees’ regular repeat cycle once they comply?',
      'Welcher Modus beim Veröffentlichen mit Benachrichtigung startet den regulären Wiederholungszyklus der Teilnehmenden neu?',
      [
        ['Retake the training — the new passing result restarts the cycle', 'Schulung erneut absolvieren — das Bestehen startet den Zyklus neu'],
        ['Review and confirm the materials — the cycle is unchanged', 'Material sichten und bestätigen — der Zyklus bleibt unverändert'],
        ['Both modes restart the cycle', 'Beide Modi starten den Zyklus neu'],
        ['Neither mode touches the cycle', 'Keiner der Modi berührt den Zyklus'],
      ],
      [0],
    ),
    q(
      'A material has only an English file and a trainee uses BrainGain in German. What happens?',
      'Ein Material hat nur eine englische Datei und ein Teilnehmer nutzt BrainGain auf Deutsch. Was passiert?',
      [
        ['The English variant is offered — English is the fallback language', 'Die englische Variante wird angeboten — Englisch ist die Rückfallsprache'],
        ['The material is hidden for that trainee', 'Das Material wird für diesen Teilnehmer ausgeblendet'],
        ['The training cannot be published', 'Die Schulung kann nicht veröffentlicht werden'],
        ['BrainGain translates the file automatically', 'BrainGain übersetzt die Datei automatisch'],
      ],
      [0],
    ),
    q(
      'For which kind of SCORM course is the completion rule "after the training duration of measured activity" meant?',
      'Für welche Art SCORM-Kurs ist die Abschlussregel „nach der Schulungsdauer gemessener Aktivität“ gedacht?',
      [
        ['Courses that report nothing at all back to the LMS', 'Kurse, die dem LMS gar nichts zurückmelden'],
        ['Every course — it is the recommended default', 'Jeden Kurs — es ist die empfohlene Voreinstellung'],
        ['Courses with a mastery score', 'Kurse mit einer Bestehensgrenze (Mastery Score)'],
        ['Courses longer than 60 minutes', 'Kurse, die länger als 60 Minuten dauern'],
      ],
      [0],
    ),
    q(
      'How does a training reach the trainees who must take it?',
      'Wie gelangt eine Schulung zu den Personen, die sie absolvieren müssen?',
      [
        ['An administrator adds it to the job roles that require it', 'Ein Administrator fügt sie den Funktionen hinzu, die sie verlangen'],
        ['The trainer picks trainees one by one in the editor', 'Der Trainer wählt die Personen einzeln im Editor aus'],
        ['Every published training is mandatory for everyone', 'Jede veröffentlichte Schulung ist für alle verpflichtend'],
        ['Trainees subscribe to it themselves', 'Die Personen abonnieren sie selbst'],
      ],
      [0],
    ),
    q(
      'Where can a trainer send reminder emails to people who are due, and what must be set up first?',
      'Wo kann ein Trainer Erinnerungs-E-Mails an fällige Personen senden, und was muss vorher eingerichtet sein?',
      [
        ['On the Trainees page — once an administrator has configured SMTP in Settings', 'Auf der Seite „Teilnehmer“ — sobald ein Administrator SMTP in den Einstellungen konfiguriert hat'],
        ['On the Users page — no setup needed', 'Auf der Seite „Benutzer“ — ohne Einrichtung'],
        ['In the training editor — once a deadline is set', 'Im Schulungseditor — sobald eine Frist gesetzt ist'],
        ['In the Audit trail', 'Im Audit-Trail'],
      ],
      [0],
    ),
    q(
      'Which statements about the training schedule are correct?',
      'Welche Aussagen zum Zeitplan einer Schulung sind richtig?',
      [
        ['"Repeat every" sets how many years a passing result stays valid', '„Wiederholung (Jahre)“ legt fest, wie viele Jahre ein bestandenes Ergebnis gültig bleibt'],
        ['"Window opens" lets trainees take the training some months before the due date', '„Fenster öffnet“ erlaubt, die Schulung einige Monate vor dem Fälligkeitsdatum zu absolvieren'],
        ['"Grace" is the number of months after the due date before a training counts as overdue', '„Kulanz“ sind die Monate nach dem Fälligkeitsdatum, bevor eine Schulung als überfällig gilt'],
        ['The schedule only affects the first attempt', 'Der Zeitplan betrifft nur den ersten Versuch'],
      ],
      [0, 1, 2],
      'multiple',
    ),
  ],
};

// Options are authored with the correct answers first (easy to review) and shuffled here with a
// fixed seed per question, so the correct option is not always "A" — and the order is stable across
// rebuilds (install.mjs compares content to decide whether to bump the version). The seed is taken
// from the ENGLISH text, so both languages share one option order (grading is language-independent).
function shuffleOptions(training) {
  training.questions.forEach((q, qi) => {
    // FNV-1a over the question text + index: a stable seed that differs per question.
    let seed = 0x811c9dc5;
    for (const ch of `${qi}:${q.text.en}`) seed = Math.imul(seed ^ ch.charCodeAt(0), 16777619) >>> 0;
    const rand = () => {
      seed = (seed + 0x6d2b79f5) >>> 0;
      let t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const order = q.options.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    q.options = order.map((i) => q.options[i]);
    q.correctIndices = q.correctIndices.map((c) => order.indexOf(c)).sort((a, b) => a - b);
  });
}
shuffleOptions(TRAINEE);
shuffleOptions(TRAINER);

export const TRAININGS = [TRAINEE, TRAINER];
