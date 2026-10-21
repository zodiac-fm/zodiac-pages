(() => {
  'use strict';

  const query = new URLSearchParams(window.location.search);
  const affiliate = query.get('offer') === 'affiliate';
  const suppliedName = (query.get('affiliate_name') || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 80);
  const affiliateName = suppliedName || '[Affiliate name]';
  const normalizedAffiliateName = affiliateName.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const davidTraffic = affiliate && normalizedAffiliateName === 'david mcewen';

  document.documentElement.dataset.offer = affiliate ? 'affiliate' : 'paid';

  document.querySelectorAll('[data-header-saving], [data-offer-saving]').forEach(element => {
    element.textContent = '20% Off';
  });
  document.querySelectorAll('[data-header-title], [data-offer-title]').forEach(element => {
    element.textContent = affiliate ? `Courtesy of ${affiliateName}` : 'One Time Offer';
  });
  document.querySelectorAll('[data-header-trial], [data-offer-trial]').forEach(element => {
    element.textContent = affiliate ? 'Free 7-Day Trial' : '7-Day Trial';
  });
  document.querySelectorAll('[data-affiliate-disclosure]').forEach(element => {
    if (affiliate) {
      element.textContent = `${affiliateName} is a Zodiac affiliate and may earn a commission if you join through this page.`;
      element.hidden = false;
    } else {
      element.hidden = true;
    }
  });
  document.querySelectorAll('[data-david-method]').forEach(element => {
    element.hidden = !davidTraffic;
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
