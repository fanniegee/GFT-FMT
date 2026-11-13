/*
 * GUVAZA GERIATRIC CLINIC — SHARED FOOTER
 * Used by patient-portal.html and clinic-staff.html.
 *
 * Later integration:
 * Founder and GGC Super Admin editors will update these
 * settings through the authenticated server and database.
 */

(() => {
  'use strict';

  const DEFAULT_SETTINGS = {
    clinicName: 'Guvaza Geriatric Clinic',
    tagline: 'Integrated Health & Geriatric Care',
    description:
      'Providing compassionate, respectful and professional healthcare and geriatric support.',
    phone: '',
    whatsapp: '',
    email: '',
    address: '',
    copyright: 'All rights reserved.',
    links: [
      { label: 'Clinic Home', url: 'clinic.html' },
      { label: 'Patient Portal', url: 'patient-portal.html' },
      { label: 'Staff Portal', url: 'clinic-staff.html' },
      { label: 'Patient Registration', url: 'clinic-registration.html' }
    ],
    socialLinks: []
  };

  // Administration pages can supply saved settings here later.
  const supplied = window.GGC_FOOTER_CONFIG || {};

  const settings = {
    ...DEFAULT_SETTINGS,
    ...supplied,
    links: Array.isArray(supplied.links)
      ? supplied.links
      : DEFAULT_SETTINGS.links,
    socialLinks: Array.isArray(supplied.socialLinks)
      ? supplied.socialLinks
      : DEFAULT_SETTINGS.socialLinks
  };

  // Avoid inserting the footer twice.
  if (document.getElementById('ggc-shared-footer')) return;

  const style = document.createElement('style');
  style.id = 'ggc-shared-footer-styles';
  style.textContent = `
    #ggc-shared-footer {
      --ggc-navy: #0B2942;
      --ggc-blue: #123B5D;
      --ggc-green: #3F8F63;
      --ggc-text: #DCE8EF;
      background: var(--ggc-navy);
      color: var(--ggc-text);
      font-family: Montserrat, Arial, sans-serif;
      margin-top: 48px;
      border-top: 4px solid var(--ggc-green);
    }

    #ggc-shared-footer * {
      box-sizing: border-box;
    }

    #ggc-shared-footer a {
      color: #E5F3E9;
      text-decoration: none;
      overflow-wrap: anywhere;
    }

    #ggc-shared-footer a:hover,
    #ggc-shared-footer a:focus-visible {
      color: #91D5A9;
      text-decoration: underline;
    }

    #ggc-shared-footer .ggc-footer-inner {
      width: min(1180px, 100%);
      margin: 0 auto;
      padding: 38px 22px 20px;
    }

    #ggc-shared-footer .ggc-footer-grid {
      display: grid;
      grid-template-columns: 1.4fr 1fr 1fr;
      gap: 34px;
    }

    #ggc-shared-footer .ggc-footer-brand {
      color: #FFFFFF;
      font-size: 19px;
      font-weight: 800;
      line-height: 1.4;
      margin: 0 0 5px;
    }

    #ggc-shared-footer .ggc-footer-tagline {
      color: #91D5A9;
      font-size: 12px;
      font-weight: 700;
      margin: 0 0 13px;
    }

    #ggc-shared-footer .ggc-footer-description {
      color: #C6D7E1;
      font-size: 13px;
      line-height: 1.8;
      margin: 0;
      max-width: 390px;
    }

    #ggc-shared-footer h3 {
      color: #FFFFFF;
      font-size: 13px;
      margin: 2px 0 15px;
      letter-spacing: .4px;
    }

    #ggc-shared-footer .ggc-footer-list {
      display: grid;
      gap: 11px;
      font-size: 12px;
      line-height: 1.6;
    }

    #ggc-shared-footer .ggc-footer-bottom {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 12px;
      border-top: 1px solid #FFFFFF24;
      margin-top: 30px;
      padding-top: 17px;
      font-size: 11px;
      color: #B8CAD5;
    }

    #ggc-shared-footer .ggc-footer-socials {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    #ggc-shared-footer .ggc-footer-socials a {
      display: inline-flex;
      border: 1px solid #FFFFFF38;
      border-radius: 20px;
      padding: 6px 11px;
      font-size: 11px;
    }

    #ggc-shared-footer .ggc-footer-empty {
      color: #B8CAD5;
      font-size: 12px;
      line-height: 1.7;
    }

    @media (max-width: 700px) {
      #ggc-shared-footer .ggc-footer-inner {
        padding: 30px 18px 18px;
      }

      #ggc-shared-footer .ggc-footer-grid {
        grid-template-columns: 1fr;
        gap: 25px;
      }

      #ggc-shared-footer .ggc-footer-bottom {
        align-items: flex-start;
        flex-direction: column;
      }
    }
  `;
  document.head.appendChild(style);

  const footer = document.createElement('footer');
  footer.id = 'ggc-shared-footer';

  const inner = document.createElement('div');
  inner.className = 'ggc-footer-inner';

  const grid = document.createElement('div');
  grid.className = 'ggc-footer-grid';

  // Column 1: Clinic identity and mission.
  const brand = document.createElement('section');

  const brandName = document.createElement('p');
  brandName.className = 'ggc-footer-brand';
  brandName.textContent = settings.clinicName;

  const tagline = document.createElement('p');
  tagline.className = 'ggc-footer-tagline';
  tagline.textContent = settings.tagline;

  const description = document.createElement('p');
  description.className = 'ggc-footer-description';
  description.textContent = settings.description;

  brand.append(brandName, tagline, description);

  // Column 2: Contact details.
  const contact = document.createElement('section');
  const contactTitle = document.createElement('h3');
  contactTitle.textContent = 'CONTACT THE CLINIC';

  const contactList = document.createElement('div');
  contactList.className = 'ggc-footer-list';

  function addContact(label, value, href) {
    if (!value || !String(value).trim()) return;

    const link = document.createElement('a');
    link.textContent = `${label}: ${String(value).trim()}`;
    link.href = href;
    contactList.appendChild(link);
  }

  addContact('Call', settings.phone,
    `tel:${String(settings.phone).replace(/[^\d+]/g, '')}`);

  addContact('WhatsApp', settings.whatsapp,
    `https://wa.me/${String(settings.whatsapp).replace(/\D/g, '')}`);

  addContact('Email', settings.email,
    `mailto:${String(settings.email).trim()}`);

  if (settings.address && String(settings.address).trim()) {
    const address = document.createElement('p');
    address.className = 'ggc-footer-description';
    address.textContent = `Address: ${String(settings.address).trim()}`;
    contactList.appendChild(address);
  }

  if (!contactList.childElementCount) {
    const empty = document.createElement('p');
    empty.className = 'ggc-footer-empty';
    empty.textContent =
      'Official clinic contact details will appear here when configured.';
    contactList.appendChild(empty);
  }

  contact.append(contactTitle, contactList);

  // Column 3: Portal links and social platforms.
  const resources = document.createElement('section');
  const linksTitle = document.createElement('h3');
  linksTitle.textContent = 'QUICK LINKS';

  const linksList = document.createElement('div');
  linksList.className = 'ggc-footer-list';

  function safeWebUrl(value) {
    try {
      const url = new URL(value, window.location.href);
      if (!['http:', 'https:'].includes(url.protocol)) return null;
      return url.href;
    } catch (_) {
      return null;
    }
  }

  settings.links.forEach(item => {
    if (!item || !item.label || !item.url) return;
    const href = safeWebUrl(item.url);
    if (!href) return;

    const link = document.createElement('a');
    link.textContent = item.label;
    link.href = href;
    linksList.appendChild(link);
  });

  const socialTitle = document.createElement('h3');
  socialTitle.textContent = 'FOLLOW THE CLINIC';
  socialTitle.style.marginTop = '22px';

  const socials = document.createElement('div');
  socials.className = 'ggc-footer-socials';

  settings.socialLinks.forEach(item => {
    if (!item || !item.platform || !item.url) return;
    const href = safeWebUrl(item.url);
    if (!href) return;

    const link = document.createElement('a');
    link.textContent = item.platform;
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.setAttribute('aria-label', item.platform);
    socials.appendChild(link);
  });

  resources.append(linksTitle, linksList);

  if (socials.childElementCount) {
    resources.append(socialTitle, socials);
  }

  grid.append(brand, contact, resources);

  // Bottom copyright.
  const bottom = document.createElement('div');
  bottom.className = 'ggc-footer-bottom';

  const copyright = document.createElement('span');
  copyright.textContent =
    `© ${new Date().getFullYear()} ${settings.clinicName}. ${settings.copyright}`;

  const privacy = document.createElement('span');
  privacy.textContent = 'Please protect your personal and medical information.';

  bottom.append(copyright, privacy);
  inner.append(grid, bottom);
  footer.appendChild(inner);

  // Append after the page content without changing portal authentication.
  document.body.appendChild(footer);
})();