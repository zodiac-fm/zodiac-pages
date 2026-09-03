/* =====================================================================
   HOME TEMPLATE T6 · CONTENT
   Every word and every photograph on the page lives in this file and
   nowhere else. A copy change, a photo swap or a new section instance is
   one edit HERE — home-t6.html and home-t6-tokens.css never move.

   ROUND 6. Not one word of copy changes from home-t5-content.js. What
   changes is which photographs are on the page, which section each one
   sits in, and that every one of them now follows its heading and
   carries its caption ON THE GROUND.

   Photographs are referenced by their permanent P number. Portraits by
   their T number. Both render on the page itself so Michael can review
   by number.

   Instance selection:  home-t6.html      -> A
                        home-t6.html?c=b  -> B  (proof instance)
   ===================================================================== */

var T4 = 'assets/home-t4/';
var T5 = 'assets/home-t5/';
var T6 = 'assets/home-t6/';

/* the four frequency waveforms, in their wheel colours */
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

/* the one accent element on the page: the existing ask. It lives at the
   close only — in the opening it sat on her head, so the hero carries the
   eyebrow, the headline and the lede and nothing else. */
var ASK = {label:'Find your frequencies at zodiac.fm', href:'https://zodiac.fm'};

/* THE OPENING, IN THREE LIGHTS. One template, one copy block; the sky, the
   light layer and where the copy stands are the only differences.
     ?hero=a  HIGH SUN, TOP LEFT      copy top left in the white
     ?hero=b  SUN BEHIND HER          copy centred in the white above her
     ?hero=c  LATE SUN, TOP RIGHT     copy top left in the silver           */
var HERO = (new URLSearchParams(location.search).get('hero') || 'a').toLowerCase();
if (['a','b','c'].indexOf(HERO) < 0) HERO = 'a';
var HERO_POS = {a:'tl', b:'cc', c:'tl'}[HERO];

/* =====================================================================
   INSTANCE A
   ===================================================================== */
var ZC_A = {
  title: 'Zodiac.fm · Home Template T6 · Instance A',
  wordmark: 'Zodiac.fm',
  navLinks: [{label:'Find your frequencies', href:'https://zodiac.fm'}],
  footer: {mark:'Zodiac.fm', line:'© 2026 Zodiac.fm · A music company'},

  blocks: [

  /* ---- 00 · OPENING. The anchor scene: the listener, the product and the
         four boards, full bleed from the top edge. The sun comes in from
         the top as WHITE light and the words stand in the sky. ---------- */
  {
    t:'hero', id:'top',
    prehead:'Experience yourself in sound',
    h:'Music, composed from <em>your birth&nbsp;chart.</em>',
    after:'Your exact birth moment becomes four personal frequencies, embedded inside music for meditation, visualization, work, or a walk on the beach.',
    pos:HERO_POS,
    /* ART DIRECTED PER BREAKPOINT. The wide frame cannot fill a phone: on a
       375 screen the four boards and the listener span 1692 source pixels, so
       the picture can only ever be a third of the viewport. The phone gets
       P-163, the same woman on the same beach, cropped from the phone's edge
       to the second board — she and the product fill the bottom half. The
       desktop, which has the width for it, keeps P-123 and all four boards. */
    frame:{
      pid:'P-163 · P-123', h:'hero', focal:'50% 50%', focalM:'50% 100%', grade:'none',
      src:T6 + 'p-123-hero-' + HERO + '.jpg',
      srcMobile:T6 + 'p-163-hero-' + HERO + '-phone.jpg',
      alt:'A smiling listener in large headphones on a sunlit white beach, holding up a phone with her Zodiac playlist playing, four surfboards in violet, emerald, amber and rose standing in the sand behind her'
    }
  },

  /* ---- 01 · VOICES. White light. The faces are the image. ------------- */
  {
    t:'voices', id:'voices', ground:'light', variant:'authorities', sun:'voices',
    cue:'01 · Voices',
    h:'Neuroscientists, Astrologers, and Human&nbsp;Design Authorities Are <em>Tuning&nbsp;In.</em>',
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

  /* ---- 02 · TUNE INTO YOU. The one place the four interface colours are
         allowed on this page: four real waveforms, on the ground. ------- */
  {
    t:'freq', id:'frequencies', ground:'light',
    cue:'02 · Your Unique Frequencies',
    h:'Tune Into <em>You.</em>',
    body:'Every birth moment carries a measurable signature. Zodiac turns yours into four frequencies: who you are, how you relate, your energy, your opportunity. Each becomes a piece of music that exists for exactly one person.',
    rows:[
      {name:'Core',      sub:'Who you are',   band:'core',      wave:W.core,      waveAlt:'The Core frequency waveform, violet',      hz:'486'},
      {name:'Love',      sub:'How you relate',band:'love',      wave:W.love,      waveAlt:'The Love frequency waveform, rose',        hz:'302'},
      {name:'Vitality',  sub:'Your energy',   band:'vitality',  wave:W.vitality,  waveAlt:'The Vitality frequency waveform, amber',   hz:'652'},
      {name:'Abundance', sub:'Opportunity',   band:'abundance', wave:W.abundance, waveAlt:'The Abundance frequency waveform, emerald',hz:'813'}
    ],
    note:'*Sample frequencies. Yours come from your birth date, time, and place.'
  },

  /* ---- 03 · HOW ZODIAC.FM WORKS. The heading leads. Each step is ONE
         unit: numeral in the photograph, words directly beneath it. ----- */
  {
    t:'steps', id:'how', ground:'light',
    cue:'03 · Three Steps',
    h:'How <em>Zodiac.fm</em> works',
    cells:[
      {pid:'P-155', src:T6 + 'p-155.jpg', h:'step', focal:'55% 49%', focalM:'60% 47%',
       zoom:1.15, zoomM:1.40, grade:'contrast(1.22) brightness(1.11) saturate(1.16)', n:'1',
       alt:'A violet desk globe and an open pocket watch on a white windowsill in morning sun',
       kick:'Step one',
       h3:'Tell us when and where you were born',
       p:'That exact minute has a signature. No mood forms, no personality quiz — date, time, place.'},
      {pid:'P-179', src:T6 + 'p-179.jpg', h:'step',
       focal:'46% 50%', focalM:'34% 52%', zoom:1.1, zoomM:1.15,
       grade:'contrast(1.22) brightness(1.02) saturate(1.16)', n:'2',
       alt:'A woman in headphones laughing with her whole face in front of a deep rose garage door in hard sun',
       kick:'Step two',
       h3:'Hear your four frequencies',
       p:'Core, Love, Vitality, Abundance &mdash; four values that are yours for life, and the music composed around them.'},
      {pid:'P-159', src:T6 + 'p-159.jpg', h:'step',
       focal:'56% 30%', focalM:'58% 24%', zoom:1.06, zoomM:1.05, n:'3',
       alt:'A woman in emerald headphones singing joyfully into a wooden spoon in a sun-flooded white kitchen',
       kick:'Step three',
       h3:'Live with your music',
       p:'Play it while you work, walk, cook, fall asleep. Nine minutes a day is the practice. There is nothing else to learn.'}
    ]
  },

  /* ---- 04 · IT MOVES IN WITH YOU. Words first, then the family of four,
         then exactly FOUR moments — one per frequency — each with its
         caption ON THE GROUND beneath it, morning to late afternoon. ---- */
  {
    t:'moments', id:'world', ground:'light', sun:'day',
    cue:'04 · Where It Lives',
    h:'It moves in <em>with you.</em>',
    body:'Not a session to schedule — a soundtrack that follows your day. A violet street on the morning walk. Brass in the afternoon sun. The record on at home. An emerald ball against the summer sky. The world keeps playing your colors back to you.',
    lead:{pid:'P-93', h:'anchor', focal:'52% 44%', focalM:'62% 46%', zoom:1.06, zoomM:1.0,
      jt:'w', jth:'20%', jb:'w', jbh:'18%',
      src:T6 + 'p-93.jpg',
      alt:'Four runners crossing a bridge in hard midday sun, their vests violet, emerald, amber and rose, long shadows on the deck'},
    cells:[
      {pid:'P-125', src:T6 + 'p-125.jpg', h:'scene', focal:'50% 42%', focalM:'50% 42%',
       zoom:1.0, zoomM:1.02,
       alt:'A listener in headphones walking beneath violet jacaranda trees in a silver-white street',
       cap:{b:'Morning, on the walk.', rest:'Core, in the headphones.'}},
      {pid:'P-126', src:T6 + 'p-126.jpg', h:'scene', focal:'58% 40%', focalM:'58% 40%',
       zoom:1.08, zoomM:1.18,
       alt:'A trumpeter playing a brass horn into the afternoon sun on a silver street',
       cap:{b:'Afternoon, out loud.', rest:'Vitality, in the sun.'}},
      {pid:'P-106', src:T6 + 'p-106.jpg', h:'dress', focal:'50% 40%', focalM:'50% 50%',
       zoom:1.0, zoomM:1.0,
       alt:'A woman dancing barefoot in a sunlit white room in a deep rose dress, a record turning on the turntable behind her',
       cap:{b:'At home, the record on.', rest:'Love, out loud.'}},
      {pid:'P-175', src:T6 + 'p-175.jpg', h:'scene', focal:'34% 44%', focalM:'28% 46%',
       zoom:1.08, zoomM:1.16, jb:'w', jbh:'24%',
       alt:'A man on a rooftop holding a huge emerald ball above his head against the city sky, laughing',
       cap:{b:'The weekend, mid-air.', rest:'Abundance, everywhere.'}}
    ]
  },

  /* ---- 05 · RESULTS. The night begins. Black ground end to end, the
         testimonials as a spread with real faces. ---------------------- */
  {
    t:'voices', id:'results', ground:'dark', variant:'spread',
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

  /* ---- 06 · THE STUDY. Stays on the black end to end. ----------------- */
  {
    t:'study', id:'study', ground:'dark',
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

  /* ---- 07 · AND IT KEEPS SHOWING UP. Dawn. The sun comes back over her
         and the heading is set in her light. ---------------------------- */
  {
    t:'voices', id:'more-results', ground:'light', variant:'dawn', marquee:MARQUEE,
    cue:'07 · More Results',
    h:'And it keeps <em>showing up.</em>',
    scene:{pid:'P-165', h:'dawn', focal:'52% 34%', focalM:'50% 22%', zoom:1.04, zoomM:1.10, grade:'none',
      jb:'w', jbh:'26%',
      src:T6 + 'p-165.jpg',
      alt:'A woman laughing into hard sun on a rooftop above the city, headphones on, a violet scarf flying out behind her'},
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

  /* ---- 08 · THE MUSIC. White light. The product, shown once, standing
         under the sentence it proves. ---------------------------------- */
  {
    t:'music', id:'music', ground:'light', sun:'drift',
    cue:'08 · The Music',
    h:'Real music, with <em>your frequencies inside.</em>',
    body:'Every track is a full piece of music, not a tone, not a spa loop, with one of your four frequencies running underneath it from the first note to the last. Five minutes between meetings, nine for a real sit, a full hour for deep work or sleep. Press play.',
    proof:'<b>Four tracks from one member&rsquo;s playlist.</b> Real lengths — five minutes to a full hour, one of the four frequencies under every note.',
    product:{pid:'P-160', h:'tall', focal:'56% 44%', focalM:'58% 44%', zoom:1.28, zoomM:1.55,
      src:T6 + 'p-160.jpg',
      alt:'A phone propped against a turntable on white linen in a shaft of sunlight, its screen showing a Zodiac playlist of four tracks'},
    cells:[
      {pid:'P-109', src:T6 + 'p-109.jpg', h:'night', focal:'44% 62%', focalM:'40% 70%',
       zoom:1.18, zoomM:1.26,
       alt:'A boombox on a windowsill with amber light in the cassette window, rain running down the glass behind it',
       cap:{b:'Vitality, at the window.', rest:'652 Hz through the whole track.'}},
      {pid:'P-110', src:T6 + 'p-110.jpg', h:'night', focal:'32% 46%', focalM:'29% 44%',
       zoom:1.38, zoomM:1.62,
       alt:'A record with a rose label turning on a turntable in a bright room, the tonearm down',
       cap:{b:'Love, spinning.', rest:'302 Hz under every note.'}}
    ]
  },

  /* ---- 09 · WHERE THIS CAME FROM. Night again. Words in the dark. ----- */
  {
    t:'aside', id:'story', ground:'dark',
    cue:'09 · Where This Came From',
    h:'It started with <em>one question.</em>',
    body:'If the planets reveal who you are, and everything is frequency&hellip; then what would be your unique frequencies? Turns out, the work had been done, we just figured out how to insert them into music so you could experience who you are through sound.'
  },

  /* ---- 10 · COME HEAR IT. The night falls into the light and the sun
         blows the last frame out to pure white. ------------------------- */
  {
    t:'close', id:'finale', ground:'fall',
    cue:'10 · Come Hear It',
    h:'The symphony has been playing your part all along. <em>Come hear it.</em>',
    body:'Zodiac is a paid membership. Every straight answer about pricing lives at zodiac.fm.',
    cta:ASK,
    frame:{
      pid:'P-130', h:'close', focal:'50% 50%', focalM:'50% 55%', zoom:1.0, zoomM:1.0, grade:'none',
      jt:'w', jth:'22%',
      src:T6 + 'p-130-close.jpg',
      srcMobile:T6 + 'p-130-close-phone.jpg',
      alt:'Four beach umbrellas — violet, emerald, amber, rose — planted in white sand under full summer sun'
    }
  }

  ]
};

/* =====================================================================
   INSTANCE B — the proof that the template is a system.
   B is A with three content edits and nothing else. No line of
   home-t6.html or home-t6-tokens.css differs between the two.
     1. a different hero photograph (P-163, the t3 hero)
     2. + 3. two body paragraphs swapped between sections
              (04 Where It Lives  <->  08 The Music)
   ===================================================================== */
var ZC_B = JSON.parse(JSON.stringify(ZC_A));
ZC_B.title = 'Zodiac.fm · Home Template T6 · Instance B';

(function (b) {
  var byId = function (id) {
    for (var i = 0; i < b.blocks.length; i++) if (b.blocks[i].id === id) return b.blocks[i];
    return null;
  };

  /* EDIT 1 — swap the hero photograph. One object, no template change. */
  byId('top').frame = {
    pid:'P-163', h:'hero', focal:'50% 50%', focalM:'50% 100%', grade:'none',
    src:T6 + 'p-163-hero-' + HERO + '.jpg',
    srcMobile:T6 + 'p-163-hero-' + HERO + '-phone.jpg',
    alt:'A smiling listener in large headphones on a sunlit white beach, holding up a phone with her Zodiac playlist playing — the sun merging into the light above her head, four surfboards in violet, emerald, amber, and rose standing in the sand behind her'
  };

  /* EDITS 2 + 3 — swap two body paragraphs between two sections. */
  var world = byId('world'), music = byId('music');
  var t = world.body; world.body = music.body; music.body = t;
}(ZC_B));

/* ---------- instance selection ---------- */
window.ZC = (new URLSearchParams(location.search).get('c') || 'a').toLowerCase() === 'b' ? ZC_B : ZC_A;
window.ZC_KEY = (new URLSearchParams(location.search).get('c') || 'a').toLowerCase() === 'b' ? 'B' : 'A';
