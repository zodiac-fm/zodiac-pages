(() => {
  'use strict';

  const query = new URLSearchParams(window.location.search);
  // This is a channel preview. Checkout offers are resolved by the existing funnel.
  const affiliate = query.get('offer') === 'affiliate';
  const offerTitle = affiliate ? 'Your affiliate discount' : 'Meta one-time offer discount';
  const offerDetail = affiliate ? 'A special offer through your referral.' : 'A special offer for you.';

  document.documentElement.dataset.offer = affiliate ? 'affiliate' : 'paid';
  document.querySelectorAll('[data-offer-title]').forEach(element => {
    element.textContent = offerTitle;
  });
  document.querySelectorAll('[data-offer-detail]').forEach(element => {
    element.textContent = offerDetail;
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
