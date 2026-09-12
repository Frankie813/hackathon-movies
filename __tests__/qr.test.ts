// The .tech join page (#33) renders its install QR from a hand-rolled encoder,
// because the page is not allowed to fetch a library or a QR image over venue
// wifi. Nothing else in the repo exercises that code, and the failure mode is a
// QR that judges cannot scan, so the two matrices that actually ship are pinned
// here module-for-module.
//
// The fixtures were cross-checked against the `qrcode` npm package (v1.5.4) and
// round-tripped through the `jsqr` decoder — 310 strings, all decoding back to
// their input. Neither library is a dependency of this repo; they were used once
// to generate and confirm these, and the fixtures are the lasting record.

type QrGlobal = {
  INSTALL_URL: string;
  qrSvg(text: string, options?: { quiet?: number; label?: string }): string;
  encode(text: string): number[][];
};

// public/qr.js is a plain browser script that attaches itself to globalThis. It
// ships to Hosting unbundled, so there is no module to import.
require('../public/qr.js');
const qr = (globalThis as unknown as { MovieMatch: QrGlobal }).MovieMatch;

const render = (text: string): string[] =>
  qr.encode(text).map((row) => row.map((module) => (module ? '#' : '.')).join(''));

describe('QR encoder (public/qr.js)', () => {
  it('encodes the install URL exactly', () => {
    expect(render('https://expo.dev/go')).toEqual([
      '#######.##.######.#######',
      '#.....#..##.....#.#.....#',
      '#.###.#..##...#...#.###.#',
      '#.###.#.##..###.#.#.###.#',
      '#.###.#.####..##..#.###.#',
      '#.....#.#.#.......#.....#',
      '#######.#.#.#.#.#.#######',
      '........##.#..#..........',
      '#...#.###....##.######..#',
      '#####...###.#.####..##.#.',
      '.##..##..#.#####.###.##..',
      '...##.....#.##.#.#.#..##.',
      '.#..#.####.###...###.####',
      '##..##.###...#####..#..#.',
      '..#####.#.#....###.####..',
      '...#.#.#.#..#.##.#.##.##.',
      '#######.#..#.##.#######..',
      '........###.#...#...#....',
      '#######.#..####.#.#.#....',
      '#.....#....#.#..#...###.#',
      '#.###.#.#...##..#######.#',
      '#.###.#...#..##.####..###',
      '#.###.#..##......##..#.#.',
      '#.....#...#.#.##..######.',
      '#######.##.#.##..#....###',
    ]);
  });

  it('encodes a join URL exactly', () => {
    expect(render('https://movienight.tech/j/BCDF')).toEqual([
      '#######.###.####.####.#######',
      '#.....#.##...#..##....#.....#',
      '#.###.#....##...#.....#.###.#',
      '#.###.#.###...##.##...#.###.#',
      '#.###.#..##.#.#.#..#..#.###.#',
      '#.....#......#.######.#.....#',
      '#######.#.#.#.#.#.#.#.#######',
      '........#......####..........',
      '#.##.###.##..#.#.###..#..#.##',
      '.#...#.#....####.########...#',
      '#...#.#####..#..#...##....##.',
      '.#.....#.#..#...#..####.#...#',
      '#.#.#.#.##.#..##.##.#....##..',
      '..##.....##...#.#..#..#...###',
      '##....#...##.#.#####.#..#.###',
      '..#..#.###.##.#.#..######..#.',
      '##..#.##.#.##.########..##.#.',
      '..#.##.....##.#.#......#.###.',
      '#.########.########..###..#..',
      '..##...###..###..#...#..#.#..',
      '.#.#..#..#.#.##.#.#########..',
      '........####...##.###...#####',
      '#######.#####.##...##.#.##.#.',
      '#.....#.###..###..#.#...##...',
      '#.###.#..#.##.......#####.#.#',
      '#.###.#.#....#...#..##.###.#.',
      '#.###.#.#.#.#.#.#.###..#..#.#',
      '#.....#....####.#.#.#..###.#.',
      '#######.#.##.#...######.#..#.',
    ]);
  });

  // Byte-mode capacity at ECC M. Getting a boundary wrong picks a version too
  // small and silently corrupts the payload rather than throwing.
  it.each([
    [14, 21], [15, 25], [26, 25], [27, 29], [42, 29], [43, 33],
    [62, 33], [63, 37], [84, 37], [85, 41], [106, 41], [107, 45],
    [122, 45], [123, 49], [152, 49], [153, 53], [180, 53], [181, 57], [213, 57],
  ])('fits %i bytes in a %ix%i symbol', (bytes, size) => {
    expect(qr.encode('x'.repeat(bytes))).toHaveLength(size);
  });

  it('refuses a payload past version 10 rather than truncating it', () => {
    expect(() => qr.encode('x'.repeat(214))).toThrow(/too long/);
  });

  it('counts UTF-8 bytes, not characters', () => {
    // 14 characters but 28 bytes — a character count would wrongly pick v1.
    expect(qr.encode('é'.repeat(14))).toHaveLength(29);
  });

  it('ships a plausible install URL that the encoder accepts', () => {
    expect(qr.INSTALL_URL).toMatch(/^https:\/\//);
    expect(() => qr.encode(qr.INSTALL_URL)).not.toThrow();
  });

  describe('qrSvg', () => {
    it('paints an opaque white ground so it scans on a dark page', () => {
      const svg = qr.qrSvg('https://movienight.tech');
      expect(svg).toContain('<rect width="33" height="33" fill="#fff"/>');
      expect(svg).toContain('fill="#000"');
    });

    it('sizes the viewBox to the symbol plus a four-module quiet zone', () => {
      expect(qr.qrSvg('https://expo.dev/go')).toContain('viewBox="0 0 33 33"');
      expect(qr.qrSvg('https://expo.dev/go', { quiet: 0 })).toContain('viewBox="0 0 25 25"');
    });

    it('escapes the accessible label', () => {
      expect(qr.qrSvg('x', { label: '<"&>' })).toContain('aria-label="&lt;&quot;&amp;&gt;"');
    });
  });
});
