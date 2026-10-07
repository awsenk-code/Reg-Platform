// Microsoft 365 backend: sign-in with Entra ID (MSAL, redirect flow) and storage in SharePoint lists
// via Microsoft Graph. Private tasks are stored in the user's OneDrive app folder.
// Implements the remote interface documented in sync.js.

const GRAPH = 'https://graph.microsoft.com/v1.0';
const SCOPES = ['User.Read', 'Sites.ReadWrite.All', 'Files.ReadWrite.AppFolder'];
const SETUP_SCOPES = ['Sites.Manage.All']; // only needed once, to create the lists
const LISTS = { project: 'EisenhowerProjects', task: 'EisenhowerTasks', member: 'EisenhowerMembers' };
const PRIVATE_FILE = 'eisenhower-private.json';

function loadScript(src) {
  if (window.msal) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = Object.assign(document.createElement('script'), { src, async: true });
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.append(s);
  });
}

// The page URL without file name, query or hash: must match the redirect URI registered in Entra.
export function appUrl() {
  const url = new URL(location.href);
  return url.origin + url.pathname.replace(/index\.html$/, '');
}

export class GraphError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export class GraphRemote {
  constructor(config) {
    this.config = config;
    this.siteId = null;
    this.listIds = {};
  }

  // Loads MSAL and completes a pending sign-in redirect. Returns the signed-in account or null.
  async init() {
    await loadScript('vendor/msal-browser.min.js');
    const { clientId, tenantId } = this.config;
    this.msal = new window.msal.PublicClientApplication({
      auth: {
        clientId,
        authority: `https://login.microsoftonline.com/${tenantId}`,
        redirectUri: appUrl(),
        postLogoutRedirectUri: appUrl(),
        navigateToLoginRequestUrl: false,
      },
      // localStorage keeps the session in the installed home-screen app between launches.
      cache: { cacheLocation: 'localStorage' },
    });
    await this.msal.initialize();
    const result = await this.msal.handleRedirectPromise();
    const account = result?.account || this.msal.getActiveAccount() || this.msal.getAllAccounts()[0];
    if (account) this.msal.setActiveAccount(account);
    return this.account();
  }

  account() {
    const a = this.msal?.getActiveAccount();
    return a ? { id: a.localAccountId, name: a.name || a.username, email: a.username, tenantId: a.tenantId } : null;
  }

  login() {
    return this.msal.loginRedirect({ scopes: SCOPES, prompt: 'select_account' });
  }

  logout() {
    return this.msal.logoutRedirect({ account: this.msal.getActiveAccount() });
  }

  async token(scopes = SCOPES) {
    const request = { scopes, account: this.msal.getActiveAccount() };
    try {
      return (await this.msal.acquireTokenSilent(request)).accessToken;
    } catch (e) {
      if (e instanceof window.msal.InteractionRequiredAuthError) {
        await this.msal.acquireTokenRedirect(request);
        return new Promise(() => {}); // the page navigates away
      }
      throw e;
    }
  }

  async request(method, path, body, { scopes, raw = false, retry = true } = {}) {
    const headers = { Authorization: `Bearer ${await this.token(scopes)}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(path.startsWith('http') ? path : GRAPH + path, {
      method,
      headers,
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
      cache: 'no-store',
    });
    if (res.status === 429 && retry) {
      const wait = Number(res.headers.get('Retry-After')) || 2;
      await new Promise((r) => setTimeout(r, wait * 1000));
      return this.request(method, path, body, { scopes, raw, retry: false });
    }
    if (!res.ok) {
      let message = `${res.status} ${res.statusText}`;
      try {
        message = (await res.json()).error?.message || message;
      } catch {
        /* no JSON body */
      }
      throw new GraphError(res.status, message);
    }
    if (res.status === 204) return null;
    const type = res.headers.get('Content-Type') || '';
    return type.includes('json') ? res.json() : res.text();
  }

  // Resolves the SharePoint site and creates the lists on first use.
  async ensureSetup() {
    if (this.siteId && Object.keys(this.listIds).length === 3) return;
    const { siteHostname, sitePath } = this.config;
    const path = sitePath.startsWith('/') ? sitePath : `/${sitePath}`;
    const site = await this.request('GET', `/sites/${siteHostname}:${path}?$select=id`);
    this.siteId = site.id;
    const lists = await this.request('GET', `/sites/${this.siteId}/lists?$select=id,displayName&$top=999`);
    for (const [kind, name] of Object.entries(LISTS)) {
      const found = lists.value.find((l) => l.displayName === name);
      this.listIds[kind] = found ? found.id : await this.createList(name);
    }
  }

  async createList(displayName) {
    const list = await this.request('POST', `/sites/${this.siteId}/lists`, {
      displayName,
      columns: [
        { name: 'RecordId', text: {} },
        { name: 'Data', text: { allowMultipleLines: true, textType: 'plain' } },
      ],
      list: { template: 'genericList' },
    }, { scopes: SETUP_SCOPES });
    return list.id;
  }

  itemsPath(kind) {
    return `/sites/${this.siteId}/lists/${this.listIds[kind]}/items`;
  }

  async fetchKind(kind) {
    const out = [];
    let url = `${this.itemsPath(kind)}?$expand=fields($select=RecordId,Data)&$top=500`;
    while (url) {
      const page = await this.request('GET', url);
      for (const item of page.value) {
        try {
          const record = JSON.parse(item.fields.Data);
          if (record && record.id) out.push({ ...record, _sp: item.id });
        } catch {
          /* ignore rows edited by hand in SharePoint */
        }
      }
      url = page['@odata.nextLink'] || null;
    }
    return out;
  }

  async fetchAll() {
    await this.ensureSetup();
    const [projects, tasks, members] = await Promise.all([this.fetchKind('project'), this.fetchKind('task'), this.fetchKind('member')]);
    return { projects, tasks, members };
  }

  async upsert(kind, record) {
    await this.ensureSetup();
    const { _sp, ...data } = record;
    const fields = { Title: String(record.title || record.name || record.id).slice(0, 255), RecordId: record.id, Data: JSON.stringify(data) };
    if (_sp) {
      try {
        await this.request('PATCH', `${this.itemsPath(kind)}/${_sp}/fields`, fields);
        return _sp;
      } catch (e) {
        if (e.status !== 404) throw e; // deleted on the server meanwhile: create it again
      }
    }
    const item = await this.request('POST', this.itemsPath(kind), { fields });
    return item.id;
  }

  async remove(kind, spId) {
    await this.ensureSetup();
    try {
      await this.request('DELETE', `${this.itemsPath(kind)}/${spId}`);
    } catch (e) {
      if (e.status !== 404) throw e;
    }
  }

  async loadPrivate() {
    let meta;
    try {
      meta = await this.request('GET', `/me/drive/special/approot:/${PRIVATE_FILE}`);
    } catch (e) {
      if (e.status === 404) return [];
      throw e;
    }
    // The pre-authenticated download URL avoids the CORS-unfriendly 302 of the /content endpoint.
    const res = await fetch(meta['@microsoft.graph.downloadUrl'], { cache: 'no-store' });
    if (!res.ok) throw new GraphError(res.status, `Could not read private tasks (${res.status})`);
    const data = await res.json();
    return Array.isArray(data?.tasks) ? data.tasks : [];
  }

  async savePrivate(tasks) {
    await this.request('PUT', `/me/drive/special/approot:/${PRIVATE_FILE}:/content`, JSON.stringify({ version: 1, tasks }), { raw: true });
  }
}
