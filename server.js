// ===== ระบบจัดการออเดอร์อาหาร — เซิร์ฟเวอร์กลาง =====
// เก็บข้อมูลใน data.json (ตั้ง env DATA_DIR เพื่อชี้ไปยัง persistent disk บนโฮสต์)
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || __dirname;
const DATA_FILE = path.join(DATA_DIR, 'data.json');

// ถ้าตั้ง MONGODB_URI จะเก็บข้อมูลถาวรใน MongoDB (ข้อมูลไม่หายเมื่อ deploy/พักตัว) ไม่ตั้งก็ใช้ไฟล์
const MONGODB_URI = process.env.MONGODB_URI || '';
let useMongo = !!MONGODB_URI;
let mongoCol = null;

app.use(express.json({ limit: '8mb', verify: (req, res, buf) => { req.rawBody = buf; } })); // เผื่อรูป base64 + เก็บ raw body ไว้ตรวจลายเซ็น LINE

// กันไม่ให้เข้าถึงไฟล์ภายในเซิร์ฟเวอร์ผ่าน URL
const BLOCK = new Set(['/server.js', '/package.json', '/package-lock.json', '/data.json', '/.gitignore', '/README.md', '/DEPLOY.md']);
app.use((req, res, next) => {
  if (BLOCK.has(req.path)) return res.status(404).send('Not found');
  next();
});
app.use(express.static(__dirname));

// ---------- storage ----------
let db = { shops: [], orders: [], lineTarget: '' };
function loadDb() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const d = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      db = { shops: d.shops || [], orders: d.orders || [], lineTarget: d.lineTarget || '' };
    }
  } catch (e) { console.error('โหลดข้อมูลไม่สำเร็จ:', e.message); }
}
let saveTimer = null;
function saveDb() {
  // เก็บลง MongoDB ถ้าเปิดใช้งาน
  if (useMongo && mongoCol) {
    mongoCol.updateOne({ _id: 'main' }, { $set: { data: db } }, { upsert: true })
      .catch(e => console.error('บันทึก MongoDB ไม่สำเร็จ:', e.message));
    return;
  }
  // ไม่งั้นเก็บลงไฟล์ (debounce)
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(DATA_FILE, JSON.stringify(db));
    } catch (e) { console.error('บันทึกไม่สำเร็จ:', e.message); }
  }, 120);
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// เลือกที่เก็บข้อมูลตอนเริ่มเซิร์ฟเวอร์
async function initStore() {
  if (useMongo) {
    try {
      const { MongoClient } = require('mongodb');
      const client = new MongoClient(MONGODB_URI);
      await client.connect();
      mongoCol = client.db(process.env.MONGODB_DB || 'catfoodorder').collection('appdata');
      const doc = await mongoCol.findOne({ _id: 'main' });
      if (doc && doc.data) {
        db = { shops: doc.data.shops || [], orders: doc.data.orders || [], lineTarget: doc.data.lineTarget || '' };
      } else {
        await mongoCol.updateOne({ _id: 'main' }, { $set: { data: db } }, { upsert: true });
      }
      console.log('✅ เก็บข้อมูลถาวรด้วย MongoDB');
    } catch (e) {
      console.error('เชื่อม MongoDB ไม่สำเร็จ ใช้ไฟล์แทน:', e.message);
      useMongo = false; loadDb();
    }
  } else {
    loadDb();
  }
}

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

// ===================== LINE (Messaging API) =====================
// ตั้งค่าใน Render: LINE_TOKEN = Channel access token, (ไม่บังคับ) LINE_SECRET = Channel secret
const LINE_PUSH = 'https://api.line.me/v2/bot/message/push';
const LINE_REPLY = 'https://api.line.me/v2/bot/message/reply';

function buildSummary() {
  if (!db.orders.length) return '🐱 ยังไม่มีออเดอร์ในตอนนี้';
  const shopName = id => { const s = db.shops.find(s => s.id === id); return s ? s.name : ''; };
  const shopPhone = id => { const s = db.shops.find(s => s.id === id); return s ? s.phone : ''; };
  // จัดกลุ่มตามร้าน -> เมนู (รวมจำนวนชิ้น + ราคา)
  const groups = {};
  db.orders.forEach(o => {
    const key = o.shop || '__none__';
    if (!groups[key]) groups[key] = { name: o.shop ? shopName(o.shop) : '(ไม่ระบุร้าน)', phone: o.shop ? shopPhone(o.shop) : '', items: {}, qty: 0, sum: 0 };
    const it = groups[key].items[o.name] || (groups[key].items[o.name] = { qty: 0, sum: 0 });
    it.qty += o.qty; it.sum += o.price * o.qty;
    groups[key].qty += o.qty; groups[key].sum += o.price * o.qty;
  });
  const total = db.orders.reduce((a, o) => a + o.price * o.qty, 0);
  const totalQty = db.orders.reduce((a, o) => a + o.qty, 0);
  const people = new Set(db.orders.map(o => o.person || '-')).size;
  const when = new Date().toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
  const body = Object.keys(groups).sort((a, b) => groups[b].sum - groups[a].sum).map(k => {
    const g = groups[k];
    let block = `🏪 ${g.name}` + (g.phone ? ` (โทร ${g.phone})` : '') + '\n';
    block += Object.keys(g.items).map(n => `  • ${n} x${g.items[n].qty} = ${g.items[n].sum.toLocaleString('th-TH')}฿`).join('\n');
    block += `\n  รวมร้าน: ${g.qty} ชิ้น = ${g.sum.toLocaleString('th-TH')} บาท`;
    return block;
  }).join('\n\n');
  return `🐱 สรุปออเดอร์อาหาร\n${when}\n\n${body}\n\n━━━━━━━━\n💰 รวมทั้งหมด: ${total.toLocaleString('th-TH')} บาท\n📋 ${totalQty} ชิ้น • ${people} คน`;
}

async function pushLine(text) {
  const token = process.env.LINE_TOKEN;
  if (!token) return { ok: false, error: 'ยังไม่ได้ตั้งค่า LINE_TOKEN ใน Render' };
  const to = process.env.LINE_TARGET || db.lineTarget;
  if (!to) return { ok: false, error: 'ยังไม่ได้เชื่อมปลายทาง — เพิ่มบอทเข้ากลุ่ม/ทักแชทกับ OA ก่อน 1 ครั้ง' };
  try {
    const r = await fetch(LINE_PUSH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ to, messages: [{ type: 'text', text }] })
    });
    if (!r.ok) return { ok: false, error: 'LINE API ' + r.status + ': ' + (await r.text()) };
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

async function replyLine(replyToken, text) {
  const token = process.env.LINE_TOKEN;
  if (!token || !replyToken) return;
  try {
    await fetch(LINE_REPLY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ replyToken, messages: [{ type: 'text', text }] })
    });
  } catch (e) { /* ignore */ }
}

// Webhook ของ LINE — จับ id ปลายทางอัตโนมัติเมื่อมีคนทักหรือเพิ่มบอทเข้ากลุ่ม
app.post('/line/webhook', (req, res) => {
  const secret = process.env.LINE_SECRET;
  if (secret && req.rawBody) {
    const sig = crypto.createHmac('sha256', secret).update(req.rawBody).digest('base64');
    if (sig !== req.get('x-line-signature')) return res.status(401).send('bad signature');
  }
  const events = (req.body && req.body.events) || [];
  events.forEach(ev => {
    const s = ev.source || {};
    const id = s.groupId || s.roomId || s.userId;
    if (id && id !== db.lineTarget) { db.lineTarget = id; saveDb(); }
    if ((ev.type === 'message' || ev.type === 'join' || ev.type === 'follow') && ev.replyToken) {
      replyLine(ev.replyToken, '✅ เชื่อมต่อ "ออเดอร์เหมียว" เรียบร้อย! กดปุ่มส่งสรุปจากหลังบ้านได้เลย 🐾');
    }
  });
  res.status(200).send('ok');
});

// สถานะการตั้งค่า LINE (ให้หลังบ้านแสดงผล)
app.get('/api/line/status', (req, res) =>
  res.json({ hasToken: !!process.env.LINE_TOKEN, linked: !!(process.env.LINE_TARGET || db.lineTarget) }));

// ส่งสรุปเข้า LINE (กดจากปุ่มหลังบ้าน)
app.post('/api/line/summary', async (req, res) => {
  const r = await pushLine(buildSummary());
  if (r.ok) return res.json({ ok: true });
  res.status(400).json(r);
});

// health check
app.get('/healthz', (req, res) => res.send('ok'));

initStore().then(() => {
  app.listen(PORT, () => console.log(`🐱 เซิร์ฟเวอร์ทำงานที่พอร์ต ${PORT}`));
});
