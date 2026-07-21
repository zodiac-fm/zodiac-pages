(() => {
  const direction = document.body.dataset.direction;
  const results = [
    { name: "Core", meaning: "Identity and purpose", band: "Root Band · 250 to 425 Hz", value: "422", point: "24.6%" },
    { name: "Love", meaning: "Connection and relationships", band: "Solar Plexus Band · 425 to 600 Hz", value: "432", point: "26%" },
    { name: "Vitality", meaning: "Energy and momentum", band: "Solar Plexus Band · 425 to 600 Hz", value: "579", point: "47%" },
    { name: "Abundance", meaning: "Exchange and opportunity", band: "Throat Band · 600 to 775 Hz", value: "611", point: "51.6%" }
  ];

  const resultRows = (instrument = false) => results.map(item => `
    <article class="result">
      <div><div class="result-name">${item.name}</div><div class="result-meaning">${item.meaning}</div></div>
      ${instrument ? `<div class="track" style="--point:${item.point}" aria-label="${item.value} hertz on the 250 to 950 hertz spectrum"></div>` : ""}
      <div class="result-value">${item.value} <small>Hz</small></div>
      <span class="result-band">${item.band}</span>
    </article>`).join("");

  const top = `
    <header class="topbar">
      <img class="logo" src="../../inapp/app-assets/logo-black.svg" width="150" height="40" alt="Zodiac.fm">
      <div class="coupon">David's 20% coupon<strong>Applied automatically</strong></div>
    </header>`;

  const proof = `
    <section class="section proof-section">
      <div class="shell">
        <figure class="portrait-proof">
          <img src="../../landers/reveal-assets/img-images_testimonials_david-mcewen-d2c.png" width="500" height="500" alt="David McEwen">
          <figcaption>
            <blockquote>“It's like a little cheat code for experiencing your authentic vibration. Because it's personalized to you, not generic. I use it every day. This one earned it.”</blockquote>
            <cite><strong>David McEwen</strong>Transformation Thought Leader · Over 12 Million YouTube Views</cite>
          </figcaption>
        </figure>
      </div>
    </section>`;

  const final = `
    <section class="final">
      <div class="shell">
        <h2>Now hear what your profile sounds like.</h2>
        <p>Your values run continuously through cinematic, lyric-free music.</p>
        <a class="button" href="/funnel/mcewen-edit/04-join">Hear My Frequencies →</a>
      </div>
    </section>
    <footer class="foot">© 2026 Zodiac.fm · Privacy · Terms</footer>`;

  const pages = {
    a: `${top}<main>
      <section class="hero"><div class="shell">
        <div class="eyebrow">A · Editorial profile</div>
        <h1>Michael, your Personal Frequency Profile is ready.</h1>
        <p class="lede">Your exact birth moment resolved into four personal frequencies. This direction treats the result like a private, beautifully typeset report.</p>
        <div class="profile-sheet">
          <div class="profile-head"><strong>Personal Frequency Profile</strong><span>From your exact birth moment</span></div>
          <div class="profile-grid">${resultRows()}</div>
        </div>
      </div></section>
      <section class="section"><div class="shell editorial-note"><h2>What the profile is showing you.</h2><p><strong>Your frequency is what your signal is.</strong> Your band is how you naturally process that part of your life. The editorial structure makes the exact profile the hero, then explains it with long-form calm.</p></div></section>
      ${proof}${final}</main>`,
    b: `${top}<main>
      <section class="hero"><div class="shell">
        <div class="eyebrow">B · Frequency instrument</div>
        <h1>See where your signal lands.</h1>
        <p class="lede">This direction turns the four results into one visual instrument, so the relationship between each value and the full spectrum is immediately visible.</p>
        <div class="instrument">
          <div class="instrument-scale"><span>250 Hz</span><strong>YOUR PERSONAL SPECTRUM</strong><span>950 Hz</span></div>
          <div class="profile-grid">${resultRows(true)}</div>
          <div class="signal-explain"><div><strong>Root</strong><small>grounding</small></div><div><strong>Solar Plexus</strong><small>motion</small></div><div><strong>Throat</strong><small>words</small></div><div><strong>Crown</strong><small>perspective</small></div></div>
        </div>
      </div></section>
      <section class="section"><div class="shell"><div class="eyebrow">How to read it</div><h2>The spectrum is continuous, not a ladder.</h2><p class="lede">Everyone uses all four bands. Your placements simply show where each part of your profile naturally begins.</p></div></section>
      ${proof}${final}</main>`,
    c: `${top}<main>
      <section class="hero"><div class="shell">
        <div class="hero-copy"><div class="eyebrow">C · Guided reading</div><h1>Your way back to your own signal.</h1><p class="lede">This direction leads with meaning and recognition, then reveals the exact four values as the supporting evidence.</p></div>
        <div class="reading-card"><p>Your profile begins with <strong>grounding in Core</strong>, moves through <strong>motion in Love and Vitality</strong>, and finds exchange through <strong>words in Abundance.</strong></p><span class="result-band">A plain-language reading of your exact placements</span></div>
      </div></section>
      <section class="section profile-section"><div class="shell"><div class="eyebrow">Your exact values</div><h2>The four placements behind your reading.</h2><div class="profile-grid">${resultRows()}</div></div></section>
      ${proof}${final}</main>`
  };

  document.querySelector(".page").innerHTML = pages[direction] || pages.a;
})();
