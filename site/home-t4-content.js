/* =====================================================================
   HOME TEMPLATE T4 · CONTENT
   Every word and every photograph on the page lives in this file and
   nowhere else. A copy change, a photo swap or a new section instance
   is one edit HERE — home-t4.html and home-t4-tokens.css never move.

   Photographs are referenced by their permanent P number. Portraits by
   their T number. Both render on the page itself so Michael can review
   by number.

   ROUND 4. Nine photographs made for this page take permanent numbers
   P-165 to P-173 and live in site/assets/home-t4/. Every word below is
   carried over from home-t3-content.js unchanged.

   Instance selection:  home-t4.html      -> A
                        home-t4.html?c=b  -> B  (proof instance)
   ===================================================================== */

var T4 = 'assets/home-t4/';

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
   INSTANCE A
   ===================================================================== */
var ZC_A = {
  title: 'Zodiac.fm · Home Template T4 · Instance A',
  wordmark: 'Zodiac.fm',
  navLinks: [
    {label:'Voices', href:'#voices'},
    {label:'Your frequencies', href:'#frequencies'},
    {label:'The study', href:'#study'}
  ],
  footer: {mark:'Zodiac.fm', line:'© 2026 Zodiac.fm · A music company'},

  blocks: [

  /* ---- 1 · WORLD ONE. The hero. The photograph starts at y=0, the sun
         comes in from the top as WHITE light, and the headline is set into
         the sky of the picture. ---------------------------------------- */
  {
    t:'world', id:'top', variant:'hero',
    prehead:'Experience yourself in sound',
    h:'Music, composed from <em>your birth&nbsp;chart.</em>', level:1,
    frames:[{
      pid:'P-165', h:'hero', focal:'52% 46%', focalM:'66% 48%', zoomM:1.12, freq:'core',
      sky:'top', jb:'w',
      src:T4 + 'p-165-rooftop-violet-scarf.jpg',
      alt:'A woman laughing into hard sun on a rooftop above the city, headphones on, a violet scarf flying out behind her'
    }],
    after:'Your exact birth moment becomes four personal frequencies, embedded inside music for meditation, visualization, work, or a walk on the beach.'
  },

  /* ---- 2 · VOICES — the first magazine spread ------------------------ */
  {
    t:'voices', id:'voices', spread:'scene',
    cue:'01 · Voices',
    h:'Neuroscientists, Astrologers, and Human&nbsp;Design Authorities Are <em>Tuning&nbsp;In.</em>',
    scene:{pid:'P-172', h:'spread', focal:'50% 52%', focalM:'40% 56%', zoomM:1.14, jb:'w', jbh:'30%',
      src:T4 + 'p-172-beach-emerald-kayak.jpg',
      alt:'A man carrying an emerald kayak over his shoulder across blown-white sand, a dark sky behind him'},
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

  /* ---- 3 · NUMBERS (the frequency chart), on the white burst --------- */
  {
    t:'numbers', id:'frequencies', variant:'freq',
    cue:'02 · Your Unique Frequencies',
    h:'Tune Into <em>You.</em>',
    body:'Every birth moment carries a measurable signature. Zodiac turns yours into four frequencies: who you are, how you relate, your energy, your opportunity. Each becomes a piece of music that exists for exactly one person.',
    rows:[
      {name:'Core',      sub:'Who you are',   band:'core',      hz:'486'},
      {name:'Love',      sub:'How you relate',band:'love',      hz:'302'},
      {name:'Vitality',  sub:'Your energy',   band:'vitality',  hz:'652'},
      {name:'Abundance', sub:'Opportunity',   band:'abundance', hz:'813'}
    ],
    note:'*Sample frequencies. Yours come from your birth date, time, and place.'
  },

  /* ---- 4 · STRIP — three photographic steps, the number set into the
         image in white Switzer. No coloured labels. ------------------- */
  {
    t:'strip', id:'how', variant:'steps',
    cue:'03 · Three Steps',
    h:'How <em>Zodiac.fm</em> works',
    cells:[
      {pid:'P-155', src:'assets/d4j/d4j-step1.jpg', h:'step', focal:'55% 49%', focalM:'60% 47%', zoom:1.15, zoomM:1.40, grade:'contrast(1.22) brightness(1.11) saturate(1.16)', n:'1',
       alt:'A violet desk globe and an open pocket watch on a white windowsill in morning sun',
       kick:'Step one',
       h3:'Tell us when and where you were born',
       p:'That exact minute has a signature. No mood forms, no personality quiz — date, time, place.'},
      {pid:'P-156', src:'assets/d4j/d4j-step2.jpg', h:'step', focal:'62% 60%', focalM:'68% 68%', zoom:1.25, zoomM:1.45, grade:'contrast(1.22) brightness(1.13) saturate(1.18)', n:'2',
       alt:'Headphones on sunlit white linen, warm amber light glowing in the near earcup',
       kick:'Step two',
       h3:'Hear your four frequencies',
       p:'Core, Love, Vitality, Abundance — four values that are yours for life, and the music composed around them.'},
      {pid:'P-159', src:'assets/nhp-e01-p159-emerald-headset.png', h:'tall', focal:'56% 30%', focalM:'58% 24%', zoom:1.06, zoomM:1.05, n:'3', big:true,
       alt:'A woman in emerald headphones singing joyfully into a wooden spoon in a sun-flooded white kitchen',
       kick:'Step three',
       h3:'Live with your music',
       p:'Play it while you work, walk, cook, fall asleep. Nine minutes a day is the practice. There is nothing else to learn.'}
    ]
  },

  /* ---- 5 · WORLD TWO. The day. --------------------------------------- */
  {
    t:'world', id:'world', order:'frames-first',
    cue:'04 · Where It Lives',
    h:'It moves in <em>with you.</em>',
    body:'Not a session to schedule — a soundtrack that follows your day. A violet street on the morning walk. Brass in the afternoon sun. The record on at home. An emerald ball against the summer sky. The world keeps playing your colors back to you.',
    frames:[
      {pid:'P-93', h:'scene', focal:'52% 44%', focalM:'52% 42%', zoom:1.06, zoomM:1.10, jt:'w', jth:'34%', jb:'w', jbh:'30%', freq:'core', src:'assets/sg5lib/r29-m-runners-bridge.jpg',
       alt:'Four runners crossing a bridge in hard midday sun, their vests violet, emerald, amber and rose, long shadows on the deck'},
      {pid:'P-169', h:'scene', focal:'62% 34%', focalM:'64% 38%', zoom:1.35, zoomM:1.36, jt:'w', jth:'32%',
       src:T4 + 'p-169-bridge-violet-vest.jpg',
       alt:'A runner in a violet vest and headphones crossing a suspension bridge into the low morning sun',
       cap:{b:'Morning, on the walk.', rest:'Core, in the headphones.'}},
      {pid:'P-126', h:'mid', focal:'70% 34%', focalM:'47% 53%', zoom:1.35, zoomM:1.95, jb:'k',
       src:'assets/d4e/d4e-trumpet-h8.jpg',
       alt:'A trumpeter playing a brass horn into the afternoon sun on a silver street'}
    ]
  },

  /* ---- 5b · STRIP joined to World two: the afternoon and the moments -- */
  {
    t:'strip', id:'world-strip', variant:'moments', join:true,
    cells:[
      {pid:'P-168', src:T4 + 'p-168-porch-amber-cushion.jpg', h:'scene', focal:'50% 54%', focalM:'52% 58%', zoomM:1.24,
       alt:'An older couple laughing side by side in headphones on a porch swing in late afternoon sun, an amber cushion under them',
       cap:{b:'Afternoon, out loud.', rest:'Vitality, in the sun.'}},
      {pid:'P-171', src:T4 + 'p-171-rooftop-rose-parasol.jpg', h:'scene', focal:'50% 44%', focalM:'48% 42%',
       alt:'Two friends sharing earbuds and laughing on a rooftop under a deep rose parasol, the city behind them',
       cap:{b:'At home, the record on.', rest:'Love, out loud.'}},
      {pid:'P-170', src:T4 + 'p-170-beach-emerald-umbrella.jpg', h:'scene', focal:'50% 34%', focalM:'56% 10%',
       alt:'A couple sharing earbuds in a deck chair on white sand under a big emerald beach umbrella',
       cap:{b:'The weekend, mid-air.', rest:'Abundance, everywhere.'}},
      {pid:'P-173', src:T4 + 'p-173-beach-rose-towel.jpg', h:'scene', focal:'50% 46%', focalM:'36% 66%', zoomM:1.14, jb:'w',
       alt:'A woman lying back laughing in headphones on a deep rose beach towel, white sand blown out by the sun all around her'},
      {pid:'P-167', src:T4 + 'p-167-pier-amber-board.jpg', h:'scene', focal:'72% 60%', focalM:'78% 68%', zoom:1.35, zoomM:1.45, jt:'w', jth:'30%',
       alt:'Two friends sitting close on a pier in hard sun sharing earbuds, an amber surfboard lying on the boards beside them'}
    ]
  },

  /* ---- 6 · VOICES (results, part one) — the second spread ------------- */
  {
    t:'voices', id:'results', spread:'run',
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

  /* ---- 7 · NUMBERS (the study), on the white burst -------------------- */
  {
    t:'numbers', id:'study', variant:'study',
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

  /* ---- 8 · VOICES (results, part two) — the third spread, composed
         against the two above: a wall standing on the white burst ------ */
  {
    t:'voices', id:'more-results', spread:'burst', marquee:MARQUEE,
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

  /* ---- 9 · WORLD THREE. The light goes. ------------------------------- */
  {
    t:'world', id:'music', order:'frames-first', night:true,
    cue:'08 · The Music',
    h:'Real music, with <em>your frequencies inside.</em>',
    body:'Every track is a full piece of music, not a tone, not a spa loop, with one of your four frequencies running underneath it from the first note to the last. Five minutes between meetings, nine for a real sit, a full hour for deep work or sleep. Press play.',
    proof:'<b>Four tracks from one member&rsquo;s playlist.</b> Real lengths — five minutes to a full hour, one of the four frequencies under every note.',
    frames:[
      {pid:'P-118', h:'night', focal:'56% 46%', focalM:'66% 48%', zoom:1.2, zoomM:1.34, jt:'k', jth:'34%', jb:'k', freq:'love',
       src:'assets/d4c/d4c-attic.jpg',
       alt:'A woman laughing over a spinning record in an attic, her face lit rose by the groove'}
    ]
  },

  /* ---- 9b · STRIP inside the night ------------------------------------ */
  {
    t:'strip', id:'music-strip', variant:'moments', join:true, night:true,
    cells:[
      {pid:'P-109', src:'assets/d4h/d4h-rain-sill.jpg', h:'tall', focal:'44% 66%', focalM:'43% 72%', zoom:1.26, zoomM:1.58, jt:'k', jb:'k',
       alt:'A boombox on a windowsill with amber light in the cassette window, rain running down the glass behind it',
       cap:{b:'Vitality, at the window.', rest:'652 Hz through the whole track.'}},
      {pid:'P-110', src:'assets/d4h/d4h-record.jpg', h:'tall', focal:'34% 48%', focalM:'32% 47%', zoom:1.35, zoomM:1.88, jt:'k', jb:'k',
       alt:'A record with a rose label turning on a turntable in a bright room, the tonearm down',
       cap:{b:'Love, spinning.', rest:'302 Hz under every note.'}}
    ]
  },

  /* ---- 10 · STRIP (the origin), the last of the night ----------------- */
  {
    t:'strip', id:'story', variant:'aside', tail:true,
    cue:'09 · Where This Came From',
    h:'It started with <em>one question.</em>',
    body:'If the planets reveal who you are, and everything is frequency&hellip; then what would be your unique frequencies? Turns out, the work had been done, we just figured out how to insert them into music so you could experience who you are through sound.',
    cells:[]
  },

  /* ---- 11 · CLOSE. Out of the night into white. ------------------------ */
  {
    t:'close', id:'finale',
    cue:'10 · Come Hear It',
    h:'The symphony has been playing your part all along. <em>Come hear it.</em>',
    body:'Zodiac is a paid membership. Every straight answer about pricing lives at zodiac.fm.',
    cta:{label:'Find your frequencies at zodiac.fm', href:'https://zodiac.fm'},
    frames:[{
      pid:'P-130', h:'close', focal:'center 58%', focalM:'48% 30%', zoomM:1.48, jt:'w', jth:'30%', freq:'abundance',
      src:'assets/d4e/d4e-umbrellas-h8.jpg',
      srcMobile:'assets/d4e/d4e-umbrellas-port-h8.jpg',
      alt:'Four beach umbrellas — violet, emerald, amber, rose — planted in white sand under full summer sun'
    }]
  }

  ]
};

/* =====================================================================
   INSTANCE B — the proof that the template is a system.
   B is A with three content edits and nothing else. No line of
   home-t4.html or home-t4-tokens.css differs between the two.
     1. a different hero photograph (P-166, the pool ring)
     2. + 3. two body paragraphs swapped between sections
              (04 Where It Lives  <->  08 The Music)
   ===================================================================== */
var ZC_B = JSON.parse(JSON.stringify(ZC_A));
ZC_B.title = 'Zodiac.fm · Home Template T4 · Instance B';

(function (b) {
  var byId = function (id) {
    for (var i = 0; i < b.blocks.length; i++) if (b.blocks[i].id === id) return b.blocks[i];
    return null;
  };

  /* EDIT 1 — swap the hero photograph. One object, no template change. */
  byId('top').frames[0] = {
    pid:'P-166', h:'hero', focal:'50% 50%', focalM:'46% 62%', zoomM:1.15, freq:'core',
    sky:'top', jb:'w', zoomM:1.15, src:T4 + 'p-166-pool-violet-ring.jpg',
    alt:'A woman laughing in headphones, floating in a violet ring on bright pool water, the sun blowing the water white around her'
  };

  /* EDITS 2 + 3 — swap two body paragraphs between two sections. */
  var world = byId('world'), music = byId('music');
  var t = world.body; world.body = music.body; music.body = t;
}(ZC_B));

/* ---------- instance selection ---------- */
window.ZC = (new URLSearchParams(location.search).get('c') || 'a').toLowerCase() === 'b' ? ZC_B : ZC_A;
window.ZC_KEY = (new URLSearchParams(location.search).get('c') || 'a').toLowerCase() === 'b' ? 'B' : 'A';
