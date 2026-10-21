// Admin-Konto anlegen oder ein bestehendes Konto zum Admin machen.
//   npm run admin -- --email du@example.org [--name "Anzeigename"]
// Passwort: aus der Umgebungsvariable ADMIN_PASSWORD, sonst wird ein zufälliges erzeugt und einmal angezeigt.
import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { openDb, migrate, DEFAULT_DB_PATH } from '../server/db.mjs';
import { checkEmail, checkPassword, cleanDisplayName, hashPassword, normalizeEmail } from '../server/auth.mjs';

const { values } = parseArgs({ options: { email: { type: 'string' }, name: { type: 'string' } } });
const email = normalizeEmail(values.email);
if (!checkEmail(email)) {
  console.error('Bitte eine gültige E-Mail angeben: npm run admin -- --email du@example.org');
  process.exit(1);
}
const name = cleanDisplayName(values.name ?? 'Admin');
if (!name) {
  console.error('Der Anzeigename muss 1–40 Zeichen haben.');
  process.exit(1);
}
const given = process.env.ADMIN_PASSWORD;
const password = given ?? randomBytes(12).toString('base64url');
const pwError = checkPassword(password);
if (pwError) {
  console.error(pwError);
  process.exit(1);
}

const db = openDb(process.env.WORTWEG_DB || DEFAULT_DB_PATH);
migrate(db);
const hash = await hashPassword(password);
const now = Date.now();
const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
if (existing) {
  db.prepare("UPDATE users SET role = 'admin', password_hash = ?, is_guest = 0 WHERE id = ?").run(hash, existing.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(existing.id);
  console.log(`Konto ${email} ist jetzt Admin. Das Passwort wurde neu gesetzt; bestehende Sitzungen wurden beendet.`);
} else {
  db.prepare("INSERT INTO users (email, display_name, password_hash, role, is_guest, created_at) VALUES (?, ?, ?, 'admin', 0, ?)").run(email, name, hash, now);
  console.log(`Admin-Konto angelegt: ${email}`);
}
if (!given) console.log(`Passwort (wird nur jetzt angezeigt): ${password}`);
db.close();
