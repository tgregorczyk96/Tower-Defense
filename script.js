/* Mittelalter Tower Defense – Branching Upgrades MVP
   - 3 Basistürme: Schütze, Magier, Nahkämpfer
   - Ab Stufe 2 Spezialisierung (2 Pfade) mit 3 Upgrades
   - Gegner mit Armor (physisch) & Magieresistenz (magisch)
   - Canvas-Rendering, einfache UI, Inspector zum Upgraden
*/

// --- Canvas & HUD ---
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const HUD = {
  goldEl: document.getElementById('gold'),
  livesEl: document.getElementById('lives'),
  waveEl: document.getElementById('wave'),
  startWaveBtn: document.getElementById('startWaveBtn'),
  nextWaveBtn: document.getElementById('nextWaveBtn'),
};

const inspectorEl = document.getElementById('inspector');
const inspTitleEl = document.getElementById('insp-title');
const inspBodyEl  = document.getElementById('insp-body');

// --- State ---
let state = {
  gold: 120,
  lives: 20,
  wave: 0,
  running: false,
  placing: null,
  selectedTower: null,
};

// --- Grid / Map ---
const TILE = 40;
const COLS = Math.floor(canvas.width / TILE);
const ROWS = Math.floor(canvas.height / TILE);
let buildable = new Array(COLS * ROWS).fill(true);

// Pfad (Wegpunkte)
const path = [
  {x: 0,   y: 5*TILE + TILE/2},
  {x: 6*TILE + TILE/2, y: 5*TILE + TILE/2},
  {x: 6*TILE + TILE/2, y: 2*TILE + TILE/2},
  {x: 13*TILE + TILE/2, y: 2*TILE + TILE/2},
  {x: 13*TILE + TILE/2, y: 9*TILE + TILE/2},
  {x: 22*TILE + TILE/2, y: 9*TILE + TILE/2},
  {x: canvas.width + 50, y: 9*TILE + TILE/2},
];

function markPathTiles(){
  for(let i=0;i<path.length-1;i++){
    const a = path[i], b = path[i+1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx,dy);
    const steps = Math.ceil(len / (TILE/2));
    for(let s=0;s<=steps;s++){
      const t = s/steps;
      const x = a.x + dx*t;
      const y = a.y + dy*t;
      for(let ox=-1;ox<=1;ox++){
        for(let oy=-1;oy<=1;oy++){
          const col = Math.floor((x+ox*TILE) / TILE);
          const row = Math.floor((y+oy*TILE) / TILE);
          if(col>=0 && col<COLS && row>=0 && row<ROWS){
            buildable[row*COLS + col] = false;
          }
        }
      }
    }
  }
}
markPathTiles();

// --- Game Objects ---
let towers = [];
let enemies = [];
let bullets = [];
let floatingTexts = []; // for small dmg numbers etc.

// --- Data (Blueprints) ---
const TOWERS = {
  archer: {
    name: 'Schütze',
    base: { damage: 18, type: 'physical', fireRate: 0.55, range: 180, size: 16, color: '#563f2e', bulletSpeed: 520 },
    cost: 70,
    paths: [ // choose one
      {
        id: 'crossbow',
        name: 'Armbrustschütze',
        desc: 'Hoher Einzelziel-DPS, rüstungsbrechend.',
        upgrades: [
          { name:'Stahlbolzen', cost: 70, apply: t => { t.mods.damage += 6; t.mods.armorShred = Math.max(t.mods.armorShred||0, 0.15); } },
          { name:'Gezackte Spitzen', cost: 110, apply: t => { t.mods.damage += 10; t.mods.armorShred = Math.max(t.mods.armorShred||0, 0.25); } },
          { name:'Präzisionsschuss', cost: 160, apply: t => { t.mods.crit = {chance:0.2, mult:2.0}; } },
        ]
      },
      {
        id: 'cannon',
        name: 'Kanonier',
        desc: 'Splash-Schaden für Gruppen.',
        upgrades: [
          { name:'Pulverladung', cost: 80, apply: t => { t.mods.aoeRadius = Math.max(t.mods.aoeRadius||0, 36); t.mods.damage += 6; t.mods.fireRate += 0.2; } },
          { name:'Schrapnell', cost: 130, apply: t => { t.mods.aoeRadius += 16; t.mods.splashFactor = 0.75; } },
          { name:'Große Kugeln', cost: 170, apply: t => { t.mods.damage += 16; t.mods.bulletSpeed -= 80; } },
        ]
      }
    ]
  },
  mage: {
    name: 'Magier',
    base: { damage: 30, type: 'magic', fireRate: 0.9, range: 140, size: 16, color: '#2d3b6f', bulletSpeed: 460 },
    cost: 80,
    paths: [
      {
        id: 'fire',
        name: 'Feuermagier',
        desc: 'DoT (Brennen) & kleine Explosion.',
        upgrades: [
          { name:'Brennen', cost: 70, apply: t => { t.mods.burn = { dps: 8, dur: 3.0 }; } },
          { name:'Feuerball+', cost: 120, apply: t => { t.mods.aoeRadius = Math.max(t.mods.aoeRadius||0, 28); t.mods.damage += 8; } },
          { name:'Hitzewelle', cost: 160, apply: t => { t.mods.burn = { dps: 12, dur: 3.5 }; t.mods.range += 10; } },
        ]
      },
      {
        id: 'ice',
        name: 'Eismagier',
        desc: 'Starker Slow & Kontrolle.',
        upgrades: [
          { name:'Kälteschock', cost: 60, apply: t => { t.mods.slow = { pct: 0.25, dur: 1.6 }; } },
          { name:'Permafrost', cost: 110, apply: t => { t.mods.slow = { pct: 0.35, dur: 2.0 }; t.mods.damage += 6; } },
          { name:'Eislanze', cost: 150, apply: t => { t.mods.armorShred = Math.max(t.mods.armorShred||0, 0.1); } },
        ]
      }
    ]
  },
  guard: {
    name: 'Nahkämpfer',
    base: { damage: 16, type: 'physical', fireRate: 0.75, range: 90, size: 18, color: '#3b3b3b', bulletSpeed: 440 },
    cost: 65,
    paths: [
      {
        id: 'soldier',
        name: 'Soldat',
        desc: 'Starker Single-Target.',
        upgrades: [
          { name:'Geschliffenes Schwert', cost: 50, apply: t => { t.mods.damage += 6; } },
          { name:'Kampfrausch', cost: 90, apply: t => { t.mods.fireRate = Math.max(0.45, t.mods.fireRate - 0.15); } },
          { name:'Klingentanz', cost: 140, apply: t => { t.mods.multishot = Math.max(t.mods.multishot||1, 2); } },
        ]
      },
      {
        id: 'templar',
        name: 'Templer',
        desc: 'Aura: verlangsamt Gegner im Umkreis.',
        upgrades: [
          { name:'Heiliger Boden', cost: 60, apply: t => { t.aura = { slowPct: 0.15 }; } },
          { name:'Gelübde', cost: 100, apply: t => { t.aura = { slowPct: 0.22 }; t.mods.range += 10; } },
          { name:'Weihe', cost: 140, apply: t => { t.aura = { slowPct: 0.28 }; } },
        ]
      }
    ]
  }
};

// --- Enemies ---
const ENEMIES = [
  { name:'Plünderer', maxHP: 40, speed: 42, reward: 10, color:'#ffde8a', armor:0.05, mres:0.05 },
  { name:'Veteran',   maxHP: 85, speed: 36, reward: 18, color:'#e07a5f', armor:0.15, mres:0.05 },
  { name:'Ritter',    maxHP: 170, speed: 30, reward: 36, color:'#3d405b', armor:0.30, mres:0.1 },
  { name:'Späher',    maxHP: 55, speed: 60, reward: 20, color:'#8fd3ff', armor:0.05, mres:0.05 },
];

function getWaveConfig(wave){
  const count = 6 + Math.floor(wave * 1.7);
  let t = ENEMIES[0];
  if (wave >= 3 && wave < 5) t = ENEMIES[1];
  else if (wave >= 5 && wave < 7) t = ENEMIES[3]; // fast
  else if (wave >= 7) t = ENEMIES[2]; // armored
  return {count, template: t};
}

// --- Utils ---
function updateHUD(){ HUD.goldEl.textContent = state.gold; HUD.livesEl.textContent = state.lives; HUD.waveEl.textContent = state.wave; }
function dist(a,b){ return Math.hypot(a.x-b.x, a.y-b.y); }
function clamp(v, a, b){ return Math.max(a, Math.min(b, v));}

// --- Enemy ---
class Enemy {
  constructor(tpl){
    this.name = tpl.name;
    this.maxHP = tpl.maxHP;
    this.hp = tpl.maxHP;
    this.baseSpeed = tpl.speed;
    this.speed = tpl.speed;
    this.reward = tpl.reward;
    this.color = tpl.color;
    this.armorBase = tpl.armor || 0;
    this.mresBase = tpl.mres || 0;
    this.effects = []; // {type:'burn'|'slow'|'ashred', data:{...}, t:duration}
    this.pathIndex = 0;
    this.x = path[0].x;
    this.y = path[0].y;
    this.alive = true;
    this.reached = false;
  }

  addEffect(effect){
    // merge if same type (keep stronger / longer)
    const existing = this.effects.find(e => e.type === effect.type);
    if(existing){
      // prefer stronger values
      if(effect.type === 'slow'){
        existing.data.pct = Math.max(existing.data.pct, effect.data.pct);
      }
      if(effect.type === 'ashred'){
        existing.data.amount = Math.max(existing.data.amount, effect.data.amount);
      }
      if(effect.type === 'burn'){
        existing.data.dps = Math.max(existing.data.dps, effect.data.dps);
      }
      existing.t = Math.max(existing.t, effect.t);
    } else {
      this.effects.push(effect);
    }
  }

  get armor(){
    const shred = this.effects.find(e => e.type==='ashred');
    return clamp((this.armorBase - (shred?.data.amount || 0)), 0, 0.9);
  }
  get mres(){
    return this.mresBase;
  }

  update(dt){
    if(!this.alive || this.reached) return;

    // apply DoT & slow
    let slowMult = 1.0;
    for(let i=this.effects.length-1;i>=0;i--){
      const e = this.effects[i];
      e.t -= dt;
      if(e.type === 'burn'){
        const dmg = e.data.dps * dt;
        this.hp -= dmg;
        floatingTexts.push(new FloatText(`-${dmg.toFixed(0)}`, this.x, this.y-20, '#ff6a00'));
      }
      if(e.type === 'slow'){
        slowMult *= (1 - e.data.pct);
      }
      if(e.t <= 0) this.effects.splice(i,1);
    }
    if(this.hp <= 0){ this.die(); return; }

    // movement
    const target = path[this.pathIndex+1];
    if(!target) return;
    const dx = target.x - this.x;
    const dy = target.y - this.y;
    const d = Math.hypot(dx,dy);
    if(d < 1){
      this.pathIndex++;
      if(this.pathIndex >= path.length-1){
        this.reached = true;
        this.alive = false;
        state.lives -= 1;
        updateHUD();
      }
      return;
    }
    const v = (this.baseSpeed * slowMult);
    const vx = dx/d * v;
    const vy = dy/d * v;
    this.x += vx * dt;
    this.y += vy * dt;
  }

  die(){
    this.alive = false;
    state.gold += this.reward;
    updateHUD();
  }

  draw(ctx){
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, 12, 0, Math.PI*2);
    ctx.fill();
    // hp bar
    const w = 30, h=5;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(this.x - w/2, this.y - 20, w, h);
    ctx.fillStyle = '#4caf50';
    ctx.fillRect(this.x - w/2, this.y - 20, w*(this.hp/this.maxHP), h);

    // effect pips
    if(this.effects.length){
      let off = -8;
      for(const e of this.effects){
        ctx.fillStyle = (e.type==='burn') ? '#ff6a00' : (e.type==='slow' ? '#1e88e5' : '#795548');
        ctx.beginPath();
        ctx.arc(this.x + off, this.y + 16, 3, 0, Math.PI*2);
        ctx.fill();
        off += 8;
      }
    }
  }
}

// --- Tower ---
class Tower {
  constructor(key, col, row){
    this.key = key;
    this.blue = TOWERS[key];
    this.col = col;
    this.row = row;
    this.x = col*TILE + TILE/2;
    this.y = row*TILE + TILE/2;
    this.cooldown = 0;
    this.level = 1;
    this.path = null; // chosen path object
    // runtime mods start with base
    const b = this.blue.base;
    this.mods = { damage:b.damage, fireRate:b.fireRate, range:b.range, bulletSpeed:b.bulletSpeed };
    this.color = b.color;
    this.size = b.size;
    this.aura = null; // {slowPct}
  }

  update(dt){
    // aura (templar)
    if(this.aura){
      for(const e of enemies){
        if(!e.alive) continue;
        if(dist(this, e) <= this.mods.range){
          e.addEffect({type:'slow', data:{pct:this.aura.slowPct}, t:0.3}); // re-apply short slow to keep active
        }
      }
    }

    if(this.cooldown > 0) this.cooldown -= dt;
    if(this.cooldown > 0) return;

    // find target
    let best=null, bestd=Infinity;
    for(const e of enemies){
      if(!e.alive) continue;
      const d = dist(this, e);
      if(d <= this.mods.range && d < bestd){
        bestd = d; best = e;
      }
    }
    if(best){
      this.fire(best);
      this.cooldown = this.mods.fireRate;
    }
  }

  fire(target){
    const shots = Math.max(1, this.mods.multishot || 1);
    for(let i=0;i<shots;i++){
      bullets.push(new Bullet(this, target));
    }
  }

  draw(ctx){
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.rect(this.x - TILE*0.4, this.y - TILE*0.4, TILE*0.8, TILE*0.8);
    ctx.fill();

    // range circle
    ctx.fillStyle = 'rgba(255,255,255,0.02)';
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.mods.range, 0, Math.PI*2);
    ctx.fill();

    // selection
    if(state.selectedTower === this){
      ctx.strokeStyle = '#222';
      ctx.lineWidth = 2;
      ctx.strokeRect(this.x - TILE*0.42, this.y - TILE*0.42, TILE*0.84, TILE*0.84);
    }
  }
}

// --- Bullet ---
class Bullet {
  constructor(tower, target){
    this.tower = tower;
    this.x = tower.x; this.y = tower.y;
    this.target = target;
    this.speed = tower.mods.bulletSpeed || 500;
    this.damage = tower.mods.damage;
    this.type = TOWERS[tower.key].base.type; // 'physical' | 'magic'
    this.color = tower.color;
    // effects on hit:
    this.aoeRadius = tower.mods.aoeRadius || 0;
    this.splashFactor = tower.mods.splashFactor || 0.6;
    this.burn = tower.mods.burn || null;
    this.slow = tower.mods.slow || null;
    this.armorShred = tower.mods.armorShred || 0;
    this.crit = tower.mods.crit || null;
    this.alive = true;
  }
  update(dt){
    if(!this.alive || !this.target || !this.target.alive){ this.alive=false; return; }
    const dx = this.target.x - this.x;
    const dy = this.target.y - this.y;
    const d = Math.hypot(dx,dy);
    if(d < 6){
      this.hit(this.target, 1.0);
      // splash
      if(this.aoeRadius > 0){
        for(const e of enemies){
          if(e!==this.target && e.alive && dist(this.target, e) <= this.aoeRadius){
            this.hit(e, this.splashFactor);
          }
        }
      }
      this.alive = false;
      return;
    }
    const vx = dx/d * this.speed;
    const vy = dy/d * this.speed;
    this.x += vx * dt;
    this.y += vy * dt;
  }
  hit(enemy, scale){
    // crit?
    let dmg = this.damage * scale;
    if(this.crit && Math.random() < this.crit.chance){
      dmg *= this.crit.mult;
      floatingTexts.push(new FloatText('CRIT!', enemy.x, enemy.y-30, '#d32f2f'));
    }
    // damage types
    const resist = (this.type === 'physical') ? enemy.armor : enemy.mres;
    const dealt = Math.max(1, Math.round(dmg * (1 - resist)));
    enemy.hp -= dealt;
    floatingTexts.push(new FloatText(`-${dealt}`, enemy.x, enemy.y-20, '#111'));
    // effects
    if(this.burn) enemy.addEffect({type:'burn', data:{dps:this.burn.dps}, t:this.burn.dur});
    if(this.slow) enemy.addEffect({type:'slow', data:{pct:this.slow.pct}, t:this.slow.dur});
    if(this.armorShred>0) enemy.addEffect({type:'ashred', data:{amount:this.armorShred}, t:2.5});
    if(enemy.hp <= 0) enemy.die();
  }
  draw(ctx){
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, 4, 0, Math.PI*2);
    ctx.fill();
  }
}

// floating damage text
class FloatText{
  constructor(text,x,y,color){
    this.text = text; this.x=x; this.y=y; this.color=color||'#111'; this.t=0.8;
  }
  update(dt){ this.y -= 20*dt; this.t -= dt; }
  draw(ctx){
    ctx.globalAlpha = Math.max(0, this.t/0.8);
    ctx.fillStyle = this.color; ctx.font='14px sans-serif'; ctx.textAlign='center';
    ctx.fillText(this.text, this.x, this.y);
    ctx.globalAlpha = 1.0;
  }
  get alive(){ return this.t>0; }
}

// --- Waves / Spawning ---
let spawnTimer = 0;
let spawnIndex = 0;
let activeWaveConfig = null;

function startWave(){
  if(state.running) return;
  state.wave += 1;
  updateHUD();
  state.running = true;
  HUD.startWaveBtn.disabled = true;
  HUD.nextWaveBtn.disabled = true;
  activeWaveConfig = getWaveConfig(state.wave);
  spawnIndex = 0;
  spawnTimer = 0;
}

function updateWave(dt){
  if(!state.running) return;
  if(spawnIndex < activeWaveConfig.count){
    spawnTimer -= dt;
    if(spawnTimer <= 0){
      enemies.push(new Enemy(activeWaveConfig.template));
      spawnIndex++;
      spawnTimer = 0.75;
    }
  } else {
    const anyAlive = enemies.some(e => e.alive);
    if(!anyAlive){
      state.running = false;
      HUD.startWaveBtn.disabled = false;
      HUD.nextWaveBtn.disabled = false;
      // kleine Zins/Belohnung
      state.gold += 15;
      updateHUD();
    }
  }
}

// --- Input & Selection ---
canvas.addEventListener('click', (e) => {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const col = Math.floor(mx / TILE);
  const row = Math.floor(my / TILE);
  if(col<0||col>=COLS||row<0||row>=ROWS) return;
  // hit-test towers first for selection
  for(const t of towers){
    if(Math.abs(t.x - (col*TILE+TILE/2)) < TILE/2 && Math.abs(t.y - (row*TILE+TILE/2)) < TILE/2){
      state.selectedTower = t;
      renderInspector();
      return;
    }
  }

  const idx = row*COLS + col;
  if(!buildable[idx]){ flashMessage("Auf dem Weg kann nicht gebaut werden!"); return; }
  const occupied = towers.some(t => t.col===col && t.row===row);
  if(occupied){ flashMessage("Hier steht bereits ein Turm."); return; }
  if(!state.placing){ flashMessage("Wähle zuerst einen Turm in der linken Leiste."); return; }
  const blue = TOWERS[state.placing];
  if(state.gold < blue.cost){ flashMessage("Nicht genug Gold!"); return; }

  // place
  towers.push(new Tower(state.placing, col, row));
  state.gold -= blue.cost;
  updateHUD();
});

document.querySelectorAll('.tower-card .buy-btn').forEach(btn => {
  const card = btn.closest('.tower-card');
  const type = card.dataset.type;
  const cost = parseInt(card.dataset.cost,10);
  btn.addEventListener('click', ()=>{
    state.placing = type;
    flashMessage(`${TOWERS[type].name} ausgewählt. Klicke auf ein Feld zum Platzieren (Kosten: ${cost}).`);
  });
});

HUD.startWaveBtn.addEventListener('click', startWave);
HUD.nextWaveBtn.addEventListener('click', startWave);

// --- Inspector UI ---
function renderInspector(){
  const t = state.selectedTower;
  if(!t){
    inspTitleEl.textContent = "Turm-Info";
    inspBodyEl.innerHTML = "<p>Kein Turm ausgewählt.</p>";
    return;
  }
  const blue = TOWERS[t.key];
  inspTitleEl.textContent = `${blue.name} (Stufe ${t.level})`;

  const stats = `
    <div class="insp-row"><span>Schaden</span><strong>${t.mods.damage}</strong></div>
    <div class="insp-row"><span>Feuerrate</span><strong>${t.mods.fireRate.toFixed(2)}s</strong></div>
    <div class="insp-row"><span>Reichweite</span><strong>${t.mods.range}px</strong></div>
  `;

  // Path selection or upgrades
  let html = stats + '<hr/>';
  if(!t.path){
    html += `<p>Wähle eine Spezialisierung:</p><div class="upgrade-list">`;
    for(const p of blue.paths){
      html += `<button class="upgrade-btn" data-action="choose" data-id="${p.id}">
        <strong>${p.name}</strong>
        <small>${p.desc}</small>
      </button>`;
    }
    html += `</div><p class="footer-note">Spezialisierungen schalten individuelle Upgrades frei.</p>`;
  } else {
    const path = t.path;
    const nextIndex = t.level - 1; // level 1 = base; level 2 = first upgrade
    const upg = path.upgrades[nextIndex];
    if(upg){
      html += `<p><strong>${path.name}</strong><span class="badge">Upgrade ${t.level-1}/3</span></p>`;
      html += `<div class="upgrade-list">
        <button class="upgrade-btn" data-action="upgrade">
          <strong>${upg.name}</strong>
          <small>Kosten: ${upg.cost} 🪙</small>
        </button>
      </div>`;
    } else {
      html += `<p><strong>${path.name}</strong><span class="badge">Max</span></p>`;
      html += `<p>Dieser Turm ist voll ausgebaut.</p>`;
    }
  }

  inspBodyEl.innerHTML = html;

  // wire buttons
  inspBodyEl.querySelectorAll('.upgrade-btn').forEach(b => {
    const action = b.dataset.action;
    if(action === 'choose'){
      const id = b.dataset.id;
      b.addEventListener('click', ()=>{
        // choose path, but first upgrade still needs payment -> show first upgrade button
        t.path = blue.paths.find(p => p.id===id);
        renderInspector();
      });
    } else if(action === 'upgrade'){
      b.addEventListener('click', ()=>{
        const path = t.path;
        const upg = path.upgrades[t.level-1];
        if(!upg) return;
        if(state.gold < upg.cost){ flashMessage("Nicht genug Gold!"); return; }
        state.gold -= upg.cost;
        updateHUD();
        upg.apply(t);
        t.level += 1;
        flashMessage(`${blue.name} → ${path.name}: ${upg.name} gekauft.`);
        renderInspector();
      });
    }
  });
}

// --- Messages ---
let msgTimer = 0;
let lastMsg = '';
function flashMessage(msg, t=2000){ lastMsg = msg; msgTimer = t; }

// --- Rendering helpers ---
function drawGrid(){
  ctx.save();
  ctx.strokeStyle = 'rgba(0,0,0,0.03)';
  for(let c=0;c<=COLS;c++){
    ctx.beginPath(); ctx.moveTo(c*TILE,0); ctx.lineTo(c*TILE,canvas.height); ctx.stroke();
  }
  for(let r=0;r<=ROWS;r++){
    ctx.beginPath(); ctx.moveTo(0,r*TILE); ctx.lineTo(canvas.width,r*TILE); ctx.stroke();
  }
  ctx.restore();
}

function drawPath(){
  ctx.save();
  ctx.strokeStyle = '#b58a5b';
  ctx.lineWidth = TILE * 0.9;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(path[0].x, path[0].y);
  for(let i=1;i<path.length;i++) ctx.lineTo(path[i].x, path[i].y);
  ctx.stroke();
  ctx.strokeStyle = '#8b5a2b';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(path[0].x, path[0].y);
  for(let i=1;i<path.length;i++) ctx.lineTo(path[i].x, path[i].y);
  ctx.stroke();
  ctx.restore();
}

// --- Game loop ---
let lastTime = performance.now();
function gameLoop(now){
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;

  updateWave(dt);

  towers.forEach(t=>t.update(dt));
  enemies.forEach(e=>e.update(dt));
  bullets.forEach(b=>b.update(dt));
  floatingTexts.forEach(ft=>ft.update(dt));

  enemies = enemies.filter(e => e.alive || !e.reached);
  bullets = bullets.filter(b => b.alive);
  floatingTexts = floatingTexts.filter(ft => ft.alive);

  if(state.lives <= 0){ draw(); gameOver(); return; }

  draw();
  requestAnimationFrame(gameLoop);
}

function draw(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  drawGrid();
  drawPath();

  // buildable shading
  for(let r=0;r<ROWS;r++){
    for(let c=0;c<COLS;c++){
      const idx = r*COLS + c;
      if(!buildable[idx]) continue;
      ctx.fillStyle = 'rgba(255,255,255,0.02)';
      ctx.fillRect(c*TILE+2, r*TILE+2, TILE-4, TILE-4);
    }
  }

  towers.forEach(t=>t.draw(ctx));
  enemies.forEach(e=>e.draw(ctx));
  bullets.forEach(b=>b.draw(ctx));
  floatingTexts.forEach(ft=>ft.draw(ctx));

  if(msgTimer > 0){
    msgTimer -= 16;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.font = '16px sans-serif';
    const padding = 10;
    const text = lastMsg;
    const w = ctx.measureText(text).width + padding*2;
    ctx.fillRect(20, canvas.height - 50, w, 36);
    ctx.fillStyle = '#fff';
    ctx.fillText(text, 30, canvas.height - 26);
    ctx.restore();
  }
}

// --- Game Over ---
let ended = false;
function gameOver(){
  if(ended) return;
  ended = true;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle = 'white';
  ctx.font = '48px serif';
  ctx.textAlign = 'center';
  ctx.fillText('Game Over', canvas.width/2, canvas.height/2 - 10);
  ctx.font = '18px sans-serif';
  ctx.fillText('F5 zum Neuladen und Neustarten', canvas.width/2, canvas.height/2 + 30);
  ctx.restore();
}

// --- Init ---
updateHUD();
renderInspector();
requestAnimationFrame(gameLoop);
