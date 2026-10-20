(() => {
  'use strict';

  const query = new URLSearchParams(window.location.search);
  const affiliate = query.get('offer') === 'affiliate';
  // This name is a review display field. Checkout attribution uses the existing allowlist.
  const suppliedName = (query.get('affiliate_name') || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80);
  const affiliateName = suppliedName || '[Affiliate name]';
  const offerTitle = affiliate ? `${affiliateName}’s one-time offer` : 'One-time offer';
  const trial = affiliate ? 'FREE 7-day trial' : '7-day trial for $3';
  const trialHeading = affiliate ? 'Try Zodiac Free for 7 Days' : 'Try Zodiac for 7 Days for $3';
  const headerTitle = affiliate ? `Courtesy of ${affiliateName}` : 'One Time Offer';
  const headerTrial = affiliate ? 'Free 7-Day Trial' : '7-Day Trial';

  document.documentElement.dataset.offer = affiliate ? 'affiliate' : 'paid';
  document.querySelectorAll('[data-offer-title]').forEach(element => {
    element.textContent = offerTitle;
  });
  document.querySelectorAll('[data-offer-saving]').forEach(element => {
    element.textContent = '20% off';
  });
  document.querySelectorAll('[data-offer-trial]').forEach(element => {
    element.textContent = trial;
  });
  document.querySelectorAll('[data-trial-heading]').forEach(element => {
    element.textContent = trialHeading;
  });
  document.querySelectorAll('[data-header-saving]').forEach(element => {
    element.textContent = '20% Off';
  });
  document.querySelectorAll('[data-header-title]').forEach(element => {
    element.textContent = headerTitle;
  });
  document.querySelectorAll('[data-header-trial]').forEach(element => {
    element.textContent = headerTrial;
  });
  document.querySelectorAll('[data-affiliate-disclosure]').forEach(element => {
    if (affiliate) {
      element.textContent = `${affiliateName} is a Zodiac affiliate.`;
      element.hidden = false;
    } else {
      element.hidden = true;
    }
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
