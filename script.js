// ※ import は不要（three.min.js を index.html で読み込み済み）

// ====== 機体データ ======
const TYPES = {
  laser: {
    key:'laser', name:'TYPE-A：レーザー', color:0x7ee0ff,
    spec:'連続レーザー（押している間だけ発射）。エネルギー消費あり。機動力：中、耐久：中。',
    hp:100, speed:20, hasEnergy:true, energyMax:100, energyRegen:14, energyDrain:25, laserDPS:55
  },
  bullet: {
    key:'bullet', name:'TYPE-B：一方向弾', color:0x9cff89,
    spec:'前方に高速連射。扱いやすい。機動力：高、耐久：中。',
    hp:105, speed:24, hasEnergy:false, rof:12, dmg:1.0
  },
  scatter: {
    key:'scatter', name:'TYPE-C：拡散弾', color:0xffda7b,
    spec:'3方向ショット。制圧向き。機動力：やや低、耐久：高。',
    hp:120, speed:18, hasEnergy:false, rof:6, dmg:0.8, spread:true
  }
};

// ====== UI 参照 ======
const choicesEl = document.getElementById('choices');
const descEl = document.getElementById('desc');
const startBtn = document.getElementById('startBtn');
const menuEl = document.getElementById('menu');
const hudEl = document.getElementById('hud');
const overEl = document.getElementById('overlay');
const overTitle = document.getElementById('overTitle');
const finalScore = document.getElementById('finalScore');

const hpBar = document.getElementById('hpbar');
const hpText = document.getElementById('hptext');
const enBar = document.getElementById('enbar');
const enText = document.getElementById('entext');
const energyRow = document.getElementById('energyRow');
const scoreEl = document.getElementById('score');

// ====== 選択カード生成 ======
let selectedType = null;
for (const t of Object.values(TYPES)) {
  const c = document.createElement('div');
  c.className = 'card';
  c.dataset.type = t.key;
  c.innerHTML = `
    <div style="display:flex; align-items:center; gap:10px;">
      <div style="width:16px; height:16px; border-radius:50%; background:#fff; box-shadow:0 0 10px #fff; filter: drop-shadow(0 0 4px #fff);"></div>
      <div style="font-weight:700">${t.name}</div>
    </div>
    <div class="muted" style="margin-top:6px">${t.spec}</div>
  `;
  c.addEventListener('click', () => {
    document.querySelectorAll('.card').forEach(x=>x.classList.remove('selected'));
    c.classList.add('selected');
    selectedType = t.key;
    descEl.textContent = t.spec;
    startBtn.disabled = false;
  });
  choicesEl.appendChild(c);
}

document.getElementById('how').addEventListener('click', () => {
  alert("操作：WASD / 方向キーで移動。\nTYPE-Aはスペースまたはクリックでレーザー（押している間）。\nTYPE-B/Cは自動射撃。\n敵や弾に当たるとダメージ。スコアは撃破数。");
});
startBtn.addEventListener('click', () => {
  if (!selectedType) return;
  menuEl.style.display = 'none';
  hudEl.hidden = false;
  startGame(selectedType);
});
document.getElementById('restart').addEventListener('click', ()=> location.reload());

// ====== three.js / ゲーム本体 ======
let scene, camera, renderer, clock;
let player, playerCore, playerStats, keys = {}, mouseDown = false;
let bullets = [], enemies = [], fx = [];
let lastShot = 0, score = 0, running = true;
let starField;
let laserLine = null, raycaster = new THREE.Raycaster();

function startGame(typeKey){
  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x02050f, 50, 340);
  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1200);
  camera.position.set(0, 0, 60);
  camera.lookAt(0,0,0);

  renderer = new THREE.WebGLRenderer({ antialias:true, alpha:false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x02050f, 1);
  document.getElementById('game').appendChild(renderer.domElement);

  clock = new THREE.Clock();

  const amb = new THREE.AmbientLight(0xffffff, 0.6); scene.add(amb);
  const dir = new THREE.DirectionalLight(0xffffff, 0.7); dir.position.set(2,3,1); scene.add(dir);

  makeStars();
  createPlayer(TYPES[typeKey]);
  addEvents();

  running = true;
  animate();
}

function makeStars(){
  const starCount = 1200;
  const geom = new THREE.BufferGeometry();
  const positions = new Float32Array(starCount*3);
  for (let i=0;i<starCount;i++){
    positions[i*3]   = (Math.random()*2-1)*90;
    positions[i*3+1] = (Math.random()*2-1)*55;
    positions[i*3+2] = -Math.random()*350 - 10;
  }
  geom.setAttribute('position', new THREE.BufferAttribute(positions,3));
  const mat = new THREE.PointsMaterial({ size: 0.8, color: 0x9cc7ff });
  starField = new THREE.Points(geom, mat);
  starField.userData = { speed: 22 };
  scene.add(starField);
}

function createPlayer(type){
  player = new THREE.Group();
  const body = new THREE.ConeGeometry(2.2, 6, 12);
  const mat  = new THREE.MeshStandardMaterial({
    color:type.color, metalness:.5, roughness:.35,
    emissive: type.key==='laser'?0x083b53:0x3a2a06, emissiveIntensity:.6
  });
  const mesh = new THREE.Mesh(body, mat);
  mesh.rotation.x = Math.PI/2;
  playerCore = mesh;
  player.add(mesh);

  const wingGeo = new THREE.BoxGeometry(6.0, .2, 1.6);
  const wing = new THREE.Mesh(
    wingGeo,
    new THREE.MeshStandardMaterial({ color:0xabcdef, metalness:.5, roughness:.2, emissive:0x111111, emissiveIntensity:.4 })
  );
  wing.position.set(0, -1.2, 0.6);
  player.add(wing);

  player.position.set(0, 0, 20);
  scene.add(player);

  playerStats = {
    type: type.key,
    hp: type.hp, hpMax: type.hp,
    speed: type.speed,
    hasEnergy: !!type.hasEnergy,
    energy: type.hasEnergy ? type.energyMax : 0,
    energyMax: type.energyMax || 0,
    energyRegen: type.energyRegen || 0,
    energyDrain: type.energyDrain || 0,
    laserDPS: type.laserDPS || 0,
    rof: type.rof || 0,
    dmg: type.dmg || 1,
    spread: !!type.spread,
    bounds: { x: 36, y: 22 }
  };

  if (playerStats.type === 'laser') {
    const laserGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0,0,0), new THREE.Vector3(0,0,-260)
    ]);
    const laserMat = new THREE.LineBasicMaterial({ color: 0x77e6ff, transparent:true, opacity:0.0 });
    laserLine = new THREE.Line(laserGeo, laserMat);
    player.add(laserLine);
    energyRow.style.display = '';
  } else {
    energyRow.style.display = 'none';
  }

  scheduleSpawn();
  updateHUD();
}

function scheduleSpawn(){
  const base = 900;
  let t = Math.max(350, base - score*4);
  setTimeout(()=>{ if(running){ spawnEnemy(); scheduleSpawn(); } }, t);
}

function spawnEnemy(){
  const geo = new THREE.IcosahedronGeometry( Math.random()*1.3 + 1.4, 0 );
  const mat = new THREE.MeshStandardMaterial({ color: 0xff6b6b, metalness:.2, roughness:.8, emissive:0x220000, emissiveIntensity:.5 });
  const m = new THREE.Mesh(geo, mat);
  m.position.set( (Math.random()*2-1)*36, (Math.random()*2-1)*22, -220 - Math.random()*80 );
  m.userData = {
    hp: 3 + Math.floor(Math.random()*3),
    speed: 26 + Math.random()*10,
    sinX: Math.random()*Math.PI*2,
    sinY: Math.random()*Math.PI*2,
    r: geo.parameters.radius || 1.8
  };
  enemies.push(m);
  scene.add(m);
}

function addEvents(){
  window.addEventListener('resize', onResize);
  window.addEventListener('keydown', e => { keys[e.key.toLowerCase()] = true; if(e.code==='Space') keys['space']=true; });
  window.addEventListener('keyup',   e => { keys[e.key.toLowerCase()] = false; if(e.code==='Space') keys['space']=false; });
  window.addEventListener('mousedown', ()=>{ mouseDown = true; });
  window.addEventListener('mouseup',   ()=>{ mouseDown = false; });

  // タッチ簡易対応
  window.addEventListener('touchstart', (e)=>{
    if (playerStats?.type==='laser') mouseDown=true;
    e.preventDefault();
  }, {passive:false});
  window.addEventListener('touchend',   (e)=>{
    mouseDown=false;
    e.preventDefault();
  }, {passive:false});
  window.addEventListener('touchmove', (e)=>{
    if (!running) return;
    const t = e.touches[0]; if (!t) return;
    const dx = (t.clientX / window.innerWidth - 0.5) * 2;
    const dy = (t.clientY / window.innerHeight - 0.5) * -2;
    player.position.x = dx * playerStats.bounds.x;
    player.position.y = dy * playerStats.bounds.y;
    e.preventDefault();
  }, {passive:false});
}

function onResize(){
  if (!renderer) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate(){
  const dt = Math.min(.05, clock.getDelta());
  if (!running) return;

  updateStars(dt);
  updatePlayer(dt);
  updateEnemies(dt);
  updateBullets(dt);
  updateFX(dt);

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

function updateStars(dt){
  const pos = starField.geometry.attributes.position;
  const n = pos.count, spd = starField.userData.speed;
  for (let i=0;i<n;i++){
    let z = pos.getZ(i) + spd * dt;
    if (z > 60) z = -320 - Math.random()*40;
    pos.setZ(i, z);
  }
  pos.needsUpdate = true;
}

function updatePlayer(dt){
  let vx=0, vy=0;
  if (keys['arrowleft']||keys['a'])  vx -= 1;
  if (keys['arrowright']||keys['d']) vx += 1;
  if (keys['arrowup']||keys['w'])    vy += 1;
  if (keys['arrowdown']||keys['s'])  vy -= 1;

  const sp = playerStats.speed;
  player.position.x = THREE.MathUtils.clamp(player.position.x + vx*sp*dt, -playerStats.bounds.x, playerStats.bounds.x);
  player.position.y = THREE.MathUtils.clamp(player.position.y + vy*sp*dt, -playerStats.bounds.y, playerStats.bounds.y);
  player.rotation.z = THREE.MathUtils.lerp(player.rotation.z, -vx*0.25, 0.15);

  if (playerStats.type === 'laser') handleLaser(dt);
  else autoFire(dt);

  updateHUD();
}

function handleLaser(dt){
  if (mouseDown || keys['space']) {
    if (playerStats.energy > 0) {
      playerStats.energy = Math.max(0, playerStats.energy - playerStats.energyDrain*dt);
      if (laserLine) laserLine.material.opacity = 0.9;
      laserHit(dt);
    } else {
      if (laserLine) laserLine.material.opacity = 0.0;
    }
  } else {
    if (laserLine) laserLine.material.opacity = 0.0;
    playerStats.energy = Math.min(playerStats.energyMax, playerStats.energy + playerStats.energyRegen*dt);
  }
}

function laserHit(dt){
  const origin = new THREE.Vector3().setFromMatrixPosition(player.matrixWorld);
  const dir = new THREE.Vector3(0,0,-1).applyQuaternion(player.quaternion);
  raycaster.set(origin, dir);
  raycaster.far = 320;
  const intersects = raycaster.intersectObjects(enemies, false);
  if (intersects.length>0) {
    const obj = intersects[0].object;
    obj.userData.hp -= playerStats.laserDPS * dt;
    spawnSpark(intersects[0].point);
    if (obj.userData.hp <= 0) destroyEnemy(obj, true);
  }
}

function autoFire(dt){
  const now = performance.now()/1000;
  const rate = 1 / (playerStats.rof || 8);
  if (now - lastShot >= rate) { lastShot = now; shootBullet(); }
}

function shootBullet(){
  const make = (angleOffset=0)=>{
    const g = new THREE.SphereGeometry(0.5, 8, 8);
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive:0x4477ff, emissiveIntensity:1 });
    const b = new THREE.Mesh(g, m);
    b.position.copy(player.position);
    b.userData = { dmg: playerStats.dmg || 1, life: 4 };
    scene.add(b);
    bullets.push(b);
  };
  if (playerStats.spread) { make(0); make(+0.18); make(-0.18); }
  else { make(0); }
}

function updateBullets(dt){
  for (let i=bullets.length-1;i>=0;i--){
    const b = bullets[i];
    b.position.z -= 80*dt;
    b.userData.life -= dt;
    if (b.userData.life <= 0 || b.position.z < -340) {
      scene.remove(b); bullets.splice(i,1); continue;
    }
    for (let j=enemies.length-1;j>=0;j--){
      const e = enemies[j];
      const dist = b.position.distanceTo(e.position);
      if (dist < (e.userData.r + 0.7)) {
        e.userData.hp -= b.userData.dmg;
        spawnSpark(b.position);
        scene.remove(b); bullets.splice(i,1);
        if (e.userData.hp <= 0) destroyEnemy(e, true);
        break;
      }
    }
  }
}

function updateEnemies(dt){
  for (let i=enemies.length-1;i>=0;i--){
    const e = enemies[i];
    e.userData.sinX += dt*2;
    e.userData.sinY += dt*2.3;
    e.position.z += e.userData.speed * dt;
    e.position.x += Math.sin(e.userData.sinX)*8*dt;
    e.position.y += Math.sin(e.userData.sinY)*6*dt;
    e.rotation.x += dt*1.2;
    e.rotation.y += dt*0.8;

    const dToPlayer = e.position.distanceTo(player.position);
    if (dToPlayer < (e.userData.r + 1.8)) { damagePlayer(18); destroyEnemy(e, false); continue; }
    if (e.position.z > camera.position.z + 4) { damagePlayer(12); destroyEnemy(e, false); }
  }
}

function destroyEnemy(e, byPlayer){
  if (byPlayer) { score += 10; scoreEl.textContent = score; }
  spawnBoom(e.position);
  scene.remove(e);
  const idx = enemies.indexOf(e);
  if (idx>=0) enemies.splice(idx,1);
}

function spawnSpark(pos){
  const g = new THREE.SphereGeometry(0.5, 6, 6);
  const m = new THREE.MeshBasicMaterial({ color: 0x8fd3ff });
  const s = new THREE.Mesh(g, m);
  s.position.copy(pos);
  s.userData = { life: .15 };
  fx.push(s); scene.add(s);
}
function spawnBoom(pos){
  const g = new THREE.SphereGeometry(1.2, 10, 10);
  const m = new THREE.MeshBasicMaterial({ color: 0xffaa66 });
  const s = new THREE.Mesh(g, m);
  s.position.copy(pos);
  s.userData = { life: .5 };
  fx.push(s); scene.add(s);
}
function updateFX(dt){
  for (let i=fx.length-1;i>=0;i--){
    const s = fx[i];
    s.scale.addScalar(3*dt);
    s.userData.life -= dt;
    if (s.userData.life <= 0) { scene.remove(s); fx.splice(i,1); }
  }
}

function damagePlayer(v){
  playerStats.hp = Math.max(0, playerStats.hp - v);
  playerCore.material.emissiveIntensity = 1.1;
  setTimeout(()=>{ if(playerCore) playerCore.material.emissiveIntensity=.6; }, 120);
  if (playerStats.hp <= 0) gameOver();
}
function updateHUD(){
  hpBar.style.width = (playerStats.hp/playerStats.hpMax*100).toFixed(1)+'%';
  hpText.textContent = `${Math.ceil(playerStats.hp)}/${playerStats.hpMax}`;
  if (playerStats.hasEnergy) {
    const p = playerStats.energy/playerStats.energyMax*100;
    enBar.style.width = p.toFixed(1)+'%';
    enText.textContent = `${Math.ceil(playerStats.energy)}/${playerStats.energyMax}`;
  }
}
function gameOver(){
  running = false;
  overTitle.textContent = 'GAME OVER';
  finalScore.textContent = `SCORE：${score}`;
  overEl.style.display = 'grid';
}
