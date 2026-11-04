/* Laguppdelning – gränssnittet. Ingen byggkedja, inga beroenden. */
(function () {
  'use strict';

  var PREFIX = ['L', 'M', 'S'];
  var LEVELS = ['Lätt', 'Medel', 'Svår'];
  var GRADES = ['Nej', 'Ja, sällan', 'Ja', 'Ja, ofta'];
  var FORMS = [5, 7, 9, 11];

  // ------------------------------------------------------------------ state

  function blank() {
    return {
      version: 1,
      team: '',
      settings: {
        series: [
          { level: 1, form: 5, subs: 3 },
          { level: 2, form: 5, subs: 3 },
          { level: 3, form: 5, subs: 3 }
        ],
        targets: { easier: 0.25, right: 0.5, harder: 0.25 },
        grades: { 'Nej': 0, 'Ja, sällan': 0.5, 'Ja': 1, 'Ja, ofta': 1.5 },
        maxShare: 0.625
      },
      players: [],
      matches: [],
      picks: {},
      out: {}
    };
  }

  var state = blank();
  var view = 'schema';
  var serieTab = 1;
  var undoStack = [];
  var seq = 0;

  function uid(p) { seq += 1; return p + Date.now().toString(36) + seq.toString(36); }

  function snapshot() {
    undoStack.push(JSON.stringify(state));
    if (undoStack.length > 40) undoStack.shift();
  }

  function undo() {
    if (!undoStack.length) { toast('Inget att ångra'); return; }
    state = JSON.parse(undoStack.pop());
    Store.touch();
    render();
    toast('Ångrat');
  }

  function change() { Store.touch(); render(); }

  // ----------------------------------------------------------------- hjälp

  function el(tag, attrs) {
    var n = document.createElement(tag), i, k;
    if (attrs) for (k in attrs) {
      if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
      var v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === 'text') n.textContent = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value') n.value = v;
      else if (k === 'checked') n.checked = !!v;
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined || c === false) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x) n.appendChild(x); });
      else n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return n;
  }

  function svg(spec, children) {
    var NS = 'http://www.w3.org/2000/svg';
    var n = document.createElementNS(NS, spec.tag);
    Object.keys(spec).forEach(function (k) { if (k !== 'tag') n.setAttribute(k, spec[k]); });
    (children || []).forEach(function (c) { n.appendChild(c); });
    return n;
  }

  function icon(path, size, color, width) {
    var s = svg({ tag: 'svg', width: size || 14, height: size || 14, viewBox: '0 0 24 24', fill: 'none',
      stroke: color || 'currentColor', 'stroke-width': width || 2.4, 'stroke-linecap': 'round',
      'stroke-linejoin': 'round', 'aria-hidden': 'true' });
    path.forEach(function (d) { s.appendChild(svg({ tag: 'path', d: d })); });
    return s;
  }

  var I = {
    lock: ['M8 11V7a4 4 0 0 1 8 0v4', 'M5 11h14v10H5z'],
    unlock: ['M8 11V8a4 4 0 0 1 7-2.6', 'M5 11h14v10H5z'],
    plus: ['M12 5v14', 'M5 12h14'],
    trash: ['M4 7h16', 'M9 7V5h6v2', 'M6 7l1 14h10l1-14'],
    down: ['M5 9l7 7 7-7'],
    back: ['M15 5l-7 7 7 7'],
    warn: ['M12 4 2.5 20h19L12 4z', 'M12 10v5', 'M12 17.6v.1']
  };

  function fmtShort(iso) {
    if (!iso) return '';
    var p = iso.split('-');
    if (p.length !== 3) return iso;
    return Number(p[2]) + '/' + Number(p[1]);
  }

  function fmtLong(iso) {
    if (!iso) return 'Datum saknas';
    var d = new Date(iso + 'T12:00:00');
    if (isNaN(d.getTime())) return iso;
    try {
      return d.toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long' });
    } catch (e) { return iso; }
  }

  function num(x, dec) {
    return (dec ? x.toFixed(dec) : String(x)).replace('.', ',');
  }

  function toast(msg) {
    var box = document.getElementById('toast');
    box.textContent = '';
    var t = el('div', { class: 'toast', text: msg });
    box.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.remove(); }, 3800);
  }

  // --------------------------------------------------------------- härledd

  function squad(level) {
    var s = state.settings.series[level - 1];
    return (s.form || 0) + (s.subs || 0);
  }

  function model() {
    var byLevel = [1, 2, 3].map(function (lv) {
      return state.matches
        .map(function (m, i) { return { m: m, i: i }; })
        .filter(function (o) { return o.m.level === lv; })
        .sort(function (a, b) {
          var da = a.m.date || '9999-99-99', db = b.m.date || '9999-99-99';
          return da < db ? -1 : da > db ? 1 : a.i - b.i;
        })
        .map(function (o) { return o.m; });
    });
    var series = byLevel.map(function (ms, i) {
      return { level: i + 1, count: ms.length, perMatch: squad(i + 1) };
    });
    var labels = byLevel.map(function (ms, i) {
      return ms.map(function (m, k) { return PREFIX[i] + (k + 1); });
    });
    var labelOf = {};
    byLevel.forEach(function (ms, i) { ms.forEach(function (m, k) { labelOf[m.id] = labels[i][k]; }); });
    return { byLevel: byLevel, series: series, labels: labels, labelOf: labelOf };
  }

  function playersForPlan() {
    var g = state.settings.grades;
    return state.players.map(function (p) {
      return { id: p.id, name: p.name, level: p.level, harder: g[p.harder] || 0, easier: g[p.easier] || 0 };
    });
  }

  function cellsFor(mo) {
    return state.players.map(function (p) {
      return mo.byLevel.map(function (ms) {
        return ms.map(function (m) {
          if ((state.out[m.id] || []).indexOf(p.id) >= 0) return '-';
          return (state.picks[m.id] || []).indexOf(p.id) >= 0 ? 'X' : '';
        });
      });
    });
  }

  function dateKeys(mo) {
    return mo.byLevel.map(function (ms) { return ms.map(function (m) { return m.date || ''; }); });
  }

  function lockedFor(mo) {
    return mo.byLevel.map(function (ms) { return ms.map(function (m) { return !!m.locked; }); });
  }

  function writeCells(mo, cells) {
    mo.byLevel.forEach(function (ms, si) {
      ms.forEach(function (m, k) {
        var ids = [];
        state.players.forEach(function (p, pi) { if (cells[pi][si][k] === 'X') ids.push(p.id); });
        state.picks[m.id] = ids;
      });
    });
  }

  function playsCount(pid) {
    var n = 0;
    state.matches.forEach(function (m) { if ((state.picks[m.id] || []).indexOf(pid) >= 0) n++; });
    return n;
  }

  function perLevelCount(pid) {
    var c = [0, 0, 0];
    state.matches.forEach(function (m) {
      if ((state.picks[m.id] || []).indexOf(pid) >= 0) c[m.level - 1]++;
    });
    return c;
  }

  /* Målandelar per nivå för en spelare, givet hur många matcher varje nivå har. */
  function sharesFor(p, counts) {
    var t = state.settings.targets, g = state.settings.grades;
    var active = counts.map(function (c, i) { return c > 0 && squad(i + 1) > 0; });
    var lv = active.map(function (a, i) { return a ? i + 1 : 0; }).filter(Boolean);
    if (!lv.length) return [0, 0, 0];
    var eff = Math.min(Math.max(p.level, Math.min.apply(null, lv)), Math.max.apply(null, lv));
    var w = [0, 1, 2].map(function (i) {
      var level = i + 1, rel = level - eff;
      if (!active[i]) return 0;
      if (Math.abs(level - p.level) > 1 && level !== eff) return 0;
      if (rel === 0) return t.right;
      if (rel === 1) return t.harder * (g[p.harder] || 0);
      if (rel === -1) return t.easier * (g[p.easier] || 0);
      return 0;
    });
    var sum = w.reduce(function (a, b) { return a + b; }, 0);
    return sum ? w.map(function (x) { return x / sum; }) : [0, 0, 0];
  }

  function targetShares(p) {
    return sharesFor(p, model().series.map(function (s) { return s.count; }));
  }

  function fairBar(p, h) {
    var c = perLevelCount(p.id);
    var tot = c[0] + c[1] + c[2];
    var box = svg({ tag: 'svg', viewBox: '0 0 100 10', preserveAspectRatio: 'none',
      class: 'fair', role: 'img',
      'aria-label': p.name + ': ' + c[0] + ' lätta, ' + c[1] + ' medel, ' + c[2] + ' svåra matcher' });
    if (h) box.setAttribute('style', 'height:' + h + 'px');
    box.appendChild(svg({ tag: 'rect', x: 0, y: 0, width: 100, height: 10, fill: '#EEF1EB' }));
    var colors = ['#24833A', '#F2C21B', '#B02020'];
    var x = 0;
    c.forEach(function (n, i) {
      if (!tot || !n) return;
      var w = n / tot * 100;
      box.appendChild(svg({ tag: 'rect', x: x, y: 0, width: w, height: 10, fill: colors[i] }));
      x += w;
    });
    var sh = targetShares(p), acc = 0;
    sh.forEach(function (s, i) {
      acc += s * 100;
      if (i === 2 || acc <= 0.01 || acc >= 99.99) return;
      box.appendChild(svg({ tag: 'line', x1: acc, y1: -1, x2: acc, y2: 11,
        stroke: '#15201B', 'stroke-width': 1.4, 'stroke-opacity': 0.6 }));
    });
    return box;
  }

  function byId(pid) {
    return state.players.filter(function (x) { return x.id === pid; })[0];
  }

  /* Andelen uttagningar som ligger på spelarens egen nivå, eller närmaste
     nivå som har ett lag. Det är måttet som faktiskt går att nå. */
  function rightLevelShare() {
    var mo = model();
    var lv = mo.series.filter(function (s) { return s.count && s.perMatch; })
      .map(function (s) { return s.level; });
    if (!lv.length) return null;
    var lo = Math.min.apply(null, lv), hi = Math.max.apply(null, lv);
    var tot = 0, right = 0;
    state.matches.forEach(function (m) {
      (state.picks[m.id] || []).forEach(function (pid) {
        var p = byId(pid);
        if (!p) return;
        tot++;
        if (m.level === Math.min(Math.max(p.level, lo), hi)) right++;
      });
    });
    return tot ? right / tot : null;
  }

  /* Går målfördelningen att nå med ett visst antal matcher per nivå? */
  function capacityHintFor(counts) {
    var cap = counts.map(function (c, i) { return c * squad(i + 1); });
    var total = cap.reduce(function (a, b) { return a + b; }, 0);
    if (!total || !state.players.length) return null;
    var fair = total / state.players.length;
    var dem = [0, 0, 0];
    state.players.forEach(function (p) {
      sharesFor(p, counts).forEach(function (s, i) { dem[i] += fair * s; });
    });
    var msgs = [];
    [0, 1, 2].forEach(function (i) {
      if (!cap[i]) return;
      var r = dem[i] / cap[i];
      if (r < 0.85) msgs.push(LEVELS[i] + ' har fler platser än målet efterfrågar, så den andelen blir större');
      else if (r > 1.15) msgs.push(LEVELS[i] + ' har färre platser än målet efterfrågar, så den andelen blir mindre');
    });
    if (!msgs.length) return null;
    return 'Målet går inte att nå exakt: ' + msgs.join(', och ') + '.';
  }

  function capacityHint() {
    return capacityHintFor(model().series.map(function (s) { return s.count; }));
  }

  function similarity(mo, si, k) {
    var ms = mo.byLevel[si];
    if (ms.length < 2) return null;
    var here = state.picks[ms[k].id] || [];
    var worst = 0;
    ms.forEach(function (o, j) {
      if (j === k) return;
      var other = state.picks[o.id] || [], n = 0;
      here.forEach(function (id) { if (other.indexOf(id) >= 0) n++; });
      if (n > worst) worst = n;
    });
    return worst;
  }

  // ---------------------------------------------------------------- toppen

  function paintStatus(s) {
    var dot = document.getElementById('fileDot');
    var name = document.getElementById('fileName');
    var sub = document.getElementById('fileSub');
    var save = document.getElementById('btnSave');
    dot.className = 'dot' + (s.needsPermission ? ' warn' : s.dirty ? ' pending' : '');
    if (s.name) {
      name.textContent = s.name;
      if (s.needsPermission) sub.textContent = 'Klicka Spara för att ge åtkomst igen';
      else if (s.error) sub.textContent = 'Kunde inte spara';
      else if (s.dirty) sub.textContent = s.connected ? 'Sparar…' : 'Osparade ändringar';
      else if (s.savedAt) sub.textContent = 'Sparad ' + s.savedAt.toTimeString().slice(0, 5);
      else sub.textContent = s.connected ? 'Kopplad' : 'Öppnad';
    } else {
      name.textContent = 'Ingen fil vald';
      sub.textContent = s.supported ? 'Öppna en fil eller spara en ny' : 'Webbläsaren saknar filkoppling';
    }
    save.textContent = s.connected && !s.supported ? 'Ladda ner' : s.connected ? 'Spara' : 'Spara som';
  }

  // ----------------------------------------------------------------- vyer

  function render() {
    document.getElementById('teamName').value = state.team || '';
    Array.prototype.forEach.call(document.querySelectorAll('#tabs button'), function (b) {
      if (b.dataset.view === view) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    var host = document.getElementById('view');
    host.textContent = '';
    host.appendChild(
      view === 'spelare' ? viewPlayers() :
      view === 'matcher' ? viewMatches() :
      view === 'installningar' ? viewSettings() : viewSchema()
    );
  }

  function emptyState(title, body, actions) {
    return el('div', { class: 'panel pad', style: 'padding:40px 28px;text-align:center' },
      el('h2', { text: title, style: 'font-size:19px' }),
      el('p', { class: 'lede', text: body, style: 'margin:0 auto 18px;max-width:46ch' }),
      el('div', { style: 'display:flex;gap:10px;justify-content:center;flex-wrap:wrap' }, actions));
  }

  // --- Schema ---------------------------------------------------------------

  function viewSchema() {
    var mo = model();
    var wrap = el('div');

    wrap.appendChild(el('div', { class: 'head' },
      el('div', null,
        el('h1', { text: 'Serieschema' }),
        el('p', { class: 'lede', text: schemaLede(mo) })),
      el('div', { style: 'display:flex;gap:10px;flex-wrap:wrap' },
        el('button', { type: 'button', class: 'btn', onclick: clearOpen }, 'Rensa olåsta'),
        el('button', { type: 'button', class: 'btn primary', onclick: generate }, 'Generera förslag'))));

    if (!state.players.length || !state.matches.length) {
      wrap.appendChild(emptyState(
        state.players.length ? 'Inga matcher än' : 'Börja med truppen och matcherna',
        state.players.length
          ? 'Truppen är på plats. Lägg in matcherna, eller fyll på med exempelmatcher för att se hur många serien bör ha.'
          : 'Lägg in spelarna och seriens matcher.',
        [
          state.players.length
            ? el('button', { type: 'button', class: 'btn primary', onclick: openDemoMatches }, 'Fyll på med exempelmatcher')
            : el('button', { type: 'button', class: 'btn primary', onclick: function () { view = 'spelare'; render(); } }, 'Lägg till spelare'),
          el('button', { type: 'button', class: 'btn', onclick: function () { view = 'matcher'; render(); } }, 'Till matcherna')
        ]));
      return wrap;
    }

    var pick = el('div', { class: 'serie-pick' });
    mo.series.forEach(function (s, i) {
      if (!s.count) return;
      pick.appendChild(el('button', {
        type: 'button', 'aria-pressed': serieTab === i + 1 ? 'true' : 'false',
        onclick: function () { serieTab = i + 1; render(); }
      },
        el('b', { text: LEVELS[i] }),
        el('span', { text: s.count + (s.count === 1 ? ' match' : ' matcher') })));
    });
    if (pick.childNodes.length > 1) wrap.appendChild(pick);

    var si = serieTab - 1;
    if (!mo.series[si].count) {
      si = mo.series.findIndex(function (s) { return s.count > 0; });
      serieTab = si + 1;
    }
    wrap.appendChild(matrixPanel(mo, si));
    wrap.appendChild(legend());
    return wrap;
  }

  function schemaLede(mo) {
    if (!state.players.length || !state.matches.length) return 'Lägg in trupp och matcher så kommer schemat.';
    var tots = state.players.map(function (p) { return playsCount(p.id); });
    var lo = Math.min.apply(null, tots), hi = Math.max.apply(null, tots);
    var n = state.matches.length;
    return state.players.length + ' spelare, ' + n + (n === 1 ? ' match' : ' matcher') + '. ' +
      (hi - lo <= 1 ? 'Alla ligger inom en match från varandra.'
                    : 'Spelar mellan ' + lo + ' och ' + hi + ' matcher.');
  }

  function matrixPanel(mo, si) {
    var ms = mo.byLevel[si], per = mo.series[si].perMatch;
    var cols = 'repeat(' + ms.length + ', var(--cell))';
    var limit = Math.floor((state.settings.maxShare || 1) * per);

    var m = el('div', { class: 'matrix' });

    // låsband
    ms.forEach(function (mt, k) {
      if (!mt.locked) return;
      m.appendChild(el('div', { class: 'lockband', style: 'left:' + (170 + k * 42) + 'px;width:42px' }));
    });

    // namnkolumn
    var names = el('div', { class: 'names' });
    names.appendChild(el('div', { class: 'mhead' }, el('span', { class: 'colhead', text: 'Spelare' })));
    state.players.forEach(function (p) {
      names.appendChild(el('div', { class: 'prow' },
        el('span', { class: 'chip lv' + p.level, text: PREFIX[p.level - 1], title: LEVELS[p.level - 1] }),
        el('span', { class: 'nm', text: p.name || '(utan namn)' })));
    });
    names.appendChild(el('div', { style: 'height:14px' }));
    names.appendChild(el('div', { class: 'sumlabel', text: 'I truppen' }));
    names.appendChild(el('div', { class: 'sumlabel', text: 'Lik tidigare match' }));
    m.appendChild(names);

    // matchkolumner
    var mid = el('div', { class: 'mid' });
    var head = el('div', { class: 'mcols', style: 'grid-template-columns:' + cols });
    ms.forEach(function (mt, k) {
      var lockBtn = el('button', {
        type: 'button', class: 'icon-btn', style: 'width:20px;height:18px',
        'aria-pressed': mt.locked ? 'true' : 'false',
        'aria-label': (mt.locked ? 'Lås upp ' : 'Lås ') + mo.labelOf[mt.id],
        title: mt.locked ? 'Låst, så den ändras inte mer. Klicka för att låsa upp.' : 'Lås en match när den är spelad, så ändras den inte mer.',
        onclick: function () { snapshot(); mt.locked = !mt.locked; change(); }
      }, icon(mt.locked ? I.lock : I.unlock, 11, mt.locked ? '#132A20' : '#AAB4A9', 2.4));
      head.appendChild(el('div', { class: 'mcol' },
        el('div', { class: 'lockrow' }, lockBtn),
        el('button', {
          type: 'button', class: 'id-btn', 'aria-label': 'Visa ' + mo.labelOf[mt.id],
          onclick: function () { matchDay(mt.id); }
        },
          el('div', { class: 'id', text: mo.labelOf[mt.id] }),
          el('div', { class: 'date', text: fmtShort(mt.date) || '–' })),
        el('div', { class: 'bar', style: 'background:' + ['#24833A', '#F2C21B', '#B02020'][si] })));
    });
    mid.appendChild(head);

    var cells = el('div', { class: 'cells', style: 'grid-template-columns:' + cols });
    state.players.forEach(function (p) {
      ms.forEach(function (mt) {
        var picked = (state.picks[mt.id] || []).indexOf(p.id) >= 0;
        var unav = (state.out[mt.id] || []).indexOf(p.id) >= 0;
        var b = el('button', {
          type: 'button', class: 'cell', disabled: mt.locked,
          'aria-label': p.name + ', ' + mo.labelOf[mt.id] + ': ' +
            (unav ? 'kan inte spela' : picked ? 'spelar' : 'spelar inte'),
          onclick: function () { cycle(p.id, mt.id); }
        });
        if (unav) {
          var s = svg({ tag: 'svg', width: 24, height: 19, viewBox: '0 0 24 19', class: 'off', 'aria-hidden': 'true' });
          s.appendChild(svg({ tag: 'line', x1: 5, y1: 15, x2: 19, y2: 4, stroke: '#AAB4A9', 'stroke-width': 2, 'stroke-linecap': 'round' }));
          b.appendChild(s);
        } else if (picked) {
          b.appendChild(el('i', { class: 'lv' + p.level, text: PREFIX[p.level - 1] }));
        }
        cells.appendChild(b);
      });
    });
    mid.appendChild(cells);

    mid.appendChild(el('div', { style: 'height:14px' }));
    var r1 = el('div', { class: 'sumrow', style: 'grid-template-columns:' + cols });
    var r2 = el('div', { class: 'sumrow', style: 'grid-template-columns:' + cols });
    ms.forEach(function (mt, k) {
      var n = (state.picks[mt.id] || []).length;
      r1.appendChild(el('div', { class: n === per ? '' : 'bad', text: String(n),
        title: n === per ? '' : 'Ska vara ' + per }));
      var sim = similarity(mo, si, k);
      r2.appendChild(el('div', { class: sim !== null && sim > limit ? 'bad' : '',
        text: sim === null ? '–' : String(sim),
        title: sim !== null && sim > limit ? 'Gränsen är ' + limit : '' }));
    });
    mid.appendChild(r1);
    mid.appendChild(r2);
    m.appendChild(mid);

    // säsongskolumn
    var season = el('div', { class: 'season' });
    season.appendChild(el('div', { class: 'mhead', style: 'gap:10px' },
      el('span', { class: 'colhead', style: 'width:38px;text-align:right', text: 'Spelar' }),
      el('span', { class: 'colhead', style: 'flex:1', text: 'Fördelning över säsongen' }),
      el('span', { class: 'colhead', style: 'width:40px;text-align:right', text: 'Diff' })));
    var tots = state.players.map(function (p) { return playsCount(p.id); });
    var mean = tots.length ? tots.reduce(function (a, b) { return a + b; }, 0) / tots.length : 0;
    state.players.forEach(function (p, i) {
      var d = tots[i] - mean;
      season.appendChild(el('div', { class: 'srow' },
        el('span', { class: 'tot', text: String(tots[i]) }),
        fairBar(p, 11),
        el('span', { class: 'diff', text: (d > 0.05 ? '+' : d < -0.05 ? '−' : '') + num(Math.abs(d), 1) })));
    });
    m.appendChild(season);

    return el('div', { class: 'panel scroll', style: 'padding:18px 18px 14px;width:fit-content;max-width:100%' },
      el('div', { style: 'min-width:' + (170 + ms.length * 42 + 320) + 'px;position:relative' }, m));
  }

  function legend() {
    function item(node, text) { return el('span', null, node, document.createTextNode(text)); }
    function sw(cls) { return el('i', { class: cls }); }
    var slash = svg({ tag: 'svg', width: 20, height: 15, viewBox: '0 0 24 19', 'aria-hidden': 'true' });
    slash.appendChild(svg({ tag: 'line', x1: 5, y1: 15, x2: 19, y2: 4, stroke: '#AAB4A9', 'stroke-width': 2, 'stroke-linecap': 'round' }));
    return el('div', { class: 'legend' },
      item(sw('lv1'), 'Lätt-spelare'),
      item(sw('lv2'), 'Medel-spelare'),
      item(sw('lv3'), 'Svår-spelare'),
      item(slash, 'Kan inte spela'),
      item(el('i', { style: 'background:rgba(19,42,32,.09);border:1px solid rgba(19,42,32,.2)' }), 'Låst match'),
      item(el('i', { style: 'width:2px;height:14px;background:#15201B;border-radius:0' }), 'Mål för fördelningen'),
      el('span', { text: 'Klicka i rutan för att växla mellan spelar, kan inte och tom.' }));
  }

  function cycle(pid, mid) {
    var mt = state.matches.filter(function (m) { return m.id === mid; })[0];
    if (!mt || mt.locked) return;
    snapshot();
    var picks = state.picks[mid] || (state.picks[mid] = []);
    var outs = state.out[mid] || (state.out[mid] = []);
    var inPicks = picks.indexOf(pid), inOut = outs.indexOf(pid);

    if (inOut >= 0) {
      outs.splice(inOut, 1);
      change();
      return;
    }
    var per = squad(mt.level);
    if (inPicks >= 0) {
      picks.splice(inPicks, 1);
      outs.push(pid);
      var rep = picks.length < per ? substitute(mid) : null;
      change();
      if (rep) toast(rep + ' ersätter ' + nameOf(pid));
      else if (picks.length < per) toast('Ingen ersättare kunde tas in. Truppen är ' + picks.length + ' av ' + per + '.');
      return;
    }
    picks.push(pid);
    change();
    if (picks.length > per) toast(labelFor(mid) + ' har nu ' + picks.length + ' spelare av ' + per + '.');
  }

  function labelFor(mid) { return model().labelOf[mid] || 'Matchen'; }

  function nameOf(pid) {
    var p = byId(pid);
    return p ? (p.name || 'Spelaren') : 'Spelaren';
  }

  /* Byt in någon i matchen som just blev en spelare kort. */
  function substitute(mid) {
    var mo = model();
    var si = -1, k = -1;
    mo.byLevel.forEach(function (ms, i) {
      ms.forEach(function (m, j) { if (m.id === mid) { si = i; k = j; } });
    });
    if (si < 0) return null;
    var pi = Plan.valjErsattare(playersForPlan(), mo.series, settingsTargets(),
      cellsFor(mo), dateKeys(mo), si, k);
    if (pi < 0 || pi === undefined) return null;
    var p = state.players[pi];
    state.picks[mid].push(p.id);
    return p.name;
  }

  function settingsTargets() {
    var t = state.settings.targets;
    return { easier: t.easier, right: t.right, harder: t.harder, maxShare: state.settings.maxShare };
  }

  function clearOpen() {
    if (!confirm('Rensa alla olåsta matcher? Låsta matcher och "kan inte spela" behålls.')) return;
    snapshot();
    state.matches.forEach(function (m) { if (!m.locked) state.picks[m.id] = []; });
    change();
    toast('Olåsta matcher rensade');
  }

  // --- Generera -------------------------------------------------------------

  function generate() {
    if (!state.players.length || !state.matches.length) { toast('Lägg in spelare och matcher först'); return; }
    var mo = model();
    if (!mo.series.some(function (s) { return s.count && s.perMatch; })) { toast('Ingen serie att fördela'); return; }
    var before = JSON.stringify(state);
    var res = Plan.planeraBast(playersForPlan(), mo.series, settingsTargets(),
      cellsFor(mo), dateKeys(mo), lockedFor(mo), mo.labels);
    snapshot();
    writeCells(mo, res.cells);
    Store.touch();
    render();
    showResult(res, before, mo);
  }

  function showResult(res, before, mo) {
    var tots = state.players.map(function (p) { return playsCount(p.id); });
    var lo = Math.min.apply(null, tots), hi = Math.max.apply(null, tots);
    var open = 0, locked = 0;
    state.matches.forEach(function (m) { if (m.locked) locked++; else open++; });

    var rls = rightLevelShare();
    var worst = 0;
    mo.byLevel.forEach(function (ms, si) {
      ms.forEach(function (m, k) { var s = similarity(mo, si, k); if (s > worst) worst = s; });
    });
    var per = Math.max.apply(null, mo.series.map(function (s) { return s.count ? s.perMatch : 0; }));

    function stat(k, v) { return el('div', { class: 'stat' }, el('div', { class: 'k', text: k }), el('div', { class: 'v', text: v })); }

    var body = el('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Förslaget är klart' },
      el('h2', { text: 'Förslaget är klart' }),
      el('p', { class: 'lede', style: 'margin-bottom:20px',
        text: open + (open === 1 ? ' match fördelades om.' : ' matcher fördelades om.') +
          (locked ? ' De ' + locked + ' låsta rördes inte.' : '') }),
      el('div', { class: 'stats framed', style: 'margin-bottom:20px;border:1px solid #EEF1EB;box-shadow:none' },
        stat('Matcher per spelare', lo === hi ? String(lo) : lo + ' till ' + hi),
        stat('På rätt nivå', rls === null ? '–' : Math.round(rls * 100) + ' %'),
        stat('Mest lika match', per ? worst + ' av ' + per : '–')));

    if (res.warnings.length) {
      body.appendChild(el('h3', { style: 'margin:0 0 10px;font-size:13.5px;font-weight:700',
        text: res.warnings.length === 1 ? 'En sak gick inte att hålla' : res.warnings.length + ' saker gick inte att hålla' }));
      res.warnings.slice(0, 8).forEach(function (w) {
        body.appendChild(el('div', { class: 'warn-item' },
          icon(I.warn, 17, '#15201B', 2),
          el('p', { style: 'margin:0', text: w })));
      });
      if (res.warnings.length > 8) {
        body.appendChild(el('p', { class: 'note', style: 'margin:6px 0 0',
          text: 'Och ' + (res.warnings.length - 8) + ' till.' }));
      }
      body.appendChild(el('div', { style: 'height:16px' }));
    } else {
      body.appendChild(el('p', { class: 'note', style: 'margin:0 0 20px',
        text: 'Alla villkor hölls: rätt antal i varje trupp, ingen mer än ett nivåsteg bort och ingen dubbelbokad.' }));
    }

    body.appendChild(el('div', { class: 'actions' },
      el('span', { style: 'font-size:12.5px;color:#5E6B64', text: 'Sparas i filen när du behåller det' }),
      el('div', { style: 'display:flex;gap:10px' },
        el('button', { type: 'button', class: 'btn', onclick: function () {
          state = JSON.parse(before);
          undoStack.pop();
          Store.touch(); closeModal(); render(); toast('Ångrat');
        } }, 'Ångra'),
        el('button', { type: 'button', class: 'btn primary', onclick: closeModal }, 'Behåll'))));

    openModal(body);
  }

  // --- Matchdag -------------------------------------------------------------

  function matchDay(mid) {
    var mo = model();
    var mt = state.matches.filter(function (m) { return m.id === mid; })[0];
    if (!mt) return;
    var per = squad(mt.level);
    var picks = state.picks[mid] || [];
    var called = state.players.filter(function (p) { return picks.indexOf(p.id) >= 0; });
    var rest = state.players.filter(function (p) { return picks.indexOf(p.id) < 0; });

    var body = el('div', { class: 'dialog matchday', role: 'dialog', 'aria-modal': 'true',
      'aria-label': 'Matchdag ' + mo.labelOf[mid] });

    body.appendChild(el('div', { class: 'mhero' },
      el('div', { style: 'display:flex;align-items:center;gap:10px' },
        el('span', { class: 'tag lv' + mt.level, text: mo.labelOf[mid] }),
        el('span', { style: 'font-size:13px;color:#9BB0A3', text: LEVELS[mt.level - 1] })),
      el('h2', { text: mt.opponent || 'Motståndare saknas' }),
      el('div', { class: 'when', text: fmtLong(mt.date) + (mt.time ? ', ' + mt.time : '') }),
      el('div', { class: 'where', text: mt.place || 'Plats saknas' })));

    body.appendChild(el('div', { style: 'display:flex;align-items:center;justify-content:space-between;padding:14px 0 4px' },
      el('h3', { style: 'margin:0;font-size:15px;font-weight:700', text: 'Kallade' }),
      el('span', { class: called.length === per ? 'lede' : 'lede bad',
        style: 'font-size:13px', text: called.length + ' av ' + per })));

    if (!called.length) {
      body.appendChild(el('p', { class: 'note', text: 'Ingen är uttagen än. Generera ett förslag eller kryssa i schemat.' }));
    }
    called.forEach(function (p) {
      body.appendChild(el('div', { class: 'callrow' },
        el('span', { class: 'chip big lv' + p.level, text: PREFIX[p.level - 1] }),
        el('span', { class: 'nm' },
          el('b', { text: p.name }),
          el('span', { text: LEVELS[p.level - 1] + ', ' + playsCount(p.id) + ' matcher i år' })),
        mt.locked ? null : el('button', { type: 'button', class: 'btn small',
          'aria-label': p.name + ' kan inte spela ' + mo.labelOf[mid],
          onclick: function () { cycle(p.id, mid); closeModal(); matchDay(mid); } }, 'Kan inte')));
    });

    if (rest.length) {
      var open = false;
      var holder = el('div');
      var toggle = el('button', { type: 'button', class: 'add', 'aria-expanded': 'false',
        style: 'border-top:1px solid #D5DBD0;margin-top:10px;height:52px',
        onclick: function () {
          open = !open;
          toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
          holder.textContent = '';
          if (open) rest.forEach(function (p) {
            holder.appendChild(el('div', { class: 'callrow' },
              el('span', { class: 'chip big lv' + p.level, text: PREFIX[p.level - 1] }),
              el('span', { class: 'nm' },
                el('b', { text: p.name }),
                el('span', { text: (state.out[mid] || []).indexOf(p.id) >= 0 ? 'Kan inte spela' : playsCount(p.id) + ' matcher i år' })),
              mt.locked ? null : el('button', { type: 'button', class: 'btn small',
                onclick: function () {
                  snapshot();
                  var o = state.out[mid] || (state.out[mid] = []);
                  var ix = o.indexOf(p.id);
                  if (ix >= 0) o.splice(ix, 1);
                  (state.picks[mid] || (state.picks[mid] = [])).push(p.id);
                  change(); closeModal(); matchDay(mid);
                } }, 'Byt in')));
          });
        } },
        icon(I.down, 15, '#5E6B64', 2.6),
        el('span', { text: 'Övriga ' + rest.length }));
      body.appendChild(toggle);
      body.appendChild(holder);
    }

    body.appendChild(el('div', { class: 'actions', style: 'margin-top:20px' },
      el('button', { type: 'button', class: 'btn', onclick: function () {
        var lines = [mo.labelOf[mid] + ' ' + (mt.opponent || ''),
          fmtLong(mt.date) + (mt.time ? ', ' + mt.time : ''), mt.place || '', '',
          'Kallade (' + called.length + '):'];
        called.forEach(function (p) { lines.push('- ' + p.name); });
        copy(lines.join('\n'));
      } }, 'Kopiera kallelsen'),
      el('button', { type: 'button', class: 'btn primary', onclick: closeModal }, 'Klar')));

    openModal(body);
  }

  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast('Kallelsen är kopierad'); },
        function () { toast('Kunde inte kopiera'); });
    } else {
      var ta = el('textarea', { value: text, style: 'position:fixed;opacity:0' });
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast('Kallelsen är kopierad'); } catch (e) { toast('Kunde inte kopiera'); }
      ta.remove();
    }
  }

  // --- Spelare --------------------------------------------------------------

  function viewPlayers() {
    var wrap = el('div');
    wrap.appendChild(el('div', { class: 'head' },
      el('div', null,
        el('h1', { text: 'Spelare' }),),
      el('button', { type: 'button', class: 'btn primary', onclick: addPlayer }, 'Lägg till spelare')));

    if (!state.players.length) {
      wrap.appendChild(emptyState('Ingen i truppen än',
        'Lägg in spelarna en och en, eller ta in ett exempellag på 20 spelare för att se hur appen fungerar.',
          [el('button', { type: 'button', class: 'btn', onclick: loadDemoPlayers }, 'Skapa en exempeltrupp'),
              el('button', { type: 'button', class: 'btn primary', onclick: addPlayer }, 'Lägg till spelare')
         ]));
      return wrap;
    }

    var tots = state.players.map(function (p) { return playsCount(p.id); });
    var sum = tots.reduce(function (a, b) { return a + b; }, 0);
    var mean = sum / tots.length;
    var rls = rightLevelShare();

    function stat(k, v) { return el('div', { class: 'stat' }, el('div', { class: 'k', text: k }), el('div', { class: 'v', text: v })); }
    wrap.appendChild(el('div', { class: 'stats' },
      stat('Spelare', String(state.players.length)),
      stat('Snitt matcher', num(mean, 1)),
      stat('Spännvidd', Math.min.apply(null, tots) + ' till ' + Math.max.apply(null, tots)),
      stat('På rätt nivå', rls === null ? '–' : Math.round(rls * 100) + ' %')));

    var panel = el('div', { class: 'panel scroll', style: 'padding:6px 20px 14px' });
    var inner = el('div', { style: 'min-width:1010px' });

    inner.appendChild(el('div', { class: 'list-head' },
      el('span', { class: 'colhead', style: 'width:170px;flex:none', text: 'Namn' }),
      el('span', { class: 'colhead', style: 'width:106px;flex:none', text: 'Nivå' }),
      el('span', { class: 'colhead', style: 'width:136px;flex:none', text: 'Kan spela svårare' }),
      el('span', { class: 'colhead', style: 'width:136px;flex:none', text: 'Kan spela lättare' }),
      el('span', { class: 'colhead', style: 'width:56px;flex:none;text-align:right', text: 'Spelar' }),
      el('span', { class: 'colhead', style: 'flex:1;min-width:180px', text: 'Fördelning per nivå' }),
      el('span', { class: 'colhead', style: 'width:48px;flex:none;text-align:right', text: 'Diff' }),
      el('span', { style: 'width:36px;flex:none' })));

    state.players.forEach(function (p, idx) {
      var seg = el('span', { class: 'seg', style: 'width:106px;flex:none' });
      [1, 2, 3].forEach(function (lv) {
        seg.appendChild(el('button', {
          type: 'button', class: p.level === lv ? 'on' + lv : '',
          'aria-pressed': p.level === lv ? 'true' : 'false',
          'aria-label': p.name + ', nivå ' + LEVELS[lv - 1],
          onclick: function () { snapshot(); p.level = lv; change(); }
        }, PREFIX[lv - 1]));
      });

      function grade(key, label) {
        var s = el('select', { style: 'width:136px;flex:none', 'aria-label': p.name + ', ' + label,
          onchange: function (e) { snapshot(); p[key] = e.target.value; change(); } });
        GRADES.forEach(function (g) { s.appendChild(el('option', { value: g, text: g, selected: p[key] === g })); });
        s.value = p[key];
        return s;
      }

      var d = tots[idx] - mean;
      var c = perLevelCount(p.id);

      inner.appendChild(el('div', { class: 'list-row' },
        el('input', { type: 'text', class: 'row-input', style: 'width:170px;flex:none;font-weight:600',
          value: p.name, placeholder: 'Namn', 'aria-label': 'Namn',
          oninput: function (e) { p.name = e.target.value; Store.touch(); },
          onchange: function () { render(); } }),
        seg,
        grade('harder', 'kan spela svårare'),
        grade('easier', 'kan spela lättare'),
        el('span', { style: 'width:56px;flex:none;text-align:right;font-size:14px;font-weight:700', text: String(tots[idx]) }),
        el('span', { style: 'flex:1;min-width:180px;display:flex;align-items:center;gap:9px' },
          fairBar(p, 13),
          el('span', { style: 'width:62px;font-size:11.5px;color:#5E6B64', text: c.join(' / ') })),
        el('span', { style: 'width:48px;flex:none;text-align:right;font-size:13px;color:#5E6B64',
          text: (d > 0.05 ? '+' : d < -0.05 ? '−' : '') + num(Math.abs(d), 1) }),
        el('button', { type: 'button', class: 'icon-btn', style: 'width:36px;flex:none',
          'aria-label': 'Ta bort ' + p.name,
          onclick: function () { removePlayer(p.id); } }, icon(I.trash, 15, '#5E6B64', 2))));
    });

    inner.appendChild(el('button', { type: 'button', class: 'add', onclick: addPlayer },
      icon(I.plus, 15, '#2563C9', 2.6), el('span', { text: 'Lägg till spelare' })));

    panel.appendChild(inner);
    wrap.appendChild(panel);
    wrap.appendChild(el('p', { class: 'note',
      text: 'Strecket i stapeln visar var fördelningen borde ligga för just den spelaren. Den som får spela svårare sällan har sitt streck längre åt vänster än den som får det ofta.' }));
    return wrap;
  }

  function addPlayer() {
    snapshot();
    state.players.push({ id: uid('p'), name: '', level: 2, harder: 'Ja', easier: 'Ja' });
    change();
    var inputs = document.querySelectorAll('.list-row input[type="text"]');
    if (inputs.length) inputs[inputs.length - 1].focus();
  }

  function removePlayer(pid) {
    var p = state.players.filter(function (x) { return x.id === pid; })[0];
    if (p && p.name && !confirm('Ta bort ' + p.name + ' ur truppen?')) return;
    snapshot();
    state.players = state.players.filter(function (x) { return x.id !== pid; });
    Object.keys(state.picks).forEach(function (k) {
      state.picks[k] = state.picks[k].filter(function (x) { return x !== pid; });
    });
    Object.keys(state.out).forEach(function (k) {
      state.out[k] = state.out[k].filter(function (x) { return x !== pid; });
    });
    change();
  }

  // --- Matcher --------------------------------------------------------------

  function viewMatches() {
    var mo = model();
    var wrap = el('div');
    wrap.appendChild(el('div', { class: 'head' },
      el('div', null,
        el('h1', { text: 'Säsongen' })),
      el('div', { style: 'display:flex;gap:10px;flex-wrap:wrap' },
        state.matches.length ? el('button', { type: 'button', class: 'btn', onclick: clearMatches }, 'Rensa alla matcher') : null,
        el('button', { type: 'button', class: 'btn', onclick: openDemoMatches }, 'Fyll på med exempel'),
        el('button', { type: 'button', class: 'btn primary', onclick: addMatch }, 'Lägg till match'))));

    if (!state.matches.length) {
      wrap.appendChild(emptyState('Inga matcher än',
        'Lägg in seriens matcher med nivå och datum.',
        [el('button', { type: 'button', class: 'btn', onclick: openDemoMatches }, 'Fyll på med exempel'),
            el('button', { type: 'button', class: 'btn primary', onclick: addMatch }, 'Lägg till match')]));
      return wrap;
    }

    var panel = el('div', { class: 'panel scroll', style: 'padding:6px 20px 14px' });
    var inner = el('div', { style: 'min-width:1040px' });

    inner.appendChild(el('div', { class: 'list-head' },
      el('span', { class: 'colhead', style: 'width:52px;flex:none', text: 'Match' }),
      el('span', { class: 'colhead', style: 'width:96px;flex:none', text: 'Nivå' }),
      el('span', { class: 'colhead', style: 'width:146px;flex:none', text: 'Datum' }),
      el('span', { class: 'colhead', style: 'width:96px;flex:none', text: 'Tid' }),
      el('span', { class: 'colhead', style: 'flex:1.1;min-width:150px', text: 'Plats' }),
      el('span', { class: 'colhead', style: 'flex:1;min-width:140px', text: 'Motståndare' }),
      el('span', { class: 'colhead', style: 'width:100px;flex:none;text-align:right', text: 'Låst' }),
      el('span', { style: 'width:36px;flex:none' })));

    var sorted = [];
    mo.byLevel.forEach(function (ms) { ms.forEach(function (m) { sorted.push(m); }); });
    sorted.sort(function (a, b) {
      var da = a.date || '9999-99-99', db = b.date || '9999-99-99';
      return da < db ? -1 : da > db ? 1 : 0;
    });

    sorted.forEach(function (mt) {
      function field(key, type, width, label, ph) {
        return el('input', { type: type, class: 'row-input', style: width, value: mt[key] || '',
          placeholder: ph || '', 'aria-label': mo.labelOf[mt.id] + ', ' + label,
          oninput: function (e) { mt[key] = e.target.value; Store.touch(); },
          onchange: function () { render(); } });
      }
      var lvSel = el('select', { style: 'width:96px;flex:none', 'aria-label': mo.labelOf[mt.id] + ', nivå',
        onchange: function (e) { snapshot(); mt.level = Number(e.target.value); change(); } });
      [1, 2, 3].forEach(function (lv) {
        lvSel.appendChild(el('option', { value: String(lv), text: LEVELS[lv - 1], selected: mt.level === lv }));
      });
      lvSel.value = String(mt.level);

      inner.appendChild(el('div', { class: 'list-row' + (mt.locked ? ' locked' : '') },
        el('span', { style: 'width:52px;flex:none' },
          el('button', { type: 'button', class: 'tag lv' + mt.level, style: 'border:0;cursor:pointer',
            'aria-label': 'Visa ' + mo.labelOf[mt.id],
            onclick: function () { matchDay(mt.id); } }, mo.labelOf[mt.id])),
        lvSel,
        field('date', 'date', 'width:146px;flex:none', 'datum'),
        field('time', 'time', 'width:96px;flex:none', 'tid'),
        field('place', 'text', 'flex:1.1;min-width:150px', 'plats', 'Plats'),
        field('opponent', 'text', 'flex:1;min-width:140px', 'motståndare', 'Motståndare'),
        el('span', { style: 'width:100px;flex:none;display:flex;justify-content:flex-end' },
          el('button', {
            type: 'button', class: 'btn small', 'aria-pressed': mt.locked ? 'true' : 'false',
            title: mt.locked ? 'Låst, så den ändras inte mer. Klicka för att låsa upp.' : 'Lås en match när den är spelad, så ändras den inte mer.',
            style: mt.locked ? 'background:#132A20;border-color:#132A20;color:#fff;font-weight:700' : '',
            onclick: function () { snapshot(); mt.locked = !mt.locked; change(); }
          }, mt.locked ? 'Låst' : 'Lås')),
        el('button', { type: 'button', class: 'icon-btn', style: 'width:36px;flex:none',
          'aria-label': 'Ta bort ' + mo.labelOf[mt.id],
          onclick: function () { removeMatch(mt.id); } }, icon(I.trash, 15, '#5E6B64', 2))));
    });

    inner.appendChild(el('button', { type: 'button', class: 'add', onclick: addMatch },
      icon(I.plus, 15, '#2563C9', 2.6), el('span', { text: 'Lägg till match' })));

    panel.appendChild(inner);
    wrap.appendChild(panel);
    return wrap;
  }

  function addMatch() {
    snapshot();
    var last = state.matches[state.matches.length - 1];
    state.matches.push({
      id: uid('m'), level: last ? last.level : 2, date: '', time: last ? last.time : '',
      place: '', opponent: '', locked: false
    });
    change();
  }

  function clearMatches() {
    if (!confirm('Ta bort alla ' + state.matches.length + ' matcher och hela schemat? Truppen behålls.')) return;
    snapshot();
    state.matches = [];
    state.picks = {};
    state.out = {};
    change();
    toast('Alla matcher borttagna');
  }

  /* Lägg till exempelmatcher för att prova olika serieupplägg. */
  function openDemoMatches() {
    var have = model().series.map(function (s) { return s.count; });
    var add = have.some(Boolean) ? [0, 0, 0] : [10, 13, 0];
    var summary = el('div', { class: 'framed' });
    var hint = el('p', { class: 'note', style: 'margin:0 0 20px' });
    var go = el('button', { type: 'button', class: 'btn primary' });

    function paint() {
      var tot = have.map(function (h, i) { return h + add[i]; });
      var slots = tot.map(function (c, i) { return c * squad(i + 1); });
      var all = slots.reduce(function (a, b) { return a + b; }, 0);
      var n = state.players.length;

      summary.textContent = '';
      summary.appendChild(el('p', { style: 'margin:0 0 12px;font-size:12.5px;color:#5E6B64',
        text: n ? 'Så här blir säsongen med ' + n + ' spelare i truppen:' : 'Lägg in truppen för att se vad det ger per spelare.' }));
      [0, 1, 2].forEach(function (i) {
        if (!tot[i]) return;
        summary.appendChild(el('div', { style: 'display:flex;align-items:center;gap:9px;font-size:13.5px;margin-bottom:6px' },
          el('span', { class: 'chip lv' + (i + 1), text: PREFIX[i] }),
          el('span', { text: LEVELS[i] + ': ' + tot[i] + ' matcher × ' + squad(i + 1) + ' i truppen = ' + slots[i] + ' platser' })));
      });
      if (!all) {
        summary.appendChild(el('p', { style: 'margin:0;font-size:13.5px', text: 'Inga matcher än.' }));
      } else {
        summary.appendChild(el('div', { class: 'stats', style: 'margin:12px 0 0;border:0;padding:12px 0 0;border-top:1px solid #EEF1EB;border-radius:0' },
          el('div', { class: 'stat' }, el('div', { class: 'k', text: 'Matcher' }), el('div', { class: 'v', text: String(tot[0] + tot[1] + tot[2]) })),
          el('div', { class: 'stat' }, el('div', { class: 'k', text: 'Platser' }), el('div', { class: 'v', text: String(all) })),
          el('div', { class: 'stat' }, el('div', { class: 'k', text: 'Per spelare' }), el('div', { class: 'v', text: n ? num(all / n, 1) : '–' }))));
      }

      var h = capacityHintFor(tot);
      hint.textContent = h || (all && n ? 'Målfördelningen går att nå med det här upplägget.' : '');
      hint.style.fontWeight = h ? '600' : '400';

      var k = add[0] + add[1] + add[2];
      go.textContent = k ? 'Lägg till ' + k + (k === 1 ? ' match' : ' matcher') : 'Lägg till';
      go.disabled = !k;
    }

    var fields = el('div', { class: 'fields', style: 'margin-bottom:20px' });
    [0, 1, 2].forEach(function (i) {
      fields.appendChild(el('label', { class: 'field' },
        el('span', { style: 'display:flex;align-items:center;gap:7px' },
          el('span', { class: 'chip lv' + (i + 1), text: PREFIX[i] }),
          el('span', { text: LEVELS[i] })),
        el('input', { type: 'number', min: '0', max: '60', style: 'width:104px',
          value: String(add[i]), 'aria-label': 'Antal exempelmatcher i ' + LEVELS[i],
          oninput: function (e) { add[i] = Math.max(0, Math.min(60, Number(e.target.value) || 0)); paint(); } })));
    });

    go.addEventListener('click', function () {
      snapshot();
      addDemoMatches(add);
      closeModal();
      change();
      toast(add[0] + add[1] + add[2] + ' exempelmatcher tillagda');
    });

    var body = el('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Fyll på med exempelmatcher' },
      el('h2', { text: 'Fyll på med exempelmatcher' }),
      el('p', { class: 'lede', style: 'margin-bottom:20px',
        text: 'Matcherna läggs på lördagar och söndagar från och med nästa helg, utan motståndare och plats. Använd dem för att se hur många matcher varje serie bör ha innan det riktiga spelschemat kommer.' }),
      fields, summary, hint,
      el('div', { class: 'actions' },
        el('span', { style: 'font-size:12.5px;color:#5E6B64', text: 'Befintliga matcher rörs inte' }),
        el('div', { style: 'display:flex;gap:10px' },
          el('button', { type: 'button', class: 'btn', onclick: closeModal }, 'Avbryt'), go)));

    paint();
    openModal(body);
  }

  function addDemoMatches(counts) {
    var order = [];
    var left = counts.slice();
    while (left[0] + left[1] + left[2] > 0) {
      for (var i = 0; i < 3; i++) if (left[i] > 0) { order.push(i + 1); left[i]--; }
    }
    var last = state.matches.reduce(function (a, m) { return m.date && m.date > a ? m.date : a; }, '');
    var d = last ? new Date(last + 'T12:00:00') : new Date();
    if (isNaN(d.getTime())) d = new Date();
    var step = (6 - d.getDay() + 7) % 7;          // närmaste lördag efter sista matchen
    d.setDate(d.getDate() + (step || 7));
    order.forEach(function (lv, i) {
      var iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      state.matches.push({ id: uid('m'), level: lv, date: iso, time: '', place: '', opponent: '', locked: false });
      d.setDate(d.getDate() + (i % 2 === 0 ? 1 : 6));   // lördag, söndag, nästa lördag …
    });
  }

  function removeMatch(mid) {
    var mo = model();
    if (!confirm('Ta bort ' + mo.labelOf[mid] + '?')) return;
    snapshot();
    state.matches = state.matches.filter(function (m) { return m.id !== mid; });
    delete state.picks[mid];
    delete state.out[mid];
    change();
  }

  // --- Inställningar --------------------------------------------------------

  function viewSettings() {
    var mo = model();
    var wrap = el('div');
    wrap.appendChild(el('h1', { text: 'Inställningar' }));

    var panel = el('div', { class: 'panel', style: 'padding:4px 28px 10px' });

    // serier
    var tbl = el('div', { style: 'min-width:560px' });
    tbl.appendChild(el('div', { style: 'display:flex;gap:12px;align-items:flex-end;height:32px' },
      el('span', { class: 'colhead', style: 'width:70px;flex:none', text: 'Serie' }),
      el('span', { class: 'colhead', style: 'width:122px;flex:none', text: 'Spelform' }),
      el('span', { class: 'colhead', style: 'width:86px;flex:none', text: 'Avbytare' }),
      el('span', { class: 'colhead', style: 'width:96px;flex:none', text: 'Matchtrupp' }),
      el('span', { class: 'colhead', style: 'width:70px;flex:none', text: 'Matcher' }),
      el('span', { class: 'colhead', style: 'width:90px;flex:none', text: 'Max samma' })));

    state.settings.series.forEach(function (s, i) {
      var count = mo.series[i].count;
      var formSel = el('select', { style: 'width:122px;flex:none', 'aria-label': 'Spelform för ' + LEVELS[i],
        onchange: function (e) { snapshot(); s.form = Number(e.target.value); change(); } });
      FORMS.forEach(function (f) {
        formSel.appendChild(el('option', { value: String(f), text: f + ' mot ' + f, selected: s.form === f }));
      });
      formSel.value = String(s.form);

      tbl.appendChild(el('div', { style: 'display:flex;gap:12px;align-items:center;height:50px;border-top:1px solid #EEF1EB' + (count ? '' : ';opacity:.55') },
        el('span', { style: 'width:70px;flex:none;display:flex;align-items:center;gap:7px' },
          el('span', { class: 'chip lv' + (i + 1), text: PREFIX[i] }),
          el('span', { style: 'font-size:13.5px;font-weight:600', text: LEVELS[i] })),
        formSel,
        el('input', { type: 'number', min: '0', max: '20', style: 'width:86px;flex:none',
          'aria-label': 'Avbytare för ' + LEVELS[i], value: String(s.subs),
          oninput: function (e) { s.subs = Math.max(0, Number(e.target.value) || 0); Store.touch(); },
          onchange: function () { snapshot(); render(); } }),
        el('span', { style: 'width:96px;flex:none;font-size:15px;font-weight:700', text: String(squad(i + 1)) }),
        el('span', { style: 'width:70px;flex:none;font-size:' + (count ? '15px;font-weight:700' : '13.5px;color:#5E6B64'),
          text: count ? String(count) : 'Inget lag' }),
        el('span', { style: 'width:90px;flex:none;font-size:' + (count ? '15px;font-weight:700' : '13.5px;color:#5E6B64'),
          text: count ? String(Math.floor(state.settings.maxShare * squad(i + 1))) : '—' })));
    });

    panel.appendChild(el('div', { class: 'section' },
      el('div', { class: 'side' }, el('h2', { text: 'Serier' }),
        el('p', { text: 'Matchtruppen är spelare på plan plus avbytare. Varje match fylls till exakt det antalet. Antal matcher räknas från fliken Matcher.' })),
      el('div', { class: 'body scroll' }, tbl)));

    // målfördelning
    var t = state.settings.targets;
    function pct(key, label) {
      return el('label', { class: 'field' }, el('span', { text: label }),
        el('input', { type: 'number', min: '0', max: '100', step: '5', style: 'width:92px',
          value: String(Math.round(t[key] * 100)),
          oninput: function (e) { t[key] = Math.max(0, Number(e.target.value) || 0) / 100; Store.touch(); },
          onchange: function () { snapshot(); render(); } }));
    }
    var sum = t.easier + t.right + t.harder;
    var prev = svg({ tag: 'svg', viewBox: '0 0 100 8', preserveAspectRatio: 'none',
      style: 'width:100%;max-width:440px;height:14px;border-radius:3px', role: 'img',
      'aria-label': 'Målfördelning' });
    var acc = 0;
    [[t.easier, '#24833A'], [t.right, '#F2C21B'], [t.harder, '#B02020']].forEach(function (seg) {
      var w = sum ? seg[0] / sum * 100 : 0;
      prev.appendChild(svg({ tag: 'rect', x: acc, y: 0, width: w, height: 8, fill: seg[1] }));
      acc += w;
    });

    panel.appendChild(el('div', { class: 'section' },
      el('div', { class: 'side' }, el('h2', { text: 'Mål för fördelningen' }),
        el('p', { text: 'Hur en spelares matcher helst ska ligga, i %.' })),
      el('div', { class: 'body' },
        el('div', { class: 'fields', style: 'margin-bottom:18px' },
          pct('easier', 'Ett steg lättare'), pct('right', 'Rätt nivå'), pct('harder', 'Ett steg svårare')),
        prev,
        el('p', { class: 'note', style: 'margin-top:10px',
          text: 'Färgerna visar nivå: grönt är Lätt, gult Medel och rött Svår.' }),
        capacityHint() ? el('p', { class: 'note', style: 'margin-top:8px;font-weight:600', text: capacityHint() }) : null)));

    // gradering
    var gfields = el('div', { class: 'fields' });
    GRADES.forEach(function (g) {
      gfields.appendChild(el('label', { class: 'field' }, el('span', { text: g }),
        el('input', { type: 'number', min: '0', max: '5', step: '0.5', style: 'width:92px',
          value: String(state.settings.grades[g]),
          oninput: function (e) { state.settings.grades[g] = Math.max(0, Number(e.target.value) || 0); Store.touch(); },
          onchange: function () { snapshot(); render(); } })));
    });
    panel.appendChild(el('div', { class: 'section' },
      el('div', { class: 'side' }, el('h2', { text: 'Gradering' }),
        el('p', { text: 'Vad valen i truppen är värda. Faktorn gångras med andelen ovan innan matcherna delas ut.' })),
      el('div', { class: 'body' }, gfields)));

    // likhet
    var simRows = el('div', { style: 'display:grid;gap:6px;margin-top:16px' });
    state.settings.series.forEach(function (sr, i) {
      if (!mo.series[i].count) return;
      var n = squad(i + 1), m = Math.floor(state.settings.maxShare * n);
      simRows.appendChild(el('div', { style: 'display:flex;align-items:center;gap:8px;font-size:13.5px' },
        el('span', { class: 'chip lv' + (i + 1), text: PREFIX[i] }),
        el('span', null, 'Två ' + LEVELS[i].toLowerCase() + 'matcher får ha högst ',
          el('strong', { text: m + ' av ' + n }), ' spelare gemensamt.')));
    });
    panel.appendChild(el('div', { class: 'section' },
      el('div', { class: 'side' }, el('h2', { text: 'Variation i laguppställningen' }),
        el('p', { text: 'Gör att det inte blir samma gäng som spelar ihop varje gång. Gränsen gäller mellan två matcher i samma serie.' })),
      el('div', { class: 'body' },
        el('label', { class: 'field' }, el('span', { text: 'Högst andel gemensamma spelare' }),
          el('span', { style: 'display:flex;align-items:center;gap:8px;color:inherit;font-size:14px;margin:0' },
            el('input', { type: 'number', min: '10', max: '100', step: '12.5', style: 'width:92px',
              value: String(Math.round(state.settings.maxShare * 1000) / 10),
              oninput: function (e) { state.settings.maxShare = Math.max(0.1, Number(String(e.target.value).replace(',', '.')) || 0) / 100; Store.touch(); },
              onchange: function () { snapshot(); render(); } }),
            '%')),
        simRows,
        el('p', { class: 'note',
          text: 'Lägre värde ger mer omväxling men är svårare att uppfylla. 62,5 % (5 av 8) brukar fungera bra med runt 20 spelare. Om gränsen inte går att hålla utan att truppen blir för liten, nivåreglerna bryts eller någon får två matcher samma dag, släpps den för den matchen och raden "Lik tidigare match" i Schema blir röd.' }))));

    // filen
    var st = Store.status();
    panel.appendChild(el('div', { class: 'section' },
      el('div', { class: 'side' }, el('h2', { text: 'Filen' }),
        el('p', { text: st.supported
          ? 'Allt ligger i en JSON-fil på din dator. Inget skickas någonstans. Lägg filen i Drive eller Dropbox om du vill dela den.'
          : 'Den här webbläsaren kan inte hålla en koppling till filen. Öppna filen när du börjar och ladda ner den när du är klar. Chrome och Edge sparar automatiskt.' })),
      el('div', { class: 'body' },
        el('p', { style: 'margin:0 0 16px;font-size:13.5px',
          text: st.name ? (st.connected ? 'Kopplad till ' : 'Öppnad från ') + st.name : 'Ingen fil vald än.' }),
        el('div', { style: 'display:flex;flex-wrap:wrap;gap:10px' },
          el('button', { type: 'button', class: 'btn', onclick: doOpen }, 'Öppna en annan fil'),
          el('button', { type: 'button', class: 'btn', onclick: function () { Store.saveAs(suggestName()); } }, 'Spara en kopia'),
          el('button', { type: 'button', class: 'btn', onclick: resetAll }, 'Börja om med tom säsong')))));

    wrap.appendChild(panel);
    return wrap;
  }

  function resetAll() {
    if (!confirm('Töm trupp, matcher och schema? Filen skrivs över när du sparar.')) return;
    snapshot();
    var team = state.team, settings = state.settings;
    state = blank();
    state.team = team;
    state.settings = settings;
    change();
    toast('Tömt');
  }

  // ---------------------------------------------------------------- modaler

  function openModal(body) {
    var host = document.getElementById('modal');
    host.textContent = '';
    var scrim = el('div', { class: 'scrim', onclick: function (e) { if (e.target === scrim) closeModal(); } }, body);
    host.appendChild(scrim);
    var f = body.querySelector('button');
    if (f) f.focus();
  }

  function closeModal() { document.getElementById('modal').textContent = ''; }

  // ------------------------------------------------------------------ filen

  function suggestName() {
    var base = (state.team || 'laguppdelning').toLowerCase()
      .replace(/[åä]/g, 'a').replace(/ö/g, 'o').replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'laguppdelning';
    return base + '.json';
  }

  function load(text) {
    if (!text) return false;
    var data;
    try { data = JSON.parse(text); } catch (e) { toast('Filen gick inte att läsa som JSON'); return false; }
    if (!data || typeof data !== 'object') { toast('Filen ser inte ut att höra hit'); return false; }
    var fresh = blank();
    state = {
      version: 1,
      team: typeof data.team === 'string' ? data.team : '',
      settings: {
        series: Array.isArray(data.settings && data.settings.series) && data.settings.series.length === 3
          ? data.settings.series.map(function (s, i) {
              return { level: i + 1, form: Number(s.form) || 5, subs: Number(s.subs) || 0 };
            })
          : fresh.settings.series,
        targets: Object.assign({}, fresh.settings.targets, (data.settings && data.settings.targets) || {}),
        grades: Object.assign({}, fresh.settings.grades, (data.settings && data.settings.grades) || {}),
        maxShare: Number(data.settings && data.settings.maxShare) || fresh.settings.maxShare
      },
      players: (Array.isArray(data.players) ? data.players : []).map(function (p) {
        return {
          id: p.id || uid('p'), name: String(p.name || ''),
          level: [1, 2, 3].indexOf(Number(p.level)) >= 0 ? Number(p.level) : 2,
          harder: GRADES.indexOf(p.harder) >= 0 ? p.harder : 'Ja',
          easier: GRADES.indexOf(p.easier) >= 0 ? p.easier : 'Ja'
        };
      }),
      matches: (Array.isArray(data.matches) ? data.matches : []).map(function (m) {
        return {
          id: m.id || uid('m'),
          level: [1, 2, 3].indexOf(Number(m.level)) >= 0 ? Number(m.level) : 2,
          date: String(m.date || ''), time: String(m.time || ''),
          place: String(m.place || ''), opponent: String(m.opponent || ''),
          locked: !!m.locked
        };
      }),
      picks: {}, out: {}
    };
    var ids = {};
    state.players.forEach(function (p) { ids[p.id] = true; });
    state.matches.forEach(function (m) {
      var keep = function (arr) {
        return (Array.isArray(arr) ? arr : []).filter(function (x) { return ids[x]; });
      };
      state.picks[m.id] = keep(data.picks && data.picks[m.id]);
      state.out[m.id] = keep(data.out && data.out[m.id]);
    });
    undoStack = [];
    render();
    return true;
  }

  function doOpen() {
    Store.open().then(function (text) {
      if (text === null) return;
      if (load(text)) toast('Filen är öppnad');
    });
  }

  // ---------------------------------------------------------------- exempel

  function loadDemoPlayers() {
    if (state.players.length && !confirm('Ersätt truppen med ett exempellag på 20 spelare?')) return;
    snapshot();
    var names = ['Alva', 'Elias', 'Maja', 'Hugo', 'Ella', 'William', 'Alice', 'Liam', 'Olivia', 'Noah',
      'Wilma', 'Lucas', 'Astrid', 'Oscar', 'Selma', 'Vincent', 'Freja', 'Leo', 'Signe', 'Adam'];
    var lv = [1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3];
    if (!state.team) state.team = 'Brostorp P9';
    state.players = names.map(function (n, i) {
      return { id: uid('p'), name: n, level: lv[i], harder: 'Ja', easier: 'Ja' };
    });
    Object.keys(state.picks).forEach(function (k) { state.picks[k] = []; });
    Object.keys(state.out).forEach(function (k) { state.out[k] = []; });
    change();
    toast('Exempeltrupp inlagd');
  }

  // ------------------------------------------------------------------ start

  function init() {
    Store.init({ onStatus: paintStatus, getData: function () { return state; } });

    document.getElementById('tabs').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-view]');
      if (!b) return;
      view = b.dataset.view;
      render();
    });
    document.getElementById('teamName').addEventListener('input', function (e) {
      state.team = e.target.value; Store.touch();
    });
    document.getElementById('btnOpen').addEventListener('click', doOpen);
    document.getElementById('btnSave').addEventListener('click', function () {
      var s = Store.status();
      if (s.needsPermission) {
        Store.reconnect().then(function (text) {
          if (text === null) { toast('Åtkomsten nekades'); return; }
          Store.save().then(function (ok) { if (ok) toast('Sparad'); });
        });
        return;
      }
      if (s.connected) Store.save().then(function (ok) { if (ok) toast('Sparad'); });
      else Store.saveAs(suggestName()).then(function (ok) { if (ok) toast('Sparad'); });
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeModal();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        var tag = (e.target.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
        e.preventDefault(); undo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault(); document.getElementById('btnSave').click();
      }
    });

    window.addEventListener('beforeunload', function (e) {
      var s = Store.status();
      if (s.dirty) { e.preventDefault(); e.returnValue = ''; }
    });

    render();

    Store.resume().then(function (text) {
      if (text) { if (load(text)) toast('Fortsätter där du slutade'); }
      else if (Store.status().needsPermission) toast('Klicka Spara för att koppla upp filen igen');
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
