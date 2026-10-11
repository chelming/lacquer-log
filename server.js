const express  = require('express');
const Database = require('better-sqlite3');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const crypto   = require('crypto');
const sharp    = require('sharp');

const app  = express();
const PORT = process.env.PORT || 3377;

// ── Directories ───────────────────────────────────────────────────────
const DATA_DIR   = process.env.DATA_DIR   || '/app/data';
const PHOTOS_DIR = process.env.PHOTOS_DIR || '/app/photos';
const THUMBS_DIR = path.join(PHOTOS_DIR, 'thumbs');
fs.mkdirSync(DATA_DIR,   { recursive: true });
fs.mkdirSync(PHOTOS_DIR, { recursive: true });
fs.mkdirSync(THUMBS_DIR, { recursive: true });

// ── Database ──────────────────────────────────────────────────────────
const db = new Database(path.join(DATA_DIR, 'lacquer.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS polishes (
    id           TEXT PRIMARY KEY,
    brand        TEXT NOT NULL,
    name         TEXT NOT NULL,
    color_family TEXT,
    color_hex    TEXT,
    types        TEXT    DEFAULT '[]',
    purchase_date TEXT,
    last_used    TEXT,
    usage_count  INTEGER DEFAULT 0,
    usage_dates  TEXT    DEFAULT '[]',
    added_at     TEXT,
    photo        TEXT
  )
`);

// ── Middleware ────────────────────────────────────────────────────────
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/photos/thumbs', express.static(THUMBS_DIR));
app.use('/photos', express.static(PHOTOS_DIR));

// ── Multer ────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: PHOTOS_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, crypto.randomUUID() + ext);
  }
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

// ── Row mappers ───────────────────────────────────────────────────────
function toRow(p) {
  let photo = p.photo || null;
  if (photo && photo.startsWith('/photos/')) photo = photo.slice(8);
  return {
    id:            p.id,
    brand:         p.brand,
    name:          p.name,
    color_family:  p.colorFamily  || null,
    color_hex:     p.colorHex     || null,
    types:         JSON.stringify(p.types        || []),
    purchase_date: p.purchaseDate || null,
    last_used:     p.lastUsed     || null,
    usage_count:   p.usageCount   || 0,
    usage_dates:   JSON.stringify(p.usageDates   || []),
    added_at:      p.addedAt      || new Date().toISOString().slice(0, 10),
    photo
  };
}

function fromRow(r) {
  return {
    id:           r.id,
    brand:        r.brand,
    name:         r.name,
    colorFamily:  r.color_family,
    colorHex:     r.color_hex,
    types:        JSON.parse(r.types        || '[]'),
    purchaseDate: r.purchase_date,
    lastUsed:     r.last_used,
    usageCount:   r.usage_count,
    usageDates:   JSON.parse(r.usage_dates  || '[]'),
    addedAt:      r.added_at,
    photo:        r.photo ? `/photos/${r.photo}` : null,
    thumb:        r.photo ? `/photos/thumbs/${r.photo.replace(/\.\w+$/, '.jpg')}` : null
  };
}

const uid = () => crypto.randomUUID().replace(/-/g, '').slice(0, 13);

async function generateThumb(filename) {
  const src  = path.join(PHOTOS_DIR, filename);
  const dest = path.join(THUMBS_DIR, filename.replace(/\.\w+$/, '.jpg'));
  if (!fs.existsSync(src)) return;
  try {
    await sharp(src).resize(300, null, { withoutEnlargement: true }).jpeg({ quality: 70 }).toFile(dest);
  } catch {}
}

// Backfill thumbs for any existing photos on startup
(async () => {
  const rows = db.prepare('SELECT photo FROM polishes WHERE photo IS NOT NULL').all();
  for (const r of rows) {
    const thumb = path.join(THUMBS_DIR, r.photo.replace(/\.\w+$/, '.jpg'));
    if (!fs.existsSync(thumb)) await generateThumb(r.photo);
  }
})();

function deletePhotoFile(filename) {
  if (!filename) return;
  const bare = filename.startsWith('/photos/') ? filename.slice(8) : filename;
  const f = path.join(PHOTOS_DIR, bare);
  if (fs.existsSync(f)) try { fs.unlinkSync(f); } catch {}
}

// ── Routes ────────────────────────────────────────────────────────────

// GET all
app.get('/api/polishes', (req, res) => {
  res.json(db.prepare('SELECT * FROM polishes ORDER BY name COLLATE NOCASE').all().map(fromRow));
});

// POST create
app.post('/api/polishes', (req, res) => {
  const row = toRow({ ...req.body, id: req.body.id || uid() });
  db.prepare(`INSERT OR REPLACE INTO polishes
    VALUES (@id,@brand,@name,@color_family,@color_hex,@types,
            @purchase_date,@last_used,@usage_count,@usage_dates,@added_at,@photo)
  `).run(row);
  res.json(fromRow(db.prepare('SELECT * FROM polishes WHERE id=?').get(row.id)));
});

// PUT update
app.put('/api/polishes/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM polishes WHERE id=?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  // If photo changed, delete old file
  const newPhoto = req.body.photo || null;
  const oldPhoto = existing.photo || null;
  const incomingBare = newPhoto && newPhoto.startsWith('/photos/') ? newPhoto.slice(8) : newPhoto;
  if (oldPhoto && incomingBare !== oldPhoto) deletePhotoFile(oldPhoto);
  const merged = { ...fromRow(existing), ...req.body, id: req.params.id };
  const row    = toRow(merged);
  db.prepare(`UPDATE polishes SET
    brand=@brand, name=@name, color_family=@color_family, color_hex=@color_hex,
    types=@types, purchase_date=@purchase_date, last_used=@last_used,
    usage_count=@usage_count, usage_dates=@usage_dates, added_at=@added_at, photo=@photo
    WHERE id=@id`).run(row);
  res.json(fromRow(db.prepare('SELECT * FROM polishes WHERE id=?').get(req.params.id)));
});

// DELETE
app.delete('/api/polishes/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM polishes WHERE id=?').get(req.params.id);
  if (existing?.photo) deletePhotoFile(existing.photo);
  db.prepare('DELETE FROM polishes WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// POST mark used
app.post('/api/polishes/:id/use', (req, res) => {
  const existing = db.prepare('SELECT * FROM polishes WHERE id=?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const p     = fromRow(existing);
  const today = new Date().toISOString().slice(0, 10);
  if (p.usageDates.includes(today)) return res.json(p);
  const dates = [...p.usageDates, today].sort();
  db.prepare('UPDATE polishes SET last_used=?,usage_count=?,usage_dates=? WHERE id=?')
    .run(today, p.usageCount + 1, JSON.stringify(dates), req.params.id);
  res.json(fromRow(db.prepare('SELECT * FROM polishes WHERE id=?').get(req.params.id)));
});

// DELETE remove a specific use date
app.delete('/api/polishes/:id/use/:date', (req, res) => {
  const existing = db.prepare('SELECT * FROM polishes WHERE id=?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const p     = fromRow(existing);
  const dates = (p.usageDates || []).filter(d => d !== req.params.date).sort();
  const last  = dates.length ? dates[dates.length - 1] : null;
  db.prepare('UPDATE polishes SET last_used=?,usage_count=?,usage_dates=? WHERE id=?')
    .run(last, dates.length, JSON.stringify(dates), req.params.id);
  res.json(fromRow(db.prepare('SELECT * FROM polishes WHERE id=?').get(req.params.id)));
});

// POST upload photo (multipart)
app.post('/api/photos/upload', upload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file received' });
  await generateThumb(req.file.filename);
  res.json({ filename: req.file.filename, url: `/photos/${req.file.filename}` });
});

// POST fetch photo from URL (server-side — no CORS issues)
app.post('/api/photos/fetch-url', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'No URL provided' });
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LacquerLog/1.0)' }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const ct = response.headers.get('content-type') || '';
    if (!ct.startsWith('image/')) throw new Error('URL does not point to an image');
    const ext      = ct.includes('png') ? '.png' : ct.includes('gif') ? '.gif' : '.jpg';
    const filename = crypto.randomUUID() + ext;
    const buffer   = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(path.join(PHOTOS_DIR, filename), buffer);
    await generateThumb(filename);
    res.json({ filename, url: `/photos/${filename}` });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// GET export JSON
app.get('/api/export', (req, res) => {
  const data = db.prepare('SELECT * FROM polishes ORDER BY name COLLATE NOCASE').all().map(r => {
    const p = fromRow(r);
    if (r.photo) {
      const f = path.join(PHOTOS_DIR, r.photo);
      if (fs.existsSync(f)) {
        const ext  = path.extname(r.photo).slice(1).toLowerCase();
        const mime = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : 'image/jpeg';
        p.photo = `data:${mime};base64,${fs.readFileSync(f).toString('base64')}`;
      }
    }
    return p;
  });
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Disposition', `attachment; filename="lacquer-log-${stamp}.json"`);
  res.setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(data, null, 2));
});

// POST import JSON
app.post('/api/import', async (req, res) => {
  const { polishes: imported, mode } = req.body;
  if (!Array.isArray(imported)) return res.status(400).json({ error: 'Expected an array' });
  const valid = imported.filter(p => p.brand && p.name);
  if (!valid.length) return res.status(400).json({ error: 'No valid polishes in file' });

  // Resolve photos: in merge mode, preserve existing file if present
  for (const p of valid) {
    if (mode !== 'replace' && p.id) {
      const existing = db.prepare('SELECT photo FROM polishes WHERE id=?').get(p.id);
      if (existing?.photo && fs.existsSync(path.join(PHOTOS_DIR, existing.photo))) {
        // Keep the existing photo file; discard whatever the import brought
        p.photo = `/photos/${existing.photo}`;
        continue;
      }
    }
    if (p.photo && p.photo.startsWith('data:image/')) {
      try {
        const m = p.photo.match(/^data:image\/(\w+);base64,(.+)$/);
        if (m) {
          const ext      = m[1] === 'png' ? '.png' : '.jpg';
          const filename = crypto.randomUUID() + ext;
          fs.writeFileSync(path.join(PHOTOS_DIR, filename), Buffer.from(m[2], 'base64'));
          await generateThumb(filename);
          p.photo = `/photos/${filename}`;
        }
      } catch { p.photo = null; }
    }
  }

  if (mode === 'replace') {
    // Clean up photo files for replaced records
    const existing = db.prepare('SELECT photo FROM polishes').all();
    existing.forEach(r => r.photo && deletePhotoFile(r.photo));
    db.prepare('DELETE FROM polishes').run();
  }

  const stmt = db.prepare(`INSERT OR REPLACE INTO polishes
    VALUES (@id,@brand,@name,@color_family,@color_hex,@types,
            @purchase_date,@last_used,@usage_count,@usage_dates,@added_at,@photo)`);

  const insertMany = db.transaction(items => {
    for (const p of items) {
      if (!p.id) p.id = uid();
      stmt.run(toRow(p));
    }
  });
  insertMany(valid);

  res.json({ imported: valid.length });
});

app.listen(PORT, () => console.log(`Lacquer Log running on http://localhost:${PORT}`));
