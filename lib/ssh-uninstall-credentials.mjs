// Full CLI uninstall: the plugin data that lists saved account backups and SSH host
// passwords is purged, so read their ids first and delete the keychain items afterwards.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

export function collectSavedCredentialIds(dataDir) {
  const accounts = readJson(join(dataDir, 'accounts.json'))?.accounts;
  const hosts = readJson(join(dataDir, 'ssh-projects', 'hosts.json'))?.hosts;
  return {
    accounts: Array.isArray(accounts) ? accounts.map(a => a?.id).filter(id => typeof id === 'string' && id) : [],
    sshHosts: hosts && typeof hosts === 'object' && !Array.isArray(hosts) ? Object.keys(hosts) : []
  };
}

// Best effort: every id is tried, failures are reported, nothing throws.
export async function purgeSavedCredentials(ids, { accountsVault, sshVault, home } = {}) {
  const failures = [];
  let removed = 0;
  const run = (kind, id, fn) => {
    try {
      const res = fn();
      if (res?.ok) removed++;
      else failures.push({ kind, id, error: res?.error || 'delete failed' });
    } catch (error) {
      failures.push({ kind, id, error: error?.message || String(error) });
    }
  };
  if (ids.accounts.length) {
    try {
      const vault = accountsVault || (await import('./credential-vault.mjs')).createCredentialVault({ home });
      for (const id of ids.accounts) run('account', id, () => vault.removeSaved(id));
    } catch (error) {
      for (const id of ids.accounts) failures.push({ kind: 'account', id, error: error?.message || String(error) });
    }
  }
  if (ids.sshHosts.length) {
    try {
      const vault = sshVault || (await import('./ssh-vault.mjs')).createSshCredentialVault();
      for (const id of ids.sshHosts) run('ssh-host', id, () => vault.removePassword(id));
    } catch (error) {
      for (const id of ids.sshHosts) failures.push({ kind: 'ssh-host', id, error: error?.message || String(error) });
    }
  }
  return { removed, failures };
}
