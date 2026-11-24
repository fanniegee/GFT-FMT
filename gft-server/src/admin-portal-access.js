export function portalRoleError(portal, admin) {
  if (!admin) return null;
  const founder = String(admin.role || '').toUpperCase() === 'FOUNDER';
  if (portal === 'admin' && founder) return 'This is the Admin platform. Your Founder session cannot enter it. Sign out and use an Admin account.';
  if (portal === 'founder' && !founder) return 'Founder access is required for this platform. Your Admin session cannot enter it.';
  return null;
}

export function installAdminPortalAccess(app, getAuthenticatedAdmin) {
  app.get(['/admin.html', '/founder.html'], async (req, res, next) => {
    try {
      res.set('Cache-Control', 'no-store');
      const admin = await getAuthenticatedAdmin(req);
      const error = portalRoleError(req.path === '/admin.html' ? 'admin' : 'founder', admin);
      if (!error) return next();
      const home = String(admin.role || '').toUpperCase() === 'FOUNDER' ? 'founder.html' : 'admin.html';
      return res.status(403).type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Platform access denied</title><link rel="stylesheet" href="/typography.css"></head><body style="margin:0;background:#0f172a;color:#e2e8f0;font-family:Montserrat,Arial,sans-serif"><main style="max-width:600px;margin:12vh auto;padding:28px;border:1px solid #475569;border-radius:18px"><h1>Platform access denied</h1><p style="line-height:1.8">${error}</p><a style="color:#7dd3fc" href="/${home}">Return to your platform</a></main></body></html>`);
    } catch (error) { next(error); }
  });
}
