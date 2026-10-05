import { Storage, Device, Share, Game, loadFullScreenAd, showFullScreenAd } from '@apps-in-toss/web-framework';
import handGif from './hand.gif';
import purrUrl from './purr.mp3';

const APP_NAME = 'petpetapp'; // apps-in-toss.config.ts의 appName과 같아야 해요
const AD_ID = 'ait-ad-test-rewarded-id'; // 테스트용 보상형 광고 ID. 출시 전에 콘솔에서 발급한 ID로 교체하세요
const KEY = 'petpetapp.save';

// 목표 횟수와 보상 코인
const MILESTONES = [
  [10, 5], [50, 10], [100, 20], [300, 50], [500, 100],
  [1000, 200], [3000, 500], [5000, 1000], [10000, 2000],
];
// 터치 횟수에 따라 펫이 진화해요
const FACES = [[0, '🐱'], [100, '😺'], [500, '😸'], [2000, '😻'], [5000, '🦁']];
const SNACK = { name: '생선', e: '🐟', price: 10, hunger: 30 };
const ITEMS = [
  { id: 'ribbon', type: 'hat', e: '🎀', name: '리본', price: 50 },
  { id: 'tophat', type: 'hat', e: '🎩', name: '신사 모자', price: 120 },
  { id: 'crown', type: 'hat', e: '👑', name: '왕관', price: 300 },
  { id: 'sky', type: 'bg', e: '☁️', name: '하늘 배경', price: 80, c: '#dff3ff' },
  { id: 'forest', type: 'bg', e: '🌳', name: '숲 배경', price: 150, c: '#e3f6dc' },
  { id: 'night', type: 'bg', e: '🌙', name: '밤 배경', price: 250, c: '#2b2a4c', dark: true },
];
const DECAY_PER_MIN = 0.5; // 배고픔·기분이 줄어드는 속도 (약 3시간 20분에 0)
const MAX_TAPS_PER_SEC = 12; // 오토클릭 방지 상한

const $ = (id) => document.getElementById(id);
let s = {
  taps: 0, coins: 0, claimed: [], hunger: 100, mood: 100, lastSeen: Date.now(),
  owned: [], hat: '', bg: '', sound: true, lastDaily: '', streak: 0,
};
let dirty = false;

// 토스 앱 밖(브라우저 개발)에서는 localStorage로 대신해요
const store = {
  get: async (k) => { try { return await Storage.getItem(k); } catch { return localStorage.getItem(k); } },
  set: async (k, v) => { try { await Storage.setItem(k, v); } catch { localStorage.setItem(k, v); } },
};
const save = () => { if (dirty) { dirty = false; s.lastSeen = Date.now(); store.set(KEY, JSON.stringify(s)); } };
const touch = () => { dirty = true; };

const safe = (fn) => { try { return Promise.resolve(fn()).catch(() => {}); } catch { return Promise.resolve(); } };
const haptic = (type) => safe(() => Device.triggerHaptic({ type }));

// ---- 사운드 (WebAudio로 직접 만들어서 저작권 걱정이 없어요) ----
let ac;
function beep(freq, dur = 0.09, type = 'triangle', vol = 0.15) {
  if (!s.sound) return;
  ac ??= new AudioContext();
  if (ac.state === 'suspended') ac.resume();
  const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime;
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(ac.destination); o.start(t); o.stop(t + dur);
}

// 골골송: 터치하는 동안 5초짜리 음원을 반복 재생하고, 멈추면 부드럽게 줄여요
const purrData = fetch(purrUrl).then((r) => r.arrayBuffer()).catch(() => null);
let purrReady, purrSrc, purrGain, purrOff;
async function purr() {
  if (!s.sound) return;
  ac ??= new AudioContext();
  if (ac.state === 'suspended') ac.resume();
  purrReady ??= purrData.then((d) => d && ac.decodeAudioData(d));
  const buf = await purrReady.catch(() => null);
  if (!buf || !s.sound) return;
  if (!purrSrc) {
    const t = ac.currentTime;
    purrSrc = ac.createBufferSource(); purrSrc.buffer = buf; purrSrc.loop = true;
    purrGain = ac.createGain(); purrGain.gain.setValueAtTime(0, t); purrGain.gain.linearRampToValueAtTime(0.8, t + 0.15);
    purrSrc.connect(purrGain).connect(ac.destination);
    purrSrc.start(0, Math.random() * buf.duration);
  }
  clearTimeout(purrOff); purrOff = setTimeout(stopPurr, 700);
}
function stopPurr(fast) {
  if (!purrSrc) return;
  const src = purrSrc, g = purrGain, t = ac.currentTime, d = fast === true ? 0.02 : 0.3;
  purrSrc = null; clearTimeout(purrOff);
  g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.linearRampToValueAtTime(0, t + d);
  src.stop(t + d);
}
const chime = (notes) => notes.forEach((f, i) => setTimeout(() => beep(f, 0.15, 'sine'), i * 100));
// 백그라운드로 가면 즉시 소리를 끄고, 돌아오면 다시 켜요
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { stopPurr(true); ac?.suspend(); save(); submitScore(true); } else if (s.sound) ac?.resume();
});

// ---- 유틸 ----
let toastTimer;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 1800);
}
const stageOf = (t) => FACES.filter(([n]) => t >= n).length - 1;
const item = (id) => ITEMS.find((i) => i.id === id);
const today = () => new Date().toDateString();
const canDaily = () => s.lastDaily !== today();

// ---- 리더보드 (점수 제출은 플레이 도중 가끔, 그리고 백그라운드로 갈 때) ----
let lastSubmit = 0;
function submitScore(force) {
  if (!s.taps || (!force && Date.now() - lastSubmit < 30000)) return;
  lastSubmit = Date.now();
  safe(() => Game.setLeaderboardScore({ score: String(s.taps) }));
}

// ---- 보상형 광고 ----
let adReady = false;
const adOk = () => { try { return loadFullScreenAd.isSupported() && showFullScreenAd.isSupported(); } catch { return false; } };
function loadAd() {
  adReady = false;
  if (!adOk()) return;
  try {
    loadFullScreenAd({
      options: { adGroupId: AD_ID },
      onEvent: (e) => { if (e.type === 'loaded') { adReady = true; render(); } },
      onError: () => {},
    });
  } catch {}
}
// userEarnedReward 이벤트가 왔을 때만 보상을 줘요 (닫기만으로는 지급 X)
function showAd(onReward) {
  if (!adReady) return toast('광고를 준비하고 있어요. 잠시 후 다시 눌러 주세요');
  adReady = false; render();
  try {
    showFullScreenAd({
      options: { adGroupId: AD_ID },
      onEvent: (e) => {
        if (e.type === 'userEarnedReward') onReward();
        if (e.type === 'dismissed' || e.type === 'failedToShow') loadAd();
      },
      onError: () => { toast('광고를 보여줄 수 없어요'); loadAd(); },
    });
  } catch { loadAd(); }
}

// ---- 화면 ----
function layoutHat() {
  const h = item(s.hat), st = $('stage'), fs = parseFloat(getComputedStyle($('pet')).fontSize);
  $('hat').textContent = h ? h.e : '';
  $('hat').style.fontSize = `${fs * 0.4}px`;
  $('hat').style.top = `${st.clientHeight / 2 - fs * 0.5 - fs * 0.14}px`;
}

function render() {
  const bg = item(s.bg);
  document.body.style.background = bg ? bg.c : '';
  document.body.classList.toggle('dark', !!bg?.dark);
  $('count').textContent = s.taps.toLocaleString();
  $('coins').textContent = `🪙 ${s.coins.toLocaleString()}`;
  $('snd').textContent = s.sound ? '🔊' : '🔇';
  $('daily').classList.toggle('dot', canDaily());
  $('hunger').style.width = `${s.hunger}%`;
  $('mood').style.width = `${s.mood}%`;
  $('pet').textContent = s.hunger < 20 ? '😿' : FACES[stageOf(s.taps)][1];
  layoutHat();

  const next = MILESTONES.find(([n]) => !s.claimed.includes(n) && s.taps < n);
  const prev = [...MILESTONES].reverse().find(([n]) => n <= s.taps)?.[0] ?? 0;
  $('fill').style.width = next ? `${((s.taps - prev) / (next[0] - prev)) * 100}%` : '100%';
  $('next').textContent = s.hunger < 20 ? '배고파해요! 상점에서 간식을 사 주세요'
    : next ? `${next[0].toLocaleString()}번까지 ${(next[0] - s.taps).toLocaleString()}번 남았어요` : '모든 보상을 받았어요!';
  $('rewards').innerHTML = MILESTONES.map(([n, c]) => {
    const done = s.claimed.includes(n), ready = !done && s.taps >= n;
    return `<div class="r${done ? ' done' : ''}"><b>${n.toLocaleString()}</b>🪙 ${c}` +
      (ready ? `<button data-claim="${n}">받기</button>` + (adOk() ? `<button class="ad" data-ad="${n}">📺 2배</button>` : '') : done ? '<br>완료' : '') + '</div>';
  }).join('');
  if (!$('shop').hidden) renderShop();
}

function renderShop() {
  $('shop').innerHTML = `<h3>상점 <button id="shopClose" aria-label="닫기">✕</button></h3>
    <div class="item"><span class="ico">${SNACK.e}</span><span class="nm">${SNACK.name} (배고픔 +${SNACK.hunger})</span><button data-snack>🪙 ${SNACK.price}</button></div>` +
    ITEMS.map((i) => {
      const own = s.owned.includes(i.id), on = s.hat === i.id || s.bg === i.id;
      return `<div class="item"><span class="ico">${i.e}</span><span class="nm">${i.name}</span>` +
        (own ? `<button data-eq="${i.id}"${on ? ' class="off"' : ''}>${on ? '해제' : '장착'}</button>` : `<button data-buy="${i.id}">🪙 ${i.price}</button>`) + '</div>';
    }).join('');
}

// ---- 터치 ----
const tapTimes = [];
$('pet').addEventListener('pointerdown', () => {
  const now = performance.now();
  while (tapTimes.length && now - tapTimes[0] > 1000) tapTimes.shift();
  if (tapTimes.length >= MAX_TAPS_PER_SEC) return;
  tapTimes.push(now);

  const before = stageOf(s.taps);
  s.taps++; s.mood = Math.min(100, s.mood + 0.5); touch();
  const pet = $('pet');
  pet.classList.remove('hit'); void pet.offsetWidth; pet.classList.add('hit');
  haptic('tickWeak'); purr();

  // 쓰다듬는 손: 터치 위치와 상관없이 고양이 이마(얼굴 중앙에서 위쪽)에 손끝이 오도록 고정해요.
  // 터치마다 새로 띄우고 GIF 재생 시간(1.1초)이 지나면 지워요.
  const r = pet.getBoundingClientRect(), fs = parseFloat(getComputedStyle(pet).fontSize), w = fs * 0.73;
  const hand = new Image();
  hand.className = 'hand'; hand.src = handGif; hand.style.width = `${w}px`;
  hand.style.left = `${r.left + r.width / 2 - w * 0.917}px`;
  hand.style.top = `${r.top + r.height / 2 - fs * 0.3 - w * 0.4}px`;
  document.body.append(hand);
  setTimeout(() => hand.remove(), 1100);

  if (stageOf(s.taps) > before) { // 진화!
    pet.classList.remove('evolve'); void pet.offsetWidth; pet.classList.add('evolve');
    toast(`진화했어요! ${FACES[stageOf(s.taps)][1]}`); haptic('confetti'); chime([523, 659, 784, 1047]);
  }
  if (s.taps % 50 === 0) submitScore();
  render();
});

// ---- 보상·상점·메뉴 ----
function claim(n, mult) {
  const m = MILESTONES.find(([t]) => t === n);
  if (!m || s.claimed.includes(n) || s.taps < n) return;
  s.claimed.push(n); s.coins += m[1] * mult; touch(); save();
  haptic('success'); chime([660, 880]); toast(`🪙 ${m[1] * mult} 받았어요!`); render();
}

$('rewards').addEventListener('click', (e) => {
  const { claim: c, ad } = e.target.dataset;
  if (c) claim(Number(c), 1);
  if (ad) showAd(() => claim(Number(ad), 2));
});

$('shop').addEventListener('click', (e) => {
  const d = e.target.dataset;
  if (e.target.id === 'shopClose') { $('shop').hidden = true; return; }
  if ('snack' in d) {
    if (s.coins < SNACK.price) return toast('코인이 부족해요');
    s.coins -= SNACK.price; s.hunger = Math.min(100, s.hunger + SNACK.hunger); s.mood = Math.min(100, s.mood + 5);
    haptic('success'); beep(520, 0.12, 'sine');
  } else if (d.buy) {
    const i = item(d.buy);
    if (s.coins < i.price) return toast('코인이 부족해요');
    s.coins -= i.price; s.owned.push(i.id); haptic('success'); chime([660, 880]);
  } else if (d.eq) {
    const i = item(d.eq), k = i.type === 'hat' ? 'hat' : 'bg';
    s[k] = s[k] === i.id ? '' : i.id;
  } else return;
  touch(); save(); render();
});

$('shopBtn').onclick = () => { $('shop').hidden = false; renderShop(); };
$('snd').onclick = () => { s.sound = !s.sound; if (!s.sound) { stopPurr(true); ac?.suspend(); } else beep(600); touch(); save(); render(); };
$('rank').onclick = () => { submitScore(true); safe(() => Game.openLeaderboard()); };
$('share').onclick = async () => {
  try {
    const link = await Share.createLink({ path: `intoss://${APP_NAME}` });
    await Share.sendMessage({ message: `펫펫에서 고양이를 ${s.taps.toLocaleString()}번 쓰다듬었어요! 같이 키워요 🐱 ${link}` });
  } catch { toast('지금은 공유할 수 없어요'); }
};
$('daily').onclick = () => {
  if (!canDaily()) return toast('오늘 출석 보상은 이미 받았어요');
  const yesterday = new Date(Date.now() - 864e5).toDateString();
  s.streak = s.lastDaily === yesterday ? s.streak + 1 : 1;
  s.lastDaily = today();
  const c = 10 + Math.min(s.streak, 7) * 5;
  s.coins += c; touch(); save(); haptic('success'); chime([660, 880]);
  toast(`출석 ${s.streak}일째! 🪙 ${c}`); render();
};

// ---- 시간이 지나면 배고픔·기분이 줄어요 ----
function decay(min) {
  s.hunger = Math.max(0, s.hunger - min * DECAY_PER_MIN);
  s.mood = Math.max(0, s.mood - min * DECAY_PER_MIN);
}
setInterval(() => { decay(1); touch(); render(); }, 60000);
setInterval(save, 1000);
window.addEventListener('resize', layoutHat);

store.get(KEY)
  .then((v) => { if (v) { s = { ...s, ...JSON.parse(v) }; decay((Date.now() - s.lastSeen) / 60000); } })
  .catch(() => {})
  .finally(() => { s.lastSeen = Date.now(); render(); loadAd(); });
