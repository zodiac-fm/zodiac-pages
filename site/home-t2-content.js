/* =====================================================================
   HOME TEMPLATE T2 · CONTENT
   Every word and every photograph on the page lives in this file and
   nowhere else. A copy change, a photo swap or a new section instance
   is one edit HERE — home-t2.html and home-t2-tokens.css never move.

   Photographs are referenced by their permanent P number. Portraits by
   their T number. Both render on the page itself so Michael can review
   by number.

   Instance selection:  home-t2.html      -> A  (the Neutral Ground words)
                        home-t2.html?c=b  -> B  (proof instance)
   ===================================================================== */

/* ---------- shared fragments used by more than one block ---------- */
var W = {
  core:      'assets/d4e/d4e-wave-core.png',
  love:      'assets/d4e/d4e-wave-love.png',
  vitality:  'assets/d4e/d4e-wave-vitality.png',
  abundance: 'assets/d4e/d4e-wave-abundance.png'
};

var MARQUEE = [
  {q:'“Oh there you are, Hilary, I found you.”', n:'Hilary Wilson'},
  {q:'“Simply by listening, I feel tuned into a positive frequency zone.”', n:'Ai Ninomiya'},
  {q:'“It gives me focus and reminds me of who I am.”', n:'Rachel Wayte'},
  {q:'“It’s like a little cheat code for experiencing your authentic vibration.”', n:'David McEwen'},
  {q:'“Every time I use this technology, I am coming home.”', n:'Alex Nazarov'},
  {q:'“This isn’t just sound - it is an energetic recalibration.”', n:'Sabrina Truscott'},
  {q:'“IT IS PRECISION Frequency!!”', n:'Yun Rhee'},
  {q:'“I immediately noticed a difference down to the cellular level.”', n:'Naomi Fox Reina'},
  {q:'“Zodiac.fm works at the frequency level underneath the pattern.”', n:'Summer Phoenix'},
  {q:'“I have never experienced change in self as I have with this experience.”', n:'Paul Tribe'},
  {q:'“Two weeks in, I feel more grounded, present, and aligned …”', n:'Camille L. Miller'},
  {q:'“The cutting-edge tool I didn’t know I needed.”', n:'Anja Žibert'}
];

/* =====================================================================
   INSTANCE A — the home page as its worked example.
   Every word, testimonial, number and section order harvested verbatim
   from site/site-d4-l-neutral-ground-study-01.html
   ===================================================================== */
var ZC_A = {
  title: 'Zodiac.fm · Home Template T2 · Instance A',
  wordmark: 'Zodiac.fm',
  navLinks: [
    {label:'Voices', href:'#voices'},
    {label:'Your frequencies', href:'#frequencies'},
    {label:'The study', href:'#study'}
  ],
  footer: {mark:'Zodiac.fm', line:'© 2026 Zodiac.fm · A music company'},

  blocks: [

  /* ---- 1 · WORLD ONE. The anchor scene: all four wheel colours together. -- */
  {
    t:'world', id:'top', variant:'hero', pop:'quad', order:'words-first',
    prehead:'Experience yourself in sound',
    h:'Music, composed from <em>your birth&nbsp;chart.</em>', level:1,
    frames:[{
      pid:'P-163', h:'hero', focal:'50% 40%', dt:0, db:.45,
      src:'assets/hero-home/hero-home-full-blast.jpg',
      alt:'A smiling listener in large headphones on a sunlit white beach, holding up a phone with her Zodiac playlist playing — the sun merging into the light above her head, four surfboards in violet, emerald, amber, and rose standing in the sand behind her'
    }],
    after:'Your exact birth moment becomes four personal frequencies, embedded inside music for meditation, visualization, work, or a walk on the beach.'
  },

  /* ---- 2 · VOICES ---------------------------------------------------- */
  {
    t:'voices', id:'voices',
    cue:'01 · Voices',
    h:'Neuroscientists, Astrologers, and Human&nbsp;Design Authorities Are <em>Tuning&nbsp;In.</em>',
    waves:true, sep:true,
    rows:[
      {size:'lead', pid:'T-4', src:'assets/d4k/d4k-face-srini.png', alt:'Srini Pillay',
       kick:'Neuroscience',
       lead:'Zodiac.fm helps people access aspects of themselves that have always been there.',
       detail:'Listening to your frequencies bypasses language and creates profound levels of self-awareness and coherence. This leads to clearer decisions, more authentic relationships, and expanded possibilities.',
       who:'Srini Pillay, M.D.', role:'Harvard-trained psychiatrist, brain-imaging researcher'},
      {pid:'T-5', src:'assets/d4k/d4k-face-debra.png', alt:'Debra Silverman',
       kick:'Astrology',
       lead:'This music tickled my soul.',
       detail:'&hellip;Give it a try — you&rsquo;ll love it.',
       who:'Debra Silverman', role:'Astrologer to Sting, Jennifer Aniston, and More'},
      {pid:'T-8', src:'assets/d4k/d4k-face-barbara.png', alt:'Barbara Ditlow',
       kick:'Human Design',
       lead:'Zodiac core frequencies translate this unique imprint into sound, bypassing the mind and speaking directly to the body.',
       who:'Barbara Ditlow', role:'Human Design Mentor, Master Practitioner, Trained/Certified/Endorsed by Ra&nbsp;Uru&nbsp;Hu&nbsp;(Founder of Human&nbsp;Design)'}
    ]
  },

  /* ---- 3 · NUMBERS (the frequency chart) ----------------------------- */
  {
    t:'numbers', id:'frequencies', variant:'freq',
    cue:'02 · Your Unique Frequencies',
    h:'Tune Into <em>You.</em>',
    body:'Every birth moment carries a measurable signature. Zodiac turns yours into four frequencies: who you are, how you relate, your energy, your opportunity. Each becomes a piece of music that exists for exactly one person.',
    rows:[
      {name:'Core',      sub:'Who you are',  band:'core',      wave:W.core,      waveAlt:'The Core frequency wave, violet',     hz:'486'},
      {name:'Love',      sub:'How you relate',band:'love',     wave:W.love,      waveAlt:'The Love frequency wave, rose',       hz:'302'},
      {name:'Vitality',  sub:'Your energy',  band:'vitality',  wave:W.vitality,  waveAlt:'The Vitality frequency wave, amber',  hz:'652'},
      {name:'Abundance', sub:'Opportunity',  band:'abundance', wave:W.abundance, waveAlt:'The Abundance frequency wave, emerald',hz:'813'}
    ],
    note:'*Sample frequencies. Yours come from your birth date, time, and place.'
  },

  /* ---- 4 · STRIP (three photographic steps) -------------------------- */
  {
    t:'strip', id:'how', stagger:true,
    cue:'03 · Three Steps',
    h:'How <em>Zodiac.fm</em> works',
    cells:[
      {pid:'P-155', src:'assets/d4j/d4j-step1.jpg', h:'tall', focal:'50% 50%',
       alt:'A violet desk globe and an open pocket watch on a white windowsill in morning sun',
       kick:'Step one', band:'core',
       h3:'Tell us when and where you were born',
       p:'That exact minute has a signature. No mood forms, no personality quiz — date, time, place.'},
      {pid:'P-156', src:'assets/d4j/d4j-step2.jpg', h:'tall', focal:'50% 50%',
       alt:'Headphones on sunlit white linen, warm amber light glowing in the near earcup',
       kick:'Step two', band:'vitality',
       h3:'Hear your four frequencies',
       p:'Core, Love, Vitality, Abundance — four values that are yours for life, and the music composed around them.'},
      {pid:'P-159', src:'assets/d4k/d4k-step3.jpg', h:'tall', focal:'50% 45%',
       alt:'A woman in headphones singing joyfully into a wooden spoon in a sun-flooded white kitchen, an emerald mug on the counter',
       kick:'Step three', band:'abundance',
       h3:'Live with your music',
       p:'Play it while you work, walk, cook, fall asleep. Nine minutes a day is the practice. There is nothing else to learn.'}
    ]
  },

  /* ---- 5 · WORLD TWO. The walk-and-afternoon passage.
         Two moment scenes, one frequency each.  ------------------------ */
  {
    t:'world', id:'world', order:'words-first',
    cue:'04 · Where It Lives',
    h:'It moves in <em>with you.</em>',
    body:'Not a session to schedule — a soundtrack that follows your day. A violet street on the morning walk. Brass in the afternoon sun. The record on at home. An emerald ball against the summer sky. The world keeps playing your colors back to you.',
    frames:[
      {pid:'P-125', pop:'core', h:'scene', focal:'50% 40%',
       src:'assets/d4e/d4e-tree-h8.jpg',
       alt:'A listener in headphones walking beneath violet jacaranda trees in a silver-white street',
       cap:{wave:W.core, b:'Morning, on the walk.', rest:'Core, in the headphones.'}},
      {pid:'P-126', pop:'vitality', h:'brass', focal:'70% 34%', dt:1, db:1,
       src:'assets/d4e/d4e-trumpet-h8.jpg',
       alt:'A trumpeter playing a brass horn into the afternoon sun on a silver street',
       cap:{wave:W.vitality, b:'Afternoon, out loud.', rest:'Vitality, in the sun.'}}
    ]
  },

  /* ---- 5b · STRIP joined to World two: the two remaining moments ------ */
  {
    t:'strip', id:'world-strip', join:true,
    cells:[
      {pid:'P-106', src:'assets/d4i/d4i-dance.jpg', h:'wide', focal:'50% 32%', band:'love',
       alt:'A woman dancing barefoot in a sunlit white room in a deep rose dress, a record turning on the turntable behind her',
       cap:{wave:W.love, b:'At home, the record on.', rest:'Love, out loud.'}},
      {pid:'P-128', src:'assets/d4e/d4e-ball-h8.jpg', h:'wide', focal:'50% 45%', band:'abundance',
       alt:'Friends leaping for an emerald ball against a bright summer sky',
       cap:{wave:W.abundance, b:'The weekend, mid-air.', rest:'Abundance, everywhere.'}}
    ]
  },

  /* ---- 6 · VOICES (results, part one) -------------------------------- */
  {
    t:'voices', id:'results', waves:true, sep:true,
    cue:'05 · Results',
    h:'Then it shows up in work, energy, and <em>who you&nbsp;are.</em>',
    rows:[
      {size:'lead', pid:'T-11', src:'assets/d4l/d4l-face-jennifer.png', alt:'Jennifer K. Hill',
       kick:'Abundance',
       lead:'Instead of 10 paid members, I got 30 paid members in 30&nbsp;days.',
       detail:'&hellip;It felt like the floodgates of abundance, prosperity, and purpose opened.',
       who:'Jennifer K. Hill', role:'Global Wellness Leader, Founder, OptiMatch'},
      {pid:'T-23', src:'assets/d4k/d4k-face-todd.png', alt:'Todd Shipman',
       kick:'Coming home',
       lead:'My Eeyore mind is gone.',
       detail:'I let life in now. My wife even says I&rsquo;m softer.',
       who:'Todd Shipman', role:'Founder &amp; CEO, Quantum Wellness Leader'},
      {pid:'T-12', src:'assets/d4k/d4k-face-alexk.png', alt:'Alex Kikel',
       kick:'Flow',
       lead:'&hellip;having it on in the background while I work has allowed me to slip into my flow state MUCH easier&hellip;',
       who:'Alex Kikel', role:'Trainer to Olympians and Professional Athletes'},
      {pid:'T-27', src:'assets/d4k/d4k-face-amber.png', alt:'Amber Hedrick',
       kick:'Identity',
       lead:'I&rsquo;m just finishing my first week &hellip; I feel like ME.',
       who:'Amber Hedrick'},
      {pid:'T-10', src:'assets/d4k/d4k-face-leanne.png', alt:'Leanne Ely',
       kick:'Opportunity',
       lead:'I have received multiple unexpected new very lucrative opportunities since I began tuning&nbsp;in.',
       detail:'This has been a total game changer for me.',
       who:'Leanne Ely', role:'Best-Selling Author, Founder, Saving Dinner'}
    ]
  },

  /* ---- 7 · NUMBERS (the study) --------------------------------------- */
  {
    t:'numbers', id:'study', variant:'study', waves:true,
    cue:'06 · The Study',
    h:'We ran the numbers <em>for a&nbsp;year.</em>',
    body:'A 52-week study of our own members: <span class="num">300</span> people started, <span class="num">278</span> completed. The numbers below are from members who used it as designed — at least nine minutes a day on average, across all four frequencies.',
    stats:[
      {v:'98.6', u:'%', label:'of completers said they would recommend Zodiac.'},
      {v:'84',   u:'%', label:'of members who used it as designed for a year called it life-changing.'}
    ],
    chart:{
      title:'What came online for them',
      sub:'share of as-designed members reporting each shift, week 52',
      rows:[
        {label:'Deeper access to themselves', v:'94'},
        {label:'Internal regulation', v:'92'},
        {label:'Sharper instincts', v:'91'},
        {label:'The witness — watching life, not drowning in it', v:'91'},
        {label:'Better relationships and love', v:'90'},
        {label:'Connection to something bigger', v:'90'},
        {label:'Life responds', v:'88'}
      ]
    },
    note:'&ldquo;As designed&rdquo; means at least nine minutes a day on average, with all four frequencies in balance. We report it exactly that way.'
  },

  /* ---- 8 · VOICES (results, part two) + the scroller ------------------ */
  {
    t:'voices', id:'more-results', waves:true, sep:true, marquee:MARQUEE,
    cue:'07 · More Results',
    h:'And it keeps <em>showing up.</em>',
    rows:[
      {pid:'T-16', src:'assets/d4k/d4k-face-tangie.png', alt:'Tangie Nadimi',
       kick:'Nine minutes',
       lead:'I went from ranting and complaining in my pages to writing in a way that felt hopeful &hellip; in only 9&nbsp;minutes.',
       detail:'From day 1 I could feel the difference in my energy.',
       who:'Tangie Nadimi', role:'Founder, Feel Good Human Design'},
      {pid:'T-2', src:'assets/d4k/d4k-face-maya.png', alt:'Maya Shetreat',
       kick:'Ahead of the curve',
       lead:'Zodiac.fm is way ahead of the curve.',
       detail:'Employing vibration and frequency for our well-being is the future.',
       who:'Maya Shetreat, MD', role:'Adult and Pediatric Neurologist, Expert Astrologer, Best-Selling Author'},
      {pid:'T-6', src:'assets/d4k/d4k-face-pedram.png', alt:'Dr. Pedram Shojai',
       kick:'Witnessed',
       lead:'Zodiac.fm is brilliant. &hellip; The transformations I&rsquo;ve witnessed are remarkable.',
       detail:'Highly recommended!',
       who:'Dr. Pedram Shojai', role:'Best-Selling Author, The Urban Monk'},
      {size:'big', pid:'T-1', src:'assets/d4k/d4k-face-rhonda.png', alt:'Rhonda Britten',
       kick:'The invitation',
       lead:'If you&rsquo;re tired of living out of tune with yourself, this is your invitation&nbsp;home.',
       who:'Rhonda Britten', role:'Author of &ldquo;Fearless Living,&rdquo; Emmy Award-Winner'}
    ]
  },

  /* ---- 9 · WORLD THREE. The light falls on the same sand. ------------- */
  {
    t:'world', id:'music', order:'frames-first',
    cue:'08 · The Music',
    h:'Real music, with <em>your frequencies inside.</em>',
    body:'Every track is a full piece of music, not a tone, not a spa loop, with one of your four frequencies running underneath it from the first note to the last. Five minutes between meetings, nine for a real sit, a full hour for deep work or sleep. Press play.',
    proof:'<b>Four tracks from one member&rsquo;s playlist.</b> Real lengths — five minutes to a full hour, one of the four frequencies under every note.',
    frames:[
      {pid:'P-3', pop:'core', h:'dusk', focal:'50% 42%', dusk:'in',
       src:'assets/p-003-violet-hour.jpg',
       alt:'A woman in black headphones before a violet dusk window'}
    ]
  },

  /* ---- 9b · STRIP joined inside the dusk ------------------------------ */
  {
    t:'strip', id:'music-strip', join:true,
    cells:[
      {pid:'P-109', src:'assets/d4h/d4h-rain-sill.jpg', h:'mid', focal:'50% 50%', band:'vitality',
       alt:'A boombox on a windowsill with amber light in the cassette window, rain running down the glass behind it',
       cap:{b:'Vitality, at the window.', rest:'652 Hz through the whole track.'}},
      {pid:'P-110', src:'assets/d4h/d4h-record.jpg', h:'mid', focal:'50% 50%', band:'love',
       alt:'A record with a rose label turning on a turntable in a bright room, the tonearm down',
       cap:{b:'Love, spinning.', rest:'302 Hz under every note.'}}
    ]
  },

  /* ---- 10 · STRIP (the origin) ---------------------------------------- */
  {
    t:'strip', id:'story', aside:true,
    cue:'09 · Where This Came From',
    h:'It started with <em>one question.</em>',
    body:'If the planets reveal who you are, and everything is frequency&hellip; then what would be your unique frequencies? Turns out, the work had been done, we just figured out how to insert them into music so you could experience who you are through sound.',
    cells:[
      {pid:'P-118', src:'assets/d4c/d4c-attic.jpg', h:'wide', focal:'50% 40%',
       alt:'A woman laughing over a spinning record in an attic, her face lit rose by the groove'}
    ]
  },

  /* ---- 11 · CLOSE. The second anchor: all four wheel colours. --------- */
  {
    t:'close', id:'finale', pop:'quad',
    cue:'10 · Come Hear It',
    h:'The symphony has been playing your part all along. <em>Come hear it.</em>',
    body:'Zodiac is a paid membership. Every straight answer about pricing lives at zodiac.fm.',
    cta:{label:'Find your frequencies at zodiac.fm', href:'https://zodiac.fm'},
    frames:[{
      pid:'P-130', h:'close', focal:'center 58%',
      src:'assets/d4e/d4e-umbrellas-h8.jpg',
      srcMobile:'assets/d4e/d4e-umbrellas-port-h8.jpg',
      alt:'Four beach umbrellas — violet, emerald, amber, rose — planted in white sand under full summer sun'
    }]
  }

  ]
};

/* =====================================================================
   INSTANCE B — the ROUND ONE PROOF that the template is a system.
   B is A with three content edits and nothing else. No line of
   home-t2.html or home-t2-tokens.css differs between the two.
     1. a different hero photograph (P-106, the dancer)
     2. + 3. two body paragraphs swapped between sections
              (04 Where It Lives  <->  08 The Music)
   ===================================================================== */
var ZC_B = JSON.parse(JSON.stringify(ZC_A));
ZC_B.title = 'Zodiac.fm · Home Template T2 · Instance B';

(function (b) {
  var byId = function (id) {
    for (var i = 0; i < b.blocks.length; i++) if (b.blocks[i].id === id) return b.blocks[i];
    return null;
  };

  /* EDIT 1 — swap the hero photograph. One object, no template change. */
  byId('top').frames[0] = {
    pid:'P-106', h:'hero', focal:'50% 30%', dt:.5, db:.8,
    src:'assets/d4i/d4i-dance.jpg',
    alt:'A woman dancing barefoot in a sunlit white room in a deep rose dress, a record turning on the turntable behind her'
  };

  /* EDITS 2 + 3 — swap two body paragraphs between two sections. */
  var world = byId('world'), music = byId('music');
  var t = world.body; world.body = music.body; music.body = t;
}(ZC_B));

/* ---------- instance selection ---------- */
window.ZC = (new URLSearchParams(location.search).get('c') || 'a').toLowerCase() === 'b' ? ZC_B : ZC_A;
window.ZC_KEY = (new URLSearchParams(location.search).get('c') || 'a').toLowerCase() === 'b' ? 'B' : 'A';
