/* ══════════════════════════════════════════════════
   VELOX SPIN & WIN — Real-Time Game Engine
   Socket.io powered matchmaking + server-authoritative spin
   USDT-native balances + cookie-based auth
══════════════════════════════════════════════════ */

/* ── Auth & Balance ── */
const API = window.location.origin + '/api';
let balance = 0;
let currentUser = null;

/* ── Game state ── */
let stake = 10, maxPlayers = 5;
let players = [];
let gameState = 'idle'; // idle | matching | countdown | spinning | result
let roundNum = 0, histCount = 0;
let socket = null;
let currentRoomId = null;

/* ── Canvas setup ── */
const C = document.getElementById('spinCanvas');
const ctx = C.getContext('2d');
const SZ = C.width, CX = SZ/2, CY = SZ/2, R_OUT = SZ/2-3;
let offWheel = null, offAxle = null;
let wheelAngle = 0, spinActive = false;
let ballEl = document.getElementById('ballEl');
let ballAngle = 0, ballRadius = 0, ballRestAngle = null, ballRestRadius = 0;
let _cc = null;

/* ── Init ── */
document.addEventListener('DOMContentLoaded', async () => {
  // Fetch user data via cookie-based auth
  try {
    const res = await fetch(API + '/me', { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      currentUser = data.user;
      balance = data.user.balance;
    }
  } catch(e) { console.log('Auth check failed'); }
  updateBalanceUI();
  updatePotUI();
  buildEmptySlots();
  drawIdleWheel();
  connectSocket();
});

/* ── Socket.io Connection ── */
function connectSocket() {
  socket = io(window.location.origin, { transports: ['websocket', 'polling'] });

  socket.on('connect', () => {
    document.getElementById('connDot').className = 'conn-dot connected';
    // Authenticate via cookie (send empty token, server reads cookie from handshake)
    socket.emit('authenticate', {});
  });
  socket.on('disconnect', () => {
    document.getElementById('connDot').className = 'conn-dot disconnected';
  });
  socket.on('authenticated', (data) => {
    console.log('[Socket] Authenticated:', data.user.username);
    currentUser = data.user;
    balance = data.user.balance;
    updateBalanceUI();
  });
  socket.on('auth_error', (data) => {
    showToast('⚠ Auth error: ' + data.error);
  });
  socket.on('balance_update', (data) => {
    balance = data.balance;
    updateBalanceUI();
  });
  socket.on('queue_error', (data) => {
    showToast('⚠ ' + data.error);
    resetUI();
  });
  socket.on('queue_update', (data) => {
    handleQueueUpdate(data);
  });
  socket.on('game_starting', (data) => {
    handleGameStarting(data);
  });
  socket.on('spin_result', (data) => {
    handleSpinResult(data);
  });
  socket.on('game_ended', (data) => {
    handleGameEnded(data);
  });
  socket.on('matchmaking_status', (data) => {
    document.getElementById('mpStatus').textContent = data.message;
    if (data.phase === 'waiting_real') {
      document.getElementById('btnFind').textContent = '🔍 Searching Players...';
    } else if (data.phase === 'filling') {
      document.getElementById('btnFind').textContent = '⏳ Filling Match...';
    }
  });
  socket.on('left_queue', (data) => {
    showToast('👋 Left queue — $' + data.refunded + ' USDT refunded');
    resetUI();
  });
}

/* ── Socket event handlers ── */
function handleQueueUpdate(data) {
  players = data.players;
  currentRoomId = data.roomId;
  const joined = data.joined;
  const needed = data.needed;

  buildEmptySlots();
  players.forEach((p, i) => fillSlot(i, p));

  updateProgress(joined);
  buildWheelBitmap();
  drawWheel(wheelAngle);
}

function handleGameStarting(data) {
  gameState = 'countdown';
  players = data.players;
  currentRoomId = data.roomId;

  setStatus('Starting!');
  showToast('✅ All players ready! Starting in 5...');
  document.getElementById('matchProgress').classList.remove('active');
  document.getElementById('btnLeave').style.display = 'none';

  buildWheelBitmap();
  drawWheel(wheelAngle);

  const overlay = document.getElementById('cdOverlay');
  overlay.classList.add('active');
  let t = data.countdown || 5;
  document.getElementById('cdNum').textContent = t;
  document.getElementById('cdSub').textContent = maxPlayers + ' players ready';

  const tick = setInterval(() => {
    t--;
    document.getElementById('cdNum').textContent = t;
    if (t <= 0) {
      clearInterval(tick);
      overlay.classList.remove('active');
    }
  }, 1000);
}

function handleSpinResult(data) {
  gameState = 'spinning';
  setStatus('Spinning!');
  spinActive = true;
  players = data.players;
  buildWheelBitmap();
  startSpinAnimation(data.winnerIdx, data);
}

function handleGameEnded(data) {
  balance = data.balance;
  updateBalanceUI();
}

/* ── Balance (USDT) ── */
function fmtUSDT(v) {
  if (v >= 1e6) return '$'+(v/1e6).toFixed(1)+'M';
  if (v >= 1e3) return '$'+(v/1e3).toFixed(1)+'K';
  if (v >= 1) return '$'+v.toFixed(2);
  return '$'+v.toFixed(4);
}
function updateBalanceUI() { document.getElementById('topBalance').textContent = fmtUSDT(balance); }

/* ── Pot calc ── */
function calcPot() {
  const gross = stake * maxPlayers;
  const fee = gross * 0.05;
  return { gross, fee, prize: gross - fee };
}
function updatePotUI() {
  const { gross, fee, prize } = calcPot();
  document.getElementById('potStake').textContent = '$'+stake;
  document.getElementById('potPC').textContent = maxPlayers;
  document.getElementById('potGross').textContent = '$'+gross;
  document.getElementById('potFee').textContent = '$'+fee.toFixed(2);
  document.getElementById('potWin').textContent = '$'+prize.toFixed(2);
  document.getElementById('abStake').textContent = '$'+stake;
  document.getElementById('abPot').textContent = fmtUSDT(prize);
  document.getElementById('asPool').textContent = fmtUSDT(prize);
  document.getElementById('asNeeded').textContent = maxPlayers;
  document.getElementById('mpTotal').textContent = maxPlayers;
}

function setStake(el, val) {
  if (gameState !== 'idle') return;
  document.querySelectorAll('.s-chip').forEach(e => e.classList.remove('active'));
  el.classList.add('active');
  stake = val; updatePotUI();
}
function setPC(el, val) {
  if (gameState !== 'idle') return;
  document.querySelectorAll('.pc-chip').forEach(e => e.classList.remove('active'));
  el.classList.add('active');
  maxPlayers = val; updatePotUI(); buildEmptySlots();
}

/* ── Player slots UI ── */
function buildEmptySlots() {
  const list = document.getElementById('playersList');
  list.innerHTML = Array.from({ length: maxPlayers }, (_, i) => `
    <div class="player-slot" id="slot${i}">
      <div class="ps-empty-avatar"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ccc" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg></div>
      <div class="ps-info"><div class="ps-empty-name">Waiting...</div></div>
      <span class="ps-tag ps-bot" style="opacity:.4">#${i+1}</span>
    </div>
  `).join('');
  document.getElementById('playerBadge').textContent = '0/'+maxPlayers;
  document.getElementById('asJoined').textContent = '0';
  document.getElementById('abPlayers').textContent = '0/'+maxPlayers;
}

function fillSlot(idx, player) {
  const slot = document.getElementById('slot'+idx);
  if (!slot) return;
  slot.className = 'player-slot filled' + (player.isMe ? ' me' : '');
  const initials = player.name.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();
  slot.innerHTML = `
    <div class="ps-avatar" style="background:${player.color}">${initials}</div>
    <div class="ps-info">
      <div class="ps-name">${player.name}${player.isMe ? ' (You)' : ''}</div>
      <div class="ps-stake">$${stake} USDT stake</div>
    </div>
    <span class="ps-tag ${player.isMe ? 'ps-me' : 'ps-bot'}">${player.isMe ? 'YOU' : (player.emoji||'🎲')}</span>
  `;
  const joined = players.length;
  document.getElementById('playerBadge').textContent = joined+'/'+maxPlayers;
  document.getElementById('asJoined').textContent = joined;
  document.getElementById('abPlayers').textContent = joined+'/'+maxPlayers;
}

/* ── Find match (server-backed) ── */
function findMatch() {
  if (!currentUser) {
    showToast('⚠ Please sign in first — go back to home page');
    return;
  }
  if (balance < stake) {
    showToast('⚠ Insufficient balance — deposit crypto first');
    return;
  }
  if (!socket || !socket.connected) {
    showToast('⚠ Not connected to server');
    return;
  }

  gameState = 'matching';
  document.getElementById('btnFind').disabled = true;
  document.getElementById('btnFind').textContent = '🔍 Finding Match...';
  document.getElementById('btnLeave').style.display = 'block';
  document.getElementById('matchProgress').classList.add('active');
  document.getElementById('stakeChips').style.pointerEvents = 'none';
  document.getElementById('pcChips').style.pointerEvents = 'none';
  setStatus('Matching...');

  socket.emit('join_queue', { stake, maxPlayers });
}

function updateProgress(joined) {
  const pct = (joined / maxPlayers) * 100;
  document.getElementById('mpFill').style.width = pct + '%';
  document.getElementById('mpJoined').textContent = joined;
  document.getElementById('mpStatus').textContent =
    joined >= maxPlayers ? 'All players found! Starting...' :
    `Waiting for ${maxPlayers - joined} more player${maxPlayers - joined !== 1 ? 's' : ''}...`;
}

function leaveGame() {
  if (gameState !== 'matching') return;
  socket.emit('leave_queue', { stake, maxPlayers });
  gameState = 'idle';
  players = [];
  resetUI();
}

/* ══════════════════════════════════════
   CANVAS — Wheel rendering
══════════════════════════════════════ */
function getInitials(name) { return name.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase(); }
function lighten(hex, amt) { const [r,g,b]=hexRGB(hex); return `rgb(${Math.min(255,r+(255-r)*amt)|0},${Math.min(255,g+(255-g)*amt)|0},${Math.min(255,b+(255-b)*amt)|0})`; }
function darken(hex, amt) { const [r,g,b]=hexRGB(hex); return `rgb(${(r*(1-amt))|0},${(g*(1-amt))|0},${(b*(1-amt))|0})`; }
function hexRGB(h) { const c=h.replace('#',''); return [parseInt(c.slice(0,2),16),parseInt(c.slice(2,4),16),parseInt(c.slice(4,6),16)]; }

function buildWheelBitmap() {
  const N = players.length;
  if (N === 0) return;
  const ARC = (2*Math.PI)/N;
  offWheel = document.createElement('canvas');
  offWheel.width = offWheel.height = SZ;
  const oc = offWheel.getContext('2d');
  for (let i=0;i<N;i++) {
    const s=i*ARC, e=s+ARC, m=s+ARC/2;
    const p=players[i];
    let color = p.color || '#6366f1';
    if (!color.startsWith('#')) color = '#6366f1';
    oc.beginPath(); oc.moveTo(CX,CY); oc.arc(CX,CY,R_OUT-4,s,e); oc.closePath();
    
    // Rich 3D shading
    const gx=CX+Math.cos(m)*(R_OUT-4)*.6, gy=CY+Math.sin(m)*(R_OUT-4)*.6;
    const gr=oc.createRadialGradient(gx,gy,0,CX,CY,R_OUT-4);
    gr.addColorStop(0,lighten(color,.4)); 
    gr.addColorStop(.5,color); 
    gr.addColorStop(1,darken(color,.55));
    oc.fillStyle=gr; oc.fill();
    
    // Glossy reflection line across the piece
    oc.beginPath(); oc.moveTo(CX,CY); oc.arc(CX,CY,R_OUT-4,s,e); oc.closePath();
    const bv=oc.createLinearGradient(CX+Math.cos(m-ARC*.4)*(R_OUT-4)*.35,CY+Math.sin(m-ARC*.4)*(R_OUT-4)*.35,CX+Math.cos(m+ARC*.4)*(R_OUT-4)*.35,CY+Math.sin(m+ARC*.4)*(R_OUT-4)*.35);
    bv.addColorStop(0,'rgba(255,255,255,.3)'); bv.addColorStop(.5,'rgba(255,255,255,0)'); bv.addColorStop(1,'rgba(0,0,0,.25)');
    oc.fillStyle=bv; oc.fill();
    
    // Silver borders between pockets
    oc.beginPath(); oc.moveTo(CX,CY); oc.lineTo(CX+Math.cos(s)*(R_OUT-4),CY+Math.sin(s)*(R_OUT-4));
    oc.strokeStyle='rgba(255,255,255,.45)'; oc.lineWidth=2; oc.stroke();
    
    const avR=(R_OUT-4)*.62, ax=CX+Math.cos(m)*avR, ay=CY+Math.sin(m)*avR;
    oc.beginPath(); oc.arc(ax,ay,N>20?9:13,0,2*Math.PI);
    oc.fillStyle=darken(color,.3); oc.fill();
    oc.strokeStyle='rgba(255,255,255,.65)'; oc.lineWidth=1.5; oc.stroke();
    oc.save(); oc.translate(ax,ay);
    oc.fillStyle='#fff'; oc.textAlign='center'; oc.textBaseline='middle';
    oc.font=`700 ${N>20?6:8}px 'Plus Jakarta Sans',sans-serif`;
    oc.fillText(getInitials(p.name),0,0); oc.restore();
    oc.save(); oc.translate(CX,CY); oc.rotate(m+Math.PI/2);
    oc.fillStyle='rgba(255,255,255,.92)';
    oc.font=`600 ${N>15?8:9}px 'Plus Jakarta Sans',sans-serif`;
    oc.textAlign='center'; oc.textBaseline='middle';
    oc.shadowColor='rgba(0,0,0,.6)'; oc.shadowBlur=3;
    const labelR=(R_OUT-4)*.32;
    oc.fillText(p.name.split(' ')[0].slice(0,N>15?5:7),0,-labelR); oc.restore();
  }
  for(let d=0;d<180;d++){const ra=d*2*Math.PI/180;const t=(Math.sin(ra*4+.6)+1)/2;oc.beginPath();oc.arc(CX,CY,R_OUT-1,ra,ra+.038);oc.strokeStyle=`hsl(42,${68+t*32|0}%,${26+t*50|0}%)`;oc.lineWidth=4;oc.stroke();}
  const rl=oc.createLinearGradient(CX-R_OUT,CY-R_OUT,CX+R_OUT,CY+R_OUT);
  rl.addColorStop(0,'rgba(255,255,255,.45)');rl.addColorStop(.5,'rgba(255,255,255,.04)');rl.addColorStop(1,'rgba(0,0,0,.3)');
  oc.beginPath();oc.arc(CX,CY,R_OUT,0,2*Math.PI);oc.strokeStyle=rl;oc.lineWidth=1.5;oc.stroke();
  const gl=oc.createRadialGradient(CX-R_OUT*.35,CY-R_OUT*.38,0,CX,CY,R_OUT);
  gl.addColorStop(0,'rgba(255,255,255,.12)');gl.addColorStop(.4,'rgba(255,255,255,.03)');gl.addColorStop(1,'rgba(0,0,0,.15)');
  oc.beginPath();oc.arc(CX,CY,R_OUT,0,2*Math.PI);oc.fillStyle=gl;oc.fill();
  /* Axle */
  offAxle = document.createElement('canvas'); offAxle.width=offAxle.height=SZ;
  const ac=offAxle.getContext('2d');
  ac.beginPath();ac.arc(CX,CY,46,0,2*Math.PI);ac.fillStyle='rgba(0,0,0,.5)';ac.fill();
  const ag=ac.createRadialGradient(CX-12,CY-14,2,CX,CY,44);
  ag.addColorStop(0,'#fffacd');ag.addColorStop(.25,'#FFD700');ag.addColorStop(.6,'#c68a00');ag.addColorStop(1,'#4a2d00');
  ac.beginPath();ac.arc(CX,CY,42,0,2*Math.PI);ac.fillStyle=ag;ac.fill();
  [37,31].forEach(r=>{ac.beginPath();ac.arc(CX,CY,r,0,2*Math.PI);ac.strokeStyle='rgba(0,0,0,.28)';ac.lineWidth=1.5;ac.stroke();ac.strokeStyle='rgba(255,255,255,.15)';ac.lineWidth=.5;ac.stroke();});
  const sg=ac.createRadialGradient(CX-3,CY-3,0,CX,CY,9);
  sg.addColorStop(0,'#fff');sg.addColorStop(.35,'#FFD700');sg.addColorStop(1,'#7a5200');
  ac.beginPath();ac.arc(CX,CY,9,0,2*Math.PI);ac.fillStyle=sg;ac.fill();
  ac.strokeStyle='rgba(0,0,0,.45)';ac.lineWidth=1;ac.stroke();
}

function drawWheel(angle) {
  ctx.clearRect(0,0,SZ,SZ);
  if (!offWheel) { drawIdleWheel(); return; }
  ctx.save(); ctx.shadowColor='rgba(0,0,0,.2)';ctx.shadowBlur=20;ctx.shadowOffsetY=8;
  ctx.beginPath();ctx.arc(CX,CY,R_OUT,0,2*Math.PI);ctx.fillStyle='#000';ctx.fill();ctx.restore();
  ctx.save();ctx.translate(CX,CY);ctx.rotate(angle);ctx.drawImage(offWheel,-CX,-CY);ctx.restore();
  ctx.drawImage(offAxle,0,0);
}

function drawIdleWheel() {
  ctx.clearRect(0,0,SZ,SZ); ctx.save();
  ctx.shadowColor='rgba(0,0,0,.12)';ctx.shadowBlur=20;ctx.shadowOffsetY=8;
  ctx.beginPath();ctx.arc(CX,CY,R_OUT,0,2*Math.PI);
  const bg=ctx.createRadialGradient(CX,CY,0,CX,CY,R_OUT);
  bg.addColorStop(0,'#e0e7ff');bg.addColorStop(.6,'#c7d2fe');bg.addColorStop(1,'#a5b4fc');
  ctx.fillStyle=bg;ctx.fill();ctx.restore();
  for(let d=0;d<180;d++){const ra=d*2*Math.PI/180;const t=(Math.sin(ra*4+.6)+1)/2;ctx.beginPath();ctx.arc(CX,CY,R_OUT-1,ra,ra+.038);ctx.strokeStyle=`hsl(42,${68+t*32|0}%,${26+t*50|0}%)`;ctx.lineWidth=4;ctx.stroke();}
  ctx.fillStyle='rgba(99,102,241,.5)';ctx.font="700 15px 'Plus Jakarta Sans',sans-serif";
  ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillText('SPIN & WIN',CX,CY-10);
  ctx.font="500 11px 'Plus Jakarta Sans',sans-serif";ctx.fillStyle='rgba(99,102,241,.4)';
  ctx.fillText('Select stake & find match',CX,CY+10);
}

/* ── Ball helpers ── */
function stageCoords() {
  if(_cc)return _cc;
  const wrap=document.getElementById('wheelWrap');
  const wr=wrap.getBoundingClientRect();
  const cr=C.getBoundingClientRect();
  const sx=cr.width/SZ,sy=cr.height/SZ;
  _cc={cx:CX*sx+(cr.left-wr.left),cy:CY*sy+(cr.top-wr.top),sx,sy};return _cc;
}
window.addEventListener('resize',()=>{_cc=null;if(ballRestAngle!==null)setBall(ballRestAngle,ballRestRadius);});
function setBall(a,r){const{cx,cy,sx,sy}=stageCoords();ballEl.style.left=(cx+Math.cos(a)*r*sx)+'px';ballEl.style.top=(cy+Math.sin(a)*r*sy)+'px';}

/* ── Spin animation (triggered by server result) ── */
function startSpinAnimation(winnerIdx, data) {
  spinActive = true;
  const TRACK_R = R_OUT - 12; // Outer ball track
  const DROP_R = R_OUT + 45;  
  const SETTLE_R = R_OUT * 0.72; // Inner pocket
  const N = players.length;
  const ARC = (2 * Math.PI) / N;

  const pocketMid = winnerIdx * ARC + ARC / 2;
  const jitter = (Math.random() - 0.5) * ARC * 0.6;
  const pocketTarget = pocketMid + jitter;
  
  const WHEEL_SPINS = 6 + Math.random() * 2; 
  const pegAngle = -Math.PI / 2; 
  const rawTarget = pegAngle - pocketTarget;
  const targetAngle = wheelAngle + (WHEEL_SPINS * 2 * Math.PI) + ((rawTarget - wheelAngle) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);

  const DROP_A = Math.random() * 2 * Math.PI;
  ballEl.style.display = 'block';
  ballEl.style.opacity = '0';
  ballAngle = DROP_A;
  ballRadius = TRACK_R;
  setBall(ballAngle, ballRadius);

  const SPIN_DUR = 10500; 
  const BALL_REVS_OPPOSITE = -(5 + Math.random() * 2); 
  const BALL_DROP_START_PCT = 0.55; 
  const BALL_LOCK_PCT = 0.85; 

  let t0spin = performance.now();
  
  // Calculate exact lock positions to avoid wrapping glitches
  const lockWheelEase = 1 - Math.pow(1 - BALL_LOCK_PCT, 3.5);
  const lockWheelAngle = wheelAngle + (targetAngle - wheelAngle) * lockWheelEase;
  const lockPocketAbsolute = lockWheelAngle + pocketTarget;
  
  // The ball spins CCW. It starts at DROP_A and goes to DROP_A + BALL_REVS_OPPOSITE * 2PI
  // Let's make it so by BALL_LOCK_PCT, the ball's absolute angle has perfectly aligned with lockPocketAbsolute.
  // We want the ball to spin CCW. So its final angle should be less than DROP_A.
  let finalBallAngle = lockPocketAbsolute;
  // Unwrap finalBallAngle so that it is less than DROP_A, and represents about 5-7 revolutions backward
  while(finalBallAngle > DROP_A) finalBallAngle -= 2*Math.PI;
  while(Math.abs(finalBallAngle - DROP_A) < 4 * 2*Math.PI) finalBallAngle -= 2*Math.PI;

  function spinFrame(now) {
    const elapsed = now - t0spin;
    const p = Math.min(elapsed / SPIN_DUR, 1);
    
    // Fade ball in at the very start
    if (p < 0.05) {
      ballEl.style.opacity = p / 0.05;
    } else {
      ballEl.style.opacity = '1';
    }

    // Wheel decel curve
    const wheelEase = 1 - Math.pow(1 - p, 3.5);
    const currentWheelAngle = wheelAngle + (targetAngle - wheelAngle) * wheelEase;
    drawWheel(currentWheelAngle);

    let currentBallA, currentBallR;

    if (p < BALL_LOCK_PCT) {
      // Ball is free spinning and dropping
      const localP = p / BALL_LOCK_PCT;
      
      // Angle: ease-out quad so it slows down as it approaches lock
      const angleEase = localP * (2 - localP);
      currentBallA = DROP_A + (finalBallAngle - DROP_A) * angleEase;
      
      // Radius: Stays on TRACK until DROP_START, then bounces inward
      if (p < BALL_DROP_START_PCT) {
        currentBallR = TRACK_R;
      } else {
        const dropP = (p - BALL_DROP_START_PCT) / (BALL_LOCK_PCT - BALL_DROP_START_PCT);
        // Bouncing
        const bounceFreq = 5;
        const dampening = 1 - dropP;
        const bounce = Math.abs(Math.sin(dropP * Math.PI * bounceFreq)) * 25 * dampening;
        const baseR = TRACK_R - (TRACK_R - SETTLE_R) * Math.pow(dropP, 1.5);
        currentBallR = baseR + bounce;
      }
    } else {
      // Locked in pocket
      currentBallA = currentWheelAngle + pocketTarget;
      currentBallR = SETTLE_R;
    }

    ballAngle = currentBallA;
    ballRadius = currentBallR;
    setBall(ballAngle, ballRadius);

    if (p < 1) {
      requestAnimationFrame(spinFrame);
    } else {
      wheelAngle = currentWheelAngle % (2 * Math.PI);
      ballRestAngle = wheelAngle + pocketTarget;
      ballRestRadius = SETTLE_R;
      setBall(ballRestAngle, ballRestRadius);
      spinActive = false;
      showResult(winnerIdx, data);
    }
  }
  requestAnimationFrame(spinFrame);
}

/* ── Result ── */
function showResult(winnerIdx, data) {
  gameState = 'result';
  const winner = players[winnerIdx];
  const { prize, fee } = data || calcPot();
  const slot = document.getElementById('slot'+winnerIdx);
  if(slot){slot.classList.remove('filled','me');slot.classList.add('winner');}
  document.getElementById('roTrophy').textContent = winner.isMe ? '🏆' : (winner.emoji||'🎲');
  document.getElementById('roName').textContent = winner.name + (winner.isMe ? ' (You)' : '');
  document.getElementById('roPrize').textContent = fmtUSDT(prize);
  document.getElementById('roFee').textContent = `Platform fee $${(fee||0).toFixed?fee.toFixed(2):fee} deducted`;
  document.getElementById('resultOverlay').classList.add('active');
  setStatus(winner.isMe ? '🏆 You Won!' : winner.name+' Won');
  roundNum++;
  document.getElementById('asRound').textContent = '#'+roundNum;
  if (winner.isMe) {
    launchConfetti();
    showToast('🏆 YOU WON '+fmtUSDT(prize)+' USDT! Congratulations!');
    addHistory(true, stake, prize, maxPlayers);
  } else {
    showToast('😔 '+winner.name+' won '+fmtUSDT(prize)+'. Better luck next time!');
    addHistory(false, stake, 0, maxPlayers);
  }
}

/* ── Reset ── */
function resetGame() {
  gameState='idle'; spinActive=false; players=[]; wheelAngle=0;
  ballRestAngle=null; ballEl.style.display='none'; 
  offWheel=null; offAxle=null; currentRoomId=null;
  document.getElementById('resultOverlay').classList.remove('active');
  document.getElementById('cdOverlay').classList.remove('active');
  document.getElementById('matchProgress').classList.remove('active');
  document.getElementById('btnFind').disabled=false;
  document.getElementById('btnFind').textContent='🎯 Find Match';
  document.getElementById('btnLeave').style.display='none';
  document.getElementById('stakeChips').style.pointerEvents='';
  document.getElementById('pcChips').style.pointerEvents='';
  document.getElementById('asRound').textContent='—';
  buildEmptySlots(); updatePotUI(); setStatus('Waiting'); drawIdleWheel();
}
function resetUI() {
  // Only called when backing out early, NOT at the end of a game
  if (gameState !== 'result') {
    ballRestAngle=null; ballEl.style.display='none'; 
    wheelAngle=0;
  }
  gameState='idle'; players=[]; offWheel=null; offAxle=null;
  document.getElementById('cdOverlay').classList.remove('active');
  document.getElementById('matchProgress').classList.remove('active');
  document.getElementById('btnFind').disabled=false;
  document.getElementById('btnFind').textContent='🎯 Find Match';
  document.getElementById('btnLeave').style.display='none';
  document.getElementById('stakeChips').style.pointerEvents='';
  document.getElementById('pcChips').style.pointerEvents='';
  buildEmptySlots(); updatePotUI(); setStatus('Waiting');
  
  // If we have a resting ball, don't clear the wheel entirely
  if (ballRestAngle !== null) {
    if (!offWheel) { drawIdleWheel(); } // fallback
    // ball stays where it is
  } else {
    drawIdleWheel();
  }
}

function setStatus(s){document.getElementById('abStatus').textContent=s;}

/* ── History ── */
function addHistory(won,s,prize,n){
  histCount++;
  document.getElementById('histCount').textContent=histCount+' game'+(histCount!==1?'s':'');
  const list=document.getElementById('histList');
  const empty=list.querySelector('.hist-empty'); if(empty)empty.remove();
  const pnl=won?prize-s:-s;
  const el=document.createElement('div');
  el.className='hist-item '+(won?'won':'lost');
  el.innerHTML=`<div class="hi-n">${histCount}</div><div class="hi-d">${n}p · $${s}</div><div class="hi-p ${pnl>=0?'pos':'neg'}">${pnl>=0?'+':''}$${Math.abs(pnl).toFixed(2)}</div>`;
  list.insertBefore(el,list.firstChild);
}

/* ── Confetti ── */
function launchConfetti(){
  const cols=['#6366f1','#a855f7','#fbbf24','#10b981','#ef4444','#fff','#3b82f6','#f97316'];
  for(let i=0;i<110;i++){
    const p=document.createElement('div');p.className='cfp';
    p.style.cssText=`left:${Math.random()*100}vw;background:${cols[~~(Math.random()*cols.length)]};width:${Math.random()*9+4}px;height:${Math.random()*9+4}px;border-radius:${Math.random()>.5?'50%':'2px'};animation-duration:${(Math.random()*2.2+2).toFixed(1)}s;animation-delay:${(Math.random()*.8).toFixed(2)}s`;
    document.body.appendChild(p);p.addEventListener('animationend',()=>p.remove());
  }
}

/* ── Toast ── */
function showToast(msg){
  const t=document.getElementById('toast');
  t.textContent=msg;t.classList.add('show');
  clearTimeout(t._t);t._t=setTimeout(()=>t.classList.remove('show'),3000);
}
