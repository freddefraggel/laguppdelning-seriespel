/* Laguppdelning – fördelningsalgoritmen.
 *
 * Villkoren i fallande ordning. De tre första bryts aldrig:
 *   1. "Kan inte spela" ("-") och låsta matcher rörs inte.
 *   2. Max ETT nivåsteg från spelarens egen nivå. Finns inget lag på
 *      spelarens nivå räknas närmaste nivå som rätt och får alltid spelas.
 *   3. Matchtruppens storlek. Varje match fylls till exakt rätt antal.
 * Räcker inte spelarna släpps i tur och ordning "Nej" på svårare/lättare,
 * sedan dubbelbokning samma datum. Likhetsgränsen är mjukast av alla.
 */
(function (root) {
  'use strict';

  var PREFIX = ['L', 'M', 'S'];

  function kontext(players, series, targets) {
    var active = series.map(function (s) { return s.count > 0 && s.perMatch > 0; });
    var levels = series.filter(function (s, i) { return active[i]; }).map(function (s) { return s.level; });
    var minL = levels.length ? Math.min.apply(null, levels) : 1;
    var maxL = levels.length ? Math.max.apply(null, levels) : 3;
    var totalSlots = 0;
    series.forEach(function (s, i) { if (active[i]) totalSlots += s.count * s.perMatch; });
    var fair = players.length ? totalSlots / players.length : 0;
    var allowed = [], possible = [], share = [];
    players.forEach(function (p) {
      var eff = Math.min(Math.max(p.level, minL), maxL), w = [], sum = 0, pos = [];
      series.forEach(function (s, si) {
        var rel = s.level - eff, weight = 0;
        var ok = active[si] && (Math.abs(s.level - p.level) <= 1 || s.level === eff);
        if (ok) {
          if (rel === 0) weight = targets.right;
          else if (rel === 1) weight = targets.harder * (p.harder || 0);
          else if (rel === -1) weight = targets.easier * (p.easier || 0);
        }
        pos.push(ok);
        w.push(weight); sum += weight;
      });
      allowed.push(w.map(function (x) { return x > 0; }));
      possible.push(pos);
      share.push(w.map(function (x) { return sum > 0 ? x / sum : 0; }));
    });
    return { active: active, totalSlots: totalSlots, fair: fair, allowed: allowed, possible: possible, share: share };
  }

  function planera(players, series, targets, cells, dateKeys, locked, labels) {
    var n = players.length, S = series.length, warnings = [];
    var ctx = kontext(players, series, targets);
    var name = function (si, m) {
      if (labels && labels[si] && labels[si][m]) return labels[si][m];
      return PREFIX[si] + (m + 1);
    };
    var out = players.map(function (p, pi) {
      return series.map(function (s, si) {
        var a = [];
        for (var m = 0; m < s.count; m++) {
          var v = cells && cells[pi] ? cells[pi][si][m] : '';
          var lk = locked && locked[si] && locked[si][m];
          a.push(lk ? v : (v === '-' ? '-' : ''));
        }
        return a;
      });
    });
    if (!n || !ctx.totalSlots) return { cells: out, warnings: [], empty: true };

    var isLocked = function (si, m) { return !!(locked && locked[si] && locked[si][m]); };
    var dkey = function (si, m) { return dateKeys && dateKeys[si] ? dateKeys[si][m] : ''; };

    var count = players.map(function () { return series.map(function () { return 0; }); });
    var total = players.map(function () { return 0; });
    var busy = players.map(function () { return {}; });
    var remCap = series.map(function () { return 0; });
    series.forEach(function (s, si) {
      if (!ctx.active[si]) return;
      for (var m = 0; m < s.count; m++) {
        if (!isLocked(si, m)) { remCap[si] += s.perMatch; continue; }
        for (var pi = 0; pi < n; pi++) if (out[pi][si][m] === 'X') {
          count[pi][si]++; total[pi]++;
          if (dkey(si, m)) busy[pi][dkey(si, m)] = true;
        }
      }
    });
    var remTotal = remCap.reduce(function (a, b) { return a + b; }, 0);
    var filled = series.map(function (s, si) {
      var f = [];
      for (var m = 0; m < s.count; m++) if (isLocked(si, m)) f.push(m);
      return f;
    });
    var maxShare = targets.maxShare || 1;

    // Återstående mål per spelare och serie, balanserat mot kapaciteten
    var rowT = total.map(function (t) { return Math.max(0, ctx.fair - t); });
    var rowSum = rowT.reduce(function (a, b) { return a + b; }, 0);
    rowT = rowT.map(function (x) { return rowSum > 0 ? x * remTotal / rowSum : remTotal / n; });
    var T = players.map(function (p, pi) {
      return series.map(function (s, si) {
        if (!ctx.allowed[pi][si] || !remCap[si]) return 0;
        return Math.max(0.01, ctx.fair * ctx.share[pi][si] - count[pi][si]);
      });
    });
    var it, si, pi;
    for (it = 0; it < 300; it++) {
      for (si = 0; si < S; si++) {
        var col = 0;
        for (pi = 0; pi < n; pi++) col += T[pi][si];
        if (col > 0) for (pi = 0; pi < n; pi++) T[pi][si] *= remCap[si] / col;
      }
      for (pi = 0; pi < n; pi++) {
        var r = 0;
        for (si = 0; si < S; si++) r += T[pi][si];
        if (r > 0) for (si = 0; si < S; si++) T[pi][si] *= rowT[pi] / r;
      }
    }

    var order = [];
    series.forEach(function (s, si2) {
      if (!ctx.active[si2]) return;
      var open = [];
      for (var m = 0; m < s.count; m++) if (!isLocked(si2, m)) open.push(m);
      open.forEach(function (m, k) { order.push({ s: si2, m: m, k: k, nOpen: open.length, t: (k + 0.5) / open.length }); });
    });
    order.sort(function (a, b) { return a.t - b.t || a.s - b.s; });

    var baseCount = count.map(function (r2) { return r2.slice(); });
    var baseTotal = total.slice();
    var done = 0;

    order.forEach(function (slot) {
      var si2 = slot.s, m = slot.m, s = series[si2], dk = dkey(si2, m);
      var progress = (slot.k + 1) / slot.nOpen;
      var overall = remTotal ? (done + s.perMatch) / remTotal : 1;

      var cands = [], expLevel = { 1: 0, 2: 0, 3: 0 }, sumT = 0;
      for (var p2 = 0; p2 < n; p2++) {
        if (out[p2][si2][m] === '-' || !ctx.possible[p2][si2]) continue;
        var tier = (ctx.allowed[p2][si2] ? 0 : 1) + (dk && busy[p2][dk] ? 2 : 0);
        var plan = (count[p2][si2] - baseCount[p2][si2]) - T[p2][si2] * progress;
        var fairness = (total[p2] - baseTotal[p2]) - rowT[p2] * overall;
        var score = tier * 1000 + (tier === 0 ? plan : 0) + 0.5 * fairness + Math.random() * 0.01;
        cands.push({ pi: p2, tier: tier, score: score });
        expLevel[players[p2].level] += T[p2][si2]; sumT += T[p2][si2];
      }
      var picked = [], inMatch = { 1: 0, 2: 0, 3: 0 };
      var prev = filled[si2], shared = prev.map(function () { return 0; });
      var limit = Math.floor(maxShare * s.perMatch);
      while (picked.length < s.perMatch && cands.length) {
        var best = -1, bestScore = Infinity;
        cands.forEach(function (c, idx) {
          var lv = players[c.pi].level;
          var share = sumT > 0 ? expLevel[lv] / sumT : 0;
          var worst = 0;
          for (var j = 0; j < prev.length; j++)
            worst = Math.max(worst, shared[j] + (out[c.pi][si2][prev[j]] === 'X' ? 1 : 0));
          var simPenalty = 100 * Math.max(0, worst - limit) + 0.3 * worst / s.perMatch;
          var sc = c.score + simPenalty + 0.4 * Math.max(0, inMatch[lv] + 1 - share * s.perMatch);
          if (sc < bestScore) { bestScore = sc; best = idx; }
        });
        var chosen = cands.splice(best, 1)[0];
        inMatch[players[chosen.pi].level]++;
        for (var j2 = 0; j2 < prev.length; j2++) if (out[chosen.pi][si2][prev[j2]] === 'X') shared[j2]++;
        picked.push(chosen);
      }
      var label = name(si2, m);
      if (picked.length < s.perMatch)
        warnings.push(label + ': bara ' + picked.length + ' av ' + s.perMatch + ' spelare tillgängliga.');
      var off = picked.filter(function (c) { return c.tier === 1 || c.tier === 3; }).length;
      if (off) warnings.push(label + ': ' + off + (off === 1 ? ' spelare' : ' spelare') + ' utanför sitt Nej på svårare eller lättare.');
      var dbl = picked.filter(function (c) { return c.tier >= 2; }).length;
      if (dbl) warnings.push(label + ': ' + dbl + ' dubbelbokad' + (dbl === 1 ? '' : 'e') + ' samma datum.');
      picked.forEach(function (c) {
        out[c.pi][si2][m] = 'X';
        count[c.pi][si2]++; total[c.pi]++;
        if (dk) busy[c.pi][dk] = true;
      });
      done += s.perMatch;
      filled[si2].push(m);
    });

    // Efterjustering: byt spelare i matcher som blev för lika en annan match
    var tierOf = function (p3, si3, m) {
      var dk = dkey(si3, m), conflict = false;
      if (dk) for (var s2 = 0; s2 < S; s2++)
        for (var k = 0; k < series[s2].count; k++)
          if ((s2 !== si3 || k !== m) && dkey(s2, k) === dk && out[p3][s2][k] === 'X') conflict = true;
      return (ctx.allowed[p3][si3] ? 0 : 1) + (conflict ? 2 : 0);
    };
    var worstFor = function (si3, m) {
      var w = 0;
      for (var j = 0; j < series[si3].count; j++) {
        if (j === m) continue;
        var sh = 0;
        for (var p3 = 0; p3 < n; p3++) if (out[p3][si3][m] === 'X' && out[p3][si3][j] === 'X') sh++;
        w = Math.max(w, sh);
      }
      return w;
    };
    var totalsNow = players.map(function (p, p3) {
      var t = 0;
      for (var s2 = 0; s2 < S; s2++) for (var k = 0; k < series[s2].count; k++) if (out[p3][s2][k] === 'X') t++;
      return t;
    });
    for (var round = 0; round < 3; round++) {
      series.forEach(function (s, si3) {
        var limit2 = Math.floor(maxShare * s.perMatch);
        for (var m = 0; m < s.count; m++) {
          if (isLocked(si3, m)) continue;
          var w = worstFor(si3, m), guard = 0;
          while (w > limit2 && guard++ < 20) {
            var bestSwap = null, bestW = w;
            for (var a = 0; a < n; a++) {
              if (out[a][si3][m] !== 'X') continue;
              var ta = tierOf(a, si3, m);
              for (var b = 0; b < n; b++) {
                if (out[b][si3][m] !== '' || !ctx.possible[b][si3]) continue;
                if (totalsNow[b] > totalsNow[a]) continue;
                out[a][si3][m] = ''; out[b][si3][m] = 'X';
                var tb = tierOf(b, si3, m), nw = worstFor(si3, m);
                out[a][si3][m] = 'X'; out[b][si3][m] = '';
                if (tb > ta) continue;
                if (nw < bestW) { bestW = nw; bestSwap = [a, b]; }
              }
            }
            if (!bestSwap) break;
            out[bestSwap[0]][si3][m] = ''; out[bestSwap[1]][si3][m] = 'X';
            totalsNow[bestSwap[0]]--; totalsNow[bestSwap[1]]++;
            w = bestW;
          }
        }
      });
    }
    series.forEach(function (s, si4) {
      var limit3 = Math.floor(maxShare * s.perMatch);
      for (var m = 0; m < s.count; m++) {
        if (isLocked(si4, m)) continue;
        var w = worstFor(si4, m);
        if (w > limit3)
          warnings.push(name(si4, m) + ': ' + w + ' av ' + s.perMatch + ' samma spelare som en annan match. Gränsen är ' + limit3 + '.');
      }
    });

    return { cells: out, warnings: warnings };
  }

  /* Välj in en ersättare i en match där någon fallit bort. */
  function valjErsattare(players, series, targets, cells, dateKeys, si, m) {
    var ctx = kontext(players, series, targets);
    var dk = dateKeys && dateKeys[si] ? dateKeys[si][m] : '';
    var limit = Math.floor((targets.maxShare || 1) * series[si].perMatch);
    var best = -1, bestScore = Infinity;
    players.forEach(function (p, pi) {
      var v = cells[pi][si][m];
      if (v === 'X' || v === '-' || !ctx.possible[pi][si]) return;
      var total = 0, inSeries = 0, conflict = false;
      for (var s = 0; s < series.length; s++)
        for (var k = 0; k < series[s].count; k++) {
          if (cells[pi][s][k] !== 'X') continue;
          total++; if (s === si) inSeries++;
          if (dk && dateKeys[s][k] === dk) conflict = true;
        }
      var worst = 0;
      for (var j = 0; j < series[si].count; j++) {
        if (j === m) continue;
        var sh = cells[pi][si][j] === 'X' ? 1 : 0;
        players.forEach(function (q, qi) {
          if (qi !== pi && cells[qi][si][m] === 'X' && cells[qi][si][j] === 'X') sh++;
        });
        worst = Math.max(worst, sh);
      }
      var tier = (ctx.allowed[pi][si] ? 0 : 1) + (conflict ? 2 : 0);
      var score = tier * 1000 + 100 * Math.max(0, worst - limit)
        + (total - ctx.fair) + 0.3 * inSeries + Math.random() * 0.01;
      if (score < bestScore) { bestScore = score; best = pi; }
    });
    return best;
  }

  /* Kör planeringen några gånger och behåll det jämnaste resultatet.
     Algoritmen har ett slumpmoment, så det kostar nästan inget och ger
     märkbart jämnare antal matcher per spelare. */
  function planeraBast(players, series, targets, cells, dateKeys, locked, labels, tries) {
    var best = null, bestKey = null;
    var runs = tries || 12;
    for (var i = 0; i < runs; i++) {
      var r = planera(players, series, targets, cells, dateKeys, locked, labels);
      var tot = players.map(function (p, pi) {
        var t = 0;
        for (var s = 0; s < series.length; s++)
          for (var m = 0; m < series[s].count; m++) if (r.cells[pi][s][m] === 'X') t++;
        return t;
      });
      var spread = tot.length ? Math.max.apply(null, tot) - Math.min.apply(null, tot) : 0;
      var key = [r.warnings.length, spread];
      if (!bestKey || key[0] < bestKey[0] || (key[0] === bestKey[0] && key[1] < bestKey[1])) {
        best = r; bestKey = key;
        if (key[0] === 0 && key[1] <= 1) break;
      }
    }
    return best;
  }

  var api = { planera: planera, planeraBast: planeraBast, kontext: kontext, valjErsattare: valjErsattare };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Plan = api;
})(typeof window !== 'undefined' ? window : this);
