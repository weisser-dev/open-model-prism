import LdapConfig from '../models/LdapConfig.js';
import { decrypt } from '../utils/encryption.js';

/**
 * Authenticate a user against the configured LDAP server.
 * Returns { username, role, dn } on success, null if not found / wrong password.
 * Throws on connection/config errors.
 *
 * Uses dynamic import of ldapjs so the server starts even without the package
 * when LDAP is disabled.
 */
export async function ldapAuthenticate(username, password) {
  const config = await LdapConfig.findOne({ enabled: true });
  if (!config?.url) return null;

  let ldap;
  try {
    ldap = (await import('ldapjs')).default;
  } catch {
    throw new Error('ldapjs not installed — run: cd server && npm install ldapjs');
  }

  return new Promise((resolve, reject) => {
    const clientOpts = {
      url: config.url,
      timeout: 5000,
      connectTimeout: 5000,
    };
    if (config.tlsInsecure) {
      clientOpts.tlsOptions = { rejectUnauthorized: false };
    }

    const client = ldap.createClient(clientOpts);
    client.on('error', err => reject(new Error(`LDAP error: ${err.message}`)));

    const bindPw = config.bindPassword ? decrypt(config.bindPassword) : '';
    client.bind(config.bindDn, bindPw, bindErr => {
      if (bindErr) {
        client.destroy();
        return reject(new Error(`LDAP service bind failed: ${bindErr.message}`));
      }

      const safeUser = username.replace(/[*()\\]/g, '');
      const filter = config.searchFilter.replace('{{username}}', safeUser);
      const searchOpts = {
        filter,
        scope: 'sub',
        attributes: ['dn', 'uid', 'cn', 'mail', 'memberOf'],
      };

      client.search(config.searchBase, searchOpts, (searchErr, searchRes) => {
        if (searchErr) {
          client.destroy();
          return reject(new Error(`LDAP search failed: ${searchErr.message}`));
        }

        const entries = [];
        searchRes.on('searchEntry', e => entries.push(e));
        searchRes.on('error', e => { client.destroy(); reject(e); });
        searchRes.on('end', () => {
          if (entries.length === 0) {
            client.destroy();
            return resolve(null); // user not in LDAP
          }

          const entry = entries[0];
          const userDn = entry.dn.toString();

          // Verify password by binding as the user
          client.bind(userDn, password, userBindErr => {
            client.destroy();
            if (userBindErr) return resolve(null); // wrong password

            // Determine role via group mapping
            const memberOf = entry.attributes
              .find(a => a.type === 'memberOf')?.values ?? [];

            let role = config.defaultRole;
            for (const mapping of (config.groupMapping || [])) {
              if (memberOf.some(g => g.toLowerCase() === mapping.groupDn.toLowerCase())) {
                role = mapping.role;
                break; // first match wins
              }
            }

            resolve({ username: username.toLowerCase(), role, dn: userDn });
          });
        });
      });
    });
  });
}

/**
 * Test an LDAP configuration (service-account bind only).
 * configOverride is a plain object with { url, bindDn, bindPassword, tlsInsecure }.
 * bindPassword may be plaintext (from form) or encrypted (from DB).
 */
export async function testLdapConnection({ url, bindDn, bindPassword, tlsInsecure }) {
  let ldap;
  try {
    ldap = (await import('ldapjs')).default;
  } catch {
    throw new Error('ldapjs not installed — run: cd server && npm install ldapjs');
  }

  return new Promise((resolve, reject) => {
    const client = ldap.createClient({
      url,
      timeout: 5000,
      connectTimeout: 5000,
      ...(tlsInsecure ? { tlsOptions: { rejectUnauthorized: false } } : {}),
    });
    client.on('error', err => reject(new Error(`Connection error: ${err.message}`)));

    const pw = bindPassword?.startsWith('enc:')
      ? decrypt(bindPassword)
      : (bindPassword || '');

    client.bind(bindDn, pw, err => {
      client.destroy();
      if (err) return reject(new Error(`Bind failed: ${err.message}`));
      resolve({ success: true });
    });
  });
}
