// The built-in word library lives in words.js (not in index.html), so the page stays small and the
// library is cached once by the service worker. words.js is one statement — `self.ENGLISH_DATA={…};` —
// whose object is plain JSON: one word per line, then one line of example sentences per word.
//
//   node tools/data.mjs check     validate the library (ids, duplicates, Hebrew, pronunciation, examples)
//   node tools/data.mjs stamp     put words.js's content hash into index.html and sw.js (run after every
//                                 change to words.js — the page asks for words.js?v=<hash>, so a phone
//                                 never mixes a new page with an old cached library)
//   node tools/data.mjs stats     counts per category and level
//
// Word ids never change: his progress is stored by id. The first 820 words keep the ids they always had
// ("b0"…"b819", their old position in the list); words added later have ids "n0001"… in the order added.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_FILE = join(ROOT, 'words.js');
const PREFIX = 'self.ENGLISH_DATA=';

export const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'];
export const TYPES = ['word', 'phrase', 'pattern'];
const HEB = /[א-ת]/;
const MARK = /[ְ-ׇּׁׂ]/;
const PH_OK = /^[א-תְ-ׇּׁׂ׳ \-]+$/;

// The same key the app uses to find a word's examples (examplesFor): exact English, or without a trailing "..." / " if...".
export const exampleKey = en => String(en);
// Duplicate check: case, spaces, "to ", "...", punctuation and British/American spelling don't make a new word.
export const norm = s => String(s || '').toLowerCase().replace(/[’‘`]/g, "'").replace(/\.\.\.|…/g, ' ').replace(/[?!.,;:"()]/g, ' ')
  .replace(/^\s*to\s+/, '').replace(/\s+/g, ' ').trim()
  .replace(/isation\b/g, 'ization').replace(/ise\b/g, 'ize').replace(/yse\b/g, 'yze').replace(/([a-z]{2,})our\b/g, '$1or');   // colour→color, but not four→for

export function parseData(text) {
  const t = String(text);
  const i = t.indexOf(PREFIX);
  if (i < 0) throw new Error('words.js: no "self.ENGLISH_DATA=" statement');
  const body = t.slice(i + PREFIX.length).trim().replace(/;\s*$/, '');
  const data = JSON.parse(body);
  if (!data || !Array.isArray(data.words) || !data.examples || typeof data.examples !== 'object') throw new Error('words.js: expected {words:[…], examples:{…}}');
  return data;
}
export const readData = (file = DATA_FILE) => parseData(readFileSync(file, 'utf8'));

const WORD_KEYS = ['id', 'en', 'he', 'ph', 'cat', 'lv', 'type', 'emoji', 'forms', 'ex', 'prio'];
export function formatData({ words, examples }) {
  const line = w => JSON.stringify(Object.fromEntries(WORD_KEYS.filter(k => w[k] !== undefined && w[k] !== '').map(k => [k, w[k]])));
  const exLines = Object.keys(examples).map(k => JSON.stringify(k) + ':' + JSON.stringify(examples[k].map(e => ({ s: e.s, he: e.he, l: e.l }))));
  return '// English Flashcards — the built-in word library (see tools/data.mjs). After editing: node tools/data.mjs check && node tools/data.mjs stamp\n'
    + PREFIX + '{"words":[\n' + words.map(line).join(',\n') + '\n],\n"examples":{\n' + exLines.join(',\n') + '\n}};\n';
}
export const writeData = (data, file = DATA_FILE) => writeFileSync(file, formatData(data));

function danglingMark(ph) {
  for (let i = 0; i < ph.length; i++) {
    if (MARK.test(ph[i]) || ph[i] === '׳') {
      const p = ph[i - 1] || '';
      if (!HEB.test(p) && !MARK.test(p)) return i;
    }
  }
  return -1;
}

// The categories the app knows (its CATS list in index.html).
export function appCategories(html = readFileSync(join(ROOT, 'index.html'), 'utf8')) {
  const m = /const CATS = \[([\s\S]*?)\n\];/.exec(html);
  if (!m) throw new Error('index.html: no CATS list');
  return [...m[1].matchAll(/\{id:'([a-z]+)'/g)].map(x => x[1]).filter(id => id !== 'all');
}

// Every problem in the library, as text. Empty = fine.
export function check(data, { cats = appCategories() } = {}) {
  const errs = [];
  const ids = new Set(), ens = new Map();
  const ex = data.examples;
  data.words.forEach((w, i) => {
    const at = `#${i} ${w && w.id} "${w && w.en}"`;
    const E = m => errs.push(`${at}: ${m}`);
    if (!w || typeof w !== 'object') { errs.push(`#${i}: not an object`); return; }
    for (const k of Object.keys(w)) if (!WORD_KEYS.includes(k)) E(`unknown key ${k}`);
    if (!/^(b\d{1,4}|n\d{4,5})$/.test(String(w.id))) E('id must be b<number> (the original words) or n<4–5 digits>');
    if (ids.has(w.id)) E('duplicate id'); ids.add(w.id);
    if (typeof w.en !== 'string' || !w.en.trim() || w.en !== w.en.trim()) E('en missing or has outer spaces');
    else {
      const k = norm(w.en);
      // Two of the original words are the British and American spelling of one word (Realise b14,
      // Realize b637). Both stay — his progress may be on either id — but nothing new may twin a word.
      if (ens.has(k) && !(String(w.id).startsWith('b') && String(ens.get(k)).startsWith('b'))) E(`duplicate word (same as ${ens.get(k)})`);
      if (!ens.has(k)) ens.set(k, w.id);
    }
    if (typeof w.he !== 'string' || !HEB.test(w.he)) E('he missing');
    else if (MARK.test(w.he)) E('he has niqqud');
    if (typeof w.ph !== 'string' || !w.ph) E('ph missing');
    else {
      if (!PH_OK.test(w.ph)) E('ph has characters other than Hebrew letters, niqqud, ׳, "-" and space');
      if (!MARK.test(w.ph)) E('ph has no niqqud');
      if (danglingMark(w.ph) >= 0) E('ph has a niqqud or ׳ that is not on a letter');
    }
    if (!cats.includes(w.cat)) E(`cat "${w.cat}" is not in the app's CATS`);
    if (!LEVELS.includes(w.lv)) E(`lv "${w.lv}" must be one of ${LEVELS.join(' ')}`);
    if (!TYPES.includes(w.type)) E(`type "${w.type}"`);
    if (typeof w.emoji !== 'string' || !w.emoji) E('emoji missing');
    const list = Object.prototype.hasOwnProperty.call(ex, w.en) ? ex[w.en] : ex[String(w.en).replace(/ if\.\.\.$/, '').replace(/\.\.\.$/, '')];
    const hasEx = (typeof w.ex === 'string' && w.ex.trim()) || (Array.isArray(list) && list.length);
    if (!hasEx) E('no example sentence');
    if (Array.isArray(list) && list.some(e => !e || typeof e.s !== 'string' || !e.s.trim() || typeof e.he !== 'string' || !HEB.test(e.he) || ![1, 2, 3, 4, 5].includes(e.l))) E('an example without a sentence, a Hebrew translation or a level');
  });
  for (const k of Object.keys(ex)) if (!Array.isArray(ex[k])) errs.push(`examples["${k}"] is not a list`);
  return errs;
}

export function stats(data) {
  const by = (f) => data.words.reduce((o, w) => (o[w[f]] = (o[w[f]] || 0) + 1, o), {});
  const sentences = Object.values(data.examples).reduce((n, a) => n + a.length, 0);
  return { words: data.words.length, sentences, byCat: by('cat'), byLevel: by('lv'), byType: by('type') };
}

// words.js's content hash → index.html (DATA_V + the <script src>) and sw.js (its precache list).
export const dataHash = (file = DATA_FILE) => createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 10);
export function stamp() {
  const h = dataHash();
  const page = join(ROOT, 'index.html'), sw = join(ROOT, 'sw.js');
  let html = readFileSync(page, 'utf8'), w = readFileSync(sw, 'utf8');
  const n1 = (html.match(/words\.js\?v=[0-9a-f]+/g) || []).length, n2 = (w.match(/words\.js\?v=[0-9a-f]+/g) || []).length;
  if (n1 !== 1 || n2 !== 1) throw new Error(`expected one words.js?v=… in index.html (found ${n1}) and in sw.js (found ${n2})`);
  html = html.replace(/words\.js\?v=[0-9a-f]+/, 'words.js?v=' + h);
  w = w.replace(/words\.js\?v=[0-9a-f]+/, 'words.js?v=' + h);
  writeFileSync(page, html); writeFileSync(sw, w);
  return h;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cmd = process.argv[2];
  if (cmd === 'check') {
    const data = readData();
    const errs = check(data);
    errs.slice(0, 200).forEach(e => console.log(e));
    const s = stats(data);
    console.log(`${s.words} words, ${s.sentences} example sentences — ${errs.length ? errs.length + ' problems' : 'all good'}`);
    const h = dataHash(), html = readFileSync(join(ROOT, 'index.html'), 'utf8');
    if (!html.includes('words.js?v=' + h)) { console.log(`index.html does not ask for words.js?v=${h} — run: node tools/data.mjs stamp`); process.exit(1); }
    process.exit(errs.length ? 1 : 0);
  } else if (cmd === 'stamp') {
    console.log('words.js?v=' + stamp());
  } else if (cmd === 'stats') {
    console.log(JSON.stringify(stats(readData()), null, 1));
  } else {
    console.log('usage: node tools/data.mjs check | stamp | stats');
    process.exit(2);
  }
}
