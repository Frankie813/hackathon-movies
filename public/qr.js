// public/qr.js — the one piece of shared script on the .tech site (issue #33).
//
// Both pages show the same "install the app" QR, so the encoder lives here
// rather than being pasted into each. It is hand-rolled on purpose: AGENTS.md
// rates venue wifi the highest-impact risk in the whole plan, and the issue is
// explicit that this page carries no external requests. A CDN'd QR library or
// an api.qrserver.com <img> would put the one thing a guest needs to scan
// behind the network that is most likely to be down.
//
// Byte mode, ECC level M, versions 1-10 (up to 213 bytes) — far more than any
// URL we will ever put in here. Verified module-for-module against the `qrcode`
// npm package in __tests__/qr.test.ts.

(function (global) {
  'use strict';

  // ---------------------------------------------------------------------
  // The URL both QRs encode, and the href both pages set at runtime.
  //
  // Today it points at the Expo Go download page, because #31 (EAS build) is
  // still open and an `expo start` QR is an exp:// tunnel URL that changes
  // every run — it cannot be baked into a static page. When #31 lands a
  // published build, swap this for that URL and both pages follow. No rebuild.
  //
  // One caveat: index.html and j/index.html each hardcode this same URL on
  // their "or open the download page" anchor, because a no-JS visitor has to
  // get somewhere and JS is what overwrites the href. Change this and change
  // those two anchors too, or a visitor without JS is sent to the old link.
  var INSTALL_URL = 'https://expo.dev/go';

  // ---- GF(256), primitive polynomial 0x11D ----------------------------
  var EXP = new Uint8Array(512);
  var LOG = new Uint8Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
  })();

  function mul(a, b) {
    return a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]];
  }

  // Product of (x - a^0)...(x - a^(degree-1)), highest power first.
  function generatorPoly(degree) {
    var poly = [1];
    for (var d = 0; d < degree; d++) {
      var next = new Array(poly.length + 1);
      for (var n = 0; n < next.length; n++) next[n] = 0;
      for (var i = 0; i < poly.length; i++) {
        next[i] ^= poly[i];
        next[i + 1] ^= mul(poly[i], EXP[d]);
      }
      poly = next;
    }
    return poly;
  }

  function ecCodewords(data, ecLen) {
    var gen = generatorPoly(ecLen);
    var res = new Uint8Array(data.length + ecLen);
    res.set(data, 0);
    for (var i = 0; i < data.length; i++) {
      var factor = res[i];
      if (factor === 0) continue;
      // gen[0] is always 1, so res[i] cancels itself — start at 1.
      for (var j = 1; j < gen.length; j++) res[i + j] ^= mul(gen[j], factor);
    }
    return res.slice(data.length);
  }

  // [ecPerBlock, group1Blocks, group1DataCw, group2Blocks, group2DataCw] at ECC M.
  var VERSIONS = [
    null,
    [10, 1, 16, 0, 0],
    [16, 1, 28, 0, 0],
    [26, 1, 44, 0, 0],
    [18, 2, 32, 0, 0],
    [24, 2, 43, 0, 0],
    [16, 4, 27, 0, 0],
    [18, 4, 31, 0, 0],
    [22, 2, 38, 2, 39],
    [22, 3, 36, 2, 37],
    [26, 4, 43, 1, 44]
  ];

  // Row/column centres of the alignment patterns, per version.
  var ALIGN = [
    null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
    [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]
  ];

  function toBytes(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
    var esc = unescape(encodeURIComponent(str));
    var out = new Uint8Array(esc.length);
    for (var i = 0; i < esc.length; i++) out[i] = esc.charCodeAt(i);
    return out;
  }

  function dataCapacity(version) {
    var s = VERSIONS[version];
    return s[1] * s[2] + s[3] * s[4];
  }

  // Byte mode's character-count indicator is 8 bits up to version 9, 16 after.
  function countBits(version) {
    return version < 10 ? 8 : 16;
  }

  function pickVersion(byteLen) {
    for (var v = 1; v < VERSIONS.length; v++) {
      if (byteLen * 8 + 4 + countBits(v) <= dataCapacity(v) * 8) return v;
    }
    return 0;
  }

  function dataCodewords(bytes, version) {
    var total = dataCapacity(version);
    var bits = [];
    function put(value, length) {
      for (var i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
    }

    put(0x4, 4); // byte mode
    put(bytes.length, countBits(version));
    for (var i = 0; i < bytes.length; i++) put(bytes[i], 8);

    // Terminator, then pad to a whole byte, then the alternating pad bytes.
    put(0, Math.min(4, total * 8 - bits.length));
    while (bits.length % 8 !== 0) bits.push(0);

    var cw = [];
    for (var b = 0; b < bits.length; b += 8) {
      var byte = 0;
      for (var k = 0; k < 8; k++) byte = (byte << 1) | bits[b + k];
      cw.push(byte);
    }
    var pad = [0xec, 0x11];
    while (cw.length < total) cw.push(pad[(cw.length - bits.length / 8) % 2]);
    return cw;
  }

  // Split into blocks, append each block's EC codewords, then interleave both
  // groups the way the spec requires.
  function finalMessage(cw, version) {
    var spec = VERSIONS[version];
    var ecLen = spec[0];
    var blocks = [];
    var ecBlocks = [];
    var offset = 0;

    function take(count, size) {
      for (var i = 0; i < count; i++) {
        var data = cw.slice(offset, offset + size);
        offset += size;
        blocks.push(data);
        ecBlocks.push(ecCodewords(Uint8Array.from(data), ecLen));
      }
    }
    take(spec[1], spec[2]);
    take(spec[3], spec[4]);

    var out = [];
    var maxData = Math.max(spec[2], spec[4]);
    for (var i = 0; i < maxData; i++) {
      for (var b = 0; b < blocks.length; b++) {
        if (i < blocks[b].length) out.push(blocks[b][i]);
      }
    }
    for (var j = 0; j < ecLen; j++) {
      for (var e = 0; e < ecBlocks.length; e++) out.push(ecBlocks[e][j]);
    }
    return out;
  }

  // BCH(15,5) over the 5-bit (ECC level, mask) pair, XOR'd with the spec mask.
  function formatBits(maskPattern) {
    var data = (0x0 << 3) | maskPattern; // ECC M is 0b00
    var rem = data;
    for (var i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    return ((data << 10) | rem) ^ 0x5412;
  }

  // BCH(18,6), versions 7 and up only.
  function versionBits(version) {
    var rem = version;
    for (var i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    return (version << 12) | rem;
  }

  function buildFunctionPatterns(version) {
    var size = version * 4 + 17;
    var m = [];
    var reserved = [];
    for (var r = 0; r < size; r++) {
      m.push(new Array(size).fill(0));
      reserved.push(new Array(size).fill(false));
    }
    function set(row, col, value) {
      m[row][col] = value;
      reserved[row][col] = true;
    }

    // Finder patterns plus their separators, in one pass over the 9x9 area.
    var corners = [[0, 0], [0, size - 7], [size - 7, 0]];
    for (var f = 0; f < corners.length; f++) {
      for (var dr = -1; dr <= 7; dr++) {
        for (var dc = -1; dc <= 7; dc++) {
          var row = corners[f][0] + dr;
          var col = corners[f][1] + dc;
          if (row < 0 || col < 0 || row >= size || col >= size) continue;
          var inFinder = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
          var dark = inFinder && (dr === 0 || dr === 6 || dc === 0 || dc === 6 ||
            (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4));
          set(row, col, dark ? 1 : 0);
        }
      }
    }

    // Timing patterns.
    for (var t = 8; t < size - 8; t++) {
      set(6, t, t % 2 === 0 ? 1 : 0);
      set(t, 6, t % 2 === 0 ? 1 : 0);
    }

    // Alignment patterns, skipping the three that would sit on a finder.
    var centres = ALIGN[version];
    var last = centres.length - 1;
    for (var a = 0; a <= last; a++) {
      for (var b = 0; b <= last; b++) {
        var onFinder = (a === 0 && b === 0) || (a === 0 && b === last) || (a === last && b === 0);
        if (onFinder) continue;
        for (var ar = -2; ar <= 2; ar++) {
          for (var ac = -2; ac <= 2; ac++) {
            var ring = Math.max(Math.abs(ar), Math.abs(ac)) !== 1;
            set(centres[a] + ar, centres[b] + ac, ring ? 1 : 0);
          }
        }
      }
    }

    // Always-dark module, then reserve the format-info strips. Their values are
    // written after masking, once the mask is chosen.
    set(size - 8, 8, 1);
    for (var i = 0; i <= 8; i++) {
      if (!reserved[8][i]) set(8, i, 0);
      if (!reserved[i][8]) set(i, 8, 0);
    }
    for (var k = 0; k < 8; k++) {
      if (!reserved[8][size - 1 - k]) set(8, size - 1 - k, 0);
      if (!reserved[size - 1 - k][8]) set(size - 1 - k, 8, 0);
    }

    if (version >= 7) {
      var vbits = versionBits(version);
      for (var v = 0; v < 18; v++) {
        var bit = (vbits >>> v) & 1;
        var near = size - 11 + (v % 3);
        var far = Math.floor(v / 3);
        set(far, near, bit);
        set(near, far, bit);
      }
    }

    return { modules: m, reserved: reserved, size: size };
  }

  // Two-module-wide columns, right to left, alternating direction. Column 6 is
  // the vertical timing pattern and is stepped over entirely.
  function placeData(grid, bits) {
    var m = grid.modules;
    var reserved = grid.reserved;
    var size = grid.size;
    var idx = 0;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) {
        for (var j = 0; j < 2; j++) {
          var col = right - j;
          var upward = ((right + 1) & 2) === 0;
          var row = upward ? size - 1 - vert : vert;
          if (reserved[row][col]) continue;
          // Running past the end of the data is the spec's remainder bits,
          // which are zero.
          m[row][col] = idx < bits.length ? bits[idx] : 0;
          idx++;
        }
      }
    }
  }

  var MASKS = [
    function (r, c) { return (r + c) % 2 === 0; },
    function (r) { return r % 2 === 0; },
    function (r, c) { return c % 3 === 0; },
    function (r, c) { return (r + c) % 3 === 0; },
    function (r, c) { return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0; },
    function (r, c) { return ((r * c) % 2) + ((r * c) % 3) === 0; },
    function (r, c) { return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0; },
    function (r, c) { return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0; }
  ];

  var FINDER_RUN = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];

  function matchesAt(line, start, pattern) {
    for (var i = 0; i < pattern.length; i++) {
      if (line[start + i] !== pattern[i]) return false;
    }
    return true;
  }

  function penalty(m) {
    var size = m.length;
    var score = 0;
    var lines = [];
    for (var r = 0; r < size; r++) lines.push(m[r]);
    for (var c = 0; c < size; c++) {
      var col = [];
      for (var r2 = 0; r2 < size; r2++) col.push(m[r2][c]);
      lines.push(col);
    }

    // Rule 1 — runs of five or more. Rule 3 — finder-lookalikes.
    var reversed = FINDER_RUN.slice().reverse();
    for (var l = 0; l < lines.length; l++) {
      var line = lines[l];
      var run = 1;
      for (var i = 1; i < size; i++) {
        if (line[i] === line[i - 1]) {
          run++;
        } else {
          if (run >= 5) score += 3 + (run - 5);
          run = 1;
        }
      }
      if (run >= 5) score += 3 + (run - 5);

      for (var s = 0; s + FINDER_RUN.length <= size; s++) {
        if (matchesAt(line, s, FINDER_RUN) || matchesAt(line, s, reversed)) score += 40;
      }
    }

    // Rule 2 — 2x2 blocks of one colour.
    for (var br = 0; br < size - 1; br++) {
      for (var bc = 0; bc < size - 1; bc++) {
        var v = m[br][bc];
        if (v === m[br][bc + 1] && v === m[br + 1][bc] && v === m[br + 1][bc + 1]) score += 3;
      }
    }

    // Rule 4 — deviation from a 50/50 light/dark split.
    var dark = 0;
    for (var dr = 0; dr < size; dr++) {
      for (var dc = 0; dc < size; dc++) dark += m[dr][dc];
    }
    var total = size * size;
    score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;

    return score;
  }

  function placeFormat(m, bits) {
    var size = m.length;
    for (var i = 0; i <= 5; i++) m[i][8] = (bits >>> i) & 1;
    m[7][8] = (bits >>> 6) & 1;
    m[8][8] = (bits >>> 7) & 1;
    m[8][7] = (bits >>> 8) & 1;
    for (var j = 9; j < 15; j++) m[8][14 - j] = (bits >>> j) & 1;

    for (var k = 0; k < 8; k++) m[8][size - 1 - k] = (bits >>> k) & 1;
    for (var n = 8; n < 15; n++) m[size - 15 + n][8] = (bits >>> n) & 1;
    m[size - 8][8] = 1;
  }

  /** Encodes `text` and returns the module matrix as rows of 0/1. */
  function encode(text) {
    var bytes = toBytes(String(text));
    var version = pickVersion(bytes.length);
    if (!version) throw new Error('QR: ' + bytes.length + ' bytes is too long for version 10.');

    var message = finalMessage(dataCodewords(bytes, version), version);
    var bits = [];
    for (var i = 0; i < message.length; i++) {
      for (var b = 7; b >= 0; b--) bits.push((message[i] >>> b) & 1);
    }

    var grid = buildFunctionPatterns(version);
    placeData(grid, bits);

    var best = null;
    var bestScore = Infinity;
    for (var mask = 0; mask < 8; mask++) {
      var candidate = grid.modules.map(function (row) { return row.slice(); });
      for (var r = 0; r < grid.size; r++) {
        for (var c = 0; c < grid.size; c++) {
          if (!grid.reserved[r][c] && MASKS[mask](r, c)) candidate[r][c] ^= 1;
        }
      }
      placeFormat(candidate, formatBits(mask));
      var score = penalty(candidate);
      if (score < bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    return best;
  }

  function escapeAttr(value) {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /**
   * Returns an <svg> string. Always black on white regardless of the page
   * theme — a dark-mode QR with a transparent background does not scan.
   */
  function qrSvg(text, options) {
    var opts = options || {};
    var quiet = opts.quiet == null ? 4 : opts.quiet;
    var m = encode(text);
    var size = m.length;
    var dim = size + quiet * 2;

    var d = '';
    for (var r = 0; r < size; r++) {
      var c = 0;
      while (c < size) {
        if (!m[r][c]) { c++; continue; }
        var start = c;
        while (c < size && m[r][c]) c++;
        var run = c - start;
        d += 'M' + (start + quiet) + ' ' + (r + quiet) + 'h' + run + 'v1h-' + run + 'z';
      }
    }

    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + dim + ' ' + dim +
      '" shape-rendering="crispEdges" role="img" aria-label="' +
      escapeAttr(opts.label || text) + '">' +
      '<rect width="' + dim + '" height="' + dim + '" fill="#fff"/>' +
      '<path d="' + d + '" fill="#000"/></svg>';
  }

  global.MovieMatch = { INSTALL_URL: INSTALL_URL, qrSvg: qrSvg, encode: encode };
})(typeof globalThis !== 'undefined' ? globalThis : this);
