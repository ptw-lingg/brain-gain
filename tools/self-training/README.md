# BrainGain self-trainings

Two trainings that teach BrainGain itself, delivered **inside** BrainGain as a slide PDF plus a quiz — in English
and German. Each training carries both languages: a German-speaking user gets the German slides and German
questions, everyone else the English ones (English is the app's fallback language).

| Training | Audience | Slides | Quiz |
| --- | --- | --- | --- |
| BrainGain for Trainees · BrainGain für Trainees | everyone who takes trainings — sign-in, dashboard, materials, test, signature, updates | 18 | 10 questions |
| BrainGain for Trainers · BrainGain für Trainer | trainers — creating a training, materials & quiz, drafts/versions/publishing, SCORM import, trainees page | 24 | 12 questions |

The slides embed real screenshots of the app in the matching UI language, so they are **regenerated, not hand-edited**.

## Files

- `content.mjs` — master data and quiz questions of both trainings, every text as `{ en, de }` (fixed ids; answers
  authored first and shuffled with a stable, text-seeded order shared by both languages).
- `decks/<deck>.<locale>.html` (`trainee.en`, `trainee.de`, `trainer.en`, `trainer.de`) and `decks/deck.css` — the
  slides, one `<section class="slide">` per page, 16:9. German decks use the German UI terms from `de.json`
  (Funktionen, Teilnehmer, Kulanz, Material & Test …).
- `capture.mjs` — boots an isolated, seeded BrainGain on ports 4552–4554 with a temp data dir and walks the learner
  and trainer flows in headless Edge once per language (`en-US` and `de-DE` browser contexts; locators follow the
  app's own i18n strings). Writes `shots/<locale>/*.png`. Never touches the tracked data.
- `render.mjs` — renders the four decks to `out/*.pdf`.
- `install.mjs` — copies the PDFs into `backend/src/data/materials` (one material with an EN and a DE variant per
  training) and upserts the two training records into `trainings.json` (published; a content change publishes the
  next version silently).
- `preview.mjs` — screenshots every slide to `out/preview/` for a quick visual check.
- `build.mjs` — the whole pipeline: render → capture → render → install.

## Regenerate

```
npm run self-training
```

Options: `--no-build` (skip the SPA build; `frontend/dist` must be current), `--skip-capture` (reuse `shots/`),
`--no-install`, `--data <dir>` and `--owner <email>` for the install step. Edit the decks or the questions, run the
pipeline, review `out/preview/`, then commit `backend/src/data` together with `tools/self-training`.

Trainees only see a training that one of their job roles requires — add the two trainings to the roles in the admin UI.
