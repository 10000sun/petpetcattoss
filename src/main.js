import { Storage } from '@apps-in-toss/web-framework';
import handGif from './hand.gif';

// 목표 횟수와 보상 코인
const MILESTONES = [
  [10, 5], [50, 10], [100, 20], [300, 50], [500, 100],
  [1000, 200], [3000, 500], [5000, 1000], [10000, 2000],
];
// 터치 횟수에 따라 펫이 진화해요
const FACES = [[0, '🐱'], [100, '😺'], [500, '😸'], [2000, '😻'], [5000, '🦁']];
const KEY = 'petpetapp.save';

const $ = (id) => document.getElementById(id);
let s = { taps: 0, coins: 0, claimed: [] };
let dirty = false;

// 토스 앱 밖(브라우저 개발)에서는 localStorage로 대신해요
const store = {
  get: async (k) => { try { return await Storage.getItem(k); } catch { return localStorage.getItem(k); } },
  set: async (k, v) => { try { await Storage.setItem(k, v); } catch { localStorage.setItem(k, v); } },
};

const save = () => { if (dirty) { dirty = false; store.set(KEY, JSON.stringify(s)); } };

function render() {
  $('count').textContent = s.taps.toLocaleString();
  $('coins').textContent = `🪙 ${s.coins.toLocaleString()}`;
  $('pet').textContent = [...FACES].reverse().find(([n]) => s.taps >= n)[1];
  const next = MILESTONES.find(([n]) => !s.claimed.includes(n) && s.taps < n);
  const prev = [...MILESTONES].reverse().find(([n]) => n <= s.taps)?.[0] ?? 0;
  $('fill').style.width = next ? `${((s.taps - prev) / (next[0] - prev)) * 100}%` : '100%';
  $('next').textContent = next ? `${next[0].toLocaleString()}번까지 ${(next[0] - s.taps).toLocaleString()}번 남았어요` : '모든 보상을 받았어요!';
  $('rewards').innerHTML = MILESTONES.map(([n, c]) => {
    const done = s.claimed.includes(n);
    const ready = !done && s.taps >= n;
    return `<div class="r${done ? ' done' : ''}"><b>${n.toLocaleString()}</b>🪙 ${c}` +
      (ready ? `<button data-n="${n}">받기</button>` : done ? '<br>완료' : '') + '</div>';
  }).join('');
}

$('pet').addEventListener('pointerdown', () => {
  s.taps++; dirty = true;
  const pet = $('pet');
  pet.classList.remove('hit'); void pet.offsetWidth; pet.classList.add('hit');
  // 쓰다듬는 손: 터치 위치와 상관없이 고양이 이마(얼굴 중앙에서 위쪽)에 손끝이 오도록 고정해요.
  // 터치마다 새로 띄우고 GIF 재생 시간(1.1초)이 지나면 지워요.
  const r = pet.getBoundingClientRect(), fs = parseFloat(getComputedStyle(pet).fontSize), w = fs * 0.73;
  const hand = new Image();
  hand.className = 'hand'; hand.src = handGif; hand.style.width = `${w}px`;
  hand.style.left = `${r.left + r.width / 2 - w * 0.917}px`;
  hand.style.top = `${r.top + r.height / 2 - fs * 0.3 - w * 0.4}px`;
  document.body.append(hand);
  setTimeout(() => hand.remove(), 1100);
  render();
});

$('rewards').addEventListener('click', (e) => {
  const n = Number(e.target.dataset.n);
  const m = MILESTONES.find(([t]) => t === n);
  if (!m || s.claimed.includes(n) || s.taps < n) return;
  s.claimed.push(n); s.coins += m[1]; dirty = true; save(); render();
});

setInterval(save, 1000);
document.addEventListener('visibilitychange', save);

store.get(KEY).then((v) => { if (v) s = { ...s, ...JSON.parse(v) }; }).catch(() => {}).finally(render);
