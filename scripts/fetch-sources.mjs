// Lädt die offenen Quellen für die Datenkurse nach .cache/sources/ (nicht im Repo, siehe .gitignore).
// Danach bauen scripts/build-course-zh.mjs und scripts/build-course-es.mjs die Kurse neu.
// Aufruf: node scripts/fetch-sources.mjs [zh|es] [--neu]   (--neu: vorhandene Dateien erneut laden)
// Die Quellen ändern sich laufend (Tatoeba wöchentlich); die Kurse im Repo wurden mit dem Stand vom 20.10.2026 gebaut.
// Insgesamt etwa 1,2 GB, davon 1 GB für das englische Wiktionary (Spanisch).
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../.cache/sources/', import.meta.url));
const TAT = 'https://downloads.tatoeba.org/exports/per_language/';
const SOURCES = {
  zh: {
    'hsk30/wordlist.txt': 'https://raw.githubusercontent.com/elkmovie/hsk30/main/wordlist.txt',
    'hsk30/LICENSE': 'https://raw.githubusercontent.com/elkmovie/hsk30/main/LICENSE',
    'hsk/complete.json': 'https://raw.githubusercontent.com/drkameleon/complete-hsk-vocabulary/main/complete.json',
    'hsk/LICENSE': 'https://raw.githubusercontent.com/drkameleon/complete-hsk-vocabulary/main/LICENSE',
    'handedict/handedict.u8.gz': 'https://handedict.zydeo.net/api/export/download',
    'dewiktionary/kaikki.org-dictionary-Chinesisch.jsonl': 'https://kaikki.org/dewiktionary/Chinesisch/kaikki.org-dictionary-Chinesisch.jsonl',
    'tatoeba/cmn_sentences.tsv.bz2': `${TAT}cmn/cmn_sentences.tsv.bz2`,
    'tatoeba/cmn_transcriptions.tsv.bz2': `${TAT}cmn/cmn_transcriptions.tsv.bz2`,
    'tatoeba/cmn_tags.tsv.bz2': `${TAT}cmn/cmn_tags.tsv.bz2`,
    'tatoeba/cmn-deu_links.tsv.bz2': `${TAT}cmn/cmn-deu_links.tsv.bz2`,
    'tatoeba/deu_sentences.tsv.bz2': `${TAT}deu/deu_sentences.tsv.bz2`,
  },
  es: {
    'frequencywords/es_50k.txt': 'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/es/es_50k.txt',
    'wikdict/es-de.sqlite3': 'https://download.wikdict.com/dictionaries/sqlite/2/es-de.sqlite3',
    'wikdict/de-es.sqlite3': 'https://download.wikdict.com/dictionaries/sqlite/2/de-es.sqlite3',
    'kaikki-de/kaikki.org-dictionary-Spanisch.jsonl': 'https://kaikki.org/dewiktionary/Spanisch/kaikki.org-dictionary-Spanisch.jsonl',
    'kaikki-en/kaikki.org-dictionary-Spanish.jsonl': 'https://kaikki.org/dictionary/Spanish/kaikki.org-dictionary-Spanish.jsonl',
    'tatoeba/spa_sentences_detailed.tsv.bz2': `${TAT}spa/spa_sentences_detailed.tsv.bz2`,
    'tatoeba/deu_sentences_detailed.tsv.bz2': `${TAT}deu/deu_sentences_detailed.tsv.bz2`,
    'tatoeba/spa-deu_links.tsv.bz2': `${TAT}spa/spa-deu_links.tsv.bz2`,
    'tatoeba/spa_tags.tsv.bz2': `${TAT}spa/spa_tags.tsv.bz2`,
    'tatoeba/deu_tags.tsv.bz2': `${TAT}deu/deu_tags.tsv.bz2`,
    'tatoeba/user_languages.tar.bz2': 'https://downloads.tatoeba.org/exports/user_languages.tar.bz2',
  },
};

const args = process.argv.slice(2);
const fresh = args.includes('--neu');
const langs = args.filter((a) => SOURCES[a]);
const mb = (n) => `${(n / 1e6).toFixed(1)} MB`;

for (const lang of langs.length ? langs : Object.keys(SOURCES)) {
  for (const [file, url] of Object.entries(SOURCES[lang])) {
    const target = join(ROOT, lang, file);
    if (!fresh && existsSync(target)) {
      console.log(`= ${lang}/${file} (vorhanden, ${mb(statSync(target).size)})`);
      continue;
    }
    mkdirSync(dirname(target), { recursive: true });
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok || !res.body) throw new Error(`${url}: HTTP ${res.status}`);
    // Erst in eine Zwischendatei, damit ein abgebrochener Download keine halbe Datei hinterlässt.
    await pipeline(Readable.fromWeb(res.body), createWriteStream(`${target}.part`));
    renameSync(`${target}.part`, target);
    console.log(`↓ ${lang}/${file} (${mb(statSync(target).size)})`);
  }
}
console.log('Fertig. Kurse bauen: node scripts/build-course-zh.mjs bzw. node scripts/build-course-es.mjs');
