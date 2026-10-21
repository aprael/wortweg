// Wortweg – Admin-Bereich (nur role = 'admin'). Wird von app.js per dynamischem import() geladen.
// Beim Laden des Moduls wird nichts am DOM verändert; createAdmin() liefert Ansicht und Ereignis-Handler.

import { solutionResponse } from './grading.js';

export const TYPE_LABELS = {
  choice: 'Auswahl', fill: 'Lücke füllen', translate: 'Übersetzen', order: 'Satzbau', listen: 'Hören', match: 'Paare finden', speak: 'Sprechen',
};
export const COURSE_STATUS = [['draft', 'Entwurf'], ['published', 'Veröffentlicht'], ['archived', 'Archiviert']];
export const UNIT_STATUS = [['draft', 'Entwurf'], ['published', 'Veröffentlicht']];
const statusLabel = (s) => (COURSE_STATUS.find(([k]) => k === s)?.[1] ?? s);

/** Textfeld mit einer Variante pro Zeile → Liste (leere Zeilen fallen weg). */
export function linesToList(text) {
  return String(text ?? '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

export function listToLines(list) {
  return (list ?? []).join('\n');
}

/** Kurzfassung einer erzeugten Übung für die Vorschau: Typ, Frage, Lösung. */
export function exerciseSummary(ex) {
  const type = TYPE_LABELS[ex.type] ?? ex.type;
  let question = ex.question ?? '';
  let solution = ex.solution ?? '';
  if (ex.type === 'match') {
    question = (ex.left ?? []).map((l) => l.text).join(', ');
    solution = (ex.pairs ?? []).map(([l, r]) => `${ex.left.find((x) => x.id === l)?.text} = ${ex.right.find((x) => x.id === r)?.text}`).join(' · ');
  } else if (ex.type === 'fill') {
    question = `${ex.question} – ${ex.parts?.before ?? ''} ___ ${ex.parts?.after ?? ''}`.trim();
    solution = `${solutionResponse(ex)} (${ex.solution})`;
  } else if (ex.type === 'listen') {
    question = `vorgelesen: „${ex.speak}“`;
  } else if (ex.type === 'speak') {
    question = `vorlesen: „${ex.question}“`;
  } else if (ex.type === 'choice') {
    solution = solutionResponse(ex);
    question = `${ex.question} [${(ex.choices ?? []).join(' | ')}]`;
  } else if (ex.type === 'order') {
    solution = solutionResponse(ex).join(' ');
  }
  return { type, question, solution };
}

const fmtTime = (t) => (t ? new Date(t).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }) : '–');

/**
 * @param {object} ctx  von app.js: api, esc, plural, announce, render, go, focus, onUnauthorized, invalidatePublic,
 *                      downloadJson, readFileText, parseJsonText, languageName, setTitle
 */
export function createAdmin(ctx) {
  const { api, esc, plural, announce, render, go, focus } = ctx;
  const data = new Map(); // key → { status, data, error }
  const ui = {
    notice: null, // { scope, kind, text, errors? }
    pendingNotice: null,
    confirm: null, // z. B. "del-item:12"
    editing: null, // z. B. "item:12", "lang:de"
    validation: new Map(),
    previews: new Map(), // unitPk → { status, lessons, error }
    busy: false,
    addOpen: new Set(), // "unitPk:w|s" – Formular nach dem Hinzufügen offen lassen (Serien-Eingabe)
  };

  // ---------- Daten ----------

  function load(key, loader) {
    let e = data.get(key);
    if (!e) {
      e = { status: 'loading', data: null, error: null };
      data.set(key, e);
      loader().then(
        (d) => {
          e.status = 'ok';
          e.data = d;
          if (data.get(key) === e) render();
        },
        (err) => {
          e.status = 'error';
          e.error = err;
          if (err?.status === 401) ctx.onUnauthorized();
          else if (data.get(key) === e) render();
        },
      );
    }
    return e;
  }

  const overview = () => load('overview', () => api.adminOverview());
  const courseData = (id) => load(`course:${id}`, () => api.adminGetCourse(id).then((d) => d.course));

  function setCourse(course) {
    data.set(`course:${course.id}`, { status: 'ok', data: course, error: null });
    data.delete('overview');
    ctx.invalidatePublic(course.id);
  }

  function setNotice(scope, kind, text, errors = null, doFocus = true) {
    ui.notice = { scope, kind, text, errors };
    if (kind === 'ok') announce(text);
    if (doFocus) focus(`#adm-notice-${scope}`);
  }

  function notice(scope) {
    const n = ui.notice;
    if (!n || n.scope !== scope) return '';
    const list = n.errors?.length ? `<ul class="error-list">${n.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` : '';
    return `<div class="notice notice-${esc(n.kind)}" id="adm-notice-${esc(scope)}" tabindex="-1"${n.kind === 'error' ? ' role="alert"' : ''}><p>${esc(n.text)}</p>${list}</div>`;
  }

  /** Führt eine Änderung aus und zeigt Erfolg oder Server-Fehler an der Stelle `scope`. */
  async function mutate(scope, fn, okText, { focusOk = false } = {}) {
    if (ui.busy) return null;
    ui.busy = true;
    ui.notice = null;
    try {
      const res = await fn();
      if (res?.course) setCourse(res.course);
      if (okText) setNotice(scope, 'ok', okText, null, focusOk);
      return res ?? {};
    } catch (err) {
      if (err?.status === 401) {
        ctx.onUnauthorized();
        return null;
      }
      setNotice(scope, 'error', err?.message ?? 'Unbekannter Fehler.', Array.isArray(err?.details?.errors) ? err.details.errors : null);
      return null;
    } finally {
      ui.busy = false;
      render();
    }
  }

  function stateView(e, title, key) {
    if (e.status === 'error') {
      ctx.setTitle(title);
      if (e.error?.status === 404) {
        return `<section class="card state-card"><h1 tabindex="-1">Nicht gefunden</h1><p>${esc(e.error.message)}</p><p><a class="btn" href="#/admin">Zur Admin-Übersicht</a></p></section>`;
      }
      return `<section class="card state-card is-error"><h1 tabindex="-1">${esc(title)}</h1><p>${esc(e.error?.message)}</p>
        <p><button type="button" class="btn btn-primary" data-action="adm-retry" data-key="${esc(key)}">Erneut versuchen</button></p></section>`;
    }
    return `<section class="card state-card" aria-busy="true"><h1 tabindex="-1">Wird geladen …</h1><div class="spinner" aria-hidden="true"></div></section>`;
  }

  // ---------- Bausteine ----------

  const langOptions = (languages, selected) => languages.map((l) => `<option value="${esc(l.code)}"${l.code === selected ? ' selected' : ''}>${esc(l.name)} (${esc(l.code)})</option>`).join('');

  function input(form, name, label, { value = '', hint = '', required = false, type = 'text', maxlength = 0, pattern = '', lang = '', placeholder = '' } = {}) {
    const id = `${form}-${name}`;
    return `<div class="field"><label for="${id}">${esc(label)}${required ? '' : ' <span class="muted">(optional)</span>'}</label>
      ${hint ? `<p class="field-hint" id="${id}-hint">${esc(hint)}</p>` : ''}
      <input id="${id}" name="${name}" type="${type}" value="${esc(value)}"${required ? ' required' : ''}${maxlength ? ` maxlength="${maxlength}"` : ''}${pattern ? ` pattern="${esc(pattern)}"` : ''}${lang ? ` lang="${esc(lang)}"` : ''}${placeholder ? ` placeholder="${esc(placeholder)}"` : ''}${hint ? ` aria-describedby="${id}-hint"` : ''} autocomplete="off"></div>`;
  }

  function textarea(form, name, label, { value = '', hint = '', required = false, rows = 3, lang = '' } = {}) {
    const id = `${form}-${name}`;
    return `<div class="field"><label for="${id}">${esc(label)}${required ? '' : ' <span class="muted">(optional)</span>'}</label>
      ${hint ? `<p class="field-hint" id="${id}-hint">${esc(hint)}</p>` : ''}
      <textarea id="${id}" name="${name}" rows="${rows}"${required ? ' required' : ''}${lang ? ` lang="${esc(lang)}"` : ''}${hint ? ` aria-describedby="${id}-hint"` : ''}>${esc(value)}</textarea></div>`;
  }

  function confirmInline(key, question, yes = 'Ja, löschen') {
    return `<div class="confirm" role="group" aria-labelledby="adm-c-${esc(key.replace(/[^a-z0-9-]/gi, '-'))}">
      <p id="adm-c-${esc(key.replace(/[^a-z0-9-]/gi, '-'))}">${question}</p>
      <button type="button" class="btn btn-danger btn-small" data-action="adm-confirm-yes" data-key="${esc(key)}">${yes}</button>
      <button type="button" class="btn btn-small" data-action="adm-confirm-no" data-key="${esc(key)}" id="adm-cno-${esc(key.replace(/[^a-z0-9-]/gi, '-'))}">Abbrechen</button>
    </div>`;
  }

  function deleteButton(key, label, srName) {
    if (ui.confirm === key) return '';
    return `<button type="button" class="btn btn-danger btn-small" data-action="adm-confirm-open" data-key="${esc(key)}">${esc(label)}<span class="sr-only">: ${esc(srName)}</span></button>`;
  }

  function moveButtons(action, pk, name, first, last) {
    return `<button type="button" class="btn btn-small" data-action="${action}" data-pk="${pk}" data-dir="up"${first ? ' disabled' : ''} aria-label="${esc(name)} nach oben">↑</button>
      <button type="button" class="btn btn-small" data-action="${action}" data-pk="${pk}" data-dir="down"${last ? ' disabled' : ''} aria-label="${esc(name)} nach unten">↓</button>`;
  }

  const statusBadge = (s) => `<span class="tag tag-status-${esc(s)}">${esc(statusLabel(s))}</span>`;

  // ---------- Übersicht ----------

  function viewOverview() {
    const e = overview();
    if (e.status !== 'ok') return stateView(e, 'Admin-Übersicht konnte nicht geladen werden', 'overview');
    ctx.setTitle('Admin');
    const o = e.data;
    const courses = o.courses.map((c) => `<li class="adm-item">
        <div class="adm-item-main"><h3><a href="#/admin/course/${encodeURIComponent(c.id)}">${esc(c.title)}</a></h3>
        <p class="small muted">${esc(c.id)} · ${esc(ctx.languageName(c.nativeLang))} → ${esc(ctx.languageName(c.targetLang))} · ${plural(c.units, 'Einheit', 'Einheiten')} · ${plural(c.items, 'Lernobjekt', 'Lernobjekte')} · Version ${c.version} · geändert ${esc(fmtTime(c.updatedAt))}</p></div>
        <div class="adm-item-side">${statusBadge(c.status)} <a class="btn btn-small" href="#/admin/course/${encodeURIComponent(c.id)}">Bearbeiten<span class="sr-only">: ${esc(c.title)}</span></a></div>
      </li>`).join('');
    const langs = o.languages.map((l) => {
      const key = `lang:${l.code}`;
      if (ui.editing === key) {
        return `<li class="adm-item"><form data-form="adm-lang-edit" data-code="${esc(l.code)}" class="adm-inline-form" novalidate>
          <p class="small"><strong>${esc(l.code)}</strong></p>
          ${input(`adm-lang-${l.code}`, 'name', 'Name (deutsch)', { value: l.name, required: true, maxlength: 60 })}
          ${input(`adm-lang-${l.code}`, 'nativeName', 'Eigenname', { value: l.nativeName, maxlength: 60 })}
          <div class="row"><button type="submit" class="btn btn-primary btn-small">Speichern</button><button type="button" class="btn btn-small" data-action="adm-edit-cancel" data-key="${esc(key)}">Abbrechen</button></div>
        </form></li>`;
      }
      return `<li class="adm-item"><div class="adm-item-main"><strong>${esc(l.name)}</strong> <span class="muted">${esc(l.code)}${l.nativeName ? ` · ${esc(l.nativeName)}` : ''}</span></div>
        <div class="adm-item-side"><button type="button" class="btn btn-small" data-action="adm-edit" data-key="${esc(key)}">Bearbeiten<span class="sr-only">: ${esc(l.name)}</span></button>${deleteButton(`del-lang:${l.code}`, 'Löschen', l.name)}</div>
        ${ui.confirm === `del-lang:${l.code}` ? confirmInline(`del-lang:${l.code}`, `<strong>Sprache „${esc(l.name)}“ löschen?</strong> Das geht nur, wenn kein Kurs sie benutzt.`) : ''}
      </li>`;
    }).join('');
    const audit = o.audit.map((a) => `<li><span class="muted small">${esc(fmtTime(a.at))}</span> · <strong>${esc(a.by)}</strong>: <code>${esc(a.action)}</code> ${esc(a.target)}</li>`).join('');
    const nativeDefault = o.languages.some((l) => l.code === 'de') ? 'de' : o.languages[0]?.code;
    return `<h1 tabindex="-1">Admin-Bereich</h1>
      <p class="muted">Kurse, Sprachen und Inhalte verwalten. Jede Änderung erhöht die Kursversion und steht im Protokoll.</p>
      <section class="stats" aria-label="Zähler">
        <div class="card stat"><p class="stat-label">Konten</p><p class="stat-value">${o.counts.accounts}</p></div>
        <div class="card stat"><p class="stat-label">Gäste</p><p class="stat-value">${o.counts.guests}</p></div>
        <div class="card stat"><p class="stat-label">Lernversuche</p><p class="stat-value">${o.counts.attempts}</p></div>
      </section>
      <section class="card" aria-labelledby="adm-courses-h"><h2 id="adm-courses-h">Kurse</h2>
        ${notice('courses')}
        ${courses ? `<ul class="adm-list">${courses}</ul>` : '<p class="muted">Noch keine Kurse.</p>'}
      </section>
      <section class="card" aria-labelledby="adm-new-h"><h2 id="adm-new-h">Neuen Kurs anlegen</h2>
        <form data-form="adm-create-course" novalidate>
          ${notice('create-course')}
          <div class="grid-2">
            ${input('adm-cc', 'id', 'Kurs-ID', { required: true, hint: 'Klein, a–z, 0–9 und -, z. B. „de-pt“. Später nicht änderbar.', maxlength: 64, placeholder: 'de-pt' })}
            ${input('adm-cc', 'title', 'Titel', { required: true, maxlength: 80, placeholder: 'Portugiesisch' })}
          </div>
          ${input('adm-cc', 'subtitle', 'Untertitel', { maxlength: 160 })}
          <div class="grid-2">
            <div class="field"><label for="adm-cc-nativeLang">Ausgangssprache (Lernende sprechen)</label><select id="adm-cc-nativeLang" name="nativeLang">${langOptions(o.languages, nativeDefault)}</select></div>
            <div class="field"><label for="adm-cc-targetLang">Zielsprache (wird gelernt)</label><select id="adm-cc-targetLang" name="targetLang">${langOptions(o.languages, o.languages.find((l) => l.code !== nativeDefault)?.code)}</select></div>
          </div>
          <div class="grid-2">
            ${input('adm-cc', 'ttsLang', 'Sprachausgabe-Code', { hint: 'z. B. „pt-PT“; leer = Zielsprache', maxlength: 12 })}
            ${input('adm-cc', 'license', 'Lizenz', { value: 'CC0 1.0', maxlength: 200 })}
          </div>
          <label class="check"><input type="checkbox" name="demo" checked> Demo-Inhalt (für Lernende so gekennzeichnet)</label>
          <p class="muted small">Neue Kurse sind Entwürfe und erst nach dem Veröffentlichen sichtbar. Fehlt eine Sprache, lege sie unten an.</p>
          <button type="submit" class="btn btn-primary">Kurs anlegen</button>
        </form>
      </section>
      <section class="card" aria-labelledby="adm-imp-h"><h2 id="adm-imp-h">Kurs-JSON importieren</h2>
        <p class="muted small">Kursformat wie in <code>data/courses/*.json</code> bzw. wie beim Export. Der Kurs wird als <strong>Entwurf</strong> angelegt; eine vorhandene ID wird nicht überschrieben.</p>
        <label class="btn file-btn">Datei wählen …<input type="file" accept="application/json,.json" data-action="adm-import-file" class="sr-only"></label>
        ${notice('import')}
      </section>
      <section class="card" aria-labelledby="adm-lang-h"><h2 id="adm-lang-h">Sprachen</h2>
        ${notice('languages')}
        <ul class="adm-list">${langs}</ul>
        <h3>Sprache hinzufügen</h3>
        <form data-form="adm-lang-create" class="grid-3" novalidate>
          ${input('adm-lc', 'code', 'Code', { required: true, hint: 'z. B. „pt“ oder „pt-BR“', maxlength: 12 })}
          ${input('adm-lc', 'name', 'Name (deutsch)', { required: true, maxlength: 60, placeholder: 'Portugiesisch' })}
          ${input('adm-lc', 'nativeName', 'Eigenname', { maxlength: 60, placeholder: 'Português' })}
          <div class="field field-submit"><button type="submit" class="btn btn-primary">Hinzufügen</button></div>
        </form>
      </section>
      <section class="card" aria-labelledby="adm-audit-h"><h2 id="adm-audit-h">Letzte Änderungen</h2>
        ${audit ? `<ol class="audit-list">${audit}</ol>` : '<p class="muted">Noch keine Einträge.</p>'}
      </section>`;
  }

  // ---------- Kurs-Editor ----------

  function viewCourse(id) {
    const e = courseData(id);
    if (e.status !== 'ok') return stateView(e, 'Kurs konnte nicht geladen werden', `course:${id}`);
    const c = e.data;
    ctx.setTitle(`Kurs: ${c.title}`);
    const v = ui.validation.get(c.id);
    const statusButtons = COURSE_STATUS.map(([k, label]) => `<button type="button" class="btn btn-small${c.status === k ? ' btn-primary' : ''}" data-action="adm-course-status" data-value="${k}" aria-pressed="${c.status === k}">${label}</button>`).join('');
    const sections = c.sections.map((s, si) => {
      const units = s.units.map((u, ui2) => {
        const words = u.items.filter((i) => i.kind === 'w').length;
        const sentences = u.items.filter((i) => i.kind === 's').length;
        const delKey = `del-unit:${u.pk}`;
        return `<li class="adm-item">
          <div class="adm-item-main"><h4><a href="#/admin/course/${encodeURIComponent(c.id)}/unit/${u.pk}">${esc(u.title)}</a></h4>
            <p class="small muted">${esc(u.slug)} · ${plural(words, 'Wort', 'Wörter')} · ${plural(sentences, 'Satz', 'Sätze')}${words < 4 || sentences < 4 ? ' · <strong class="text-bad">mind. 4 Wörter und 4 Sätze nötig</strong>' : ''}</p></div>
          <div class="adm-item-side">${statusBadge(u.status)}
            <button type="button" class="btn btn-small" data-action="adm-unit-status" data-pk="${u.pk}" data-value="${u.status === 'published' ? 'draft' : 'published'}">${u.status === 'published' ? 'Zum Entwurf machen' : 'Veröffentlichen'}<span class="sr-only">: ${esc(u.title)}</span></button>
            <a class="btn btn-small" href="#/admin/course/${encodeURIComponent(c.id)}/unit/${u.pk}">Inhalte<span class="sr-only"> von ${esc(u.title)}</span></a>
            ${moveButtons('adm-unit-move', u.pk, u.title, ui2 === 0, ui2 === s.units.length - 1)}
            ${deleteButton(delKey, 'Löschen', u.title)}</div>
          ${ui.confirm === delKey ? confirmInline(delKey, `<strong>Einheit „${esc(u.title)}“ löschen?</strong> Alle ${plural(words + sentences, 'Lernobjekt', 'Lernobjekte')} darin und zugehörige Wiederholungen der Lernenden werden gelöscht.`) : ''}
          ${notice(`unit-${u.pk}`)}
        </li>`;
      }).join('');
      const delKey = `del-section:${s.pk}`;
      return `<section class="adm-section" aria-labelledby="adm-s-${s.pk}">
        <div class="adm-section-head">
          <h3 id="adm-s-${s.pk}">Abschnitt ${si + 1}: ${esc(s.title)} <span class="muted small">(${esc(s.slug)})</span></h3>
          <div class="row">${moveButtons('adm-section-move', s.pk, s.title, si === 0, si === c.sections.length - 1)}${deleteButton(delKey, 'Löschen', s.title)}</div>
        </div>
        ${ui.confirm === delKey ? confirmInline(delKey, `<strong>Abschnitt „${esc(s.title)}“ löschen?</strong> Alle ${plural(s.units.length, 'Einheit', 'Einheiten')} darin werden mitgelöscht.`) : ''}
        ${notice(`section-${s.pk}`)}
        <form data-form="adm-section-rename" data-pk="${s.pk}" class="adm-inline-form row-form" novalidate>
          ${input(`adm-sr-${s.pk}`, 'title', 'Titel des Abschnitts', { value: s.title, required: true, maxlength: 80 })}
          <button type="submit" class="btn btn-small">Umbenennen</button>
        </form>
        ${units ? `<ul class="adm-list">${units}</ul>` : '<p class="muted small">Noch keine Einheiten.</p>'}
        <details class="adm-add"><summary>Einheit hinzufügen</summary>
          <form data-form="adm-unit-create" data-pk="${s.pk}" novalidate>
            <div class="grid-2">${input(`adm-uc-${s.pk}`, 'slug', 'Einheiten-ID', { required: true, hint: 'Eindeutig im Kurs, a–z, 0–9, -', maxlength: 64 })}
            ${input(`adm-uc-${s.pk}`, 'title', 'Titel', { required: true, maxlength: 80 })}</div>
            ${input(`adm-uc-${s.pk}`, 'description', 'Beschreibung', { maxlength: 200 })}
            <p class="muted small">Neue Einheiten sind Entwürfe. Veröffentliche sie, wenn sie mindestens 4 Wörter und 4 Sätze haben.</p>
            <button type="submit" class="btn btn-primary btn-small">Einheit anlegen</button>
          </form>
        </details>
      </section>`;
    }).join('');
    const vHtml = v ? `<div class="notice ${v.ok ? 'notice-ok' : 'notice-error'}" id="adm-validation" tabindex="-1">
        <p><strong>${v.ok ? 'Prüfung bestanden' : 'Prüfung: Fehler gefunden'}</strong>${v.ok ? ' – der veröffentlichte Teil ist gültig.' : ''}</p>
        ${v.errors.length ? `<p>Fehler:</p><ul class="error-list">${v.errors.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
        ${v.warnings.length ? `<p>Hinweise:</p><ul>${v.warnings.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      </div>` : '';
    const delKey = `del-course:${c.id}`;
    return `<p class="crumbs"><a href="#/admin">Admin</a> <span aria-hidden="true">›</span> ${esc(c.title)}</p>
      <h1 tabindex="-1">Kurs bearbeiten: ${esc(c.title)}</h1>
      <p class="muted">${esc(c.id)} · ${esc(ctx.languageName(c.nativeLang))} → ${esc(ctx.languageName(c.targetLang))} · Version ${c.version} · ${statusBadge(c.status)}</p>
      ${notice('course-top')}
      <section class="card" aria-labelledby="adm-status-h"><h2 id="adm-status-h">Status</h2>
        <div class="row" role="group" aria-label="Kursstatus">${statusButtons}</div>
        <p class="muted small">Veröffentlicht = für Lernende sichtbar (nur veröffentlichte Einheiten). Archiviert = ausgeblendet, Fortschritt bleibt.</p>
        ${notice('status')}
      </section>
      <section class="card" aria-labelledby="adm-tools-h"><h2 id="adm-tools-h">Prüfen &amp; Daten</h2>
        <div class="row">
          <button type="button" class="btn" data-action="adm-validate">Kurs prüfen</button>
          <button type="button" class="btn" data-action="adm-export">Kurs exportieren (JSON)</button>
          ${deleteButton(delKey, 'Kurs löschen …', c.title)}
        </div>
        ${ui.confirm === delKey ? confirmInline(delKey, `<strong>Kurs „${esc(c.title)}“ endgültig löschen?</strong> Alle Abschnitte, Einheiten und Lernobjekte werden gelöscht. Tipp: vorher exportieren.`, 'Ja, Kurs löschen') : ''}
        ${notice('tools')}
        ${vHtml}
      </section>
      <section class="card" aria-labelledby="adm-meta-h"><h2 id="adm-meta-h">Metadaten</h2>
        <form data-form="adm-course-meta" novalidate>
          <div class="grid-2">${input('adm-cm', 'title', 'Titel', { value: c.title, required: true, maxlength: 80 })}
          ${input('adm-cm', 'subtitle', 'Untertitel', { value: c.subtitle ?? '', maxlength: 160 })}</div>
          <div class="grid-2">${input('adm-cm', 'ttsLang', 'Sprachausgabe-Code', { value: c.ttsLang ?? '', hint: 'z. B. „en-GB“; leer = Zielsprache', maxlength: 12 })}
          ${input('adm-cm', 'license', 'Lizenz', { value: c.license ?? '', maxlength: 200 })}</div>
          ${textarea('adm-cm', 'provenance', 'Herkunft der Inhalte', { value: c.provenance ?? '', rows: 2 })}
          <label class="check"><input type="checkbox" name="demo"${c.demo ? ' checked' : ''}> Demo-Inhalt</label>
          <p class="muted small">Ausgangs- und Zielsprache lassen sich nach dem Anlegen nicht mehr ändern.</p>
          <button type="submit" class="btn btn-primary">Metadaten speichern</button>
          ${notice('meta')}
        </form>
      </section>
      <section class="card" aria-labelledby="adm-struct-h"><h2 id="adm-struct-h">Abschnitte &amp; Einheiten</h2>
        ${sections || '<p class="muted">Noch keine Abschnitte.</p>'}
        <details class="adm-add"${c.sections.length ? '' : ' open'}><summary>Abschnitt hinzufügen</summary>
          <form data-form="adm-section-create" novalidate>
            <div class="grid-2">${input('adm-sc', 'slug', 'Abschnitts-ID', { required: true, hint: 'z. B. „a1“', maxlength: 64 })}
            ${input('adm-sc', 'title', 'Titel', { required: true, maxlength: 80, placeholder: 'A1 – Einstieg' })}</div>
            <button type="submit" class="btn btn-primary btn-small">Abschnitt anlegen</button>
          </form>
        </details>
        ${notice('structure')}
      </section>`;
  }

  // ---------- Einheit: Lernobjekte und Vorschau ----------

  function itemForm(formName, c, { kind, item = null, unitPk }) {
    const pre = item ? `adm-it-${item.pk}` : `adm-new-${kind}`;
    const isS = kind === 's';
    return `<form data-form="${formName}" data-kind="${kind}"${item ? ` data-pk="${item.pk}"` : ` data-unit="${unitPk}"`} class="adm-item-form" novalidate>
      <div class="grid-2">
        ${textarea(pre, 'native', `Muttersprache (${ctx.languageName(c.nativeLang)})`, { value: listToLines(item?.native), required: true, rows: isS ? 2 : 2, lang: c.nativeLang, hint: 'Eine Variante pro Zeile.' })}
        ${textarea(pre, 'target', `Zielsprache (${ctx.languageName(c.targetLang)})`, { value: listToLines(item?.target), required: true, rows: isS ? 3 : 2, lang: c.targetLang, hint: 'Eine Variante pro Zeile – die erste ist die Musterlösung, weitere gelten auch als richtig.' })}
      </div>
      ${textarea(pre, 'note', 'Erklärung', { value: item?.note ?? '', required: isS, rows: 2, hint: isS ? 'Pflicht bei Sätzen: kurze Erklärung, erscheint im Feedback.' : 'Optional: erscheint im Feedback.' })}
      ${extraFields(pre, c, isS, item)}
      <div class="row"><button type="submit" class="btn btn-primary btn-small">${item ? 'Speichern' : isS ? 'Satz hinzufügen' : 'Wort hinzufügen'}</button>
      ${item ? `<button type="button" class="btn btn-small" data-action="adm-edit-cancel" data-key="item:${item.pk}">Abbrechen</button>` : ''}</div>
    </form>`;
  }

  /** Aussprache und Wortbausteine – nur bei Chinesisch oder wenn das Lernobjekt sie schon hat. Bei Wörtern ein Beispielsatz. */
  function extraFields(pre, c, isS, item) {
    const zh = String(c.targetLang).startsWith('zh');
    const ex = item?.examples?.[0];
    const example = isS ? '' : `<div class="grid-2">
      ${input(pre, 'exTarget', `Beispielsatz (${ctx.languageName(c.targetLang)})`, { value: ex?.target ?? '', maxlength: 300, lang: c.targetLang, hint: 'Zeigt, wann man das Wort benutzt. Erscheint, wenn das Wort neu ist.' })}
      ${input(pre, 'exNative', `Beispielsatz (${ctx.languageName(c.nativeLang)})`, { value: ex?.native ?? '', maxlength: 300, lang: c.nativeLang, hint: 'Übersetzung des Beispielsatzes.' })}
    </div>`;
    const reading = zh || item?.reading
      ? input(pre, 'reading', 'Aussprache', { value: item?.reading ?? '', maxlength: 300, hint: 'Zur Musterlösung, z. B. Pinyin mit Tonzeichen: „nǐ hǎo“.' })
      : '';
    const tokens = isS && (zh || item?.tokens)
      ? input(pre, 'tokens', 'Wortbausteine', { value: (item?.tokens ?? []).join(' '), maxlength: 2000, lang: c.targetLang, hint: 'Für Sprachen ohne Leerzeichen: Musterlösung in Wörter zerlegt, durch Leerzeichen getrennt, ohne Satzzeichen.' })
      : '';
    return (reading || tokens ? `<div class="grid-2">${reading}${tokens}</div>` : '') + example;
  }

  /**
   * Zusatzfelder für den Server (nur gesendet, wenn das Formular sie enthält; leer = entfernen).
   * Das Formular bearbeitet nur das erste Beispiel; weitere aus dem Kurs (item) bleiben dahinter erhalten.
   */
  function extraBody(v, item = null) {
    const out = {};
    if (typeof v.reading === 'string') out.reading = v.reading.trim();
    if (typeof v.tokens === 'string') out.tokens = v.tokens.trim() ? v.tokens.trim().split(/\s+/) : [];
    if (typeof v.exTarget === 'string') {
      const target = v.exTarget.trim();
      const native = (v.exNative ?? '').trim();
      const rest = (item?.examples ?? []).slice(1);
      out.examples = target || native ? [{ target, native, ...(item?.examples?.[0]?.target === target && item.examples[0].reading ? { reading: item.examples[0].reading } : {}) }, ...rest] : rest;
    }
    return out;
  }

  /** Lernobjekt eines geladenen Admin-Kurses über seinen Primärschlüssel. */
  function findItem(pk) {
    for (const [key, e] of data) {
      if (!key.startsWith('course:') || !e.data) continue;
      for (const sec of e.data.sections) for (const u of sec.units) for (const it of u.items) if (String(it.pk) === String(pk)) return it;
    }
    return null;
  }

  function itemList(c, u, kind) {
    const items = u.items.filter((i) => i.kind === kind);
    const label = kind === 'w' ? 'Wort' : 'Satz';
    return items.map((it, idx) => {
      const key = `item:${it.pk}`;
      const delKey = `del-item:${it.pk}`;
      const name = `${label} ${idx + 1} (${it.native[0]})`;
      if (ui.editing === key) {
        return `<li class="adm-item is-editing"><p class="small"><strong>${label} ${idx + 1} bearbeiten</strong></p>${itemForm('adm-item-edit', c, { kind, item: it })}${notice(`item-${it.pk}`)}</li>`;
      }
      return `<li class="adm-item">
        <div class="adm-item-main">
          <p class="adm-pair"><span class="adm-num" aria-hidden="true">${idx + 1}</span><span lang="${esc(c.nativeLang)}">${esc(it.native.join(' / '))}</span> <span aria-hidden="true">→</span><span class="sr-only">auf ${esc(ctx.languageName(c.targetLang))}:</span> <strong lang="${esc(c.targetLang)}">${esc(it.target[0])}</strong>${it.reading ? ` <span class="muted small">(${esc(it.reading)})</span>` : ''}${it.target.length > 1 ? ` <span class="muted small">auch: <span lang="${esc(c.targetLang)}">${esc(it.target.slice(1).join(' / '))}</span></span>` : ''}</p>
          ${it.note ? `<p class="small muted">${esc(it.note)}</p>` : ''}
        </div>
        <div class="adm-item-side">
          <button type="button" class="btn btn-small" data-action="adm-edit" data-key="${esc(key)}">Bearbeiten<span class="sr-only">: ${esc(name)}</span></button>
          ${moveButtons('adm-item-move', it.pk, name, idx === 0, idx === items.length - 1)}
          ${deleteButton(delKey, 'Löschen', name)}
        </div>
        ${ui.confirm === delKey ? confirmInline(delKey, `<strong>${esc(name)} löschen?</strong> Zugehörige Wiederholungen der Lernenden werden entfernt.`) : ''}
        ${notice(`item-${it.pk}`)}
      </li>`;
    }).join('');
  }

  function viewPreview(u) {
    const p = ui.previews.get(u.pk);
    if (!p) return '<p class="muted small">Zeigt alle Übungen, die aus dieser Einheit erzeugt werden (mit Hören und Sprechen).</p>';
    if (p.status === 'loading') return '<p role="status">Vorschau wird erzeugt …</p>';
    if (p.status === 'error') return `<p class="notice notice-error" role="alert">${esc(p.error.message)}</p>`;
    if (!p.lessons.length) return '<p class="muted">Keine Lektionen – die Einheit braucht Wörter.</p>';
    return p.lessons.map((l) => `<div class="preview-lesson"><h3>Lektion ${l.index + 1}</h3>
      ${l.error ? `<p class="notice notice-error">${esc(l.error)}</p>` : `<ol class="preview-list">${l.exercises.map((ex) => {
        const s = exerciseSummary(ex);
        return `<li><span class="tag">${esc(s.type)}</span> <span lang="${esc(ex.questionLang)}">${esc(s.question)}</span><br><span class="muted small">Lösung:</span> <span lang="${esc(ex.answerLang)}">${esc(s.solution)}</span></li>`;
      }).join('')}</ol>`}</div>`).join('');
  }

  function viewUnit(id, pk) {
    const e = courseData(id);
    if (e.status !== 'ok') return stateView(e, 'Kurs konnte nicht geladen werden', `course:${id}`);
    const c = e.data;
    const section = c.sections.find((s) => s.units.some((u) => String(u.pk) === String(pk)));
    const u = section?.units.find((x) => String(x.pk) === String(pk));
    if (!u) {
      ctx.setTitle('Einheit nicht gefunden');
      return `<section class="card state-card"><h1 tabindex="-1">Einheit nicht gefunden</h1><p><a class="btn" href="#/admin/course/${encodeURIComponent(c.id)}">Zum Kurs</a></p></section>`;
    }
    ctx.setTitle(`Einheit: ${u.title}`);
    const words = u.items.filter((i) => i.kind === 'w').length;
    const sentences = u.items.filter((i) => i.kind === 's').length;
    return `<p class="crumbs"><a href="#/admin">Admin</a> <span aria-hidden="true">›</span> <a href="#/admin/course/${encodeURIComponent(c.id)}">${esc(c.title)}</a> <span aria-hidden="true">›</span> ${esc(u.title)}</p>
      <h1 tabindex="-1">Einheit: ${esc(u.title)}</h1>
      <p class="muted">${esc(u.slug)} · Abschnitt „${esc(section.title)}“ · ${statusBadge(u.status)} · ${plural(words, 'Wort', 'Wörter')}, ${plural(sentences, 'Satz', 'Sätze')} (mind. 4 + 4; je 4 Wörter ergeben eine Lektion)</p>
      <section class="card" aria-labelledby="adm-um-h"><h2 id="adm-um-h">Einheit</h2>
        <form data-form="adm-unit-meta" data-pk="${u.pk}" novalidate>
          <div class="grid-2">${input('adm-um', 'title', 'Titel', { value: u.title, required: true, maxlength: 80 })}
          <div class="field"><label for="adm-um-status">Status</label><select id="adm-um-status" name="status">${UNIT_STATUS.map(([k, l]) => `<option value="${k}"${u.status === k ? ' selected' : ''}>${l}</option>`).join('')}</select></div></div>
          ${input('adm-um', 'description', 'Beschreibung', { value: u.description ?? '', maxlength: 200 })}
          ${textarea('adm-um', 'intro', 'Regeltext', { value: u.intro ?? '', rows: 4, hint: 'Erklärt eine Regel oder Ausnahme (max. 2000 Zeichen). Erscheint als Regelkarte vor der ersten Lektion der Einheit. Leerzeile = neuer Absatz.' })}
          <button type="submit" class="btn btn-primary">Speichern</button>
          ${notice('unit-meta')}
        </form>
      </section>
      <section class="card" aria-labelledby="adm-w-h"><h2 id="adm-w-h">Wörter (${words})</h2>
        ${notice('items-w')}
        ${words ? `<ol class="adm-list" aria-labelledby="adm-w-h">${itemList(c, u, 'w')}</ol>` : '<p class="muted">Noch keine Wörter.</p>'}
        <details class="adm-add"${!words || ui.addOpen.has(`${u.pk}:w`) ? ' open' : ''}><summary>Wort hinzufügen</summary>${itemForm('adm-item-create', c, { kind: 'w', unitPk: u.pk })}</details>
      </section>
      <section class="card" aria-labelledby="adm-s-h"><h2 id="adm-s-h">Sätze (${sentences})</h2>
        ${notice('items-s')}
        ${sentences ? `<ol class="adm-list" aria-labelledby="adm-s-h">${itemList(c, u, 's')}</ol>` : '<p class="muted">Noch keine Sätze.</p>'}
        <details class="adm-add"${!sentences || ui.addOpen.has(`${u.pk}:s`) ? ' open' : ''}><summary>Satz hinzufügen</summary>${itemForm('adm-item-create', c, { kind: 's', unitPk: u.pk })}</details>
      </section>
      <section class="card" aria-labelledby="adm-pv-h"><h2 id="adm-pv-h">Vorschau der Lektionen</h2>
        <p><button type="button" class="btn" data-action="adm-preview" data-pk="${u.pk}">${ui.previews.get(u.pk) ? 'Vorschau aktualisieren' : 'Vorschau erzeugen'}</button></p>
        <div id="adm-preview-out" tabindex="-1">${viewPreview(u)}</div>
      </section>`;
  }

  // ---------- Ansicht ----------

  function view(args = []) {
    const [kind, id, sub, pk] = args;
    if (!kind) return viewOverview();
    if (kind === 'course' && id && !sub) return viewCourse(id);
    if (kind === 'course' && id && sub === 'unit' && pk) return viewUnit(id, pk);
    ctx.setTitle('Nicht gefunden');
    return '<section class="card state-card"><h1 tabindex="-1">Admin-Seite nicht gefunden</h1><p><a class="btn" href="#/admin">Zur Admin-Übersicht</a></p></section>';
  }

  function routeArgs() {
    const parts = location.hash.replace(/^#\/?/, '').split('/').map((p) => {
      try {
        return decodeURIComponent(p);
      } catch {
        return '';
      }
    });
    return parts.slice(1);
  }

  const currentCourseId = () => routeArgs()[1];

  // ---------- Aktionen ----------

  async function runConfirmed(key) {
    const [what, ref] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
    ui.confirm = null;
    const cid = currentCourseId();
    if (what === 'del-lang') {
      const ok = await mutate('languages', () => api.adminDeleteLanguage(ref), `Sprache „${ref}“ gelöscht.`, { focusOk: true });
      if (ok) data.delete('overview');
      render();
    } else if (what === 'del-course') {
      const ok = await mutate('tools', () => api.adminDeleteCourse(ref), null);
      if (ok) {
        data.delete(`course:${ref}`);
        data.delete('overview');
        ctx.invalidatePublic(ref);
        ui.pendingNotice = { scope: 'courses', kind: 'ok', text: `Kurs „${ref}“ wurde gelöscht.` };
        go('#/admin');
      }
    } else if (what === 'del-section') {
      await mutate('structure', () => api.adminDeleteSection(ref), 'Abschnitt gelöscht.', { focusOk: true });
    } else if (what === 'del-unit') {
      await mutate('structure', () => api.adminDeleteUnit(ref), 'Einheit gelöscht.', { focusOk: true });
    } else if (what === 'del-item') {
      const course = data.get(`course:${cid}`)?.data;
      const kind = course?.sections.flatMap((s) => s.units).flatMap((u) => u.items).find((i) => String(i.pk) === ref)?.kind ?? 'w';
      await mutate(`items-${kind}`, () => api.adminDeleteItem(ref), `${kind === 's' ? 'Satz' : 'Wort'} gelöscht.`, { focusOk: true });
    }
  }

  function handleClick(el) {
    const action = el.dataset.action;
    if (!action?.startsWith('adm-')) return false;
    const cid = currentCourseId();
    switch (action) {
      case 'adm-retry':
        data.delete(el.dataset.key);
        render();
        break;
      case 'adm-confirm-open':
        ui.confirm = el.dataset.key;
        ui.notice = null;
        focus(`#adm-cno-${CSS.escape(el.dataset.key.replace(/[^a-z0-9-]/gi, '-'))}`);
        render();
        break;
      case 'adm-confirm-no':
        ui.confirm = null;
        focus(`[data-action="adm-confirm-open"][data-key="${CSS.escape(el.dataset.key)}"]`);
        render();
        break;
      case 'adm-confirm-yes': runConfirmed(el.dataset.key); break;
      case 'adm-edit':
        ui.editing = el.dataset.key;
        ui.notice = null;
        focus(el.dataset.key.startsWith('item:') ? `#adm-it-${CSS.escape(el.dataset.key.slice(5))}-native` : `#adm-lang-${CSS.escape(el.dataset.key.slice(5))}-name`);
        render();
        break;
      case 'adm-edit-cancel':
        ui.editing = null;
        focus(`[data-action="adm-edit"][data-key="${CSS.escape(el.dataset.key)}"]`);
        render();
        break;
      case 'adm-course-status': {
        const status = el.dataset.value;
        mutate('status', () => api.adminUpdateCourse(cid, { status }), `Status: ${statusLabel(status)}.`);
        break;
      }
      case 'adm-validate':
        mutate('tools', async () => {
          const v = await api.adminValidateCourse(cid);
          ui.validation.set(cid, { ok: v.ok, errors: v.errors ?? [], warnings: v.warnings ?? [] });
          focus('#adm-validation');
          announce(v.ok ? 'Prüfung bestanden.' : `Prüfung: ${plural(v.errors.length, 'Fehler', 'Fehler')} gefunden.`);
          return null;
        }, null);
        break;
      case 'adm-export':
        mutate('tools', async () => {
          const { data: course, filename } = await api.adminExportCourse(cid);
          ctx.downloadJson(filename ?? `${cid}.json`, course);
          return null;
        }, 'Export wurde heruntergeladen.');
        break;
      case 'adm-section-move':
        mutate('structure', () => api.adminUpdateSection(el.dataset.pk, { direction: el.dataset.dir }), 'Abschnitt verschoben.');
        break;
      case 'adm-unit-move':
        mutate('structure', () => api.adminUpdateUnit(el.dataset.pk, { direction: el.dataset.dir }), 'Einheit verschoben.');
        break;
      case 'adm-unit-status':
        mutate(`unit-${el.dataset.pk}`, () => api.adminUpdateUnit(el.dataset.pk, { status: el.dataset.value }), el.dataset.value === 'published' ? 'Einheit veröffentlicht.' : 'Einheit ist jetzt ein Entwurf.');
        break;
      case 'adm-item-move': {
        const course = data.get(`course:${cid}`)?.data;
        const kind = course?.sections.flatMap((s) => s.units).flatMap((u) => u.items).find((i) => String(i.pk) === el.dataset.pk)?.kind ?? 'w';
        mutate(`items-${kind}`, () => api.adminMoveItem(el.dataset.pk, el.dataset.dir), 'Verschoben.');
        break;
      }
      case 'adm-preview': {
        const pk = Number(el.dataset.pk);
        ui.previews.set(pk, { status: 'loading', lessons: [], error: null });
        render();
        api.adminPreviewUnit(pk).then(
          (d) => ui.previews.set(pk, { status: 'ok', lessons: d.lessons, error: null }),
          (err) => {
            if (err?.status === 401) ctx.onUnauthorized();
            ui.previews.set(pk, { status: 'error', lessons: [], error: err });
          },
        ).finally(() => {
          focus('#adm-preview-out');
          announce('Vorschau erzeugt.');
          render();
        });
        break;
      }
      default:
        return false;
    }
    return true;
  }

  async function importFile(inputEl) {
    const file = inputEl.files?.[0];
    inputEl.value = '';
    if (!file) return;
    let course;
    try {
      const parsed = ctx.parseJsonText(await ctx.readFileText(file));
      course = parsed.course && typeof parsed.course === 'object' ? parsed.course : parsed;
    } catch (err) {
      setNotice('import', 'error', err.message);
      render();
      return;
    }
    const res = await mutate('import', () => api.adminImportCourse(course), null);
    if (res?.course) {
      ui.pendingNotice = { scope: 'course-top', kind: 'ok', text: `Kurs „${res.course.title}“ wurde als Entwurf importiert. Prüfe ihn und veröffentliche ihn, wenn alles passt.` };
      go(`#/admin/course/${encodeURIComponent(res.course.id)}`);
    }
  }

  function handleChange(el) {
    if (el.dataset.action === 'adm-import-file') {
      importFile(el);
      return true;
    }
    return false;
  }

  const vals = (form) => {
    const out = {};
    for (const [k, v] of new FormData(form).entries()) out[k] = typeof v === 'string' ? v : '';
    return out;
  };

  function handleSubmit(form) {
    const name = form.dataset.form;
    if (!name?.startsWith('adm-')) return false;
    const v = vals(form);
    const cid = currentCourseId();
    switch (name) {
      case 'adm-create-course': {
        const body = {
          id: v.id.trim(), title: v.title.trim(), subtitle: v.subtitle.trim(), nativeLang: v.nativeLang, targetLang: v.targetLang,
          ttsLang: v.ttsLang.trim() || null, license: v.license.trim(), demo: v.demo === 'on',
        };
        mutate('create-course', () => api.adminCreateCourse(body), null).then((res) => {
          if (res?.course) {
            ui.pendingNotice = { scope: 'course-top', kind: 'ok', text: `Kurs „${res.course.title}“ angelegt (Entwurf). Lege jetzt Abschnitte und Einheiten an.` };
            go(`#/admin/course/${encodeURIComponent(res.course.id)}`);
          }
        });
        break;
      }
      case 'adm-lang-create':
        mutate('languages', () => api.adminCreateLanguage({ code: v.code.trim(), name: v.name.trim(), nativeName: v.nativeName.trim() }), `Sprache „${v.name.trim()}“ angelegt.`)
          .then((res) => {
            if (res) {
              data.delete('overview');
              ctx.invalidatePublic(null);
              render();
            }
          });
        break;
      case 'adm-lang-edit': {
        const code = form.dataset.code;
        mutate('languages', () => api.adminUpdateLanguage(code, { name: v.name.trim(), nativeName: v.nativeName.trim() }), 'Sprache gespeichert.').then((res) => {
          if (res) {
            ui.editing = null;
            data.delete('overview');
            ctx.invalidatePublic(null);
            focus(`[data-action="adm-edit"][data-key="lang:${CSS.escape(code)}"]`);
            render();
          }
        });
        break;
      }
      case 'adm-course-meta':
        mutate('meta', () => api.adminUpdateCourse(cid, {
          title: v.title.trim(), subtitle: v.subtitle.trim(), ttsLang: v.ttsLang.trim() || null, license: v.license.trim(), provenance: v.provenance.trim(), demo: v.demo === 'on',
        }), 'Metadaten gespeichert.');
        break;
      case 'adm-section-create':
        mutate('structure', () => api.adminCreateSection(cid, { slug: v.slug.trim(), title: v.title.trim() }), `Abschnitt „${v.title.trim()}“ angelegt.`, { focusOk: true });
        break;
      case 'adm-section-rename':
        mutate(`section-${form.dataset.pk}`, () => api.adminUpdateSection(form.dataset.pk, { title: v.title.trim() }), 'Abschnitt umbenannt.');
        break;
      case 'adm-unit-create':
        mutate('structure', () => api.adminCreateUnit(form.dataset.pk, { slug: v.slug.trim(), title: v.title.trim(), description: v.description.trim() }), `Einheit „${v.title.trim()}“ angelegt (Entwurf).`, { focusOk: true });
        break;
      case 'adm-unit-meta':
        mutate('unit-meta', () => api.adminUpdateUnit(form.dataset.pk, { title: v.title.trim(), description: v.description.trim(), intro: v.intro.trim(), status: v.status }), 'Einheit gespeichert.');
        break;
      case 'adm-item-create': {
        const kind = form.dataset.kind;
        const body = { kind, native: linesToList(v.native), target: linesToList(v.target), note: v.note.trim(), ...extraBody(v) };
        ui.addOpen.add(`${form.dataset.unit}:${kind}`);
        mutate(`items-${kind}`, () => api.adminCreateItem(form.dataset.unit, body), kind === 's' ? 'Satz hinzugefügt.' : 'Wort hinzugefügt.').then((res) => {
          if (res) {
            focus(`#adm-new-${kind}-native`);
            render();
          }
        });
        break;
      }
      case 'adm-item-edit': {
        const pk = form.dataset.pk;
        const body = { native: linesToList(v.native), target: linesToList(v.target), note: v.note.trim(), ...extraBody(v, findItem(pk)) };
        mutate(`item-${pk}`, () => api.adminUpdateItem(pk, body), 'Gespeichert.').then((res) => {
          if (res) {
            ui.editing = null;
            focus(`[data-action="adm-edit"][data-key="item:${CSS.escape(pk)}"]`);
            render();
          }
        });
        break;
      }
      default:
        return false;
    }
    return true;
  }

  function onRouteChange() {
    ui.confirm = null;
    ui.editing = null;
    ui.notice = ui.pendingNotice;
    ui.pendingNotice = null;
    if (!location.hash.startsWith('#/admin/course/')) data.delete('overview');
  }

  return { view, handleClick, handleChange, handleSubmit, onRouteChange };
}
