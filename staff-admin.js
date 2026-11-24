(() => {
  const names = new Map([['tv', 'GFT-TV'], ['spotlight', 'Spotlight Studio'], ['library', 'GFT-Library']]);
  const department = new URLSearchParams(location.search).get('department') || 'tv';
  const get = id => document.getElementById(id);
  if (!names.has(department)) {
    get('status').textContent = 'Choose a department.';
    return;
  }

  const themes = {
    tv: { name: 'GFT.TV', mark: 'TV', tagline: 'Four Worlds. One Destination.', home: 'https://gft-tv.onrender.com', description: 'Welcome to GFT.TV administration. Sign in or accept your invitation to join the television team.' },
    library: { name: 'Guvaza Library', mark: '▤', tagline: 'Knowledge • Heritage • Imagination', home: 'library.html', description: 'A home for knowledge, heritage and imagination. Sign in or accept your invitation to join the Library team.' },
    spotlight: { name: 'Spotlight Studio', mark: '✦', tagline: 'Create • Collaborate • Inspire', home: 'gft-spotlight-membership.html', description: 'Support our creative community. Sign in or accept your invitation to join the Spotlight Studio team.' }
  };
  const theme = themes[department];
  document.body.dataset.department = department;
  document.title = theme.name + ' Admin | Guvaza Family Trust';
  get('departmentBrand').textContent = theme.name;
  get('departmentMark').textContent = theme.mark;
  get('departmentTagline').textContent = theme.tagline;
  get('departmentDescription').textContent = theme.description;
  get('departmentHome').href = theme.home;
  get('departmentBack').href = theme.home;
  document.querySelectorAll('nav a').forEach(link => {
    if (new URL(link.href).searchParams.get('department') === department) link.setAttribute('aria-current', 'page');
  });

  const base = '/api/staff-admin/' + department;
  let invitation = new URLSearchParams(location.hash.slice(1)).get('invite');
  if (invitation) history.replaceState(null, '', location.pathname + location.search);
  get('heading').textContent = names.get(department) + ' Admin';

  async function request(path, body) {
    const response = await fetch(base + path, body === undefined ? {} : {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Request failed (' + response.status + ').');
    return result;
  }

  async function refresh() {
    const { staff, canInviteSuperAdmin, canInviteAdmin, founder } = await request('/me');
    get('account').hidden = !staff || Boolean(invitation);
    get('login').hidden = Boolean(staff || invitation);
    get('accept').hidden = !invitation;
    get('invite').hidden = Boolean(invitation) || !(canInviteSuperAdmin || canInviteAdmin);
    get('delegation').hidden = !founder || Boolean(invitation);
    get('identity').textContent = staff ? staff.name + ' · ' + (staff.role === 'SUPER_ADMIN' ? 'Super Admin' : 'Admin') : '';
    const roles = get('invite').elements.role;
    roles.replaceChildren();
    if (canInviteSuperAdmin) roles.add(new Option('Super Admin', 'SUPER_ADMIN'));
    if (canInviteAdmin) roles.add(new Option('Admin', 'ADMIN'));
  }

  async function perform(action) {
    try { get('status').textContent = ''; await action(); }
    catch (error) { get('status').textContent = error.message; }
  }

  function onSubmit(id, action) {
    const form = get(id);
    form.addEventListener('submit', event => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(form));
      perform(async () => {
        const button = form.querySelector('button');
        button.disabled = true;
        try { await action(values, form); }
        finally { button.disabled = false; }
      });
    });
  }

  onSubmit('login', async (values, form) => {
    await request('/login', values);
    form.reset();
    await refresh();
  });
  onSubmit('accept', async (values, form) => {
    await request('/accept', { ...values, token: invitation });
    invitation = null;
    form.reset();
    await refresh();
    get('status').textContent = 'Account activated. You can now sign in.';
  });
  onSubmit('invite', async values => {
    get('linkLabel').hidden = true;
    get('inviteLink').value = '';
    const result = await request('/invitations', values);
    get('inviteLink').value = new URL(result.path, location.origin).href;
    get('linkLabel').hidden = false;
    get('inviteLink').select();
  });
  onSubmit('delegation', async values => {
    await request('/delegation', { email: values.email, enabled: values.enabled === 'true' });
    get('status').textContent = 'Invitation authority saved.';
  });
  get('logout').addEventListener('click', () => perform(async () => {
    await request('/logout', {});
    get('inviteLink').value = '';
    get('linkLabel').hidden = true;
    await refresh();
  }));
  perform(refresh);
})();

