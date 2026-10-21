// Core logic for saving and restoring Claude Code logins.
//
// Claude Code's login state lives in two places:
//   ~/.claude/.credentials.json   OAuth tokens (whole file)
//   ~/.claude.json                the "oauthAccount" key (who is logged in)
// A profile is a snapshot of both, stored under ~/.claude-switcher/profiles/<name>/.

const fs = require('fs');
const os = require('os');
const path = require('path');

const HOME = os.homedir();
const CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(HOME, '.claude');
const CREDENTIALS_FILE = path.join(CONFIG_DIR, '.credentials.json');
const GLOBAL_CONFIG_FILE = process.env.CLAUDE_CONFIG_DIR
  ? path.join(CONFIG_DIR, '.claude.json')
  : path.join(HOME, '.claude.json');
const PROFILES_DIR = path.join(HOME, '.claude-switcher', 'profiles');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// Write via temp file + rename so a crash never leaves a half-written file.
function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.switcher-${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function validateName(name) {
  if (!/^[\w.@ -]{1,64}$/.test(name)) {
    throw new Error('Profile names may only use letters, digits, spaces and . _ - @');
  }
}

function currentAccount() {
  try {
    return readJson(GLOBAL_CONFIG_FILE).oauthAccount || null;
  } catch {
    return null;
  }
}

function sameAccount(a, b) {
  return !!a && !!b &&
    a.accountUuid === b.accountUuid &&
    a.organizationUuid === b.organizationUuid;
}

function listProfiles() {
  if (!fs.existsSync(PROFILES_DIR)) return [];
  return fs.readdirSync(PROFILES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const dir = path.join(PROFILES_DIR, d.name);
      try {
        return { name: d.name, dir, account: readJson(path.join(dir, 'oauthAccount.json')) };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function activeProfile() {
  const acct = currentAccount();
  return listProfiles().find((p) => sameAccount(p.account, acct)) || null;
}

// Snapshot the live login into a profile (overwriting it if it exists).
function saveProfile(name) {
  validateName(name);
  const account = currentAccount();
  if (!account) throw new Error('No Claude login found. Run `claude` and /login first.');
  if (!fs.existsSync(CREDENTIALS_FILE)) {
    throw new Error(`Credentials file not found at ${CREDENTIALS_FILE}.`);
  }
  const dir = path.join(PROFILES_DIR, name);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeJsonAtomic(path.join(dir, 'credentials.json'), readJson(CREDENTIALS_FILE));
  writeJsonAtomic(path.join(dir, 'oauthAccount.json'), account);
  return { name, dir, account };
}

function switchTo(name) {
  validateName(name);
  const dir = path.join(PROFILES_DIR, name);
  const creds = readJson(path.join(dir, 'credentials.json'));
  const account = readJson(path.join(dir, 'oauthAccount.json'));

  // Tokens refresh over time, so re-snapshot the outgoing account before
  // replacing it; otherwise its saved refresh token may go stale.
  const outgoing = activeProfile();
  if (outgoing && outgoing.name !== name) saveProfile(outgoing.name);

  const config = readJson(GLOBAL_CONFIG_FILE);
  config.oauthAccount = account;
  writeJsonAtomic(CREDENTIALS_FILE, creds);
  writeJsonAtomic(GLOBAL_CONFIG_FILE, config);
  return { name, account };
}

function removeProfile(name) {
  validateName(name);
  fs.rmSync(path.join(PROFILES_DIR, name), { recursive: true, force: true });
}

module.exports = {
  CREDENTIALS_FILE,
  GLOBAL_CONFIG_FILE,
  PROFILES_DIR,
  currentAccount,
  listProfiles,
  activeProfile,
  saveProfile,
  switchTo,
  removeProfile,
};
