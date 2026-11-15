(() => {
  const room = document.getElementById('spotlight-workroom');
  const tabs = [...document.querySelectorAll('button[data-department]')];
  const heading = room.querySelector('h3');
  const notice = room.querySelector('[role="status"]');
  const search = room.querySelector('form');
  const mine = room.querySelector('[data-my-listings]');
  const directory = room.querySelector('[data-creators]');
  const inbox = room.querySelector('[data-collaborations]');
  const labels = { author: 'Authors', artist: 'Artists', music: 'Music Producers', film: 'Film Professionals' };
  const types = ['Project partnership', 'Paid commission', 'Feedback exchange', 'Mentoring', 'Event or production', 'Other'];
  let active;
  let resultsVersion = 0;

  function node(tag, value, className) {
    const element = document.createElement(tag);
    if (value) element.textContent = value;
    if (className) element.className = className;
    return element;
  }

  function button(label, handler) {
    const element = node('button', label, 'room-button');
    element.type = 'button';
    element.addEventListener('click', handler);
    return element;
  }

  function showError(error, tab) {
    if (active === tab) notice.textContent = error.message;
  }

  async function request(tab, endpoint, method = 'GET', body) {
    const response = await fetch('/api/spotlight/workrooms/' + tab.dataset.department + endpoint, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'The workroom is unavailable. Try again.');
    return result;
  }

  function bindSubmit(form, action) {
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const submit = form.querySelector('[type="submit"]');
      if (submit.disabled) return;
      const tab = active;
      submit.disabled = true;
      notice.textContent = '';
      try {
        await action(Object.fromEntries(new FormData(form)));
      } catch (error) {
        showError(error, tab);
      } finally {
        submit.disabled = false;
      }
    });
  }

  function field(form, label, input, name) {
    const wrapper = node('label', label);
    input.name = name;
    input.required = true;
    wrapper.append(input);
    form.append(wrapper);
  }

  function select(options) {
    const input = document.createElement('select');
    for (const [value, label] of options) input.append(new Option(label, value));
    return input;
  }

  function submit(form, label) {
    const control = node('button', label, 'room-button room-primary');
    control.type = 'submit';
    form.append(control);
  }

  function creatorCard(tab, profile, senders) {
    const card = node('details', '', 'room-creator');
    const summary = node('summary', '');
    const details = profile.details || {};
    const portraitUrl = SpotlightProfileCard.safeUrl(details.portraitUrl);
    if (portraitUrl) {
      const portrait = node('img', '');
      portrait.alt = '';
      portrait.loading = 'lazy';
      portrait.referrerPolicy = 'no-referrer';
      portrait.addEventListener('error', () => portrait.remove());
      portrait.src = portraitUrl;
      summary.append(portrait);
    }
    const name = node('span', '');
    name.append(node('strong', profile.display_name), node('small', profile.headline || 'Spotlight creator'));
    summary.append(name);
    const biography = node('p', profile.biography || 'This creator has not added a bio yet.', 'room-prose');
    card.append(summary, biography);

    if (details.location) card.append(node('p', details.location));
    if (Array.isArray(details.distinctions) && details.distinctions.length) {
      const tags = node('div', '', 'room-tags');
      tags.append(...details.distinctions.map(tag => node('span', tag)));
      card.append(tags);
    }
    if (details.workTitle) card.append(node('h5', details.workTitle));
    if (details.workDescription) card.append(node('p', details.workDescription, 'room-prose'));
    const website = SpotlightProfileCard.safeUrl(details.website);
    if (website) {
      const link = node('a', 'Portfolio website', 'text-link');
      link.href = website;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      card.append(link);
    }

    if (!senders.length) {
      card.append(node('p', 'List one of your profiles in this workroom to send a proposal.'));
      return card;
    }

    const proposal = node('details', '', 'room-proposal');
    proposal.append(node('summary', 'Propose a collaboration'));
    const form = node('form', '', 'room-form');
    field(form, 'Send as', select(senders.map(sender => [sender.profile_id, sender.display_name])), 'senderProfile');
    field(form, 'Type', select(types.map(type => [type, type])), 'kind');
    const subject = node('input', '');
    subject.maxLength = 120;
    field(form, 'Subject', subject, 'subject');
    const message = node('textarea', '');
    message.maxLength = 2000;
    field(form, 'Proposal', message, 'proposal');
    submit(form, 'Send private proposal');
    bindSubmit(form, async values => {
      await request(tab, '/collaborations', 'POST', { ...values, recipientProfile: profile.profile_id });
      form.reset();
      proposal.open = false;
      if (active === tab) {
        notice.textContent = 'Proposal sent.';
        await loadInbox(tab);
      }
    });
    proposal.append(form);
    card.append(proposal);
    return card;
  }

  async function loadDirectory(tab) {
    const version = ++resultsVersion;
    const form = new FormData(search);
    const data = await request(tab, '/creators?q=' + encodeURIComponent(form.get('q').trim()));
    if (active !== tab || resultsVersion !== version) return;
    const own = data.profiles.filter(profile => profile.is_mine);
    const peers = data.profiles.filter(profile => !profile.is_mine);
    mine.replaceChildren();
    directory.replaceChildren();
    for (const profile of own) {
      const row = node('div', '', 'room-listing');
      row.append(node('span', profile.display_name + (profile.listed ? ' · Listed' : ' · Private')));
      if (!profile.listed) row.append(makeListingPreview(tab, profile));
      if (profile.can_change_listing) {
        row.append(button(profile.listed ? 'Remove listing' : 'List for members', async event => {
          const control = event.currentTarget;
          control.disabled = true;
          notice.textContent = '';
          try {
            await request(tab, '/creators/' + encodeURIComponent(profile.profile_id) + '/visibility', 'PATCH', { listed: !profile.listed });
            if (active === tab) {
              notice.textContent = profile.listed ? 'Listing removed.' : 'Profile listed for Spotlight members.';
              await loadDirectory(tab);
            }
          } catch (error) {
            showError(error, tab);
          } finally {
            control.disabled = false;
          }
        }));
      }
      mine.append(row);
    }
    if (!own.length) {
      const create = node('a', 'Create a profile for this department', 'text-link');
      create.href = 'gft-spotlight-profile-editor.html?new=1&department=' + tab.dataset.department;
      mine.append(create);
    }
    if (!peers.length) directory.append(node('p', form.get('q').trim() ? 'No creators match your search.' : 'No other creators are listed in this workroom yet.'));
    if (data.limited) directory.append(node('p', 'Showing the first matches. Search by name, speciality, or location to narrow the results.'));
    directory.append(...peers.map(profile => creatorCard(tab, profile, own.filter(entry => entry.listed))));
  }

  function makeListingPreview(tab, profile) {
    const card = creatorCard(tab, profile, []);
    card.querySelector('summary').textContent = 'Preview member listing';
    card.lastElementChild.remove();
    return card;
  }

  async function loadThread(tab, endpoint, list) {
    const result = await request(tab, endpoint + '/messages');
    const messages = result.messages.map(message => {
      const item = node('li', '', message.mine ? 'mine' : '');
      item.append(node('strong', message.mine ? 'You' : 'Collaborator'), node('p', message.body, 'room-prose'));
      return item;
    });
    list.replaceChildren(...messages);
    return result.status;
  }

  function collaborationCard(tab, item) {
    const endpoint = '/collaborations/' + encodeURIComponent(item.collaboration_id);
    const element = node('details', '', 'room-thread');
    const summary = node('summary', item.subject);
    summary.append(node('small', item.kind + ' · ' + item.status));
    const peer = item.outgoing ? item.recipient_name : item.sender_name;
    element.append(summary, node('p', (item.outgoing ? 'To ' : 'From ') + peer), node('p', item.proposal, 'room-prose'));
    const actions = node('div', '', 'room-actions');
    const options = item.status === 'pending'
      ? item.outgoing ? [['Withdraw', 'withdrawn']] : [['Accept', 'accepted'], ['Decline', 'declined']]
      : item.status === 'accepted' ? [['Close collaboration', 'closed']] : [];
    for (const [label, action] of options) {
      actions.append(button(label, async () => {
        for (const control of actions.children) control.disabled = true;
        notice.textContent = '';
        try {
          await request(tab, endpoint, 'PATCH', { action });
          if (active === tab) {
            notice.textContent = 'Collaboration ' + action + '.';
            await loadInbox(tab, item.collaboration_id);
          }
        } catch (error) {
          showError(error, tab);
        } finally {
          for (const control of actions.children) control.disabled = false;
        }
      }));
    }
    element.append(actions);

    if (['accepted', 'closed'].includes(item.status)) {
      const messages = node('ol', '', 'room-messages');
      messages.setAttribute('aria-label', 'Latest 100 messages');
      const form = node('form', '', 'room-form');
      const input = node('textarea', '');
      input.maxLength = 2000;
      field(form, 'Private message', input, 'body');
      submit(form, 'Send message');
      form.hidden = item.status !== 'accepted';
      bindSubmit(form, async values => {
        await request(tab, endpoint + '/messages', 'POST', values);
        form.reset();
        if (active === tab) await refresh();
      });
      async function refresh() {
        const status = await loadThread(tab, endpoint, messages);
        form.hidden = status !== 'accepted';
      }
      element.addEventListener('toggle', () => {
        if (element.open) refresh().catch(error => showError(error, tab));
      });
      element.append(button('Refresh messages', () => refresh().catch(error => showError(error, tab))), messages, form);
    }
    return element;
  }

  async function loadInbox(tab, openId) {
    const { collaborations } = await request(tab, '/collaborations');
    if (active !== tab) return;
    inbox.replaceChildren(...collaborations.map(item => {
      const card = collaborationCard(tab, item);
      card.open = item.collaboration_id === openId;
      return card;
    }));
    if (!collaborations.length) inbox.append(node('p', 'Your sent and received proposals will appear here.'));
  }

  function close() {
    if (!active) return;
    active.setAttribute('aria-expanded', 'false');
    active.focus();
    active = undefined;
    room.hidden = true;
  }

  for (const tab of tabs) {
    tab.addEventListener('click', () => {
      if (active === tab) return close();
      active?.setAttribute('aria-expanded', 'false');
      active = tab;
      tab.setAttribute('aria-expanded', 'true');
      room.hidden = false;
      heading.textContent = labels[tab.dataset.department] + ' Workroom';
      heading.focus();
      search.reset();
      mine.replaceChildren();
      directory.replaceChildren();
      inbox.replaceChildren();
      notice.textContent = 'Loading workroom…';
      Promise.all([loadDirectory(tab), loadInbox(tab)]).then(() => {
        if (active === tab) notice.textContent = '';
      }).catch(error => showError(error, tab));
    });
  }
  room.querySelector('[data-close-room]').addEventListener('click', close);
  room.querySelector('[data-refresh-inbox]').addEventListener('click', () => {
    const tab = active;
    notice.textContent = '';
    loadInbox(tab).catch(error => showError(error, tab));
  });
  bindSubmit(search, () => loadDirectory(active));
})();
