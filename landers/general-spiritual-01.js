(() => {
  'use strict';

  const query = new URLSearchParams(window.location.search);
  // This switch previews the two approved page offers. It does not select
  // a checkout price. The existing funnel resolves offers from campaign data.
  const affiliate = query.get('offer') === 'affiliate';
  const offerTitle = affiliate ? '7 days free' : '7 days for $3';
  const offerDetail = '$88 a year or $14 a month after your trial.';

  document.documentElement.dataset.offer = affiliate ? 'affiliate' : 'paid';
  document.querySelectorAll('[data-offer-title]').forEach(element => {
    element.textContent = offerTitle;
  });
  document.querySelectorAll('[data-offer-detail]').forEach(element => {
    element.textContent = offerDetail;
  });

  // Preserve only acquisition fields consumed by the existing funnel.
  // Personal information and this page's visual-preview switch stay here.
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
