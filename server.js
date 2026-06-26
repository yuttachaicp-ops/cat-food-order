// ===== ระบบจัดการออเดอร์อาหาร — เซิร์ฟเวอร์กลาง =====
// เก็บข้อมูลใน data.json (ตั้ง env DATA_DIR เพื่อชี้ไปยัง persistent disk บนโฮสต์)
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || __dirname;
const DATA_FILE = path.join(DATA_DIR, 'data.json');

app.use(express.json({ limit: '8mb' })); // เผื่อรูป base64

// กันไม่ให้เข้าถึงไฟล์ภายในเซิร์ฟเวอร์ผ่าน URL
const BLOCK = new Set(['/server.js', '/package.json', '/package-lock.json', '/data.json', '/.gitignore', '/README.md', '/DEPLOY.md']);
app.use((req, res, next) => {
  if (BLOCK.has(req.path)) return res.status(404).send('Not found');
  next();
});
app.use(express.static(__dirname));

// ---------- storage ----------
let db = { shops: [], orders: [] };
function loadDb() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const d = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      db = { shops: d.shops || [], orders: d.orders || [] };
    }
  } catch (e) { console.error('โหลดข้อมูลไม่สำเร็จ:', e.message); }
}
let saveTimer = null;
function saveDb() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(DATA_FILE, JSON.stringify(db));
    } catch (e) { console.error('บันทึกไม่สำเร็จ:', e.message); }
  }, 120);
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
loadDb();

// ---------- helpers ----------
const findShop = id => db.shops.find(s => s.id === id);

// ===================== API =====================

// ดึงข้อมูลทั้งหมด (ใช้ทั้งหน้าบ้าน/หลังบ้าน + polling)
app.get('/api/data', (req, res) => res.json(db));

// ---------- ORDERS ----------
app.post('/api/orders', (req, res) => {
  const b = req.body || {};
  const name = (b.name || '').toString().trim();
  if (!name) return res.status(400).json({ error: 'ต้องมีชื่ออาหาร' });
  const order = {
    id: uid(),
    name,
    person: (b.person || '').toString().trim(),
    price: Number(b.price) || 0,
    qty: parseInt(b.qty) || 1,
    shop: b.shop || '',
    img: b.img || '',
    status: 'new',
    createdAt: Date.now()
  };
  db.orders.push(order);
  saveDb();
  res.json(order);
});

app.put('/api/orders/:id', (req, res) => {
  const o = db.orders.find(o => o.id === req.params.id);
  if (!o) return res.status(404).json({ error: 'ไม่พบรายการ' });
  const b = req.body || {};
  ['name', 'person', 'shop', 'img', 'status'].forEach(k => { if (b[k] !== undefined) o[k] = b[k]; });
  if (b.price !== undefined) o.price = Number(b.price) || 0;
  if (b.qty !== undefined) o.qty = parseInt(b.qty) || 1;
  saveDb();
  res.json(o);
});

app.delete('/api/orders/:id', (req, res) => {
  db.orders = db.orders.filter(o => o.id !== req.params.id);
  saveDb();
  res.json({ ok: true });
});

app.delete('/api/orders', (req, res) => { db.orders = []; saveDb(); res.json({ ok: true }); });

// ---------- SHOPS ----------
app.post('/api/shops', (req, res) => {
  const name = (req.body.name || '').toString().trim();
  if (!name) return res.status(400).json({ error: 'ต้องมีชื่อร้าน' });
  const shop = { id: uid(), name, phone: (req.body.phone || '').toString().trim(), menu: [] };
  db.shops.push(shop);
  saveDb();
  res.json(shop);
});

app.put('/api/shops/:id', (req, res) => {
  const s = findShop(req.params.id);
  if (!s) return res.status(404).json({ error: 'ไม่พบร้าน' });
  if (req.body.name !== undefined) s.name = req.body.name.toString().trim();
  if (req.body.phone !== undefined) s.phone = req.body.phone.toString().trim();
  saveDb();
  res.json(s);
});

app.delete('/api/shops/:id', (req, res) => {
  db.shops = db.shops.filter(s => s.id !== req.params.id);
  saveDb();
  res.json({ ok: true });
});

// ---------- MENU ----------
app.post('/api/shops/:id/menu', (req, res) => {
  const s = findShop(req.params.id);
  if (!s) return res.status(404).json({ error: 'ไม่พบร้าน' });
  const name = (req.body.name || '').toString().trim();
  if (!name) return res.status(400).json({ error: 'ต้องมีชื่อเมนู' });
  const item = { id: uid(), name, price: Number(req.body.price) || 0, img: req.body.img || '' };
  s.menu.push(item);
  saveDb();
  res.json(item);
});

app.put('/api/shops/:id/menu/:mid', (req, res) => {
  const s = findShop(req.params.id);
  if (!s) return res.status(404).json({ error: 'ไม่พบร้าน' });
  const m = s.menu.find(m => m.id === req.params.mid);
  if (!m) return res.status(404).json({ error: 'ไม่พบเมนู' });
  if (req.body.name !== undefined) m.name = req.body.name.toString().trim();
  if (req.body.price !== undefined) m.price = Number(req.body.price) || 0;
  if (req.body.img !== undefined) m.img = req.body.img;
  saveDb();
  res.json(m);
});

app.delete('/api/shops/:id/menu/:mid', (req, res) => {
  const s = findShop(req.params.id);
  if (!s) return res.status(404).json({ error: 'ไม่พบร้าน' });
  s.menu = s.menu.filter(m => m.id !== req.params.mid);
  saveDb();
  res.json({ ok: true });
});

// health check
app.get('/healthz', (req, res) => res.send('ok'));

app.listen(PORT, () => console.log(`🐱 เซิร์ฟเวอร์ทำงานที่พอร์ต ${PORT}`));
