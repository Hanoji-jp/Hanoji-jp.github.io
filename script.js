/* ==========================================================
   スクロール位置に合わせて、ページ全体の見た目を次の場面へ寄せていく。

   各 .scene が CSS で持っている値（--w-bg など）を読み、
   画面の少し下（55% の高さ）が場面の境目をまたぐあいだに、
   背景色・角の丸み・奥の模様を少しずつ混ぜる。
   文字色は背景の明るさで白か黒に切り替える。

   負荷を抑えるための決まりごと
   ・作らない：値が変わったときだけ書き込む。色と角丸は、使う要素にだけ渡す
   ・描かない：画面に出ていない背景は止める。画面の外の三角形は GPU に送らない
   ・使い回す：背景は本文と別のレイヤー。動かしても本文は描き直さない
   ・GPU に任せる：星空と三角形は WebGL で、1回の描画命令でまとめて描く
   ========================================================== */
(() => {
  const root = document.documentElement;
  const scenes = [...document.querySelectorAll('.scene')];
  let layers = [];   // 奥の模様。WebGL の準備が済んでから集める
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

  const PROBE = 0.55;   // 画面のどの高さで場面を判定するか
  const BLEND = 0.45;   // 境目の前後、画面の何割ぶんで混ぜるか

  // 背景がこの明るさを超えたら黒い文字、下回ったら白い文字にする。
  // 文字色の切り替えは本文全体の描き直しになるので、境目に幅を持たせて、
  // 同じ場所を行き来しても何度も切り替わらないようにしている
  const DARK_TEXT_ABOVE = 0.195;
  const LIGHT_TEXT_BELOW = 0.165;
  let darkText = null;

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

  // 値が変わったときだけ書き込む
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

    // 背景色：背景のレイヤーとナビにだけ渡す（ページ全体のスタイル再計算を起こさない）
    put('bg', `rgb(${bg.join(' ')})`, (v) => {
      backdrop.style.backgroundColor = v;
      chrome.style.setProperty('--bg', v);
    });
    put('r', `${(a.radius + (b.radius - a.radius) * t).toFixed(1)}px`, (v) => chrome.style.setProperty('--r', v));

    // 文字色：切り替わるのは場面の境目ごとに1回だけ
    const lum = luminance(bg);
    if (darkText === null) darkText = lum > (DARK_TEXT_ABOVE + LIGHT_TEXT_BELOW) / 2;
    else if (lum > DARK_TEXT_ABOVE) darkText = true;
    else if (lum < LIGHT_TEXT_BELOW) darkText = false;
    put('fg', darkText ? main.ink : main.paper, (v) => root.style.setProperty('--fg', v));

    if (railFill) {
      put('p', max > 0 ? Math.min(1, y / max).toFixed(3) : '0', (v) => { railFill.style.transform = `scaleY(${v})`; });
    }

    // 奥の模様：不透明度だけを変える（GPU 上の合成で済む）
    let tankVisible = false;
    let starsVisible = false;
    for (const layer of layers) {
      const w = layer.dataset.world;
      const o = a === b ? (a.world === w ? 1 : 0) : (a.world === w ? 1 - t : 0) + (b.world === w ? t : 0);
      const shown = o > 0.004;
      if (w === 'tank') tankVisible = shown;
      if (w === 'corelia') starsVisible = shown;
      put(`o-${w}`, o.toFixed(3), (v) => {
        layer.style.setProperty('--o', v);
        layer.style.visibility = shown ? 'visible' : 'hidden';
        layer.classList.toggle('is-live', shown);
      });
    }
    stars.setScroll(y);
    stars.setVisible(starsVisible);
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
     WebGL の準備。使えないとき（GPU が無い、ソフトウェア描画になる）は
     null を返し、呼び出し側は CSS の止まった背景に切り替える。
     ソフトウェア描画で動かすと CPU を食うだけなので、あえて使わない。
     ---------------------------------------------------------- */
  const createProgram = (canvas, options, vertexSource, fragmentSource) => {
    let gl = null;
    try {
      gl = canvas.getContext('webgl', {
        depth: false,
        stencil: false,
        powerPreference: 'low-power',
        failIfMajorPerformanceCaveat: true,
        ...options,
      });
    } catch (e) {
      gl = null;
    }
    if (!gl) return null;
    // GPU ではなく CPU で WebGL を動かしている環境も「使えない」扱いにする
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    if (/swiftshader|llvmpipe|software|basic render/i.test(renderer)) {
      const lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
      return null;
    }
    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
    };
    const vs = compile(gl.VERTEX_SHADER, vertexSource);
    const fs = compile(gl.FRAGMENT_SHADER, fragmentSource);
    if (!vs || !fs) return null;
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
    gl.useProgram(program);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);   // 色には先に不透明度を掛けておく
    return { gl, program };
  };

  // 画面に合わせて canvas の解像度を決める（高精細な画面でも 1.5 倍まで）
  const fit = (canvas, gl) => {
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    const width = canvas.clientWidth || innerWidth;
    const height = canvas.clientHeight || innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
    return { width, height, dpr };
  };

  /* ----------------------------------------------------------
     背景アニメーションの進行役。画面に出ている背景だけを毎フレーム呼ぶ。
     何も出ていなければ止まる。step は「60fps の何フレームぶん進んだか」で、
     144Hz の画面でも 60Hz の画面でも同じ速さで動く。
     ---------------------------------------------------------- */
  const ticker = (() => {
    const jobs = new Set();
    let running = false;
    let before = 0;
    const loop = (now) => {
      if (!jobs.size || reduceMotion.matches) {
        running = false;
        before = 0;
        return;
      }
      const step = before ? Math.min(now - before, 100) / (1000 / 60) : 1;
      before = now;
      for (const job of jobs) job(now / 1000, step);
      requestAnimationFrame(loop);
    };
    return {
      add(job) {
        jobs.add(job);
        if (!running && !reduceMotion.matches) {
          running = true;
          requestAnimationFrame(loop);
        }
      },
      remove(job) { jobs.delete(job); },
    };
  })();

  // WebGL で描けないときは、canvas を CSS の止まった背景に差し替える
  const flatten = (canvas) => {
    const flat = document.createElement('div');
    flat.className = `${canvas.className} is-flat`;
    flat.dataset.world = canvas.dataset.world;
    canvas.replaceWith(flat);
    layers = [...document.querySelectorAll('.bd')];
    delete last[`o-${flat.dataset.world}`];
  };

  // WebGL の背景に共通の後始末：画面の大きさが変わったら描き直し、
  // GPU の都合で描画先を失ったら止めて、戻ってきたら再開する
  const attach = (canvas, { setup, redraw, job, isVisible }) => {
    let ready = setup();
    if (!ready) {
      flatten(canvas);
      return false;
    }
    redraw();
    addEventListener('resize', () => { if (ready) redraw(); });
    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      ready = false;
      ticker.remove(job);
    });
    canvas.addEventListener('webglcontextrestored', () => {
      ready = setup();
      if (!ready) { flatten(canvas); return; }
      redraw();
      if (isVisible()) ticker.add(job);
    });
    return true;
  };

  /* ----------------------------------------------------------
     Corelia の星空：StarField.cpp を WebGL に移したもの。
     300 個の星がそれぞれの位相でゆっくり明滅し、近い星ほど
     スクロールに対して大きく流れる（多重スクロール）。
     星の数・大きさ・発光・色・明滅・追従の値は StarFieldConst.h と同じ。

     星の位置と明滅は頂点シェーダーが計算する。
     毎フレームの CPU の仕事は「時刻とスクロール量を渡して1回描く」だけ。
     ---------------------------------------------------------- */
  const stars = (() => {
    const off = { setVisible() {}, setScroll() {} };
    const canvas = document.querySelector('canvas.bd--corelia');
    if (!canvas) return off;

    const C = {
      count: 300,
      radiusMin: 60, radiusMax: 400,
      scaleMin: 0.15, scaleMax: 0.6,
      emissiveMin: 2, emissiveMax: 6,
      colorMin: [0.7, 0.7, 0.8],
      twinkleSpeed: 1.5, twinkleStrength: 0.35,
      nearParallax: 0.30, farParallax: 0.985,
      seed: 20240601,
    };
    const FOCAL = 520;   // 星の大きさ（scale ÷ 距離）を画面の px に直す係数
    const DEPTH = 25;    // スクロール量をカメラの移動量に見立てる係数
    const PAD = 40;      // 画面の上下の外側で回り込ませる幅(px)

    const VERTEX = `
      attribute vec2 a_uv;       // 画面内の位置（0〜1）
      attribute vec4 a_shape;    // 芯の大きさ, 光の半径, 明るさ, 明滅の位相
      attribute float a_flow;    // スクロール 1px で流れる量
      attribute vec3 a_color;
      uniform vec2 u_res;        // 画面の大きさ（CSS px）
      uniform float u_dpr;
      uniform float u_scroll;
      uniform float u_time;
      uniform float u_twinkle;   // 0 = 明滅させない
      varying vec4 v_color;
      varying float v_core;
      void main() {
        float span = u_res.y + ${(PAD * 2).toFixed(1)};
        float y = mod(a_uv.y * span - u_scroll * a_flow, span) - ${PAD.toFixed(1)};
        float x = a_uv.x * u_res.x;
        gl_Position = vec4(x / u_res.x * 2.0 - 1.0, 1.0 - y / u_res.y * 2.0, 0.0, 1.0);
        gl_PointSize = a_shape.y * 2.0 * u_dpr;
        float wave = (1.0 + ${C.twinkleStrength.toFixed(2)} * sin(u_time * ${C.twinkleSpeed.toFixed(2)} + a_shape.w)) / ${(1 + C.twinkleStrength).toFixed(2)};
        v_color = vec4(a_color, a_shape.z * mix(1.0, wave, u_twinkle));
        v_core = a_shape.x > 1.3 ? (a_shape.x * 0.5) / a_shape.y : 0.0;
      }`;
    const FRAGMENT = `
      precision mediump float;
      varying vec4 v_color;
      varying float v_core;
      void main() {
        vec2 c = gl_PointCoord * 2.0 - 1.0;
        float d = length(c);
        // にじんだ光（ブルームの代わり）
        float glow = d < 0.16 ? mix(1.0, 0.85, d / 0.16)
                   : d < 0.42 ? mix(0.85, 0.22, (d - 0.16) / 0.26)
                   : mix(0.22, 0.0, min((d - 0.42) / 0.58, 1.0));
        // ゲームの星は小さな箱なので、大きい星には四角い芯を描く
        float core = step(max(abs(c.x), abs(c.y)), v_core);
        float a = max(glow, core) * v_color.a;
        gl_FragColor = vec4(v_color.rgb * a, a);
      }`;

    // 毎回同じ星空にする（ゲームと同じ考え方。乱数の式は別物）
    let state = C.seed;
    const rnd = () => {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    // 星は最初に1回だけ作って GPU に置く。あとは書き換えない
    const STRIDE = 10;
    const buffer = new Float32Array(C.count * STRIDE);
    for (let i = 0; i < C.count; i++) {
      const far = rnd();   // 0 = 近い、1 = 遠い
      const radius = C.radiusMin + far * (C.radiusMax - C.radiusMin);
      const scale = C.scaleMin + rnd() * (C.scaleMax - C.scaleMin);
      const emissive = C.emissiveMin + rnd() * (C.emissiveMax - C.emissiveMin);
      const color = C.colorMin.map((m) => m + rnd() * (1 - m));
      const follow = C.nearParallax + far * (C.farParallax - C.nearParallax);
      const size = Math.min(4.2, Math.max(0.55, (scale / radius) * FOCAL));
      const glow = size * (1.8 + emissive * 0.5);
      const alpha = Math.min(1, 0.3 + ((emissive - C.emissiveMin) / (C.emissiveMax - C.emissiveMin)) * 0.55 + (1 - far) * 0.15);
      const u = rnd();
      const v = rnd();
      const phase = rnd() * Math.PI * 2;
      const flow = ((1 - follow) / radius) * DEPTH;
      buffer.set([u, v, size, glow, alpha, phase, flow, color[0], color[1], color[2]], i * STRIDE);
    }

    let gl = null;
    let uniform = {};
    let scroll = 0;
    let visible = false;

    const setup = () => {
      // 点はシェーダーの中でぼかしているので、アンチエイリアスは要らない
      const made = createProgram(canvas, { alpha: true, antialias: false }, VERTEX, FRAGMENT);
      if (!made) return false;
      gl = made.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, buffer, gl.STATIC_DRAW);
      const attribute = (name, size, offset) => {
        const location = gl.getAttribLocation(made.program, name);
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, size, gl.FLOAT, false, STRIDE * 4, offset * 4);
      };
      attribute('a_uv', 2, 0);
      attribute('a_shape', 4, 2);
      attribute('a_flow', 1, 6);
      attribute('a_color', 3, 7);
      uniform = {};
      for (const name of ['res', 'dpr', 'scroll', 'time', 'twinkle']) {
        uniform[name] = gl.getUniformLocation(made.program, `u_${name}`);
      }
      gl.clearColor(0, 0, 0, 0);
      return true;
    };
    const draw = (time, twinkle) => {
      gl.uniform1f(uniform.scroll, scroll);
      gl.uniform1f(uniform.time, time);
      gl.uniform1f(uniform.twinkle, twinkle);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.POINTS, 0, C.count);
    };
    const redraw = () => {
      const size = fit(canvas, gl);
      gl.uniform2f(uniform.res, size.width, size.height);
      gl.uniform1f(uniform.dpr, size.dpr);
      draw(performance.now() / 1000, reduceMotion.matches ? 0 : 1);
    };
    const job = (time) => draw(time, 1);

    if (!attach(canvas, { setup, redraw, job, isVisible: () => visible })) return off;

    return {
      setScroll(y) { if (!reduceMotion.matches) scroll = y; },
      setVisible(v) {
        visible = v;
        if (!gl || gl.isContextLost()) return;
        if (v) ticker.add(job); else ticker.remove(job);
      },
    };
  })();

  /* ----------------------------------------------------------
     TankAce の背景：TriBgSystem.cpp を WebGL に移したもの。
     150 個の歪んだ三角形が、ゆっくり回りながら画面を流れる。
     値（大きさ 25〜160、速さ 0.3〜1.3、明るさ 0.55〜1.3、
     不透明度 0.06〜0.22、基準色 0.65/0.05/0.05）はゲームと同じ。

     位置の更新は CPU（三角形 150 個ぶんの足し算）、
     描くのは GPU で1回の描画命令。画面の外の三角形は送らない。
     ---------------------------------------------------------- */
  const tank = (() => {
    const off = { setVisible() {} };
    const canvas = document.querySelector('canvas.bd--tank');
    if (!canvas) return off;

    const VERTEX = `
      attribute vec2 a_pos;      // ゲームの画面座標（中心が原点）
      attribute vec4 a_color;
      uniform vec2 u_half;       // 画面の半分の大きさ
      varying vec4 v_color;
      void main() {
        gl_Position = vec4(a_pos / u_half, 0.0, 1.0);
        v_color = vec4(a_color.rgb * a_color.a, a_color.a);
      }`;
    const FRAGMENT = `
      precision mediump float;
      varying vec4 v_color;
      void main() { gl_FragColor = v_color; }`;

    const COUNT = 150;
    const BASE = [0.65, 0.05, 0.05];
    const TAU = Math.PI * 2;
    const STRIDE = 6;
    const rand = (lo, hi) => lo + (hi - lo) * Math.random();

    // 頂点の置き場は最初に1回だけ確保して、毎フレーム中身だけ書き換える
    const buffer = new Float32Array(COUNT * 3 * STRIDE);
    let gl = null;
    let uHalf = null;
    let w = 0;
    let h = 0;
    let tris = [];
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
      tri.color = [...BASE.map((c) => Math.min(c * bright, 1)), rand(0.06, 0.22)];
      return tri;
    };

    const setup = () => {
      // 背景色で塗りつぶすので透明にはしない（合成が軽くなる）。三角形の縁はなめらかに
      const made = createProgram(canvas, { alpha: false, antialias: true }, VERTEX, FRAGMENT);
      if (!made) return false;
      gl = made.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, buffer.byteLength, gl.DYNAMIC_DRAW);
      const attribute = (name, size, offset) => {
        const location = gl.getAttribLocation(made.program, name);
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, size, gl.FLOAT, false, STRIDE * 4, offset * 4);
      };
      attribute('a_pos', 2, 0);
      attribute('a_color', 4, 2);
      uHalf = gl.getUniformLocation(made.program, 'u_half');
      gl.clearColor(0x9a / 255, 0x0c / 255, 0x0e / 255, 1);   // 場面の背景色 #9a0c0e
      return true;
    };

    const move = (step) => {
      const hw = w / 2 + 200;
      const hh = h / 2 + 200;
      for (const tri of tris) {
        tri.x += tri.vx * step;
        tri.y += tri.vy * step;
        tri.rot += tri.rotVel * step;
        if (tri.x < -hw || tri.x > hw || tri.y < -hh || tri.y > hh) spawn(tri);
      }
    };
    const draw = () => {
      let n = 0;
      for (const tri of tris) {
        // 画面に掛からない三角形は GPU に送らない
        const reach = tri.size * 1.6;
        if (Math.abs(tri.x) - reach > w / 2 || Math.abs(tri.y) - reach > h / 2) continue;
        for (let k = 0; k < 3; k++) {
          const ang = tri.rot + k * (TAU / 3) + tri.ang[k];
          const rad = tri.size * tri.rad[k];
          buffer[n++] = tri.x + Math.cos(ang) * rad;
          buffer[n++] = tri.y + Math.sin(ang) * rad;
          buffer[n++] = tri.color[0];
          buffer[n++] = tri.color[1];
          buffer[n++] = tri.color[2];
          buffer[n++] = tri.color[3];
        }
      }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, buffer.subarray(0, n));
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, n / STRIDE);
    };
    const redraw = () => {
      const size = fit(canvas, gl);
      const scale = Math.max(size.width / 1280, size.height / 720);   // ゲームの画面は 1280×720
      w = size.width / scale;
      h = size.height / scale;
      gl.uniform2f(uHalf, w / 2, h / 2);
      if (!tris.length) {
        // 最初は画面全体にばらけさせる
        tris = Array.from({ length: COUNT }, () => {
          const tri = spawn({});
          tri.x = rand(-w / 2, w / 2);
          tri.y = rand(-h / 2, h / 2);
          return tri;
        });
      }
      draw();
    };
    const job = (time, step) => {
      move(step);
      draw();
    };

    if (!attach(canvas, { setup, redraw, job, isVisible: () => visible })) return off;

    return {
      setVisible(v) {
        visible = v;
        if (!gl || gl.isContextLost()) return;
        if (v) ticker.add(job); else ticker.remove(job);
      },
    };
  })();

  layers = [...document.querySelectorAll('.bd')];
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
