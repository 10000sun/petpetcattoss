import { Storage, User, Device, Share, Game, loadFullScreenAd, showFullScreenAd } from '@apps-in-toss/web-framework';
import handGif from './hand.gif';
import purrUrl from './purr.mp3';

const APP_NAME = 'petpet-cat'; // apps-in-toss.config.ts의 appName과 같아야 해요
const AD_ID = 'ait-ad-test-rewarded-id'; // 테스트용 보상형 광고 ID. 출시 전에 콘솔에서 발급한 ID로 교체하세요
const KEY = 'petpetapp.save';
let saveKey = KEY; // 사용자 식별키를 받으면 `${KEY}.${hash}`로 바뀌어요 (계정마다 저장 데이터 분리)

// 업적: 누적 터치 횟수와 보상 코인
const MILESTONES = [
  [100, 50], [500, 100], [1000, 200], [3000, 400], [5000, 600], [10000, 1000],
  [30000, 2000], [50000, 3000], [100000, 5000], [300000, 10000], [500000, 15000], [1000000, 30000],
];
// 오늘의 미션: 하루 터치 횟수와 보상 코인 (매일 0시에 초기화돼요)
const DAILY_MISSIONS = [[300, 30], [1000, 80], [3000, 200], [5000, 400], [10000, 800]];
// 터치 횟수에 따라 펫이 진화해요
const FACES = [[0, '🐱'], [500, '😺'], [3000, '😸'], [10000, '😻'], [30000, '🦁']];
const SNACKS = [
  { id: 'milk', name: '우유', e: '🥛', price: 50, hunger: 15, mood: 5 },
  { id: 'fish', name: '생선', e: '🐟', price: 100, hunger: 30, mood: 5 },
  { id: 'chicken', name: '닭고기', e: '🍗', price: 200, hunger: 60, mood: 10 },
  { id: 'cake', name: '생크림 케이크', e: '🍰', price: 500, hunger: 100, mood: 40 },
];
const ITEMS = [
  { id: 'flower', type: 'hat', e: '🌸', name: '꽃 핀', price: 400 },
  { id: 'ribbon', type: 'hat', e: '🎀', name: '리본', price: 500 },
  { id: 'cap', type: 'hat', e: '🧢', name: '야구 모자', price: 900 },
  { id: 'tophat', type: 'hat', e: '🎩', name: '신사 모자', price: 1200 },
  { id: 'santa', type: 'hat', e: '🎅', name: '산타 모자', price: 2000 },
  { id: 'grad', type: 'hat', e: '🎓', name: '학사모', price: 2500 },
  { id: 'crown', type: 'hat', e: '👑', name: '왕관', price: 3000 },
  { id: 'sky', type: 'bg', e: '☁️', name: '하늘 배경', price: 800, c: '#dff3ff' },
  { id: 'forest', type: 'bg', e: '🌳', name: '숲 배경', price: 1500, c: '#e3f6dc' },
  { id: 'snow', type: 'bg', e: '☃️', name: '눈 내리는 배경', price: 1800, c: '#eaf1ff' },
  { id: 'sakura', type: 'bg', e: '🌸', name: '벚꽃 배경', price: 2000, c: '#ffe3ee' },
  { id: 'beach', type: 'bg', e: '🏖️', name: '바다 배경', price: 2200, c: '#d6f1f4' },
  { id: 'night', type: 'bg', e: '🌙', name: '밤 배경', price: 2500, c: '#2b2a4c', dark: true },
  { id: 'sunset', type: 'bg', e: '🌅', name: '노을 배경', price: 3000, c: '#ffd9bd' },
  { id: 'space', type: 'bg', e: '🌌', name: '우주 배경', price: 5000, c: '#120d2e', dark: true },
];
const DECAY_PER_MIN = 0.5; // 배고픔·기분이 줄어드는 속도 (약 3시간 20분에 0)
const MAX_TAPS_PER_SEC = 12; // 오토클릭 방지 상한

const $ = (id) => document.getElementById(id);
let s = {
  taps: 0, coins: 0, claimed: [], hunger: 100, mood: 100, lastSeen: Date.now(),
  owned: [], hat: '', bg: '', sound: true, lastDaily: '', streak: 0,
  dailyDate: '', dailyTaps: 0, dailyClaimed: [],
};
let dirty = false;

// 토스 앱 밖(브라우저 개발)에서는 localStorage로 대신해요
const store = {
  get: async (k) => { try { return await Storage.getItem(k); } catch { return localStorage.getItem(k); } },
  set: async (k, v) => { try { await Storage.setItem(k, v); } catch { localStorage.setItem(k, v); } },
};
const save = () => { if (dirty) { dirty = false; s.lastSeen = Date.now(); store.set(saveKey, JSON.stringify(s)); } };
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
// 큰 숫자는 만 단위로 줄여서 보여줘요
const fmt = (n) => (n >= 10000 ? `${+(n / 10000).toFixed(1)}만` : n.toLocaleString());
// 날짜가 바뀌면 오늘의 미션을 초기화해요
function ensureDay() {
  if (s.dailyDate !== today()) { s.dailyDate = today(); s.dailyTaps = 0; s.dailyClaimed = []; touch(); }
}
let tab = 'day';
const LISTS = {
  day: { list: DAILY_MISSIONS, value: () => s.dailyTaps, done: () => s.dailyClaimed },
  ach: { list: MILESTONES, value: () => s.taps, done: () => s.claimed },
};
const ready = (k) => LISTS[k].list.some(([n]) => !LISTS[k].done().includes(n) && LISTS[k].value() >= n);

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
  ensureDay();
  $('count').textContent = s.taps.toLocaleString();
  $('count').style.fontSize = s.taps >= 1e6 ? '34px' : s.taps >= 1e5 ? '44px' : '';
  $('coins').textContent = `🪙 ${s.coins.toLocaleString()}`;
  $('snd').textContent = s.sound ? '🔊' : '🔇';
  $('daily').classList.toggle('dot', canDaily());
  $('hunger').style.width = `${s.hunger}%`;
  $('mood').style.width = `${s.mood}%`;
  $('pet').textContent = s.hunger < 20 ? '😿' : FACES[stageOf(s.taps)][1];
  layoutHat();

  const { list, value, done } = LISTS[tab], v = value(), claimed = done();
  const next = list.find(([n]) => !claimed.includes(n) && v < n);
  const prev = [...list].reverse().find(([n]) => n <= v)?.[0] ?? 0;
  $('fill').style.width = next ? `${((v - prev) / (next[0] - prev)) * 100}%` : '100%';
  $('next').textContent = s.hunger < 20 ? '배고파해요! 상점에서 간식을 사 주세요'
    : next ? `${tab === 'day' ? '오늘 ' : ''}${fmt(next[0])}번까지 ${fmt(next[0] - v)}번 남았어요`
      : tab === 'day' ? '오늘 미션을 모두 달성했어요!' : '모든 업적을 달성했어요!';
  document.querySelectorAll('#tabs button').forEach((b) => {
    b.classList.toggle('on', b.dataset.tab === tab); b.classList.toggle('dot', ready(b.dataset.tab));
  });
  $('rewards').innerHTML = list.map(([n, c]) => {
    const isDone = claimed.includes(n), isReady = !isDone && v >= n;
    return `<div class="r${isDone ? ' done' : ''}"><b>${fmt(n)}</b>🪙 ${fmt(c)}` +
      (isReady ? `<button data-claim="${n}">받기</button>` + (adOk() ? `<button class="ad" data-ad="${n}">📺 2배</button>` : '') : isDone ? '<br>완료' : '') + '</div>';
  }).join('');
  if (!$('shop').hidden) renderShop();
}

function renderShop() {
  const row = (ico, nm, btn) => `<div class="item"><span class="ico">${ico}</span><span class="nm">${nm}</span>${btn}</div>`;
  const gear = (type) => ITEMS.filter((i) => i.type === type).map((i) => {
    const own = s.owned.includes(i.id), on = s.hat === i.id || s.bg === i.id;
    return row(i.e, i.name, own ? `<button data-eq="${i.id}"${on ? ' class="off"' : ''}>${on ? '해제' : '장착'}</button>` : `<button data-buy="${i.id}">🪙 ${fmt(i.price)}</button>`);
  }).join('');
  $('shop').innerHTML = `<h3>상점 <button id="shopClose" aria-label="닫기">✕</button></h3>
    <h4>간식</h4>` + SNACKS.map((n) => row(n.e, `${n.name} (배고픔 +${n.hunger})`, `<button data-snack="${n.id}">🪙 ${fmt(n.price)}</button>`)).join('') +
    `<h4>모자</h4>${gear('hat')}<h4>배경</h4>${gear('bg')}`;
}

// ---- 터치 ----
const tapTimes = [];
$('pet').addEventListener('pointerdown', () => {
  const now = performance.now();
  while (tapTimes.length && now - tapTimes[0] > 1000) tapTimes.shift();
  if (tapTimes.length >= MAX_TAPS_PER_SEC) return;
  tapTimes.push(now);

  const before = stageOf(s.taps);
  ensureDay(); s.taps++; s.dailyTaps++; s.mood = Math.min(100, s.mood + 0.5); touch();
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
  const { list, value, done } = LISTS[tab], m = list.find(([t]) => t === n);
  if (!m || done().includes(n) || value() < n) return;
  done().push(n); s.coins += m[1] * mult; touch(); save();
  haptic('success'); chime([660, 880]); toast(`🪙 ${fmt(m[1] * mult)} 받았어요!`); render();
}

$('rewards').addEventListener('click', (e) => {
  const { claim: c, ad } = e.target.dataset;
  if (c) claim(Number(c), 1);
  // 광고를 보는 동안 탭이 바뀌어도 원래 탭의 보상을 지급해요
  if (ad) { const k = tab; showAd(() => { tab = k; claim(Number(ad), 2); }); }
});
$('tabs').addEventListener('click', (e) => { if (e.target.dataset.tab) { tab = e.target.dataset.tab; render(); } });

$('shop').addEventListener('click', (e) => {
  const d = e.target.dataset;
  if (e.target.id === 'shopClose') { $('shop').hidden = true; return; }
  if (d.snack) {
    const n = SNACKS.find((x) => x.id === d.snack);
    if (s.coins < n.price) return toast('코인이 부족해요');
    s.coins -= n.price; s.hunger = Math.min(100, s.hunger + n.hunger); s.mood = Math.min(100, s.mood + n.mood);
    haptic('success'); beep(520, 0.12, 'sine');
  } else if (d.buy) {
    const i = item(d.buy);
    if (s.coins < i.price) return toast('코인이 부족해요');
    s.coins -= i.price; s.owned.push(i.id); haptic('success'); chime([660, 880]); toast(`${i.name} 구매 완료!`);
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
  const c = 100 + Math.min(s.streak, 7) * 50;
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

// 게임 미니앱은 사용자 식별키(User.getAnonymousKey)를 발급받아 저장 데이터를 사용자별로 구분해요.
// 지원하지 않는 환경(구버전 토스 앱 등)이거나 3초 안에 못 받으면 기본 키로 시작해요.
const userKey = () => Promise.race([
  Promise.resolve().then(() => User.getAnonymousKey()).then((r) => r?.hash || 'local'),
  new Promise((r) => setTimeout(() => r('local'), 3000)),
]).catch(() => 'local');

userKey()
  .then((hash) => { saveKey = `${KEY}.${hash}`; return store.get(saveKey); })
  .then((v) => { if (v) { s = { ...s, ...JSON.parse(v) }; decay((Date.now() - s.lastSeen) / 60000); } })
  .catch(() => {})
  .finally(() => { s.lastSeen = Date.now(); render(); loadAd(); });
