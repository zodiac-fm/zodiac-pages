(function () {
  var page = document.body.dataset.page; // "paid" ($3 week) or "free" (free week)
  var params = new URLSearchParams(location.search);
  var state = {
    coupon: params.get('coupon') !== 'off',
    source: params.get('source') === 'google' ? 'google' : 'meta',
    affiliate: params.get('affiliate') || 'David McEwen',
    plan: params.get('plan') === 'monthly' ? 'monthly' : 'yearly'
  };

  var PRICES = {
    list: { yearly: { amount: 109, unit: '/year', note: '$9.08 per month, billed yearly' },
            monthly: { amount: 17, unit: '/month', note: '$17 billed monthly' } },
    coupon: { yearly: { amount: 88, unit: '/year', note: '$7.33 per month, billed yearly' },
              monthly: { amount: 14, unit: '/month', note: '$14 billed monthly' } }
  };
  var SAVING = { yearly: 'Save $21 a year', monthly: 'Save $3 a month' };
  var CODES = { meta: 'FACEBOOK20', google: 'GOOGLE20' };
  var today = page === 'paid' ? 3 : 0;

  var day8 = new Date();
  day8.setDate(day8.getDate() + 7);
  var shortDate = day8.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  var longDate = day8.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  function $(sel) { return document.querySelector(sel); }
  function all(sel) { return document.querySelectorAll(sel); }
  function set(name, text) { all('[data-bind="' + name + '"]').forEach(function (el) { el.textContent = text; }); }

  function render() {
    var table = state.coupon ? PRICES.coupon : PRICES.list;
    var chosen = table[state.plan];
    var period = state.plan === 'yearly' ? 'yearly' : 'monthly';
    var renews = '$' + chosen.amount + ' billed ' + period;

    ['yearly', 'monthly'].forEach(function (plan) {
      var p = table[plan];
      set(plan + '-amount', '$' + p.amount);
      set(plan + '-unit', p.unit);
      set(plan + '-note', p.note);
      set(plan + '-list', '$' + PRICES.list[plan].amount + PRICES.list[plan].unit);
      all('[data-show="' + plan + '-list"]').forEach(function (el) { el.hidden = !state.coupon; });
    });

    $('[data-show="code"]').hidden = !state.coupon;
    var source = $('[data-show="source"]');
    if (source) {
      source.hidden = !state.coupon;
      set('affiliate', state.affiliate);
    }
    set('code-name', page === 'paid' ? CODES[state.source] : 'MCEWEN');
    set('code-saving', SAVING[state.plan]);

    set('today', '$' + today);
    set('day8-short', shortDate);
    set('renews', renews);
    set('agree-today', today ? '$3 is charged today' : 'nothing is charged today');
    set('agree-renews', '$' + chosen.amount + ' is billed on ' + longDate + ' and then ' + period);
    set('faq-today', today ? 'You pay $3 today for seven days of the full library.' : 'Nothing is charged today. The full library is yours for seven days.');
    set('faq-renews', 'On day 8, ' + longDate + ', your membership starts at $' + chosen.amount + (state.plan === 'yearly' ? ' a year. It renews yearly' : ' a month. It renews monthly') + ' until you cancel.');

    all('.review-bar [data-coupon]').forEach(function (b) { b.setAttribute('aria-pressed', String((b.dataset.coupon === 'on') === state.coupon)); });
    all('.review-bar [data-source]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.source === state.source)); });
    var sourceGroup = $('.review-bar [data-group="source"]');
    if (sourceGroup) sourceGroup.hidden = !state.coupon;
  }

  all('input[name="plan"]').forEach(function (input) {
    input.checked = input.value === state.plan;
    input.addEventListener('change', function () { state.plan = input.value; render(); });
  });
  all('.review-bar [data-coupon]').forEach(function (b) {
    b.addEventListener('click', function () { state.coupon = b.dataset.coupon === 'on'; render(); });
  });
  all('.review-bar [data-source]').forEach(function (b) {
    b.addEventListener('click', function () { state.source = b.dataset.source; render(); });
  });
  render();
})();
