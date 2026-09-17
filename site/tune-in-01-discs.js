// Extracted from /inapp/app.html#zdisc-js. Static at rest for Tune In rows.
const ZPAL={
  core:{d:['#6521C9','#A737C8'],s:[['#7A4AE0','#B98AF0'],['#B44FD8','#D07DE8']]},
  love:{d:['#B90044','#E0559A'],s:[['#F43F6B','#FF7A98'],['#EE3D9C','#FF7EC2']]},
  vitality:{d:['#FF7A00','#FFC251'],s:[['#FF5426','#FF8A5C'],['#FFB020','#FFE08A']]},
  abundance:{d:['#0B9159','#2BC47F'],s:[['#0FA98F','#3BC9AD'],['#2FBF6E','#63D992']]}
};
const FAM={'quiet-success':'halo','kindred-spirits':'mandala','elysian-surge':'burst','starseed':'weave','astrolith':'iris','cosmic-drift':'orbit','galactic-slumber':'galaxy'};
function hx(h){h=h.replace('#','');return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)];}
function mix(a,b,t){return a.map((v,i)=>v+(b[i]-v)*t);}
function rgba(c,a){return 'rgba('+(c[0]|0)+','+(c[1]|0)+','+(c[2]|0)+','+a+')';}
function hash(s){let h=177;for(let i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))>>>0;return h;}
function ray(x,x1,y1,x2,y2,cA,cB,al,wd){const g=x.createLinearGradient(x1,y1,x2,y2);g.addColorStop(0,rgba(cA,al));g.addColorStop(.78,rgba(cB,al*.9));g.addColorStop(1,rgba(cB,al*.35));x.strokeStyle=g;x.lineWidth=wd*2.3;x.globalAlpha=.45;x.beginPath();x.moveTo(x1,y1);x.lineTo(x2,y2);x.stroke();x.globalAlpha=1;x.lineWidth=wd;x.beginPath();x.moveTo(x1,y1);x.lineTo(x2,y2);x.stroke();}

export function drawDisc(cv,slug,domain){
  const x=cv.getContext('2d'),W=cv.width,H=cv.height,cx=W/2,cy=H/2;x.clearRect(0,0,W,H);
  const P=ZPAL[domain]||ZPAL.core,pr=hx(P.d[0]),en=hx(P.d[1]),s0a=hx(P.s[0][0]),s0b=hx(P.s[0][1]),s1a=hx(P.s[1][0]),s1b=hx(P.s[1][1]);
  const seed=hash(slug),rr1=(seed%97)/97,puls=1,bmul=1,R=Math.min(W,H)*.44,r0=Math.min(W,H)*.075,rot=.6+rr1*6.28,wd=Math.max(1.35,W/240*1.3);
  x.fillStyle='#fff';x.beginPath();x.arc(cx,cy,R*1.02,0,7);x.fill();
  const tg=x.createRadialGradient(cx,cy,r0,cx,cy,R*.95);tg.addColorStop(0,rgba(en,.18));tg.addColorStop(1,rgba(en,.02));x.fillStyle=tg;x.beginPath();x.arc(cx,cy,R,0,7);x.fill();x.lineCap='round';
  const F=FAM[slug]||'burst';const glint=i=>i%6===0?[s0a,s0b,.75]:(i%9===0?[s1a,s1b,.72]:[pr,en,1]);
  if(F==='burst'){const N=150;for(let i=0;i<N;i++){const a=i/N*6.283+rot,L=R*(.86+.10*Math.sin(a*7+rr1*6))*puls,[cA,cB,m]=glint(i);ray(x,cx+Math.cos(a)*r0,cy+Math.sin(a)*r0,cx+Math.cos(a)*L,cy+Math.sin(a)*L,cA,cB,.85*m*bmul,wd);}}
  else if(F==='iris'){const N=130;for(let i=0;i<N;i++){const a=i/N*6.283+rot,L=R*.7*puls,[cA,cB,m]=glint(i);ray(x,cx+Math.cos(a)*r0,cy+Math.sin(a)*r0,cx+Math.cos(a)*L,cy+Math.sin(a)*L,cA,cB,.7*m*bmul,wd);}[[.5,pr,2.6],[.84,en,1.9]].forEach(([r2,cc,ww])=>{x.strokeStyle=rgba(cc,.95*bmul);x.lineWidth=wd*ww;x.beginPath();x.arc(cx,cy,R*r2*puls,0,7);x.stroke();});}
  else if(F==='orbit'){[.36,.52,.68,.84].forEach((rr,k)=>{x.strokeStyle=rgba(k%2?en:pr,.8-k*.08);x.lineWidth=wd*1.3;x.beginPath();x.arc(cx,cy,R*rr*puls,0,7);x.stroke();const NB2=3+k;for(let b=0;b<NB2;b++){const a=rot*(k%2?1.4:-1.1)+b/NB2*6.283+k*.9,[cA,cB,m]=glint(k*7+b*3);x.fillStyle=rgba(cB,.95*m*bmul);x.beginPath();x.arc(cx+Math.cos(a)*R*rr*puls,cy+Math.sin(a)*R*rr*puls,wd*2.1,0,7);x.fill();}});}
  else if(F==='galaxy'){for(let ar=0;ar<3;ar++){const a0=ar/3*6.283+rot;for(let i=0;i<34;i++){const t=i/34,a=a0+t*3.1,r2=r0*1.2+(R*.92-r0*1.2)*t*puls,[cA,cB,m]=glint(ar*34+i);x.fillStyle=rgba(t<.12?cA:mix(cA,cB,t),(.95-.55*t)*m*bmul);x.beginPath();x.arc(cx+Math.cos(a)*r2,cy+Math.sin(a)*r2,wd*(1.9-t*1.1),0,7);x.fill();}}const bg=x.createRadialGradient(cx,cy,0,cx,cy,r0*1.5);bg.addColorStop(0,rgba(en,.8*bmul));bg.addColorStop(1,rgba(en,0));x.fillStyle=bg;x.beginPath();x.arc(cx,cy,r0*1.5,0,7);x.fill();}
  else if(F==='mandala'){const Pt=10,N=170;for(let i=0;i<N;i++){const a=i/N*6.283+rot,lobe=Math.max(0,Math.cos((a-rot)*Pt/2)),L=R*(.44+.5*Math.pow(lobe,1.6))*puls;if(L>R*.45){const[cA,cB,m]=glint(i);ray(x,cx+Math.cos(a)*r0,cy+Math.sin(a)*r0,cx+Math.cos(a)*L,cy+Math.sin(a)*L,cA,cB,.8*m*bmul,wd);}}}
  else if(F==='halo'){const N=36;for(let i=0;i<N;i++){const a=i/N*6.283+rot,L=R*.88*puls,[cA,cB,m]=glint(i);ray(x,cx+Math.cos(a)*r0,cy+Math.sin(a)*r0,cx+Math.cos(a)*L,cy+Math.sin(a)*L,cA,cB,.8*m*bmul,wd);}x.strokeStyle=rgba(en,.9*bmul);x.lineWidth=wd*2.6;x.beginPath();x.arc(cx,cy,R*.88*puls,0,7);x.stroke();}
  else{const N=130;for(let i=0;i<N;i++){const a=i/N*6.283+rot,L1=R*.52,L2=R*.9*puls,[cA,cB,m]=glint(i);ray(x,cx+Math.cos(a)*r0,cy+Math.sin(a)*r0,cx+Math.cos(a)*L1,cy+Math.sin(a)*L1,pr,pr,.8*bmul,wd);if(i%2)ray(x,cx+Math.cos(a)*(L1+wd*3),cy+Math.sin(a)*(L1+wd*3),cx+Math.cos(a)*L2,cy+Math.sin(a)*L2,cA,cB,.7*m*bmul,wd);}}
  const core=x.createRadialGradient(cx,cy,0,cx,cy,r0*1.8);core.addColorStop(0,'rgba(255,255,255,.96)');core.addColorStop(.55,rgba(pr,.10));core.addColorStop(1,rgba(pr,0));x.fillStyle=core;x.beginPath();x.arc(cx,cy,r0*1.9,0,7);x.fill();x.fillStyle='#fff';x.beginPath();x.arc(cx,cy,r0*.5,0,7);x.fill();
}
