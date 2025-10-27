/* Mittelalter Tower Defense - Einfache Version
   - Canvas-basiertes Spiel
   - Türme platzieren, Gegner folgen einem Weg, Türme schießen
   - UI auf Deutsch
*/

// Grundkonfiguration
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const HUD = {
  goldEl: document.getElementById('gold'),
  livesEl: document.getElementById('lives'),
  waveEl: document.getElementById('wave'),
  startWaveBtn: document.getElementById('startWaveBtn'),
  nextWaveBtn: document.getElementById('nextWaveBtn'),
};

let state = {
  gold: 100,
  lives: 20,
  wave: 0,
  running: false, // ob gerade Welle läuft
  placing: null,  // Turmtyp der gerade platziert werden soll
};

// Spielfeldgitter (kacheln) - zu platzierende Stellen
const TILE = 40;
const COLS = Math.floor(canvas.width / TILE);
const ROWS = Math.floor(canvas.height / TILE);

// Precompute buildable grid (true = bebaubar)
let buildable = new Array(COLS * ROWS).fill(true);

// Definierter Weg als Wegpunkte (Mittelalterischer Pfad)
const path = [
  {x: 0,   y: 5 * TILE + TILE/2},
  {x: 6 * TILE + TILE/2, y: 5 * TILE + TILE/2},
  {x: 6 * TILE + TILE/2, y: 2 * TILE + TILE/2},
  {x: 13 * TILE + TILE/2, y: 2 * TILE + TILE/2},
  {x: 13 * TILE + TILE/2, y: 9 * TILE + TILE/2},
  {x: 22 * TILE + TILE/2, y: 9 * TILE + TILE/2},
  {x: canvas.width + 50, y: 9 * TILE + TILE/2},
];

// Markiere Tiles, die nicht bebaubar sind (der Weg)
function markPathTiles(){
  // Gehe jeden Pfadabschnitt durch und markiere nahegelegene Kacheln
  for(let i=0;i<path.length-1;i++){
    const a = path[i], b = path[i+1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx,dy);
    const steps = Math.ceil(len / (TILE/2));
    for(let s=0;s<=steps;s++){
      const t = s/steps;
      const x = a.x + dx*t;
      const y = a.y + dy*t;
      // markiere umliegende Kacheln
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

// Spielobjekte
let towers = [];
let enemies = [];
let bullets = [];

/* -- Tower-Definitionen -- */
const TOWER_TYPES = {
  arrow: {
    name: 'Bogenschütze',
    range: 120,
    damage: 10,
    fireRate: 0.6,
    cost: 50,
    color: '#563f2e',
    size: 16,
  },
  ballista: {
    name: 'Balliste',
    range: 160,
    damage: 30,
    fireRate: 1.6,
    cost: 120,
    color: '#2f2f2f',
    size: 20,
  }
};

/* -- Gegner-Templates -- */
const ENEMY_TEMPLATES = [
  { name: 'Bauer', maxHP: 30, speed: 40, reward: 10, color: '#ffde8a' },
  { name: 'Söldner', maxHP: 70, speed: 35, reward: 18, color: '#e07a5f' },
  { name: 'Ritter', maxHP: 160, speed: 28, reward: 40, color: '#3d405b' },
];

// Wellen-Logik
function getWaveConfig(wave){
  // Einfacher Progress: mehr und stärkere Feinde pro Welle
  const count = 5 + Math.floor(wave * 1.6);
  const templateIdx = Math.min(ENEMY_TEMPLATES.length-1, Math.floor(wave/3));
  return {count, template: ENEMY_TEMPLATES[templateIdx]};
}

// Hilfsfunktionen
function updateHUD(){
  HUD.goldEl.textContent = state.gold;
  HUD.livesEl.textContent = state.lives;
  HUD.waveEl.textContent = state.wave;
}

// Distance helper
function dist(a,b){
  return Math.hypot(a.x-b.x, a.y-b.y);
}

/* -- Enemy Class -- */
class Enemy {
  constructor(template){
    this.hp = template.maxHP;
    this.maxHP = template.maxHP;
    this.speed = template.speed;
    this.reward = template.reward;
    this.color = template.color;
    this.pathIndex = 0;
    this.x = path[0].x;
    this.y = path[0].y;
    this.alive = true;
    this.reached = false;
  }
  update(dt){
    if(!this.alive || this.reached) return;
    const target = path[this.pathIndex+1];
    if(!target) return;
    const dx = target.x - this.x;
    const dy = target.y - this.y;
    const d = Math.hypot(dx,dy);
    if(d < 1){
      this.pathIndex++;
      if(this.pathIndex >= path.length-1){
        // Gegner hat die Burg erreicht
        this.reached = true;
        this.alive = false;
        state.lives -= 1;
        updateHUD();
      }
      return;
    }
    const vx = dx/d * this.speed;
    const vy = dy/d * this.speed;
    this.x += vx * dt;
    this.y += vy * dt;
  }
  draw(ctx){
    // Körper
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, 12, 0, Math.PI*2);
    ctx.fill();
    // HP bar
    const w = 30;
    const h = 5;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(this.x - w/2, this.y - 20, w, h);
    ctx.fillStyle = '#4caf50';
    ctx.fillRect(this.x - w/2, this.y - 20, w * (this.hp/this.maxHP), h);
  }
}

/* -- Tower Class -- */
class Tower {
  constructor(type, col, row){
    this.type = type;
    this.col = col;
    this.row = row;
    this.x = col * TILE + TILE/2;
    this.y = row * TILE + TILE/2;
    this.cooldown = 0;
    this.config = TOWER_TYPES[type];
  }
  update(dt){
    if(this.cooldown > 0) this.cooldown -= dt;
    if(this.cooldown <= 0){
      // suche Ziel
      let target = null;
      let bestDist = Infinity;
      for(const e of enemies){
        if(!e.alive) continue;
        const d = dist({x:this.x,y:this.y}, e);
        if(d <= this.config.range && d < bestDist){
          bestDist = d;
          target = e;
        }
      }
      if(target){
        this.shoot(target);
        this.cooldown = this.config.fireRate;
      }
    }
  }
  shoot(target){
    bullets.push(new Bullet(this.x, this.y, target, this.config.damage, this.config.color));
  }
  draw(ctx){
    ctx.fillStyle = this.config.color;
    ctx.beginPath();
    ctx.rect(this.x - TILE*0.4, this.y - TILE*0.4, TILE*0.8, TILE*0.8);
    ctx.fill();
    // Range (leicht transparent)
    ctx.fillStyle = 'rgba(255,255,255,0.02)';
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.config.range, 0, Math.PI*2);
    ctx.fill();
  }
}

/* -- Bullet Class -- */
class Bullet {
  constructor(x,y,target,damage,color){
    this.x = x; this.y = y;
    this.target = target;
    this.speed = 420;
    this.damage = damage;
    this.color = color;
    this.alive = true;
  }
  update(dt){
    if(!this.alive || !this.target || !this.target.alive) { this.alive=false; return; }
    const dx = this.target.x - this.x;
    const dy = this.target.y - this.y;
    const d = Math.hypot(dx,dy);
    if(d < 6){
      // Hit
      this.target.hp -= this.damage;
      if(this.target.hp <= 0){
        this.target.alive = false;
        state.gold += this.target.reward;
        updateHUD();
      }
      this.alive = false;
      return;
    }
    const vx = dx/d * this.speed;
    const vy = dy/d * this.speed;
    this.x += vx * dt;
    this.y += vy * dt;
  }
  draw(ctx){
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, 4, 0, Math.PI*2);
    ctx.fill();
  }
}

/* -- Wave / Spawn System -- */
let spawnTimer = 0;
let spawnIndex = 0;
let currentWaveEnemies = 0;
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
  currentWaveEnemies = activeWaveConfig.count;
}

function updateWave(dt){
  if(!state.running) return;
  if(spawnIndex < activeWaveConfig.count){
    spawnTimer -= dt;
    if(spawnTimer <= 0){
      spawnEnemy(activeWaveConfig.template);
      spawnIndex++;
      spawnTimer = 0.8; // Abfolge zwischen Gegnern
    }
  } else {
    // alle Gegner gespawnt, warten bis alle beseitigt oder die Burg verloren ist
    const anyAlive = enemies.some(e => e.alive);
    if(!anyAlive){
      // Welle beendet
      state.running = false;
      HUD.startWaveBtn.disabled = false;
      HUD.nextWaveBtn.disabled = false;
    }
  }
}

function spawnEnemy(template){
  enemies.push(new Enemy(template));
}

/* -- Input: Platzieren von Türmen -- */
canvas.addEventListener('mousemove', (e) => {
  // optional für spätere visuelle Hinweise
});
canvas.addEventListener('click', (e) => {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const col = Math.floor(mx / TILE);
  const row = Math.floor(my / TILE);
  if(col<0||col>=COLS||row<0||row>=ROWS) return;
  const idx = row*COLS + col;
  // prüfen ob bebaubar und kein Turm existiert
  if(!buildable[idx]){
    // nicht auf Weg bauen
    flashMessage("Auf dem Weg kann nicht gebaut werden!");
    return;
  }
  const occupied = towers.some(t => t.col===col && t.row===row);
  if(occupied){
    flashMessage("Hier steht bereits ein Turm.");
    return;
  }
  if(!state.placing){
    flashMessage("Wähle zuerst einen Turm in der linken Leiste.");
    return;
  }
  const cfg = TOWER_TYPES[state.placing];
  if(state.gold < cfg.cost){
    flashMessage("Nicht genug Gold!");
    return;
  }
  // Platzieren
  towers.push(new Tower(state.placing, col, row));
  state.gold -= cfg.cost;
  updateHUD();
});

/* -- Kaufen Buttons -- */
document.querySelectorAll('.tower-card').forEach(card=>{
  const btn = card.querySelector('.buy-btn');
  const type = card.dataset.type;
  const cost = parseInt(card.dataset.cost,10);
  btn.addEventListener('click', ()=>{
    state.placing = type;
    flashMessage(`${TOWER_TYPES[type].name} ausgewählt. Klicke auf ein Feld zum Platzieren (Kosten: ${cost}).`);
  });
});

/* -- Kleine Nachrichtenanzeige -- */
let msgTimer = 0;
let lastMsg = '';
function flashMessage(msg, t=2000){
  lastMsg = msg;
  msgTimer = t;
}

/* -- Buttons -- */
HUD.startWaveBtn.addEventListener('click', startWave);
HUD.nextWaveBtn.addEventListener('click', ()=>{
  // sofort Welle starten (auch wenn noch keine läuft)
  startWave();
});

/* -- Rendering Hilfen -- */
function drawGrid(){
  ctx.save();
  ctx.strokeStyle = 'rgba(0,0,0,0.03)';
  for(let c=0;c<=COLS;c++){
    ctx.beginPath();
    ctx.moveTo(c*TILE, 0);
    ctx.lineTo(c*TILE, canvas.height);
    ctx.stroke();
  }
  for(let r=0;r<=ROWS;r++){
    ctx.beginPath();
    ctx.moveTo(0, r*TILE);
    ctx.lineTo(canvas.width, r*TILE);
    ctx.stroke();
  }
  ctx.restore();
}

function drawPath(){
  ctx.save();
  // Pfadgrund
  ctx.strokeStyle = '#b58a5b';
  ctx.lineWidth = TILE * 0.9;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(path[0].x, path[0].y);
  for(let i=1;i<path.length;i++) ctx.lineTo(path[i].x, path[i].y);
  ctx.stroke();

  // Pfadrand
  ctx.strokeStyle = '#8b5a2b';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(path[0].x, path[0].y);
  for(let i=1;i<path.length;i++) ctx.lineTo(path[i].x, path[i].y);
  ctx.stroke();
  ctx.restore();
}

/* -- Game Loop -- */
let lastTime = performance.now();

function gameLoop(now){
  const dt = Math.min(0.05, (now - lastTime) / 1000); // begrenzen
  lastTime = now;

  // Update
  updateWave(dt);

  towers.forEach(t=>t.update(dt));
  enemies.forEach(e=>e.update(dt));
  bullets.forEach(b=>b.update(dt));

  // entferne tote Objekte
  enemies = enemies.filter(e => e.alive || !e.reached);
  bullets = bullets.filter(b => b.alive);

  // Check Game Over
  if(state.lives <= 0){
    draw(); // finales Bild
    gameOver();
    return;
  }

  // Draw
  draw();

  requestAnimationFrame(gameLoop);
}

function draw(){
  // Hintergrund wiesenmuster
  ctx.clearRect(0,0,canvas.width,canvas.height);

  // Boden leicht texturiert
  // drawPath first or after? Path should appear on top of grass
  drawGrid();
  drawPath();

  // Platzierbare Felder (leichte Kacheln)
  for(let r=0;r<ROWS;r++){
    for(let c=0;c<COLS;c++){
      const idx = r*COLS + c;
      if(!buildable[idx]) continue;
      ctx.fillStyle = 'rgba(255,255,255,0.02)';
      ctx.fillRect(c*TILE+2, r*TILE+2, TILE-4, TILE-4);
    }
  }

  towers.forEach(t => t.draw(ctx));
  enemies.forEach(e => e.draw(ctx));
  bullets.forEach(b => b.draw(ctx));

  // UI Overlay: Nachricht
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

/* -- Game Over -- */
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

/* -- Start the Loop -- */
// Erstmal ein paar Gegner in Wartereihe, damit man testen kann
updateHUD();
requestAnimationFrame(gameLoop);