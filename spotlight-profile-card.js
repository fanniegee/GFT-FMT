const SpotlightProfileCard = (() => {
  const departmentLabels = new Map([
    ['author', 'Author'],
    ['artist', 'Artist'],
    ['music', 'Music Producer'],
    ['film', 'Film Professional']
  ]);

  function departmentLabel(department) {
    return departmentLabels.get(department) || department || 'Author';
  }

  function safeUrl(value) {
    try {
      const url = new URL(value);
      return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
    } catch {
      return '';
    }
  }

  function createCard({ status, profile_id: profileId, onChangeCover, onPortraitError } = {}) {
    const element = document.createElement('article');
    element.className = 'spotlight-profile-card';
    element.innerHTML = `
      <div class="preview-label">
        <h3><i class="fa-regular fa-eye" aria-hidden="true"></i> <span></span></h3>
        <span class="live-tag"></span>
      </div>
      <div class="cover">
        <button class="cover-action" type="button" hidden><i class="fa-regular fa-image" aria-hidden="true"></i> Preview banner</button>
      </div>
      <div class="profile-body">
        <div class="portrait">
          <span><i class="fa-solid fa-user-astronaut" aria-hidden="true"></i></span>
          <img alt="" hidden>
        </div>
        <div class="profile-name"></div>
        <div class="profile-role"></div>
        <div class="profile-bio"></div>
        <div class="chips"></div>
        <div class="portfolio-head"><span>Featured portfolio</span><span style="color:#0878e8;font-size:10px">FEATURED WORK</span></div>
        <div class="portfolio">
          <div class="work-card"><i class="fa-solid fa-star work-icon" aria-hidden="true"></i><strong></strong></div>
          <div class="work-card"><i class="fa-solid fa-folder-open work-icon" aria-hidden="true"></i><strong>More projects</strong></div>
        </div>
      </div>
      <div class="preview-foot"></div>`;

    const find = selector => element.querySelector(selector);
    const cover = find('.cover');
    const portrait = find('.portrait img');
    const portraitFallback = find('.portrait span');
    const footer = find('.preview-foot');
    const isPreview = Boolean(onChangeCover);

    find('.preview-label h3 span').textContent = isPreview ? 'Public profile preview' : 'Saved profile';
    find('.live-tag').textContent = isPreview ? 'LIVE PREVIEW' : (status || 'draft').toUpperCase();

    if (isPreview) {
      const button = find('.cover-action');
      button.hidden = false;
      button.addEventListener('click', onChangeCover);
      footer.innerHTML = '<i class="fa-solid fa-circle-info" aria-hidden="true"></i> Preview only. Saving stores a private draft; the Founder controls publication.';
    } else if (status === 'draft' && profileId) {
      const edit = document.createElement('a');
      edit.href = 'gft-spotlight-profile-editor.html?profile_id=' + encodeURIComponent(profileId);
      edit.textContent = 'Open / Edit Draft';
      footer.append(edit);
    } else {
      footer.hidden = true;
    }

    portrait.addEventListener('error', () => {
      portrait.hidden = true;
      portraitFallback.hidden = false;
      onPortraitError?.();
    });
    portrait.addEventListener('load', () => {
      if (!portrait.hasAttribute('src')) return;
      portrait.hidden = false;
      portraitFallback.hidden = true;
    });

    function update({ department, displayName, headline, biography, details }) {
      const profileDetails = details || {};
      find('.profile-name').textContent = displayName || 'Your Professional Name';
      find('.profile-role').textContent = departmentLabel(department) + ' · ' + (headline || 'Creative Professional');
      find('.profile-bio').textContent = [biography, profileDetails.location].filter(Boolean).join('\n\n');
      find('.work-card strong').textContent = profileDetails.workTitle || 'Featured Creative Work';

      const distinctions = profileDetails.distinctions;
      const labels = Array.isArray(distinctions) && distinctions.length ? distinctions : ['GFT Spotlight Studio'];
      find('.chips').replaceChildren(...labels.map(label => {
        const chip = document.createElement('span');
        chip.className = 'chip';
        chip.textContent = label;
        return chip;
      }));

      const banner = safeUrl(profileDetails.coverUrl);
      cover.style.backgroundImage = banner
        ? `linear-gradient(90deg,rgba(5,16,34,.75),rgba(6,24,48,.25)),url("${banner}")`
        : '';

      const portraitUrl = safeUrl(profileDetails.portraitUrl);
      if ((portrait.getAttribute('src') || '') === portraitUrl) return;
      portrait.hidden = true;
      portraitFallback.hidden = false;
      if (portraitUrl) portrait.src = portraitUrl;
      else portrait.removeAttribute('src');
    }

    return { element, update };
  }

  return { createCard, departmentLabel, safeUrl };
})();

