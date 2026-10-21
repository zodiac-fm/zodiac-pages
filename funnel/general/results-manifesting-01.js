(() => {
  'use strict';
  const params = new URLSearchParams(window.location.search);
  const channel = document.body.dataset.channel;
  const isAffiliate = channel === 'affiliate';
  const source = params.get('source')?.toLowerCase() === 'google' ? 'Google' : 'Meta';
  const partner = (params.get('affiliate') || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80);
  const sourceText = isAffiliate
    ? (partner ? `Courtesy of ${partner}.` : 'Courtesy of XXXXX.')
    : `Available through ${source}.`;
  const trialText = isAffiliate
    ? 'Enjoy seven days free.'
    : 'Explore the full library for seven days. Just $3.';
  const dialog = document.getElementById('checkout-review');
  const planInputs = [...document.querySelectorAll('input[name="plan"]')];
  let selectedPlan = params.get('plan') === 'monthly' ? 'monthly' : 'yearly';
  let triggeringAction = null;

  function billingText() {
    const price = selectedPlan === 'yearly' ? '$88 is billed yearly' : '$14 is billed monthly';
    const dueNow = isAffiliate ? 'Nothing today' : '$3 today';
    return `${dueNow}. On day 8, ${price}. It renews ${selectedPlan === 'yearly' ? 'yearly' : 'monthly'} until you cancel. Cancel before day 8 to avoid the membership charge.`;
  }

  function syncPlan() {
    planInputs.forEach(input => { input.checked = input.value === selectedPlan; });
    const billing = billingText();
    document.querySelectorAll('[data-source-label]').forEach(node => { node.textContent = sourceText; });
    document.querySelectorAll('.trial-title').forEach(node => { node.textContent = trialText; });
    document.querySelectorAll('[data-billing-summary]').forEach(node => { node.textContent = billing; });
    document.querySelectorAll('[data-review-source]').forEach(node => { node.textContent = sourceText; });
    document.querySelectorAll('[data-review-plan]').forEach(node => {
      node.textContent = selectedPlan === 'yearly'
        ? 'Yearly membership · $88 per year ($7.33 per month).'
        : 'Monthly membership · $14 per month.';
    });
    document.querySelectorAll('[data-review-billing]').forEach(node => { node.textContent = billing; });
  }

  planInputs.forEach(input => input.addEventListener('change', () => {
    selectedPlan = input.checked && input.value === 'monthly' ? 'monthly' : 'yearly';
    syncPlan();
  }));
  syncPlan();

  document.querySelectorAll('[data-checkout]').forEach(action => {
    action.addEventListener('click', event => {
      event.preventDefault();
      triggeringAction = action;
      syncPlan();
      if (dialog && typeof dialog.showModal === 'function') dialog.showModal();
      else document.getElementById('offer')?.scrollIntoView({ behavior: 'auto' });
    });
  });
  document.querySelector('[data-close-dialog]')?.addEventListener('click', () => dialog?.close());
  dialog?.addEventListener('close', () => triggeringAction?.focus());
  dialog?.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
  });

  const iosStore = 'https://apps.apple.com/us/app/zodiacfm/id6764863619';
  const androidStore = 'https://play.google.com/store/apps/details?id=fm.zodiac.app';
  const ua = navigator.userAgent;
  const store = /android/i.test(ua) ? androidStore : /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? iosStore : null;
  const appDialog = document.getElementById('get-the-app');
  let freeTrigger = null;
  document.querySelectorAll('.free-link').forEach(link => {
    if (store) { link.href = store; return; }
    link.addEventListener('click', event => {
      if (!appDialog || typeof appDialog.showModal !== 'function') return;
      event.preventDefault();
      freeTrigger = link;
      appDialog.showModal();
    });
  });
  document.querySelector('[data-close-app]')?.addEventListener('click', () => appDialog?.close());
  appDialog?.addEventListener('close', () => freeTrigger?.focus());
})();
