const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const profiles = require('./profiles');

let statusItem;
const treeChanged = new vscode.EventEmitter();

function describe(account) {
  if (!account) return 'not logged in';
  const org = account.organizationName && !account.organizationName.includes(account.emailAddress)
    ? ` · ${account.organizationName}`
    : '';
  return `${account.emailAddress}${org}`;
}

function refresh() {
  const active = profiles.activeProfile();
  const account = profiles.currentAccount();
  const label = active ? active.name : account ? 'unsaved' : 'logged out';
  statusItem.text = `$(account) Claude: ${label}`;
  statusItem.tooltip = `Claude account: ${describe(account)}\nClick to switch`;
  statusItem.show();
  treeChanged.fire();
}

// Sidebar list of saved profiles; clicking one switches to it.
const profileTree = {
  onDidChangeTreeData: treeChanged.event,
  getTreeItem: (item) => item,
  getChildren() {
    const active = profiles.activeProfile();
    const items = profiles.listProfiles().map((p) => {
      const isActive = !!active && p.name === active.name;
      const item = new vscode.TreeItem(p.name);
      item.description = describe(p.account);
      item.tooltip = `${p.name}\n${describe(p.account)}${isActive ? '\n(active)' : '\nClick to switch'}`;
      item.iconPath = new vscode.ThemeIcon(isActive ? 'pass-filled' : 'account',
        isActive ? new vscode.ThemeColor('charts.green') : undefined);
      item.contextValue = isActive ? 'activeProfile' : 'profile';
      item.profileName = p.name;
      if (!isActive) {
        item.command = { command: 'claudeSwitcher.switchTo', title: 'Switch', arguments: [item] };
      }
      return item;
    });
    // Surface a live login that isn't saved yet, so it's one click to keep it.
    const account = profiles.currentAccount();
    if (items.length && account && !active) {
      const item = new vscode.TreeItem('Current login (unsaved)');
      item.description = describe(account);
      item.iconPath = new vscode.ThemeIcon('warning');
      item.command = { command: 'claudeSwitcher.save', title: 'Save' };
      items.unshift(item);
    }
    return items;
  },
};

async function promptSave() {
  const account = profiles.currentAccount();
  if (!account) {
    vscode.window.showWarningMessage('No Claude login found. Run `claude` in a terminal and use /login first.');
    return;
  }
  const existing = profiles.activeProfile();
  const name = await vscode.window.showInputBox({
    title: `Save ${account.emailAddress} as profile`,
    prompt: 'Profile name (e.g. personal, work)',
    value: existing ? existing.name : account.emailAddress.split('@')[0],
    validateInput: (v) => (/^[\w.@ -]{1,64}$/.test(v) ? null : 'Use letters, digits, spaces and . _ - @'),
  });
  if (!name) return;
  profiles.saveProfile(name);
  vscode.window.showInformationMessage(`Saved ${account.emailAddress} as "${name}".`);
  refresh();
}

async function switchToProfile(name) {
  const active = profiles.activeProfile();
  if (active && active.name === name) return;
  const { account } = profiles.switchTo(name);
  refresh();
  const mode = vscode.workspace.getConfiguration('claudeSwitcher').get('reloadAfterSwitch');
  const msg = `Switched Claude to "${name}" (${describe(account)}). Restart any running Claude Code sessions to use it.`;
  if (mode === 'always') return vscode.commands.executeCommand('workbench.action.reloadWindow');
  if (mode === 'never') return vscode.window.showInformationMessage(msg);
  const choice = await vscode.window.showInformationMessage(msg, 'Reload Window');
  if (choice === 'Reload Window') vscode.commands.executeCommand('workbench.action.reloadWindow');
}

async function switchAccount() {
  const all = profiles.listProfiles();
  const active = profiles.activeProfile();
  const others = all.filter((p) => !active || p.name !== active.name);

  // With exactly two profiles, clicking the status bar just toggles.
  if (all.length === 2 && active && others.length === 1) return switchToProfile(others[0].name);

  const items = all.map((p) => ({
    label: `${active && p.name === active.name ? '$(check) ' : ''}${p.name}`,
    description: describe(p.account),
    profile: p,
  }));
  items.push(
    { label: '', kind: vscode.QuickPickItemKind.Separator },
    { label: '$(save) Save current login as profile…', action: 'save' },
    { label: '$(sign-in) Add another account…', action: 'add' },
  );

  const pick = await vscode.window.showQuickPick(items, {
    title: `Claude account (current: ${describe(profiles.currentAccount())})`,
  });
  if (!pick) return;
  if (pick.action === 'save') return promptSave();
  if (pick.action === 'add') return addAccount();
  return switchToProfile(pick.profile.name);
}

// Prefer `claude` on PATH; otherwise fall back to the binary bundled with the
// Claude Code VS Code extension, which is often the only copy installed.
function claudeCommand() {
  const onPath = (process.env.PATH || '').split(path.delimiter)
    .some((dir) => dir && fs.existsSync(path.join(dir, process.platform === 'win32' ? 'claude.exe' : 'claude')));
  if (onPath) return 'claude';
  const ext = vscode.extensions.getExtension('anthropic.claude-code');
  if (ext) {
    const bin = path.join(ext.extensionPath, 'resources', 'native-binary',
      process.platform === 'win32' ? 'claude.exe' : 'claude');
    if (fs.existsSync(bin)) return process.platform === 'win32' ? `& "${bin}"` : `"${bin}"`;
  }
  return 'claude';
}

async function addAccount() {
  if (profiles.currentAccount() && !profiles.activeProfile()) {
    const save = await vscode.window.showWarningMessage(
      'Your current login is not saved as a profile yet. Save it first?', 'Save', 'Skip');
    if (save === 'Save') await promptSave();
    if (!save) return;
  }
  const term = vscode.window.createTerminal('Claude login');
  term.show();
  term.sendText(claudeCommand());
  vscode.window.showInformationMessage(
    'In the terminal, type /login and sign in with the other account, then save it as a profile.',
    'Save Now',
  ).then((c) => c === 'Save Now' && promptSave());
}

async function removeProfile(item) {
  let name = item && item.profileName;
  if (!name) {
    const pick = await vscode.window.showQuickPick(
      profiles.listProfiles().map((p) => ({ label: p.name, description: describe(p.account) })),
      { title: 'Remove which saved profile?' },
    );
    if (!pick) return;
    name = pick.label;
  }
  const ok = await vscode.window.showWarningMessage(
    `Delete saved profile "${name}"? The live login is not affected.`, { modal: true }, 'Delete');
  if (ok !== 'Delete') return;
  profiles.removeProfile(name);
  refresh();
}

function wrap(fn) {
  return async (...args) => {
    try {
      await fn(...args);
    } catch (err) {
      vscode.window.showErrorMessage(`Claude Account Switcher: ${err.message}`);
    }
  };
}

function activate(context) {
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusItem.command = 'claudeSwitcher.switch';
  context.subscriptions.push(
    statusItem,
    treeChanged,
    vscode.window.registerTreeDataProvider('claudeSwitcher.profiles', profileTree),
    vscode.commands.registerCommand('claudeSwitcher.switch', wrap(switchAccount)),
    vscode.commands.registerCommand('claudeSwitcher.switchTo', wrap((item) => switchToProfile(item.profileName))),
    vscode.commands.registerCommand('claudeSwitcher.save', wrap(promptSave)),
    vscode.commands.registerCommand('claudeSwitcher.add', wrap(addAccount)),
    vscode.commands.registerCommand('claudeSwitcher.remove', wrap(removeProfile)),
    vscode.commands.registerCommand('claudeSwitcher.refresh', wrap(refresh)),
    vscode.commands.registerCommand('claudeSwitcher.openFolder', wrap(async () => {
      fs.mkdirSync(profiles.PROFILES_DIR, { recursive: true });
      await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(profiles.PROFILES_DIR));
    })),
  );

  // Keep the status bar and sidebar in sync when Claude Code itself logs in/out.
  fs.watchFile(profiles.GLOBAL_CONFIG_FILE, { interval: 3000 }, () => refresh());
  context.subscriptions.push({ dispose: () => fs.unwatchFile(profiles.GLOBAL_CONFIG_FILE) });

  refresh();
}

function deactivate() {}

module.exports = { activate, deactivate };
