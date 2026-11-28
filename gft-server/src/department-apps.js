import path from 'node:path';
export const departmentApps = Object.freeze({
  gft: { name:'Guvaza Family Trust', color:'#0f172a', page:'index.html' },
  library: { name:'Guvaza Library', color:'#17120f', page:'library.html' },
  clinic: { name:'GGC Clinic', color:'#0B2942', page:'clinic.html' }
});
export function installDepartmentApps(app, publicRoot) {
  app.get('/apps/:name.webmanifest', (req,res) => {
    const name=req.params.name;
    if(!Object.hasOwn(departmentApps,name)) return res.sendStatus(404);
    const config=departmentApps[name];
    res.type('application/manifest+json').set('Cache-Control','no-cache').json({
      id:'/apps/'+name, name:config.name, short_name:config.name, description:config.name+' official app',
      start_url:'/'+config.page, scope:'/', display:'standalone', theme_color:config.color, background_color:config.color,
      icons:[192,512].map(size=>({src:name === 'clinic' ? `/api/clinic/public/icon/${size}` : `/assets/${name}-app-${size}.png${name === 'gft' ? '?v=maroon-grey-1' : ''}`,sizes:`${size}x${size}`,type:'image/png',purpose:'any'}))
    });
  });
  app.get('/app-worker.js', (_req,res) => res.set({'Cache-Control':'no-store','Service-Worker-Allowed':'/'}).type('application/javascript').sendFile(path.join(publicRoot,'app-worker.js')));
  app.use((req,res,next)=>{
    const name=Object.keys(departmentApps).find(key=>key!=='gft' && req.hostname===key+'.guvazafamilytrust.com');
    if(!name) return next();
    if(req.path==='/'||req.path==='/index.html') return res.sendFile(path.join(publicRoot,departmentApps[name].page));
    if(['/about.html','/contact.html','/companies.html','/founder.html','/admin.html'].includes(req.path)) return res.redirect(302,'https://guvazafamilytrust.com'+req.originalUrl);
    next();
  });
}
