/* ==========================================================
   スクロール位置に合わせて、ページ全体の見た目を次の場面へ寄せていく。

   各 .scene が CSS で持っている値（--w-bg など）を読み、
   画面の少し下（55% の高さ）が場面の境目をまたぐあいだに、
   背景色・角の丸み・奥の模様を少しずつ混ぜる。
   文字色は背景の明るさで白か黒に切り替える（常にコントラスト比 4.5 以上）。
   ========================================================== */
(() => {
  const root = document.documentElement;
  const scenes = [...document.querySelectorAll('.scene')];
  const layers = [...document.querySelectorAll('.bd')];
  const backdrop = document.querySelector('.backdrop');
  const chrome = document.querySelector('.chrome');
  const railLabel = document.querySelector('.rail__label');
  const railFill = document.querySelector('.rail__track i');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  if (!scenes.length) return;

  const hex = (str) => {
    let s = str.trim().replace('#', '');
    if (s.length === 3) s = [...s].map((c) => c + c).join('');
    const n = parseInt(s, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const luminance = ([r, g, b]) => {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };

  const PROBE = 0.55;      // 画面のどの高さで場面を判定するか
  const BLEND = 0.45;      // 境目の前後、画面の何割ぶんで混ぜるか
  const LIGHT_BG = 0.18;   // これより明るい背景には黒い文字を乗せる

  let data = [];
  const measure = () => {
    data = scenes.map((el) => {
      const cs = getComputedStyle(el);
      const v = (name) => cs.getPropertyValue(name).trim();
      return {
        top: el.getBoundingClientRect().top + scrollY,
        world: el.dataset.world,
        label: el.dataset.label || '',
        bg: hex(v('--w-bg')),
        ink: v('--w-ink'),
        paper: v('--w-paper'),
        radius: parseFloat(v('--w-r')) || 0,
      };
    });
  };

  let shownLabel = railLabel ? railLabel.textContent : '';
  let ticking = false;

  // 値が変わったときだけ書き込む。
  // 色と角丸は使う要素（背景・ナビ）にだけ渡し、ページ全体の再計算を起こさない
  const last = {};
  const put = (key, value, write) => {
    if (last[key] === value) return;
    last[key] = value;
    write(value);
  };

  const render = () => {
    ticking = false;
    const vh = innerHeight;
    const y = scrollY;
    const probe = y + vh * PROBE;
    const zone = vh * BLEND;

    let i = 0;
    while (i < data.length - 1 && probe >= data[i + 1].top) i++;

    let a = data[i];
    let b = a;
    let t = 0;
    const next = data[i + 1];
    if (next && next.top - probe < zone) {
      b = next;
      t = 0.5 - (next.top - probe) / (2 * zone);
    } else if (i > 0 && probe - a.top < zone) {
      b = a;
      a = data[i - 1];
      t = 0.5 + (probe - b.top) / (2 * zone);
    }
    // 最後の場面は短いので、いちばん下まで来たときに混ぜ終わるように伸ばす
    const max = Math.max(0, root.scrollHeight - vh);
    if (b === data[data.length - 1] && a !== b) {
      const tAtEnd = 0.5 + (max + vh * PROBE - b.top) / (2 * zone);
      if (tAtEnd > 0 && tAtEnd < 1) t /= tAtEnd;
    }
    t = Math.min(1, Math.max(0, t));
    t = t * t * (3 - 2 * t);

    const bg = mix(a.bg, b.bg, t);
    const main = t < 0.5 ? a : b;
    put('bg', `rgb(${bg.join(' ')})`, (v) => {
      backdrop.style.setProperty('--bg', v);
      chrome.style.setProperty('--bg', v);
    });
    put('fg', luminance(bg) > LIGHT_BG ? main.ink : main.paper, (v) => root.style.setProperty('--fg', v));
    put('r', `${(a.radius + (b.radius - a.radius) * t).toFixed(1)}px`, (v) => chrome.style.setProperty('--r', v));
    if (railFill) {
      put('p', max > 0 ? Math.min(1, y / max).toFixed(3) : '0', (v) => { railFill.style.transform = `scaleY(${v})`; });
    }

    let tankVisible = false;
    for (const layer of layers) {
      const w = layer.dataset.world;
      const o = a === b ? (a.world === w ? 1 : 0) : (a.world === w ? 1 - t : 0) + (b.world === w ? t : 0);
      const shown = o > 0.004;
      if (w === 'tank') tankVisible = shown;
      put(`o-${w}`, o.toFixed(3), (v) => {
        layer.style.opacity = v;
        layer.style.visibility = shown ? 'visible' : 'hidden';
      });
    }
    tank.setVisible(tankVisible);

    if (root.dataset.world !== main.world) root.dataset.world = main.world;
    if (railLabel && shownLabel !== main.label) {
      shownLabel = main.label;
      railLabel.textContent = main.label;
      if (!reduceMotion.matches && railLabel.animate) {
        railLabel.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 320, easing: 'ease-out' });
      }
    }
  };

  const request = () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(render);
    }
  };

  /* ----------------------------------------------------------
     TankAce の背景：TriBgSystem.cpp を canvas に移したもの。
     150 個の歪んだ三角形が、ゆっくり回りながら画面を流れる。
     値（大きさ 25〜160、速さ 0.3〜1.3、明るさ 0.55〜1.3、
     不透明度 0.06〜0.22、基準色 0.65/0.05/0.05）はゲームと同じ。
     ---------------------------------------------------------- */
  const tank = (() => {
    const canvas = document.querySelector('.bd--tank canvas');
    if (!canvas || !canvas.getContext) return { setVisible() {} };
    const ctx = canvas.getContext('2d');
    const COUNT = 150;
    const BASE = [0.65, 0.05, 0.05];
    const TAU = Math.PI * 2;
    const rand = (lo, hi) => lo + (hi - lo) * Math.random();
    let w = 0;
    let h = 0;
    let scale = 1;
    let tris = [];
    let running = false;
    let visible = false;

    const spawn = (tri) => {
      tri.size = rand(25, 160);
      tri.rot = rand(0, TAU);
      tri.rotVel = rand(-0.007, 0.007);
      tri.ang = [rand(-0.7, 0.7), rand(-0.7, 0.7), rand(-0.7, 0.7)];
      tri.rad = [rand(0.4, 1.6), rand(0.4, 1.6), rand(0.4, 1.6)];
      const hw = w / 2 + tri.size;
      const hh = h / 2 + tri.size;
      const edge = Math.random();
      if (edge < 0.25) { tri.x = rand(-hw, hw); tri.y = hh; }
      else if (edge < 0.5) { tri.x = rand(-hw, hw); tri.y = -hh; }
      else if (edge < 0.75) { tri.x = -hw; tri.y = rand(-hh, hh); }
      else { tri.x = hw; tri.y = rand(-hh, hh); }
      const dir = rand(0, TAU);
      const speed = rand(0.3, 1.3);
      tri.vx = Math.cos(dir) * speed;
      tri.vy = Math.sin(dir) * speed;
      const bright = rand(0.55, 1.3);
      const rgb = BASE.map((c) => Math.round(Math.min(c * bright, 1) * 255));
      tri.color = `rgba(${rgb.join(',')},${rand(0.06, 0.22).toFixed(3)})`;
      return tri;
    };

    const resize = () => {
      const dpr = Math.min(devicePixelRatio || 1, 1.5);
      const cw = canvas.clientWidth || innerWidth;
      const ch = canvas.clientHeight || innerHeight;
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
      scale = Math.max(cw / 1280, ch / 720);   // ゲームの画面は 1280×720
      w = cw / scale;
      h = ch / scale;
      ctx.setTransform(dpr * scale, 0, 0, dpr * scale, (cw / 2) * dpr, (ch / 2) * dpr);
      if (!tris.length) {
        tris = Array.from({ length: COUNT }, () => {
          const tri = spawn({});
          tri.x = rand(-w / 2, w / 2);
          tri.y = rand(-h / 2, h / 2);
          return tri;
        });
      }
    };

    const draw = () => {
      ctx.clearRect(-w, -h, w * 2, h * 2);
      for (const tri of tris) {
        ctx.beginPath();
        for (let k = 0; k < 3; k++) {
          const ang = tri.rot + k * (TAU / 3) + tri.ang[k];
          const rad = tri.size * tri.rad[k];
          const px = tri.x + Math.cos(ang) * rad;
          const py = tri.y + Math.sin(ang) * rad;
          if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fillStyle = tri.color;
        ctx.fill();
      }
    };

    const step = () => {
      const hw = w / 2 + 200;
      const hh = h / 2 + 200;
      for (const tri of tris) {
        tri.x += tri.vx;
        tri.y += tri.vy;
        tri.rot += tri.rotVel;
        if (tri.x < -hw || tri.x > hw || tri.y < -hh || tri.y > hh) spawn(tri);
      }
    };

    const loop = () => {
      if (!visible || reduceMotion.matches) { running = false; return; }
      step();
      draw();
      requestAnimationFrame(loop);
    };

    resize();
    draw();
    addEventListener('resize', () => { resize(); draw(); });

    return {
      setVisible(v) {
        visible = v;
        if (v && !running && !reduceMotion.matches) {
          running = true;
          requestAnimationFrame(loop);
        }
      },
    };
  })();

  const refresh = () => { measure(); render(); };
  addEventListener('scroll', request, { passive: true });
  addEventListener('resize', refresh);
  addEventListener('load', refresh);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(refresh);
  if ('ResizeObserver' in window) {
    new ResizeObserver(refresh).observe(document.querySelector('main'));
  }
  refresh();
})();
