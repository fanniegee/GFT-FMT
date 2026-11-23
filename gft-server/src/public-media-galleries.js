import { readdir } from 'node:fs/promises';
import path from 'node:path';

const folders = Object.freeze({ 'ama-2k': 'AMA-2k', 'gen-1-5': 'GEN-1-5', events: 'events', biographs: 'biographs' });
const imagePattern = /\.(?:avif|gif|jpe?g|png|webp)$/i;
const videoPattern = /\.(?:mp4|webm|m4v|mov)$/i;
const supported = name => imagePattern.test(name) || videoPattern.test(name);

export function installPublicMediaGalleries(app, publicRoot) {
  async function entries(key) {
    if (!Object.hasOwn(folders, key)) return null;
    try {
      return (await readdir(path.join(publicRoot, 'assets', folders[key]), { withFileTypes: true }))
        .filter(entry => entry.isFile() && !entry.name.startsWith('.') && supported(entry.name))
        .map(entry => entry.name).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
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
        name, type: imagePattern.test(name) ? 'image' : 'video',
        url: `/public-gallery/${encodeURIComponent(req.params.gallery)}/${encodeURIComponent(name)}`
      })) });
    } catch (error) { next(error); }
  });

  // Only supported, regular media files from these four public folders are exposed.
  app.get('/public-gallery/:gallery/:filename', async (req, res, next) => {
    try {
      const names = await entries(req.params.gallery);
      if (!names || !names.includes(req.params.filename)) return res.sendStatus(404);
      res.sendFile(req.params.filename, {
        root: path.join(publicRoot, 'assets', folders[req.params.gallery]), dotfiles: 'deny',
        headers: { 'X-Content-Type-Options': 'nosniff' }
      }, error => { if (error) next(error); });
    } catch (error) { next(error); }
  });
}
