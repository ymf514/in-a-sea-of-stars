import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { initialArchive, newArchiveItem, modelScore, relatedness, quoteFor, creditFor, readingDetail, MODEL_KEYS } from './archive.js';
import { disagreementOf, agreementLabel } from './inference/scoring.js';
import { requestReading } from './inference/client.js';
import { isRemote, loadNotes, saveNote, loadReleasedStars, releaseStar, loadPredictions, shrinkImage } from './persistence.js';
import { SCENE, POST, OCEAN, LAYOUT, VIEW, BOUNDARY, WAKE, STARS, GLOW, REVEAL, BOAT, CAMERA, INTERACTION, RIPPLES, COLLISION } from './config.js';
import './style.css';

// Navigable archive: real archive images; NO real ML inference yet (predictions are null).
// Tunable numbers and colours live in src/config.js (look for TUNE).
const $ = (id) => document.getElementById(id);
const world = $('world');
const scene = new THREE.Scene();
scene.background = new THREE.Color(SCENE.background);
scene.fog = new THREE.FogExp2(SCENE.fogColor, SCENE.fogDensity);
const camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, 0.1, 250);
const renderer = new THREE.WebGLRenderer({ antialias:true, alpha:false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, POST.maxPixelRatio));
renderer.outputColorSpace = THREE.SRGBColorSpace;
// Neutral tone mapping keeps the pastel colours instead of bleaching them.
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = SCENE.exposure;
world.appendChild(renderer.domElement);
// Soft hazy glow (config.js → POST): the scene renders into a buffer, bright parts
// bloom, then OutputPass applies tone mapping and sRGB for the screen.
const composer=new EffectComposer(renderer);
composer.renderTarget1.samples=composer.renderTarget2.samples=POST.msaa;   // keep edges smooth
composer.addPass(new RenderPass(scene,camera));
const bloom=new UnrealBloomPass(new THREE.Vector2(256,256),POST.bloomStrength,POST.bloomRadius,POST.bloomThreshold);
bloom.enabled=POST.bloom;composer.addPass(bloom);
composer.addPass(new OutputPass());
const clock = new THREE.Clock();
scene.add(new THREE.HemisphereLight(SCENE.skyLight, SCENE.groundLight, SCENE.skyLightIntensity));
const sun = new THREE.DirectionalLight(SCENE.sunColor, SCENE.sunIntensity);
sun.position.set(-12, 25, 14);
scene.add(sun);

// Visible range around the boat (config.js → VIEW): one shared uniform set used by
// the ocean shader and every star, so the sea and its stars darken together.
// The ocean shader works in sRGB values and converts at the end; the star shader works
// in linear (three.js renders into a linear buffer before OutputPass).
const darkLinear=new THREE.Color(VIEW.darkColor),darkSRGB=darkLinear.clone().convertLinearToSRGB();
const view={uBoat:{value:new THREE.Vector2()},uDark:{value:new THREE.Vector3(darkSRGB.r,darkSRGB.g,darkSRGB.b)},
  uDarkLinear:{value:new THREE.Vector3(darkLinear.r,darkLinear.g,darkLinear.b)}};
const viewGLSL=`uniform vec2 uBoat; uniform vec3 uDark;
  float viewShade(vec2 p){return pow(smoothstep(${VIEW.clearRadius.toFixed(2)},${VIEW.fadeRadius.toFixed(2)},distance(p,uBoat)),${VIEW.curve.toFixed(2)})*${VIEW.darkness.toFixed(2)};}`;
// 0 = clear, 1 = fully dark (same curve as the shader, for stars and culling on the CPU)
function viewShade(x,z){
  const d=Math.hypot(x-boat.position.x,z-boat.position.z);
  const t=Math.min(1,Math.max(0,(d-VIEW.clearRadius)/(VIEW.fadeRadius-VIEW.clearRadius)));
  return Math.pow(t*t*(3-2*t),VIEW.curve)*VIEW.darkness;
}

// Ocean: keep the geometry light and do the dreamlike texture in a shader.
const glsl = (rgb) => `vec3(${rgb.map(v => v.toFixed(3)).join(',')})`;
const ocean = new THREE.Mesh(
  new THREE.PlaneGeometry(400,400,1,1),
  new THREE.ShaderMaterial({
    uniforms:{uTime:{value:0},...view},
    vertexShader:`varying vec2 vUv; varying vec3 vPosition; varying vec3 vWorld; void main(){vUv=uv;vPosition=position;vWorld=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader:`uniform float uTime; varying vec2 vUv; varying vec3 vPosition; varying vec3 vWorld; ${viewGLSL}
      void main(){vec2 p=vPosition.xy;float t=uTime*${OCEAN.waveSpeed.toFixed(3)};
      float a=sin(p.x*.40+t*.48)*sin(p.y*.26-t*.33);float b=sin(p.x*.14-p.y*.18+t*.19);
      float c=sin(p.x*1.8+p.y*.4+t*.75)*.5+.5;float foam=pow(max(0.,a*.52+b*.3+c*.2),7.0);
      vec3 col=mix(${glsl(OCEAN.deep)},${glsl(OCEAN.shallow)},clamp(.55+.25*a+.17*b,0.,1.));
      col+=${glsl(OCEAN.foam)}*foam*${OCEAN.foamStrength.toFixed(3)};
      col=mix(col,uDark,viewShade(vWorld.xz));gl_FragColor=vec4(pow(col,vec3(2.2)),1.);}`
  })
);
ocean.rotation.x = -Math.PI / 2;
ocean.position.y=-0.24;
scene.add(ocean);

// The sea of stars is a disc; boat and stars stay within SEA_EDGE.
const SEA_EDGE=LAYOUT.seaRadius+BOUNDARY.margin;
function keepInside(p,radius){
  const d=Math.hypot(p.x,p.z),max=SEA_EDGE-radius;
  if(d<=max)return false;
  p.x*=max/d;p.z*=max/d;return true;
}
if(BOUNDARY.showRing){
  // A faint line of light on the water, with a wider soft halo.
  for(const [width,alpha] of [[BOUNDARY.ringWidth,1],[BOUNDARY.ringWidth*6,.25]]){
    const ring=new THREE.Mesh(new THREE.RingGeometry(SEA_EDGE-width/2,SEA_EDGE+width/2,220).rotateX(-Math.PI/2),
      new THREE.MeshBasicMaterial({color:BOUNDARY.ringColor,transparent:true,opacity:BOUNDARY.ringOpacity*alpha,depthWrite:false,blending:THREE.AdditiveBlending,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1}));
    ring.position.y=-.21;scene.add(ring);
  }
}

// Sparse drifting glints on the water, spread a little beyond the stars.
// All glints are one instanced mesh (one draw call); hidden ones are scaled to zero.
const glintData=[];
const glints=new THREE.InstancedMesh(new THREE.SphereGeometry(OCEAN.glintSize,5,4),
  new THREE.MeshBasicMaterial({color:OCEAN.glintColor,transparent:true,opacity:.60,depthWrite:false}),OCEAN.glintCount);
glints.frustumCulled=false;scene.add(glints);
for(let i=0;i<OCEAN.glintCount;i++){
  const r = 5+Math.sqrt(Math.random())*(LAYOUT.seaRadius+20);
  const a = Math.random()*Math.PI*2;
  glintData.push({x:Math.cos(a)*r,z:Math.sin(a)*r,phase:Math.random()*6.3});
}
const glintMatrix=new THREE.Matrix4(),hiddenMatrix=new THREE.Matrix4().makeScale(0,0,0);
function updateGlints(){
  glintData.forEach((p,i)=>{
    if(viewShade(p.x,p.z)<.6)glints.setMatrixAt(i,glintMatrix.makeTranslation(p.x,-.12+Math.sin(elapsed*1.2+p.phase)*.025,p.z));
    else glints.setMatrixAt(i,hiddenMatrix);
  });
  glints.instanceMatrix.needsUpdate=true;
}

// Puffy folded lucky star: a star outline lifted into a pillow by stacked rings.
// The top and bottom domes meet at a shared rim crease; tips are pinched thinner
// than the valleys, as when a paper strip is pressed into a star. See STARS.shape.
function makePaperStar({outerRadius,innerRadius,height,depth,roundness,tipPinch,rings,edgeSegments}){
  const outline=[];
  for(let i=0;i<10;i++){
    const a0=-Math.PI/2+i*Math.PI/5, a1=a0+Math.PI/5;
    const r0=i%2===0?outerRadius:innerRadius, r1=i%2===0?innerRadius:outerRadius;
    for(let s=0;s<edgeSegments;s++){
      const t=s/edgeSegments, a=a0+(a1-a0)*t, r=r0+(r1-r0)*t;
      outline.push([Math.cos(a)*r,Math.sin(a)*r,(r-innerRadius)/(outerRadius-innerRadius)]);
    }
  }
  const n=outline.length;
  const verts=[0,height,0, 0,-depth,0];               // 0 = top centre, 1 = bottom centre
  const lift=(t,tip,h)=>h*Math.pow(1-t*t,roundness)*(1-tipPinch*tip*t);
  const top=[],bottom=[];                             // top[k][j] / bottom[k][j] vertex indices
  for(let k=1;k<=rings;k++){
    const t=k/rings;const rowT=[],rowB=[];
    for(const [x,z,tip] of outline){
      rowT.push(verts.length/3);verts.push(x*t,lift(t,tip,height),z*t);
      if(k<rings){rowB.push(verts.length/3);verts.push(x*t,-lift(t,tip,depth),z*t);}
    }
    top.push(rowT);bottom.push(k<rings?rowB:rowT);  // the rim ring is shared
  }
  const indices=[];
  for(let j=0;j<n;j++){
    const m=(j+1)%n;
    indices.push(0,top[0][j],top[0][m], 1,bottom[0][m],bottom[0][j]);
    for(let k=0;k<rings-1;k++){
      const a=top[k],b=top[k+1],c=bottom[k],d=bottom[k+1];
      indices.push(a[j],b[j],b[m], a[j],b[m],a[m]);
      indices.push(c[j],d[m],d[j], c[j],c[m],d[m]);
    }
  }
  // Image projected straight down onto both domes (far edge = top of the picture).
  const uvs=[];for(let i=0;i<verts.length;i+=3)uvs.push(verts[i]/(2*outerRadius)+.5,.5-verts[i+2]/(2*outerRadius));
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
  g.setIndex(indices);g.computeVertexNormals();return g;
}
const starGeometry=makePaperStar(STARS.shape);
const stars=[];
const raycaster=new THREE.Raycaster();const mouse=new THREE.Vector2();
const pickTargets=[];
const ripples=[];
const rippleGeometry=new THREE.RingGeometry(.86,.90,72);
// size scales the ring, opacity its starting strength (wake rings are small and faint).
function addRipple(x,z,color='#bbecff',speed=1.0,size=1,opacity=RIPPLES.opacity){
  const ring = new THREE.Mesh(rippleGeometry,new THREE.MeshBasicMaterial({color,transparent:true,opacity,side:THREE.DoubleSide,depthWrite:false}));
  ring.rotation.x=-Math.PI/2;ring.position.set(x,-.07,z);ring.scale.setScalar(.1);scene.add(ring);
  ripples.push({mesh:ring,life:0,speed,size,opacity});
}
// Shared by every star so 300 stars stay cheap.
const shadowGeometry=new THREE.CircleGeometry(.81,30);
// The glow is a pool of light lying on the water (a camera-facing sprite was cut
// in half by the sea surface). It and the shadow stay at water level while the
// paper star bobs above them.
const poolGeometry=new THREE.PlaneGeometry(1,1).rotateX(-Math.PI/2);
const WATER_Y=-0.2;
const shadowMaterial=new THREE.MeshBasicMaterial({color:STARS.shadowColor,transparent:true,opacity:STARS.shadowOpacity,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-3,polygonOffsetUnits:-3});
// ---------------------------------------------------------------- star light (Phase C)
// Brightness = combined Star-relatedness; low scores stay softly visible.
// Disagreement between models = slow colour drift + irregular breathing.
// Unresolved (not yet revealed / not readable) = steady neutral pearl glow —
// unknown is not unrelated. Every light change fades in, never snaps.
const UNRESOLVED=new THREE.Color(GLOW.unresolvedColor);
const BRIGHT=new THREE.Color(GLOW.brightColor);
const DRIFT=GLOW.disagreeColors.map(c=>new THREE.Color(c));
const tmpColor=new THREE.Color();
const revealedIds=(()=>{try{return new Set(REVEAL.remember?JSON.parse(localStorage.getItem('sea-stars-revealed')||'[]'):[]);}catch{return new Set();}})();
function rememberReveal(id){
  revealedIds.add(id);
  if(REVEAL.remember)try{localStorage.setItem('sea-stars-revealed',JSON.stringify([...revealedIds]));}catch{}
}
// Score → brightness 0–1, stretched over GLOW.scoreRange with a contrast curve.
function shine(score){
  if(score===null)return null;
  const [lo,hi]=GLOW.scoreRange;
  return Math.pow(Math.min(1,Math.max(0,(score-lo)/(hi-lo))),GLOW.contrast);
}
// Recompute what a star's light should become from its (possibly new) readings.
function readLight(s){
  s.score=shine(relatedness(s.item));
  const d=disagreementOf(s.item.predictions);
  s.disagree=d===null?0:Math.min(1,d);                     // 0–1 spread between models
  s.disagreeOn=agreementLabel(s.item.predictions)==='disagree';
  s.revealColor=(s.revealColor??new THREE.Color()).copy(s.poolColor).lerp(BRIGHT,(s.score??0)*GLOW.brightBlend);
}
const hasReading=(item)=>Boolean(item.predictions&&(item.predictions.tm||item.predictions.clip||item.predictions.mn));
function revealStar(s){
  if(s.revealed||s.analyzing||s.tried)return;
  if(hasReading(s.item)){s.revealed=true;rememberReveal(s.item.id);return;}
  // No cached reading: ask the local inference server, shimmer while it works.
  s.analyzing=true;s.item.analysisStatus='analyzing';
  requestReading(s.item).then(r=>{
    s.item.predictions=r.predictions;s.item.analysisStatus=r.analysisStatus;s.item.modelVersion=r.modelVersion;
    readLight(s);s.revealed=true;rememberReveal(s.item.id);
    addRipple(s.item.position.x,s.item.position.z,INTERACTION.nearRippleColor,.8);
  }).catch(err=>{console.info(`No reading for ${s.item.id}:`,err.message);s.item.analysisStatus='pending';s.tried=true;})
    .finally(()=>{s.analyzing=false;});
}
function updateLight(s,dt){
  s.mix+=((s.revealed&&s.score!==null?1:0)-s.mix)*Math.min(1,dt*GLOW.fadeSpeed);
  const m=s.mix,score=s.score??GLOW.unresolvedLevel;
  const level=GLOW.unresolvedLevel+(score-GLOW.unresolvedLevel)*m;
  const opacity=GLOW.unresolvedOpacity+((GLOW.opacityBase+score*GLOW.opacityRange)-GLOW.unresolvedOpacity)*m;
  const t=elapsed;
  tmpColor.copy(UNRESOLVED).lerp(s.revealColor,m);
  let pulse=Math.sin(t*GLOW.pulseSpeed+s.phase)*GLOW.pulse;
  if(s.disagreeOn&&m>.01){
    const k=Math.sin(t*GLOW.disagreeSpeed+s.phase)*.5+.5;
    tmpColor.lerp(DRIFT[Math.floor(s.phase)%DRIFT.length],k*GLOW.disagreeDrift*s.disagree*m);
    pulse+=Math.sin(t*2.3+s.phase*1.7)*Math.sin(t*.7+s.phase)*GLOW.disagreePulse*m;
  }
  if(s.analyzing)pulse+=(Math.sin(t*GLOW.shimmerSpeed+s.phase)*.5+.5)*GLOW.shimmer;
  const size=GLOW.sizeBase+level*GLOW.sizeRange;
  s.glow.scale.set(size,1,size);
  s.glow.material.color.copy(tmpColor);
  s.glow.material.opacity=opacity*(1+pulse);
  // The paper itself takes on its light colour; the image is mixed in (STARS.imageOpacity).
  const m2=s.paper.material;
  m2.color.copy(tmpColor);m2.emissive.copy(tmpColor);
  m2.emissiveIntensity=STARS.lightGlow*(.35+.65*level)*(1+pulse*.5);
}
function saturate(hex){
  const c=new THREE.Color(hex);const hsl={};c.getHSL(hsl);
  return c.setHSL(hsl.h,Math.min(1,hsl.s*STARS.saturation),hsl.l);
}
const paperColor=(index)=>saturate(STARS.paperPalette[index%STARS.paperPalette.length]);
// The pool keeps a gentle, light version of the image's dominant colour.
function poolColor(item,fallback){
  if(!STARS.poolUsesImageColor||!item.color)return fallback;
  const c=saturate(item.color);const hsl={};c.getHSL(hsl);
  const [lo,hi]=GLOW.lightness;
  return c.setHSL(hsl.h,Math.min(1,Math.max(GLOW.minSaturation,hsl.s*GLOW.saturationBoost)),Math.min(hi,Math.max(lo,hsl.l)));
}
const textureLoader=new THREE.TextureLoader();
// Surface = mix(light colour, image, imageOpacity) instead of light × image, so a
// faint image still lets the star's own colour read clearly. One shared program.
// Each star also darkens into the night outside the visible range (uShade per star).
const imageOpacity={value:STARS.imageOpacity};
function starShader(shader){                                   // called with this = the material
  shader.uniforms.uImageOpacity=imageOpacity;
  shader.uniforms.uDark=view.uDarkLinear;
  shader.uniforms.uShade=this.userData.shade;
  shader.fragmentShader='uniform float uImageOpacity; uniform vec3 uDark; uniform float uShade;\n'+shader.fragmentShader.replace('#include <map_fragment>',
    `#ifdef USE_MAP
      vec4 sampledDiffuseColor = texture2D( map, vMapUv );
      // mixed in gamma space so 50 % looks like half, not almost white
      diffuseColor.rgb = pow( mix( pow( diffuseColor.rgb, vec3( 1.0 / 2.2 ) ), pow( sampledDiffuseColor.rgb, vec3( 1.0 / 2.2 ) ), uImageOpacity ), vec3( 2.2 ) );
    #endif`).replace('#include <emissivemap_fragment>',
    `#ifdef USE_MAP
      totalEmissiveRadiance *= mix( vec3( 1.0 ), sampledDiffuseColor.rgb, uImageOpacity );
    #endif`).replace('#include <dithering_fragment>',
    `gl_FragColor.rgb = mix( gl_FragColor.rgb, uDark, uShade );
    #include <dithering_fragment>`);
}
// Images are loaded only for stars near the boat and released again when the boat
// sails away, so 1000+ stars do not all sit in GPU memory at once.
function wrapImage(s){
  if(!STARS.showImages||!s.item.thumb||s.tex)return;
  s.tex='loading';
  textureLoader.load(s.item.thumb,tex=>{
    if(s.tex!=='loading'){tex.dispose();return;}                 // released while loading
    tex.colorSpace=THREE.SRGBColorSpace;tex.anisotropy=4;
    const m=s.paper.material;
    m.map=tex;m.needsUpdate=true;s.tex='ready';
  },undefined,()=>{s.tex='failed';});                           // keep the plain paper star on failure
}
function releaseImage(s){
  if(s.tex==='ready'){const m=s.paper.material;m.map.dispose();m.map=null;m.needsUpdate=true;}
  if(s.tex!=='failed')s.tex=null;
}
// Released stars land at a random spot, which can fall on top of an existing star.
// Spiral outward from there to the first place with LAYOUT.minSpacing of room.
function freeSpot(p){
  const roomy=(x,z)=>Math.hypot(x,z)<=SEA_EDGE-1&&stars.every(o=>Math.hypot(o.home.x-x,o.home.z-z)>=LAYOUT.minSpacing);
  for(let i=0;i<400;i++){
    const r=i*.06,a=i*2.4;                                       // golden-angle spiral
    const x=p.x+Math.cos(a)*r,z=p.z+Math.sin(a)*r;
    if(roomy(x,z)){p.x=+x.toFixed(2);p.z=+z.toFixed(2);return;}
  }
}
function makeStar(item,isDrop=false){
  if(item.uploaded)freeSpot(item.position);
  const group=new THREE.Group();
  const baseColor=paperColor(stars.length);
  const material = new THREE.MeshStandardMaterial({color:baseColor,roughness:STARS.roughness,metalness:0,flatShading:true,side:THREE.DoubleSide});
  material.userData.shade={value:0};
  material.onBeforeCompile=starShader;material.customProgramCacheKey=()=>'paper-star';
  const paper=new THREE.Mesh(starGeometry,material);
  paper.rotation.y=Math.random()*Math.PI*2;
  const size=STARS.sizeMin+Math.random()*(STARS.sizeMax-STARS.sizeMin);
  paper.scale.set(size,size*(1+(Math.random()*2-1)*STARS.heightJitter),size);
  group.add(paper);
  group.position.set(item.position.x,isDrop?INTERACTION.dropHeight:STARS.floatHeight,item.position.z);
  group.userData.item=item;
  // Light pool + shadow on the water surface, following the star's x/z.
  const pool=new THREE.Group();
  const glow=new THREE.Mesh(poolGeometry,new THREE.MeshBasicMaterial({map:glowTexture(),transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2}));
  glow.renderOrder=1;pool.add(glow);
  const shadow=new THREE.Mesh(shadowGeometry,shadowMaterial);
  shadow.rotation.x=-Math.PI/2;shadow.position.y=.01;shadow.scale.setScalar(size/.77);shadow.renderOrder=2;pool.add(shadow);
  pool.position.set(item.position.x,WATER_Y,item.position.z);
  scene.add(group,pool);pickTargets.push(paper);
  const revealed=!REVEAL.onApproach||(revealedIds.has(item.id)&&hasReading(item));
  const object={item,group,pool,paper,glow,baseColor,shown:true,poolColor:poolColor(item,baseColor),size,phase:Math.random()*6.28,
    revealed,mix:revealed?1:0,analyzing:false,tried:false,
    vel:new THREE.Vector2(),wobble:0,home:{x:item.position.x,z:item.position.z},fall:isDrop?{vel:0,bounces:0}:null,lastRipple:-20};
  readLight(object);
  paper.userData.starObject=object;
  stars.push(object);
  updateCount();return object;
}
// Stars out in the dark are taken out of the scene entirely, so three.js only walks
// through (and draws) the hundred or so near the boat, not all of them.
function setShown(s,on){
  if(s.shown===on)return;s.shown=on;
  if(on)scene.add(s.group,s.pool);else scene.remove(s.group,s.pool);
}
let cachedGlow;
function glowTexture(){
  if(cachedGlow) return cachedGlow;
  const canvas=document.createElement('canvas');canvas.width=128;canvas.height=128;
  const ctx=canvas.getContext('2d');const grd=ctx.createRadialGradient(64,64,2,64,64,64);
  grd.addColorStop(0,'rgba(255,255,255,1)');grd.addColorStop(.25,'rgba(255,255,255,.40)');grd.addColorStop(1,'rgba(255,255,255,0)');
  ctx.fillStyle=grd;ctx.fillRect(0,0,128,128);cachedGlow=new THREE.CanvasTexture(canvas);return cachedGlow;
}
initialArchive.forEach(item=>makeStar(item));
// Stars released by earlier visitors, then readings stored in Supabase (they override
// the local cache — e.g. readings of released stars made by the inference server).
loadReleasedStars().then(list=>list.forEach(u=>makeStar(newArchiveItem({id:u.starId,image:u.imageUrl,title:u.title,x:u.x,z:u.z}))))
 .catch(err=>console.warn('Released stars unavailable:',err))
 .then(loadPredictions).then(byId=>{for(const s of stars){const r=byId?.[s.item.id];if(!r||!(r.predictions.tm||r.predictions.clip||r.predictions.mn))continue;
  s.item.predictions=r.predictions;s.item.analysisStatus=r.analysisStatus;s.item.modelVersion=r.modelVersion;readLight(s);
  if(!REVEAL.onApproach||revealedIds.has(s.item.id))s.revealed=true;}})
 .catch(err=>console.warn('Predictions unavailable:',err));

// Folded paper boat: pointed bow and stern, sloping sides, a triangular "sail"
// standing up in the middle (the doubled paper of the classic fold). Faces are flat
// like creased paper; fold lines are drawn in a crayon-blue line. Bow points to −Z.
function paperTexture(){
  const c=document.createElement('canvas');c.width=c.height=256;const g=c.getContext('2d');
  g.fillStyle=BOAT.paperColor;g.fillRect(0,0,256,256);
  if(BOAT.showGrid){g.strokeStyle=BOAT.gridColor;g.lineWidth=1.4;
    for(let i=0;i<=256;i+=24){g.beginPath();g.moveTo(i+Math.random(),0);g.lineTo(i+Math.random(),256);g.stroke();
      g.beginPath();g.moveTo(0,i+Math.random());g.lineTo(256,i+Math.random());g.stroke();}}
  for(let i=0;i<900;i++){g.fillStyle=`rgba(120,110,100,${Math.random()*.06})`;g.fillRect(Math.random()*256,Math.random()*256,1.5,1.5);} // paper tooth
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;return t;
}
function makeBoat(){
 const g=new THREE.Group();
 const L=BOAT.length/2,W=BOAT.width/2,H=BOAT.sailHeight,o=BOAT.sailOpen;
 const b=L*.55,w0=W*.32,rim=BOAT.rimHeight,tipY=BOAT.tipHeight,s=L*.44;
 const P={
  keelLF:[-w0,0,-b],keelLB:[-w0,0,b],keelRF:[w0,0,-b],keelRB:[w0,0,b],  // flat bottom
  tipF:[0,tipY,-L],tipB:[0,tipY,L],                                       // raised bow and stern
  rimLF:[-W,rim,-s],rimLB:[-W,rim,s],rimRF:[W,rim,-s],rimRB:[W,rim,s],    // top of the hull sides
  sailLF:[-o,rim,-s],sailLB:[-o,rim,s],sailRF:[o,rim,-s],sailRB:[o,rim,s],// base of the centre peak
  apex:[0,H,0]
 };
 // A closed solid: every face shares its edges, so there are no gaps or slits.
 const faces=[
  // hull sides (each a trapezoid plus the triangles that rise to bow and stern)
  ['keelLF','keelLB','rimLB'],['keelLF','rimLB','rimLF'],['keelLB','tipB','rimLB'],['keelLF','rimLF','tipF'],
  ['keelRF','rimRB','keelRB'],['keelRF','rimRF','rimRB'],['keelRB','rimRB','tipB'],['keelRF','tipF','rimRF'],
  // bow / stern ends and the bottom
  ['keelLB','keelRB','tipB'],['keelRF','keelLF','tipF'],['keelLF','keelRF','keelRB'],['keelLF','keelRB','keelLB'],
  // decks either side of the peak, and the flaps that rise to the tips
  ['rimLF','rimLB','sailLB'],['rimLF','sailLB','sailLF'],['rimRF','sailRB','rimRB'],['rimRF','sailRF','sailRB'],
  ['tipF','rimLF','sailLF'],['tipF','sailLF','sailRF'],['tipF','sailRF','rimRF'],
  ['tipB','sailLB','rimLB'],['tipB','sailRB','sailLB'],['tipB','rimRB','sailRB'],
  // the centre peak: a four-sided pyramid
  ['sailLF','sailLB','apex'],['sailRB','sailRF','apex'],['sailRF','sailLF','apex'],['sailLB','sailRB','apex']
 ];
 const pos=[],uv=[],a=new THREE.Vector3(),b2=new THREE.Vector3(),c=new THREE.Vector3(),n=new THREE.Vector3();
 for(const f of faces){
  a.fromArray(P[f[0]]);b2.fromArray(P[f[1]]);c.fromArray(P[f[2]]);
  n.subVectors(b2,a).cross(c.clone().sub(a));
  const ax=Math.abs(n.x),ay=Math.abs(n.y),az=Math.abs(n.z);
  for(const v of [a,b2,c]){                                   // grid paper projected per face
   pos.push(v.x,v.y,v.z);
   const [u,w]=ax>=ay&&ax>=az?[v.z,v.y]:ay>=az?[v.x,v.z]:[v.x,v.y];
   uv.push(u*BOAT.gridScale,w*BOAT.gridScale);
  }
 }
 const geo=new THREE.BufferGeometry();
 geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
 geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
 geo.computeVertexNormals();
 g.add(new THREE.Mesh(geo,new THREE.MeshStandardMaterial({map:paperTexture(),roughness:.9,side:THREE.DoubleSide,flatShading:true})));
 // Soft crayon line along each fold.
 g.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo,12),new THREE.LineBasicMaterial({color:BOAT.lineColor,transparent:true,opacity:BOAT.lineOpacity})));
 return g;
}
const boat=makeBoat();
boat.scale.setScalar(BOAT.scale);
scene.add(boat);
boat.position.set(0,.13,0);
const keys=new Set();
window.addEventListener('keydown',e=>{
 const key=e.key.toLowerCase();if(['arrowup','arrowdown','arrowleft','arrowright',' '].includes(key))e.preventDefault();
 if(isOpen())return;
 keys.add(key);if(key==='e'){const s=nearestStar();if(s&&distanceTo(s)<INTERACTION.reach)openCard(s);}
});
window.addEventListener('keyup',e=>keys.delete(e.key.toLowerCase()));
window.addEventListener('blur',()=>keys.clear());

let near=null;
function distanceTo(s){return Math.hypot(s.item.position.x-boat.position.x,s.item.position.z-boat.position.z);}
function nearestStar(){let closest=null;let best=Infinity;for(const s of stars){let d=distanceTo(s);if(d<best){best=d;closest=s;}}return closest;}
function updateCount(){$('star-count').textContent=`${String(stars.length).padStart(2,'0')} stars adrift`;}
function resize(){let w=world.clientWidth,h=world.clientHeight;camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h,false);
  composer.setPixelRatio(renderer.getPixelRatio());composer.setSize(w,h);}
window.addEventListener('resize',resize);resize();

function onPointerMove(event){
  const rect=renderer.domElement.getBoundingClientRect();mouse.x=((event.clientX-rect.left)/rect.width)*2-1;mouse.y=-((event.clientY-rect.top)/rect.height)*2+1;
  raycaster.setFromCamera(mouse,camera);
  const hits=raycaster.intersectObjects(pickTargets.filter(p=>p.userData.starObject.shown),false);
  const target=hits.length?hits[0].object.userData.starObject:null;
  renderer.domElement.style.cursor=target&&distanceTo(target)<INTERACTION.reach?'pointer':'default';
}
renderer.domElement.addEventListener('pointermove',onPointerMove);
renderer.domElement.addEventListener('click',(event)=>{
 if(isOpen())return;
 onPointerMove(event);
 const hits=raycaster.intersectObjects(pickTargets.filter(p=>p.userData.starObject.shown),false);
 if(hits.length){const s=hits[0].object.userData.starObject;if(distanceTo(s)<INTERACTION.reach)openCard(s);else showToast('Sail a little closer to retrieve this star.');}
});

// Polaroid interaction.
let selected=null;
// Sailing pauses while the Polaroid or the about page is open.
function isOpen(){return $('modal').classList.contains('open')||$('about').classList.contains('open');}
function openCard(s){selected=s;keys.clear();const item=s.item;$('card-image').src=item.image;$('card-image').alt=item.title;
 const kept=item.humanCategories.length?item.humanCategories.join(' · ').toUpperCase():(item.uploaded?'RELEASED':'UNSORTED');
 $('card-id').textContent=`${item.id.toUpperCase()}  /  ${kept}`;
 $('card-quote').textContent=quoteFor(item);
 const credit=creditFor(item);$('card-credit').hidden=!credit;
 if(credit){$('card-credit').textContent=credit.text;$('card-credit').href=credit.href||'#';}
 for(const key of MODEL_KEYS){const v=modelScore(item,key);const bar=$('bar-'+key);
  bar.style.width='0%';bar.parentElement.classList.toggle('unread',v===null);
  bar.closest('.reading-row').title=readingDetail(item,key);
  if(v!==null)setTimeout(()=>{bar.style.width=`${Math.round(v*100)}%`;},260+MODEL_KEYS.indexOf(key)*140);} // bars draw in one by one
 const agree={agree:'THE READINGS AGREE',partial:'THE READINGS PARTLY AGREE',disagree:'THE READINGS DISAGREE'}[agreementLabel(item.predictions)];
 $('demo-label').textContent=item.analysisStatus==='analyzing'?'BEING READ…':relatedness(item)===null?'NOT YET READ BY THE MACHINES':agree??'ONE READING SO FAR';
 $('modal').classList.add('open');$('modal').setAttribute('aria-hidden','false');
 $('write-panel').hidden=true;$('read-panel').hidden=true;
 $('close-card').focus();
}
function closeCard(){$('modal').classList.remove('open');$('modal').setAttribute('aria-hidden','true');selected=null;keys.clear();}
$('close-card').addEventListener('click',closeCard);
$('modal-wash').addEventListener('click',closeCard);
window.addEventListener('keydown',e=>{if(e.key==='Escape'&&isOpen()){closeCard();closeAbout();}});
// About page: the title line at the bottom opens it over a blue blur.
function openAbout(){keys.clear();$('about').classList.add('open');$('about').setAttribute('aria-hidden','false');$('about-close').focus();}
function closeAbout(){if(!$('about').classList.contains('open'))return;$('about').classList.remove('open');$('about').setAttribute('aria-hidden','true');keys.clear();$('about-open').focus();}
$('about-open').addEventListener('click',openAbout);
$('about-close').addEventListener('click',closeAbout);
$('about').addEventListener('click',e=>{if(e.target===$('about'))closeAbout();});
$('write-toggle').addEventListener('click',()=>{$('write-panel').hidden=!$('write-panel').hidden;$('read-panel').hidden=true;if(!$('write-panel').hidden)$('note-input').focus();});
$('save-note').textContent=isRemote?'Leave this note':'Keep this note locally';
$('notes-source').textContent=isRemote?'Notes left by visitors to this sea.':'Local preview only · notes stay in this browser.';
$('read-toggle').addEventListener('click',async()=>{
 $('read-panel').hidden=!$('read-panel').hidden;$('write-panel').hidden=true;
 if(!selected||$('read-panel').hidden)return;
 const starId=selected.item.id;
 $('notes-list').textContent='Listening…';
 let notes;
 try{notes=await loadNotes(starId);}catch(err){console.error(err);$('notes-list').textContent='The notes could not be reached just now.';return;}
 if(selected?.item.id!==starId)return;
 $('notes-list').replaceChildren();
 if(!notes.length){$('notes-list').textContent='No one has left a note here yet.';return;}
 for(const n of notes){const p=document.createElement('p');p.className='note-item';p.textContent='“'+n.text+'”';$('notes-list').append(p);}
});
$('save-note').addEventListener('click',async()=>{
 if(!selected)return;const note=$('note-input').value.trim();if(!note)return;
 $('save-note').disabled=true;
 try{await saveNote(selected.item.id,note);
  $('note-input').value='';$('write-panel').hidden=true;
  showToast(isRemote?'A thought was left with this star.':'A thought was left with this star (saved in this browser).');
 }catch(err){console.error(err);showToast(String(err.message||'The note could not be sent. Please try again.'));}
 finally{$('save-note').disabled=false;}
});
let toastTimeout;function showToast(message){const el=$('toast');el.textContent=message;el.classList.add('show');clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>el.classList.remove('show'),2900);}

// Upload: session-only without Supabase; with it, the star is kept for every visitor.
$('add-image').addEventListener('click',()=>$('upload-input').click());
$('upload-input').addEventListener('change',async(e)=>{
 const file=e.target.files?.[0];if(!file)return;
 if(!file.type.startsWith('image/')){showToast('Please choose an image.');return;}
 if(file.size>INTERACTION.maxUploadMB*1024*1024){showToast(`Please use an image smaller than ${INTERACTION.maxUploadMB} MB.`);return;}
 e.target.value='';
 let dataURL;
 try{dataURL=await shrinkImage(file);}catch{showToast('This image could not be read.');return;}
 const [rMin,rMax]=INTERACTION.releaseDistance;
 const angle=Math.random()*Math.PI*2,r=rMin+Math.random()*(rMax-rMin);
 const x=+(boat.position.x+Math.cos(angle)*r).toFixed(2),z=+(boat.position.z+Math.sin(angle)*r).toFixed(2);
 const title=file.name.replace(/\.[^.]+$/,'').slice(0,120);
 const item=newArchiveItem({image:dataURL,title,x,z});
 makeStar(item,true);
 if(!isRemote){showToast('A new star has fallen into the sea. Its model readings are not yet available.');return;}
 try{const saved=await releaseStar({imageDataURL:dataURL,title,x:item.position.x,z:item.position.z});item.id=saved.starId;
  showToast('A new star has fallen into the sea, and it will stay.');
 }catch(err){console.error(err);showToast('The star fell, but could not be kept: '+(err.message||'network error'));}
});

// ---------------------------------------------------------------- collision
// Boat = two circles along its keel; star = one circle. The boat shoves stars aside,
// pushed stars nudge their neighbours, and water friction slowly stops them.
const boatVel=new THREE.Vector2();const lastBoat=new THREE.Vector2();
let pushing=0;
function boatForward(){return [-Math.sin(boat.rotation.y),-Math.cos(boat.rotation.y)];}
function boatCircles(){
  const [fx,fz]=boatForward(),o=COLLISION.boatLength;
  return [[boat.position.x+fx*o,boat.position.z+fz*o],[boat.position.x-fx*o,boat.position.z-fz*o]];
}
// Stars bucketed into square cells so a moving star only checks its neighbours.
// Cells are wider than any two touching stars, so the 3×3 block around a star is enough.
const GRID_CELL=COLLISION.starRadius*STARS.sizeMax*2+.5;
function buildGrid(){
  const grid=new Map();
  for(const s of stars){
    const key=Math.floor(s.item.position.x/GRID_CELL)*4096+Math.floor(s.item.position.z/GRID_CELL);
    let cell=grid.get(key);if(!cell)grid.set(key,cell=[]);cell.push(s);
  }
  return grid;
}
function collide(dt){
  boatVel.set((boat.position.x-lastBoat.x)/Math.max(dt,1e-4),(boat.position.z-lastBoat.y)/Math.max(dt,1e-4));
  lastBoat.set(boat.position.x,boat.position.z);
  const circles=boatCircles();let hit=0;
  const [fx,fz]=boatForward(),px=-fz,pz=fx;                   // px,pz = boat's starboard side
  for(const s of stars){
    if(s.fall&&s.group.position.y>STARS.floatHeight+.6)continue;  // still in the air
    const p=s.item.position,rs=COLLISION.starRadius*s.size;
    for(const [cx,cz] of circles){
      const dx=p.x-cx,dz=p.z-cz,d=Math.hypot(dx,dz)||1e-4,min=COLLISION.boatRadius+rs;
      if(d>=min)continue;
      const nx=dx/d,nz=dz/d;
      p.x+=nx*(min-d);p.z+=nz*(min-d);                       // no passing through
      const approach=Math.max(0,boatVel.x*nx+boatVel.y*nz);
      // Deflect toward the side the star already sits on, so it slides past the hull.
      const side=Math.sign(nx*px+nz*pz)||(s.phase>Math.PI?1:-1);
      const vx=nx+px*side*COLLISION.sideways,vz=nz+pz*side*COLLISION.sideways,vl=Math.hypot(vx,vz);
      s.vel.x+=vx/vl*approach*COLLISION.push;s.vel.y+=vz/vl*approach*COLLISION.push;
      s.wobble=Math.min(.35,s.wobble+approach*.03*COLLISION.wobble*4);
      hit=1;
    }
  }
  pushing+=(hit-pushing)*Math.min(1,dt*6);
  // Like moored buoys, displaced stars are gently drawn back to their place, so the
  // sea keeps its layout after the boat has passed.
  for(const s of stars){
    const p=s.item.position,hx=s.home.x-p.x,hz=s.home.z-p.z;
    if(hx*hx+hz*hz<1e-4||s.fall)continue;
    s.vel.x+=hx*COLLISION.homeSpring*dt;s.vel.y+=hz*COLLISION.homeSpring*dt;
  }
  // Moving stars glide and jostle their neighbours (only those in nearby grid cells).
  const damp=Math.exp(-COLLISION.friction*dt);
  let grid=null;
  for(const s of stars){
    if(s.vel.lengthSq()<1e-5){s.vel.set(0,0);continue;}
    grid??=buildGrid();
    const p=s.item.position;p.x+=s.vel.x*dt;p.z+=s.vel.y*dt;s.vel.multiplyScalar(damp);
    if(keepInside(p,COLLISION.starRadius*s.size)){const d=Math.hypot(p.x,p.z),out=(s.vel.x*p.x+s.vel.y*p.z)/d;
      if(out>0){s.vel.x-=2*out*p.x/d*.5;s.vel.y-=2*out*p.z/d*.5;}}            // soft bounce off the edge
    const cx=Math.floor(p.x/GRID_CELL),cz=Math.floor(p.z/GRID_CELL);
    for(let gx=cx-1;gx<=cx+1;gx++)for(let gz=cz-1;gz<=cz+1;gz++)for(const o of grid.get(gx*4096+gz)||[]){
      if(o===s)continue;
      const q=o.item.position,dx=q.x-p.x,dz=q.z-p.z,min=COLLISION.starRadius*(s.size+o.size);
      if(Math.abs(dx)>min||Math.abs(dz)>min)continue;
      const d=Math.hypot(dx,dz)||1e-4;if(d>=min)continue;
      const nx=dx/d,nz=dz/d,push=(min-d)/2;
      p.x-=nx*push;p.z-=nz*push;q.x+=nx*push;q.z+=nz*push;
      const along=(s.vel.x-o.vel.x)*nx+(s.vel.y-o.vel.y)*nz;
      if(along>0){const j=along*COLLISION.starBounce;s.vel.x-=nx*j;s.vel.y-=nz*j;o.vel.x+=nx*j;o.vel.y+=nz*j;
        o.wobble=Math.min(.35,o.wobble+j*.05*COLLISION.wobble*4);}
    }
  }
}

// ---------------------------------------------------------------- wake
// While the boat moves it leaves small spreading rings: one at the stern, and
// alternating ones off each side of the bow.
let wakeTravel=0,wakeSide=1;const lastWake=new THREE.Vector2();
function leaveWake(){
  wakeTravel+=Math.hypot(boat.position.x-lastWake.x,boat.position.z-lastWake.y);
  lastWake.set(boat.position.x,boat.position.z);
  if(wakeTravel<WAKE.spacing)return;
  wakeTravel=0;
  const [fx,fz]=boatForward(),half=BOAT.length/2*BOAT.scale;
  addRipple(boat.position.x-fx*half*.85,boat.position.z-fz*half*.85,WAKE.color,WAKE.speed,WAKE.size,WAKE.opacity);
  if(WAKE.bowWaves){
    wakeSide*=-1;const sx=-fz*wakeSide,sz=fx*wakeSide,off=BOAT.width/2*BOAT.scale;
    addRipple(boat.position.x+fx*half*.45+sx*off,boat.position.z+fz*half*.45+sz*off,WAKE.color,WAKE.speed*1.2,WAKE.size*.7,WAKE.opacity*.8);
  }
}

// Add ?fps to the address (e.g. localhost:5173/?fps) to show a small frame-rate counter.
const fpsMeter=new URLSearchParams(location.search).has('fps')?(()=>{
  const el=document.createElement('div');el.style.cssText='position:fixed;left:8px;bottom:8px;z-index:99;font:12px monospace;color:#cfe;background:#0008;padding:3px 6px;border-radius:4px;pointer-events:none';
  document.body.appendChild(el);let n=0,t0=performance.now();
  return {tick(){n++;const t=performance.now();if(t-t0>=1000){el.textContent=`${Math.round(n*1000/(t-t0))} fps · ${stars.filter(s=>s.shown).length} stars drawn`;n=0;t0=t;}}};
})():null;
let elapsed=0,lastPrompt=null;
function animate(){requestAnimationFrame(animate);const dt=Math.min(clock.getDelta(),.05);elapsed+=dt;
 ocean.material.uniforms.uTime.value=elapsed;
 if(!isOpen()){
  let dx=0,dz=0;if(keys.has('w')||keys.has('arrowup'))dz-=1;if(keys.has('s')||keys.has('arrowdown'))dz+=1;
  if(keys.has('a')||keys.has('arrowleft'))dx-=1;if(keys.has('d')||keys.has('arrowright'))dx+=1;
  if(dx||dz){const mag=Math.hypot(dx,dz);dx/=mag;dz/=mag;const step=dt*BOAT.speed*(1-pushing*COLLISION.boatDrag);
    const hx=dx,hz=dz;                                          // heading follows the keys
    // Near the edge, the outward part of the motion fades away; the boat slides along it.
    const d=Math.hypot(boat.position.x,boat.position.z);
    if(d>SEA_EDGE-BOUNDARY.softness&&d>0){
      const rx=boat.position.x/d,rz=boat.position.z/d,out=dx*rx+dz*rz;
      if(out>0){const keep=Math.max(0,(SEA_EDGE-d)/BOUNDARY.softness);dx-=rx*out*(1-keep);dz-=rz*out*(1-keep);}
    }
    boat.position.x+=dx*step;boat.position.z+=dz*step;
    keepInside(boat.position,0);
    leaveWake();
    const turn=Math.min(dt*BOAT.turnSpeed,.3);
    boat.rotation.y+=(Math.atan2(-hx,-hz)-boat.rotation.y+Math.PI*3)%(Math.PI*2)*turn-Math.PI*turn;}
  boat.position.y=BOAT.floatY+Math.sin(elapsed*1.7)*.055;
  boat.rotation.z=Math.sin(elapsed*1.25)*.035;
  const target=new THREE.Vector3(boat.position.x,CAMERA.height,boat.position.z+CAMERA.distance);
  camera.position.lerp(target,Math.min(1,dt*CAMERA.follow));
  camera.lookAt(boat.position.x,0,boat.position.z-1);
 }
 collide(dt);
 for(const s of stars){
  // Outside the visible range the star is not drawn (or animated) at all.
  const shade=s.fall?0:viewShade(s.item.position.x,s.item.position.z);
  const visible=shade<.995;
  setShown(s,visible);
  if(!visible){if(s.tex&&distanceTo(s)>VIEW.fadeRadius+8)releaseImage(s);continue;}
  if(s.fall){s.group.position.y+=s.fall.vel*dt;s.fall.vel-=INTERACTION.gravity*dt;
   if(s.group.position.y<=STARS.floatHeight){s.group.position.y=STARS.floatHeight;addRipple(s.item.position.x,s.item.position.z,INTERACTION.dropRippleColor,1.45);
    const bounce=INTERACTION.dropBounces[s.fall.bounces++];
    if(bounce===undefined){s.fall=null;}else{s.fall.vel=bounce;}
   }}else{s.group.position.y=STARS.floatHeight+Math.sin(elapsed*STARS.bobSpeed+s.phase)*STARS.bobAmount;}
  s.group.position.x=s.item.position.x;s.group.position.z=s.item.position.z;
  s.pool.position.x=s.item.position.x;s.pool.position.z=s.item.position.z;
  s.wobble*=Math.exp(-3*dt);
  s.paper.rotation.y+=dt*STARS.spinSpeed;s.paper.rotation.z=Math.sin(elapsed*.8+s.phase)*STARS.tilt+Math.sin(elapsed*9+s.phase)*s.wobble;
  s.paper.rotation.x=Math.cos(elapsed*7+s.phase)*s.wobble*.6;
  if(!s.revealed&&!s.fall&&distanceTo(s)<REVEAL.radius)revealStar(s);
  if(!s.tex)wrapImage(s);
  s.paper.material.userData.shade.value=shade;
  updateLight(s,dt);
  s.glow.material.opacity*=1-shade;
 }
 const next=nearestStar();near=next&&distanceTo(next)<INTERACTION.reach?next:null;
 const prompt=!isOpen()&&near?'✦  A star is near · click it or press E to retrieve':'';
 if(prompt!==lastPrompt){$('nearby-prompt').textContent=prompt;lastPrompt=prompt;}   // a DOM write every frame re-runs the crayon filter
 if(near&&elapsed-near.lastRipple>INTERACTION.nearRippleEvery&&!isOpen()){near.lastRipple=elapsed;addRipple(near.item.position.x,near.item.position.z,INTERACTION.nearRippleColor,.6);}
 for(let i=ripples.length-1;i>=0;i--){let r=ripples[i];r.life+=dt*r.speed;r.mesh.scale.setScalar((.2+r.life*RIPPLES.growth)*r.size);r.mesh.material.opacity=r.opacity*Math.max(0,1-r.life/RIPPLES.life);
  if(r.life>RIPPLES.life){scene.remove(r.mesh);r.mesh.material.dispose();ripples.splice(i,1);}}
 updateGlints();
 view.uBoat.value.set(boat.position.x,boat.position.z);
 composer.render();
 if(fpsMeter)fpsMeter.tick();
}
camera.position.set(0,CAMERA.height,CAMERA.distance);camera.lookAt(0,0,-1);animate();
