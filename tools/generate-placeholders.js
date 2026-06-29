const http = require('http');
const EXE = 'http://127.0.0.1:9800';
const PORT = 9900;
const COUNT = 50;

// Generate a simple colored PNG (200x150) with question number
function makePlaceholderPng(qn) {
  // Pre-generated 200x150 PNG with solid color + text
  // Using a minimal valid PNG for simplicity
  // Colors: cycle through 6 colors
  const colors = [
    [0xf9,0x73,0x16], [0x22,0xc5,0x5e], [0x8b,0x5c,0xf6],
    [0x47,0x55,0x69], [0xdc,0x26,0x26], [0x25,0x63,0xeb]
  ];
  const c = colors[qn % colors.length];

  // Build a minimal PNG with IHDR, IDAT (solid color), IEND
  const width = 200, height = 150;

  // Scanline: filter byte (0) + RGB pixels
  const raw = Buffer.alloc((1 + width * 3) * height);
  for (let y = 0; y < height; y++) {
    const off = y * (1 + width * 3);
    raw[off] = 0; // no filter
    for (let x = 0; x < width; x++) {
      raw[off + 1 + x * 3] = c[0];
      raw[off + 2 + x * 3] = c[1];
      raw[off + 3 + x * 3] = c[2];
    }
  }

  const zlib = require('zlib');
  const compressed = zlib.deflateSync(raw);

  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      c ^= buf[i];
      for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  function chunk(type, data) {
    const t = Buffer.from(type);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const crcBuf = Buffer.concat([t, data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(crcBuf), 0);
    return Buffer.concat([len, t, data, crc]);
  }

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type (RGB)
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', compressed), chunk('IEND', Buffer.alloc(0))]);
}

// Pre-generate all PNGs
const pngs = {};
for (let q = 1; q <= COUNT; q++) {
  pngs[q] = makePlaceholderPng(q);
}

// Start HTTP server
const server = http.createServer((req, res) => {
  const m = req.url.match(/^\/(\d+)/);
  const qn = m ? parseInt(m[1]) : 1;
  const png = pngs[qn] || pngs[1];
  res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': png.length });
  res.end(png);
});

server.listen(PORT, '127.0.0.1', async () => {
  console.log('Placeholder server on http://127.0.0.1:' + PORT);

  let done = 0;
  for (let q = 1; q <= COUNT; q++) {
    const url = 'http://127.0.0.1:' + PORT + '/' + q;
    const promptId = 'placeholder-prompt-' + q;
    try {
      const r = await fetch(EXE + '/api/cache', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, promptId, questionNum: q })
      });
      if (r.ok) {
        done++;
        process.stdout.write('\rCached: ' + done + '/' + COUNT);
      } else {
        process.stdout.write('\rCache fail Q' + q + ': ' + r.status);
      }
    } catch(e) {
      process.stdout.write('\rCache err Q' + q + ': ' + e.message);
    }
    await new Promise(r => setTimeout(r, 80));
  }

  console.log('\nDone! ' + done + ' placeholder images cached (Q1-Q' + COUNT + ')');
  server.close();
  process.exit(0);
});

server.on('error', (e) => { console.error('Server error:', e.message); process.exit(1); });
