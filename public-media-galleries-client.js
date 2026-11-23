(() => {
  'use strict';
  const sections = [...document.querySelectorAll('[data-media-galleries]')];
  if (!sections.length) return;
  const labels = { 'ama-2k': 'AMA-2k', 'gen-1-5': 'GEN 1–5', events: 'Family Events', biographs: 'Family Biographs' };
  const cards = [];
  let active = null;
  let previousFocus;
  const dialog = document.createElement('dialog');
  dialog.className = 'gft-media-dialog';
  dialog.setAttribute('aria-label', 'Family media viewer');
  dialog.innerHTML = '<div class="gft-media-toolbar"><strong class="gft-media-title"></strong><button type="button" data-close>Close ✕</button></div><div class="gft-media-view"></div><div class="gft-media-details"></div><div class="gft-media-toolbar"><button type="button" data-prev>← Previous</button><span aria-live="polite" data-count></span><button type="button" data-next>Next →</button></div>';
  document.body.append(dialog);
  const view = dialog.querySelector('.gft-media-view');
  function clearMedia(container) {
    container.querySelectorAll('video').forEach(video => { video.pause(); video.removeAttribute('src'); video.load(); });
    container.replaceChildren();
  }
  function media(item, preview) {
    const el = document.createElement(item.type === 'video' ? 'video' : 'img');
    el.src = item.url;
    if (item.type === 'video') {
      el.controls = !preview; el.muted = preview; el.loop = preview; el.playsInline = true; el.preload = 'metadata';
      if (preview) { el.tabIndex = -1; el.setAttribute('aria-hidden', 'true'); }
    } else { el.alt = preview ? '' : item.name; el.loading = preview ? 'lazy' : 'eager'; }
    el.addEventListener('error', () => {
      const message = document.createElement('span'); message.className = 'gft-media-empty';
      message.textContent = 'This file could not be displayed. Try Next for more media.';
      el.replaceWith(message);
    }, { once: true });
    return el;
  }
  function drawPreview(card) {
    clearMedia(card.stage);
    const item = card.items[card.index];
    if (!item) {
      const empty = document.createElement('span'); empty.className = 'gft-media-empty';
      empty.textContent = card.error ? 'Media is temporarily unavailable. Open to retry.' : 'New memories will appear here when uploaded.';
      card.stage.append(empty); return;
    }
    card.stage.append(media(item, true));
    const badge = document.createElement('span'); badge.className = 'gft-media-badge';
    badge.textContent = `${item.collection ? item.collection + ' · ' : ''}${item.type === 'video' ? 'Video' : 'Photo'} · ${card.index + 1} / ${card.items.length}`;
    card.stage.append(badge);
    syncPlayback();
  }
  function syncPlayback() {
    for (const card of cards) {
      const video = card.stage.querySelector('video');
      if (!video) continue;
      if (!document.hidden && !dialog.open && !card.section.paused && card.visible) video.play().catch(() => {});
      else video.pause();
    }
  }
  const observer = new IntersectionObserver(entries => entries.forEach(entry => {
    const card = cards.find(c => c.button === entry.target);
    if (card) card.visible = entry.isIntersecting;
    syncPlayback();
  }));
  async function load(card) {
    try {
      const response = await fetch(`/api/public/media-galleries/${encodeURIComponent(card.key)}`);
      if (!response.ok) throw new Error('Unavailable');
      const result = await response.json();
      card.items = result.items || []; card.error = false; card.index = 0;
    } catch { card.items = []; card.error = true; }
    drawPreview(card);
  }
  function drawViewer() {
    clearMedia(view);
    dialog.querySelector('.gft-media-title').textContent = labels[active.key];
    const item = active.items[active.viewerIndex];
    if (item) view.append(media(item, false));
    else { const empty = document.createElement('p'); empty.textContent = active.error ? 'Unable to load this gallery. Please try again later.' : 'No media has been uploaded yet.'; view.append(empty); }
    dialog.querySelector('.gft-media-details').textContent = item ? [item.collection, item.name].filter(Boolean).join(' · ') : '';
    dialog.querySelector('[data-count]').textContent = item ? `${active.viewerIndex + 1} of ${active.items.length}` : '0 items';
    for (const button of dialog.querySelectorAll('[data-prev],[data-next]')) button.disabled = active.items.length < 2;
  }
  function step(delta) { if (active?.items.length) { active.viewerIndex = (active.viewerIndex + delta + active.items.length) % active.items.length; drawViewer(); } }
  dialog.querySelector('[data-prev]').onclick = () => step(-1);
  dialog.querySelector('[data-next]').onclick = () => step(1);
  dialog.querySelector('[data-close]').onclick = () => dialog.close();
  dialog.addEventListener('close', () => { clearMedia(view); active = null; syncPlayback(); previousFocus?.focus(); });
  dialog.addEventListener('keydown', event => { if (event.target.tagName === 'VIDEO') return; if (event.key === 'ArrowRight') step(1); if (event.key === 'ArrowLeft') step(-1); });
  document.addEventListener('visibilitychange', syncPlayback);
  for (const container of sections) {
    const section = { paused: matchMedia('(prefers-reduced-motion: reduce)').matches };
    const heading = document.createElement('div'); heading.className = 'gft-media-heading';
    const title = document.createElement('h2'); title.textContent = container.dataset.mediaTitle || 'Our family in pictures';
    const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'gft-media-toggle';
    function toggleLabel() { toggle.textContent = section.paused ? 'Play rotation' : 'Pause rotation'; }
    toggle.onclick = () => { section.paused = !section.paused; toggleLabel(); syncPlayback(); }; toggleLabel();
    heading.append(title, toggle);
    const grid = document.createElement('div'); grid.className = 'gft-media-grid'; container.append(heading, grid);
    for (const key of container.dataset.mediaGalleries.split(',')) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'gft-media-card';
      const stage = document.createElement('span'); stage.className = 'gft-media-stage';
      const caption = document.createElement('span'); caption.className = 'gft-media-caption';
      const name = document.createElement('strong'); name.textContent = labels[key];
      const hint = document.createElement('span'); hint.textContent = 'Open gallery · Photos & videos →'; caption.append(name, hint); button.append(stage, caption); grid.append(button);
      const card = { key, button, stage, section, items: [], index: 0, visible: false }; cards.push(card); observer.observe(button);
      button.onclick = async () => { if (card.error) await load(card); previousFocus = button; active = card; active.viewerIndex = card.index; drawViewer(); dialog.showModal(); syncPlayback(); };
      load(card);
    }
  }
  setInterval(() => {
    if (document.hidden || dialog.open) return;
    for (const card of cards) if (!card.section.paused && card.visible && card.items.length > 1) { card.index = (card.index + 1) % card.items.length; drawPreview(card); }
  }, 6000);
})();
