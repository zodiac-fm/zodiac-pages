(() => {
  'use strict';

  const query = new URLSearchParams(window.location.search);
  const suppliedName = (query.get('affiliate_name') || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 80);
  const affiliateName = suppliedName || 'XXXXXX';

  document.documentElement.dataset.offer = 'affiliate';
  document.querySelectorAll('[data-header-saving], [data-offer-saving]').forEach(element => {
    element.textContent = '20% Off';
  });
  document.querySelectorAll('[data-header-title], [data-offer-title]').forEach(element => {
    element.textContent = `Courtesy of ${affiliateName}`;
  });
  document.querySelectorAll('[data-header-trial], [data-offer-trial]').forEach(element => {
    element.textContent = 'Free 7-Day Trial';
  });
  document.querySelectorAll('[data-trial-heading]').forEach(element => {
    element.textContent = 'Try Zodiac Free for 7 Days';
  });
  document.querySelectorAll('[data-affiliate-disclosure]').forEach(element => {
    element.textContent = `${affiliateName} is a Zodiac affiliate and may earn a commission if you join through this page.`;
    element.hidden = false;
  });

  const acquisitionFields = [
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
    'gclid', 'gbraid', 'wbraid', 'fbclid', 'ttclid', 'msclkid', 'twclid',
    'li_fat_id', 'infclid', 'coupon', 'oid', 'aid', 'sub1', 'sub2', 'sub3',
    'sub4', 'sub5', 'uid', 'source_id', 'creative_id'
  ];
  const destination = new URL('https://staging.zodiac.fm/begin');
  acquisitionFields.forEach(key => {
    const value = query.get(key);
    if (value && value.trim()) destination.searchParams.set(key, value);
  });
  document.querySelectorAll('a[data-begin]').forEach(link => {
    link.href = destination.href;
  });
})();
