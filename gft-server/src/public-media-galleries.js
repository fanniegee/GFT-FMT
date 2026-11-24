import { readdir } from 'node:fs/promises';
import path from 'node:path';

const folders = Object.freeze({ 'ama-2k': 'AMA-2k', 'gen-1-5': 'GEN-1-5', events: 'events', biographs: 'Biography', 'clinic-life': 'clinic/gallery', 'clinic-stories': 'clinic/stories' });
const imagePattern = /\.(?:avif|gif|jpe?g|png|webp)$/i;
const videoPattern = /\.(?:mp4|webm|m4v|mov)$/i;
const supported = name => imagePattern.test(name) || videoPattern.test(name);

export function installPublicMediaGalleries(app, publicRoot) {
  async function entries(key) {
    if (!Object.hasOwn(folders, key)) return null;
    try {
      const root = path.join(publicRoot, 'assets', folders[key]);
      async function walk(relative = '') {
        const children = (await readdir(path.join(root, relative), { withFileTypes: true }))
          .filter(entry => !entry.name.startsWith('.'))
          .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
        const files = children.filter(entry => entry.isFile() && supported(entry.name))
          .map(entry => relative ? `${relative}/${entry.name}` : entry.name);
        // Complete each event folder before moving to the next; never follow symlinks.
        if (key === 'events') {
          for (const entry of children.filter(entry => entry.isDirectory())) {
            files.push(...await walk(relative ? `${relative}/${entry.name}` : entry.name));
          }
        }
        return files;
      }
      return await walk();
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }

  app.get('/api/public/media-galleries/:gallery', async (req, res, next) => {
    try {
      const names = await entries(req.params.gallery);
      if (!names) return res.status(404).json({ ok: false, error: 'Gallery not found' });
      res.set('Cache-Control', 'public, max-age=60').json({ ok: true, items: names.map(name => ({
        name: path.posix.basename(name),
        collection: name.includes('/') ? path.posix.dirname(name) : '',
        type: imagePattern.test(name) ? 'image' : 'video',
        url: `/public-gallery/${encodeURIComponent(req.params.gallery)}/${name.split('/').map(encodeURIComponent).join('/')}`
      })) });
    } catch (error) { next(error); }
  });

  // Only supported, regular media files from these four public folders are exposed.
  app.get('/public-gallery/:gallery/*filename', async (req, res, next) => {
    try {
      const names = await entries(req.params.gallery);
      const filename = req.params.filename.join('/');
      if (!names || !names.includes(filename)) return res.sendStatus(404);
      res.sendFile(filename, {
        root: path.join(publicRoot, 'assets', folders[req.params.gallery]), dotfiles: 'deny',
        headers: { 'X-Content-Type-Options': 'nosniff' }
      }, error => { if (error) next(error); });
    } catch (error) { next(error); }
  });
}
