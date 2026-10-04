
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { URL } = require("node:url");
const { DatabaseSync } = require("node:sqlite");

const envFile = path.join(__dirname, ".env");
if (fs.existsSync(envFile)) {
  for (const rawLine of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const PORT = Number(process.env.PORT || 3000);
const DB_FILE = process.env.DB_FILE
  ? path.resolve(ROOT, process.env.DB_FILE)
  : path.join(DATA_DIR, "summit-base.sqlite");
const NODE_ENV = process.env.NODE_ENV || "development";
const SESSION_TTL_DAYS = Math.max(1, Number(process.env.SESSION_TTL_DAYS || 7));
const COOKIE_SECURE = String(process.env.COOKIE_SECURE || (NODE_ENV === "production" ? "true" : "false")) === "true";

const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || "admin@summitbase.local").trim().toLowerCase();
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || (NODE_ENV === "production" ? "" : "Admin!ChangeMe123"));
const ADMIN_NAME = String(process.env.ADMIN_NAME || "Summit Base Admin").trim();

if (NODE_ENV === "production" && (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 12)) {
  throw new Error("Production requires ADMIN_PASSWORD with at least 12 characters.");
}

const db = new DatabaseSync(DB_FILE);
db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    phone TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    approval_status TEXT NOT NULL DEFAULT 'approved'
      CHECK(approval_status IN ('pending','approved','rejected')),
    rejection_reason TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS admin_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin' CHECK(role IN ('admin','superadmin')),
    is_default INTEGER NOT NULL DEFAULT 0 CHECK(is_default IN (0,1)),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER,
    admin_id INTEGER,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(admin_id) REFERENCES admin_users(id) ON DELETE CASCADE,
    CHECK ((user_id IS NOT NULL) + (admin_id IS NOT NULL) = 1)
  );

  CREATE TABLE IF NOT EXISTS catalog (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    category TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT '🎒',
    description TEXT NOT NULL DEFAULT '',
    price INTEGER NOT NULL CHECK(price >= 0),
    stock INTEGER NOT NULL DEFAULT 0 CHECK(stock >= 0),
    active INTEGER NOT NULL DEFAULT 1,
    photo TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS rentals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    start_date TEXT NOT NULL,
    return_date TEXT NOT NULL,
    days INTEGER NOT NULL CHECK(days >= 1),
    total_price INTEGER NOT NULL CHECK(total_price >= 0),
    status TEXT NOT NULL DEFAULT 'Dipinjam'
      CHECK(status IN ('Dipinjam','Diperpanjang','Dikembalikan')),
    approval_status TEXT NOT NULL DEFAULT 'approved'
      CHECK(approval_status IN ('pending','approved','rejected')),
    rejection_reason TEXT NOT NULL DEFAULT '',
    approved_at TEXT,
    rejected_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    returned_at TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS rental_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rental_id INTEGER NOT NULL,
    catalog_id INTEGER NOT NULL,
    equipment_name TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK(quantity >= 1),
    unit_price INTEGER NOT NULL CHECK(unit_price >= 0),
    subtotal INTEGER NOT NULL CHECK(subtotal >= 0),
    FOREIGN KEY(rental_id) REFERENCES rentals(id) ON DELETE CASCADE,
    FOREIGN KEY(catalog_id) REFERENCES catalog(id) ON DELETE RESTRICT
  );

  CREATE TABLE IF NOT EXISTS rental_extensions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rental_id INTEGER NOT NULL,
    additional_days INTEGER NOT NULL CHECK(additional_days >= 1),
    previous_return_date TEXT NOT NULL,
    requested_return_date TEXT NOT NULL,
    extra_total INTEGER NOT NULL CHECK(extra_total >= 0),
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK(status IN ('pending','approved','rejected')),
    rejection_reason TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    approved_at TEXT,
    rejected_at TEXT,
    FOREIGN KEY(rental_id) REFERENCES rentals(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
  CREATE INDEX IF NOT EXISTS idx_rentals_user ON rentals(user_id);
  CREATE INDEX IF NOT EXISTS idx_rentals_return ON rentals(return_date);
  CREATE INDEX IF NOT EXISTS idx_rental_items_rental ON rental_items(rental_id);
  CREATE INDEX IF NOT EXISTS idx_rental_extensions_rental ON rental_extensions(rental_id);
  CREATE INDEX IF NOT EXISTS idx_rental_extensions_status ON rental_extensions(status);
`);

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

function verifyPassword(password, encoded) {
  const [kind, saltHex, hashHex] = String(encoded || "").split("$");
  if (kind !== "scrypt" || !saltHex || !hashHex) return false;
  try {
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(hashHex, "hex");
    const actual = crypto.scryptSync(password, salt, expected.length);
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function ensureDefaultAdminColumn() {
  const columns = db.prepare("PRAGMA table_info(admin_users)").all();
  if (!columns.some(column => column.name === "is_default")) {
    db.exec("ALTER TABLE admin_users ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0");
  }
}

function ensureSingleDefaultAdmin() {
  const rows = db.prepare(`
    SELECT id, email
    FROM admin_users
    ORDER BY id ASC
  `).all();

  if (!rows.length) return;

  let chosen = rows.find(row => String(row.email).toLowerCase() === ADMIN_EMAIL);
  if (!chosen) chosen = rows[0];

  db.exec("UPDATE admin_users SET is_default = 0");
  db.prepare("UPDATE admin_users SET is_default = 1 WHERE id = ?").run(chosen.id);
}

ensureDefaultAdminColumn();

function ensureApprovalColumns() {
  const userColumns = db.prepare("PRAGMA table_info(users)").all();
  if (!userColumns.some(column => column.name === "approval_status")) {
    db.exec("ALTER TABLE users ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'approved'");
  }
  if (!userColumns.some(column => column.name === "rejection_reason")) {
    db.exec("ALTER TABLE users ADD COLUMN rejection_reason TEXT NOT NULL DEFAULT ''");
  }

  const rentalColumns = db.prepare("PRAGMA table_info(rentals)").all();
  if (!rentalColumns.some(column => column.name === "approval_status")) {
    db.exec("ALTER TABLE rentals ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'approved'");
  }
  if (!rentalColumns.some(column => column.name === "rejection_reason")) {
    db.exec("ALTER TABLE rentals ADD COLUMN rejection_reason TEXT NOT NULL DEFAULT ''");
  }
  if (!rentalColumns.some(column => column.name === "approved_at")) {
    db.exec("ALTER TABLE rentals ADD COLUMN approved_at TEXT");
  }
  if (!rentalColumns.some(column => column.name === "rejected_at")) {
    db.exec("ALTER TABLE rentals ADD COLUMN rejected_at TEXT");
  }
}

ensureApprovalColumns();

function seedDatabase() {
  const admin = db.prepare("SELECT id FROM admin_users ORDER BY id LIMIT 1").get();
  if (!admin) {
    db.prepare(`
      INSERT INTO admin_users (name, email, password_hash, role, is_default, active)
      VALUES (?, ?, ?, 'superadmin', 1, 1)
    `).run(ADMIN_NAME, ADMIN_EMAIL, hashPassword(ADMIN_PASSWORD));
  }

  ensureSingleDefaultAdmin();

  const count = db.prepare("SELECT COUNT(*) AS count FROM catalog").get().count;
  if (Number(count) === 0) {
    const seed = [
      ["Tenda 2–3 Orang", "Camping", "⛺", "Tenda ringkas untuk camping dan pendakian singkat.", 25000, 5],
      ["Carrier 45L", "Carrier", "🎒", "Nyaman membawa perlengkapan utama untuk perjalananmu.", 20000, 8],
      ["Kompor Portable", "Masak", "🔥", "Teman masak yang ringan dan praktis untuk di camp.", 10000, 10],
      ["Sleeping Bag", "Istirahat", "🛏️", "Menjaga tubuh tetap hangat saat bermalam di gunung.", 15000, 7]
    ];
    const stmt = db.prepare(`
      INSERT INTO catalog (name, category, icon, description, price, stock, active, photo)
      VALUES (?, ?, ?, ?, ?, ?, 1, '')
    `);
    for (const row of seed) stmt.run(...row);
  }
}
seedDatabase();

function nowIso() {
  return new Date().toISOString();
}

function addDaysIso(days) {
  return new Date(Date.now() + days * 86400000).toISOString();
}

function dateOnly(value) {
  const s = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

function addDaysDateOnly(dateValue, days) {
  const base = new Date(`${dateValue}T00:00:00Z`);
  if (!dateValue || Number.isNaN(base.getTime())) return "";
  base.setUTCDate(base.getUTCDate() + Number(days || 0));
  return base.toISOString().slice(0, 10);
}

function daysInclusive(startDate, returnDate) {
  const s = Date.parse(`${startDate}T00:00:00Z`);
  const r = Date.parse(`${returnDate}T00:00:00Z`);
  if (!Number.isFinite(s) || !Number.isFinite(r) || r < s) return 0;
  return Math.floor((r - s) / 86400000) + 1;
}

function cleanText(value, max = 200) {
  return String(value ?? "").trim().slice(0, max);
}

function cleanEmail(value) {
  const email = cleanText(value, 180).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "";
  return email;
}

function cleanPhone(value) {
  const phone = cleanText(value, 30).replace(/[^\d+\-\s()]/g, "");
  if (phone.replace(/\D/g, "").length < 8) return "";
  return phone;
}

function validatePassword(password) {
  return typeof password === "string" && password.length >= 8 && password.length <= 128;
}

function parseJsonBody(req, maxBytes = 4 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let data = "";
    let size = 0;
    req.on("data", chunk => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("payload_too_large"));
        req.destroy();
        return;
      }
      data += chunk.toString("utf8");
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error("invalid_json"));
      }
    });
    req.on("error", reject);
  });
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  const out = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const k = part.slice(0, idx).trim();
    const v = decodeURIComponent(part.slice(idx + 1).trim());
    out[k] = v;
  }
  return out;
}

function setSessionCookie(res, token) {
  const maxAge = SESSION_TTL_DAYS * 86400;
  const bits = [
    `sb_session=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`
  ];
  if (COOKIE_SECURE) bits.push("Secure");
  res.setHeader("Set-Cookie", bits.join("; "));
}

function clearSessionCookie(res) {
  const bits = [
    "sb_session=",
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0"
  ];
  if (COOKIE_SECURE) bits.push("Secure");
  res.setHeader("Set-Cookie", bits.join("; "));
}

function newSession({ userId = null, adminId = null }) {
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  db.prepare(`
    INSERT INTO sessions (token_hash, user_id, admin_id, expires_at)
    VALUES (?, ?, ?, ?)
  `).run(tokenHash, userId, adminId, addDaysIso(SESSION_TTL_DAYS));
  return token;
}

function currentAuth(req) {
  const token = parseCookies(req).sb_session;
  if (!token) return null;
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const row = db.prepare(`
    SELECT s.*, u.name AS user_name, u.email AS user_email, u.phone AS user_phone,
           u.active AS user_active, u.approval_status AS user_approval_status,
           u.rejection_reason AS user_rejection_reason,
           a.name AS admin_name, a.email AS admin_email, a.role AS admin_role,
           a.is_default AS admin_is_default, a.active AS admin_active
    FROM sessions s
    LEFT JOIN users u ON u.id = s.user_id
    LEFT JOIN admin_users a ON a.id = s.admin_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `).get(tokenHash, nowIso());

  if (!row) return null;

  if (row.user_id && row.user_active) {
    if (row.user_approval_status === "approved") {
      return {
        kind: "customer",
        id: row.user_id,
        name: row.user_name,
        email: row.user_email,
        phone: row.user_phone,
        approvalStatus: "approved",
        rejectionReason: ""
      };
    }
    if (row.user_approval_status === "pending" || row.user_approval_status === "rejected") {
      return {
        kind: "customer_status",
        id: row.user_id,
        name: row.user_name,
        email: row.user_email,
        phone: row.user_phone,
        approvalStatus: row.user_approval_status,
        rejectionReason: row.user_rejection_reason || ""
      };
    }
  }

  if (row.admin_id && row.admin_active) {
    return {
      kind: "admin",
      id: row.admin_id,
      name: row.admin_name,
      email: row.admin_email,
      role: row.admin_role,
      isDefault: Number(row.admin_is_default) === 1
    };
  }

  return null;
}

function requireCustomer(req) {
  const auth = currentAuth(req);
  if (!auth || auth.kind !== "customer") throw httpError(401, "AUTH_REQUIRED", "Silakan login sebagai customer.");
  return auth;
}

function requireAdmin(req, superOnly = false) {
  const auth = currentAuth(req);
  if (!auth || auth.kind !== "admin") throw httpError(401, "AUTH_REQUIRED", "Silakan login sebagai admin.");
  if (superOnly && auth.role !== "superadmin") throw httpError(403, "FORBIDDEN", "Akses superadmin diperlukan.");
  return auth;
}

function requireDefaultAdmin(req) {
  const auth = requireAdmin(req);
  if (!auth.isDefault) {
    throw httpError(403, "DEFAULT_ADMIN_ONLY", "Hanya akun admin default yang dapat mengelola akun admin lain.");
  }
  return auth;
}

function checkSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return;

  // Saat berjalan di belakang reverse proxy (mis. Caddy/Nginx),
  // browser melihat origin publik, sedangkan Node bisa menerima Host internal.
  // Gunakan forwarded host/proto hanya pada deployment/proxy, sehingga
  // validasi PATCH/POST seperti persetujuan customer tetap lolos.
  const useForwarded = NODE_ENV === "production" || String(process.env.TRUST_PROXY || "").toLowerCase() === "true";
  const pickForwarded = (value, fallback) => {
    const first = String(value || "").split(",")[0].trim();
    return first || fallback;
  };
  const host = useForwarded
    ? pickForwarded(req.headers["x-forwarded-host"], req.headers.host)
    : req.headers.host;
  const proto = useForwarded
    ? pickForwarded(req.headers["x-forwarded-proto"], COOKIE_SECURE ? "https" : "http")
    : (COOKIE_SECURE ? "https" : "http");

  try {
    const expected = `${proto}://${host}`;
    if (origin !== expected) throw httpError(403, "BAD_ORIGIN", "Origin request tidak valid.");
  } catch (err) {
    if (err.code) throw err;
    throw httpError(403, "BAD_ORIGIN", "Origin request tidak valid.");
  }
}

function httpError(status, code, message, details = null) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  err.details = details;
  return err;
}

const rateBuckets = new Map();
function rateLimit(req, bucket, limit = 25, windowMs = 60000) {
  const key = `${req.socket.remoteAddress || "unknown"}:${bucket}`;
  const now = Date.now();
  let row = rateBuckets.get(key);
  if (!row || now - row.start > windowMs) {
    row = { start: now, count: 0 };
  }
  row.count += 1;
  rateBuckets.set(key, row);
  if (row.count > limit) {
    throw httpError(429, "RATE_LIMITED", "Terlalu banyak permintaan. Coba lagi sebentar.");
  }
}

setInterval(() => {
  const threshold = nowIso();
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(threshold);
  const cutoff = Date.now() - 15 * 60 * 1000;
  for (const [key, row] of rateBuckets.entries()) {
    if (row.start < cutoff) rateBuckets.delete(key);
  }
}, 5 * 60 * 1000).unref();

function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
    ...extraHeaders
  });
  res.end(body);
}

function sendText(res, status, body, contentType = "text/plain; charset=utf-8", extraHeaders = {}) {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    ...extraHeaders
  });
  res.end(body);
}

function securityHeaders() {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src https://www.google.com https://maps.google.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  };
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function serveStatic(req, res, pathname) {
  let requested = pathname === "/" ? "/index.html" : pathname;
  if (requested === "/admin") requested = "/admin.html";

  let decoded;
  try {
    decoded = decodeURIComponent(requested);
  } catch {
    return sendText(res, 400, "Bad Request");
  }

  const filePath = path.normalize(path.join(PUBLIC_DIR, decoded));
  const rel = path.relative(PUBLIC_DIR, filePath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return sendText(res, 403, "Forbidden");
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return sendText(res, 404, "Not Found");
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = mimeTypes[ext] || "application/octet-stream";
  const data = fs.readFileSync(filePath);
  res.writeHead(200, {
    ...securityHeaders(),
    "Content-Type": contentType,
    "Content-Length": data.length,
    "Cache-Control": NODE_ENV === "production" ? "public, max-age=3600" : "no-cache"
  });
  res.end(data);
}

function publicCatalog() {
  return db.prepare(`
    SELECT id, name, category, icon, description, price, stock, active, photo
    FROM catalog
    WHERE active = 1
    ORDER BY id DESC
  `).all();
}

function adminCatalog() {
  return db.prepare(`
    SELECT id, name, category, icon, description, price, stock, active, photo, created_at, updated_at
    FROM catalog
    ORDER BY id DESC
  `).all();
}

function validateItems(items) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 20) {
    throw httpError(400, "INVALID_ITEMS", "Pilih minimal satu alat.");
  }

  const seen = new Set();
  const normalized = [];

  for (const entry of items) {
    const id = Number(entry?.catalogId);
    const quantity = Math.floor(Number(entry?.quantity));
    if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(quantity) || quantity < 1) {
      throw httpError(400, "INVALID_ITEMS", "Daftar alat tidak valid.");
    }
    if (seen.has(id)) throw httpError(400, "DUPLICATE_ITEM", "Alat yang sama tidak boleh dikirim dua kali.");
    seen.add(id);
    normalized.push({ catalogId: id, quantity });
  }
  return normalized;
}

function createRentalInTransaction(userId, payload, options = {}) {
  const startDate = dateOnly(payload.startDate);
  const returnDate = dateOnly(payload.returnDate);
  const days = daysInclusive(startDate, returnDate);

  if (!startDate || !returnDate || days < 1) {
    throw httpError(400, "INVALID_DATES", "Tanggal mulai dan tanggal kembali tidak valid.");
  }

  const today = nowIso().slice(0, 10);
  if (startDate < today) throw httpError(400, "START_IN_PAST", "Tanggal mulai tidak boleh di masa lalu.");

  const items = validateItems(payload.items);
  const catalogStmt = db.prepare(`
    SELECT id, name, price, stock, active
    FROM catalog
    WHERE id = ?
  `);

  const resolved = [];
  let total = 0;

  for (const item of items) {
    const row = catalogStmt.get(item.catalogId);
    if (!row || !row.active) {
      throw httpError(409, "ITEM_UNAVAILABLE", `Alat dengan ID ${item.catalogId} tidak tersedia.`);
    }
    if (item.quantity > row.stock) {
      throw httpError(409, "STOCK_INSUFFICIENT", `Stok ${row.name} tidak mencukupi. Tersedia ${row.stock} unit.`);
    }
    const subtotal = Number(row.price) * item.quantity * days;
    resolved.push({
      catalogId: row.id,
      equipmentName: row.name,
      quantity: item.quantity,
      unitPrice: Number(row.price),
      subtotal
    });
    total += subtotal;
  }

  const approvalStatus = options.approvalStatus || "pending";
  const reserveStock = options.reserveStock === true;

  if (!["pending", "approved"].includes(approvalStatus)) {
    throw httpError(400, "INVALID_APPROVAL", "Status persetujuan tidak valid.");
  }

  db.prepare(`
    INSERT INTO rentals
      (user_id, start_date, return_date, days, total_price, status,
       approval_status, approved_at, rejected_at)
    VALUES (?, ?, ?, ?, ?, 'Dipinjam', ?, ?, NULL)
  `).run(
    userId,
    startDate,
    returnDate,
    days,
    total,
    approvalStatus,
    approvalStatus === "approved" ? nowIso() : null
  );

  const rentalId = Number(db.prepare("SELECT last_insert_rowid() AS id").get().id);

  const itemInsert = db.prepare(`
    INSERT INTO rental_items
      (rental_id, catalog_id, equipment_name, quantity, unit_price, subtotal)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const item of resolved) {
    itemInsert.run(
      rentalId,
      item.catalogId,
      item.equipmentName,
      item.quantity,
      item.unitPrice,
      item.subtotal
    );
  }

  if (reserveStock) {
    const stockUpdate = db.prepare(`
      UPDATE catalog
      SET stock = stock - ?, updated_at = datetime('now')
      WHERE id = ? AND stock >= ?
    `);
    for (const item of resolved) {
      const result = stockUpdate.run(item.quantity, item.catalogId, item.quantity);
      if (result.changes !== 1) {
        throw httpError(409, "STOCK_INSUFFICIENT", `Stok ${item.equipmentName} sudah berubah. Silakan coba lagi.`);
      }
    }
  }

  return {
    rentalId,
    startDate,
    returnDate,
    days,
    totalPrice: total,
    approvalStatus,
    items: resolved.map(x => ({
      catalogId: x.catalogId,
      equipment: x.equipmentName,
      quantity: x.quantity,
      unitPrice: x.unitPrice,
      subtotal: x.subtotal
    }))
  };
}

function transaction(fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    try { db.exec("ROLLBACK"); } catch {}
    throw err;
  }
}

function customerRentals(userId) {
  const rentals = db.prepare(`
    SELECT id, start_date AS startDate, return_date AS returnDate,
           days, total_price AS totalPrice, status, approval_status AS approvalStatus,
           rejection_reason AS rejectionReason,
           approved_at AS approvedAt, rejected_at AS rejectedAt,
           created_at AS createdAt, returned_at AS returnedAt
    FROM rentals
    WHERE user_id = ?
    ORDER BY id DESC
  `).all(userId);

  const itemStmt = db.prepare(`
    SELECT catalog_id AS catalogId, equipment_name AS equipment,
           quantity, unit_price AS unitPrice, subtotal
    FROM rental_items
    WHERE rental_id = ?
    ORDER BY id
  `);
  const extensionStmt = db.prepare(`
    SELECT id, additional_days AS additionalDays,
           previous_return_date AS previousReturnDate,
           requested_return_date AS requestedReturnDate,
           extra_total AS extraTotal, status, rejection_reason AS rejectionReason,
           created_at AS createdAt, approved_at AS approvedAt, rejected_at AS rejectedAt
    FROM rental_extensions
    WHERE rental_id = ?
    ORDER BY id DESC
    LIMIT 1
  `);

  return rentals.map(r => ({
    ...r,
    items: itemStmt.all(r.id),
    extensionRequest: extensionStmt.get(r.id) || null
  }));
}

function adminRentals() {
  const rentals = db.prepare(`
    SELECT r.id, r.start_date AS startDate, r.return_date AS returnDate,
           r.days, r.total_price AS totalPrice, r.status,
           r.approval_status AS approvalStatus, r.rejection_reason AS rejectionReason,
           r.approved_at AS approvedAt, r.rejected_at AS rejectedAt,
           r.created_at AS createdAt, r.returned_at AS returnedAt,
           u.id AS userId, u.name AS userName, u.email AS userEmail, u.phone AS userPhone
    FROM rentals r
    JOIN users u ON u.id = r.user_id
    ORDER BY r.id DESC
  `).all();

  const itemStmt = db.prepare(`
    SELECT catalog_id AS catalogId, equipment_name AS equipment,
           quantity, unit_price AS unitPrice, subtotal
    FROM rental_items
    WHERE rental_id = ?
    ORDER BY id
  `);
  const extensionStmt = db.prepare(`
    SELECT id, additional_days AS additionalDays,
           previous_return_date AS previousReturnDate,
           requested_return_date AS requestedReturnDate,
           extra_total AS extraTotal, status, rejection_reason AS rejectionReason,
           created_at AS createdAt, approved_at AS approvedAt, rejected_at AS rejectedAt
    FROM rental_extensions
    WHERE rental_id = ?
    ORDER BY id DESC
    LIMIT 1
  `);
  return rentals.map(r => ({
    ...r,
    items: itemStmt.all(r.id),
    extensionRequest: extensionStmt.get(r.id) || null
  }));
}

function effectiveRentalStatus(rental) {
  if (rental.status === "Dikembalikan") return "Dikembalikan";
  const today = new Date();
  const ret = new Date(`${rental.returnDate}T00:00:00Z`);
  const t = new Date(`${today.toISOString().slice(0,10)}T00:00:00Z`);
  if (ret < t) return "Terlambat";
  return rental.status;
}

function adminStats() {
  const users = Number(db.prepare("SELECT COUNT(*) AS c FROM users WHERE active=1 AND approval_status='approved'").get().c);
  const pendingAccounts = Number(db.prepare("SELECT COUNT(*) AS c FROM users WHERE approval_status='pending'").get().c);
  const rentals = adminRentals();
  const active = rentals.filter(r => r.approvalStatus === "approved" && r.status !== "Dikembalikan");
  const today = nowIso().slice(0, 10);
  const dueToday = active.filter(r => r.returnDate === today);
  const overdue = active.filter(r => r.returnDate < today);
  const pendingRentals = rentals.filter(r => r.approvalStatus === "pending");
  const pendingExtensions = Number(db.prepare("SELECT COUNT(*) AS c FROM rental_extensions WHERE status='pending'").get().c);
  const newOrders = pendingAccounts + pendingRentals.length + pendingExtensions;
  const tools = Number(db.prepare("SELECT COUNT(*) AS c FROM catalog WHERE active=1").get().c);
  return {
    totalAccounts: users,
    activeRentals: active.length,
    dueToday: dueToday.length,
    overdueRentals: overdue.length,
    newOrders,
    pendingExtensions,
    activeTools: tools
  };
}

function validatePhotoData(photo) {
  const value = String(photo || "");
  if (!value) return "";
  if (!/^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=\r\n]+$/.test(value)) {
    throw httpError(400, "INVALID_PHOTO", "Format foto harus JPEG, PNG, atau WebP.");
  }
  const comma = value.indexOf(",");
  const bytes = Math.floor((value.length - comma - 1) * 3 / 4);
  if (bytes > 1_500_000) {
    throw httpError(413, "PHOTO_TOO_LARGE", "Foto terlalu besar. Gunakan ukuran maksimal sekitar 1.5 MB.");
  }
  return value;
}

async function handleApi(req, res, url) {
  const method = req.method;
  const pathname = url.pathname;

  const isMutation = !["GET", "HEAD", "OPTIONS"].includes(method);
  if (isMutation) checkSameOrigin(req);

  if (method === "OPTIONS") {
    res.writeHead(204, {
      ...securityHeaders(),
      "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    });
    return res.end();
  }

  // PUBLIC
  if (method === "GET" && pathname === "/api/catalog") {
    return sendJson(res, 200, { catalog: publicCatalog() });
  }

  if (method === "GET" && pathname === "/api/health") {
    return sendJson(res, 200, { ok: true, time: nowIso() });
  }

  if (method === "POST" && pathname === "/api/auth/register") {
    rateLimit(req, "register", 8, 10 * 60 * 1000);
    const body = await parseJsonBody(req, 3 * 1024 * 1024);

    const name = cleanText(body.name, 100);
    const email = cleanEmail(body.email);
    const phone = cleanPhone(body.phone);
    const password = body.password;
    if (name.length < 2) throw httpError(400, "INVALID_NAME", "Nama minimal 2 karakter.");
    if (!email) throw httpError(400, "INVALID_EMAIL", "Email tidak valid.");
    if (!phone) throw httpError(400, "INVALID_PHONE", "Nomor telepon wajib diisi.");
    if (!validatePassword(password)) throw httpError(400, "INVALID_PASSWORD", "Password minimal 8 karakter.");
    validateItems(body.items);

    const rentalResult = transaction(() => {
      const exists = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
      if (exists) throw httpError(409, "EMAIL_EXISTS", "Email sudah terdaftar.");
      const userInsert = db.prepare(`
        INSERT INTO users (name, email, phone, password_hash, active, approval_status, rejection_reason)
        VALUES (?, ?, ?, ?, 1, 'pending', '')
      `);
      userInsert.run(name, email, phone, hashPassword(password));
      const userId = Number(db.prepare("SELECT last_insert_rowid() AS id").get().id);

      const rental = createRentalInTransaction(userId, body, { approvalStatus: 'pending', reserveStock: false });
      return { userId, rental };
    });
    return sendJson(res, 201, {
      pending: true,
      user: { id: rentalResult.userId, name, email, phone, approvalStatus: "pending" },
      rental: rentalResult.rental,
      message: "Akun dan pesanan menunggu persetujuan admin."
    });
  }

  if (method === "POST" && pathname === "/api/auth/login") {
    rateLimit(req, "login", 12, 10 * 60 * 1000);
    const body = await parseJsonBody(req, 128 * 1024);
    const email = cleanEmail(body.email);
    const password = body.password;
    if (!email || !password) throw httpError(400, "INVALID_LOGIN", "Email dan password wajib diisi.");

    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
    if (!user) {
      throw httpError(401, "INVALID_LOGIN", "Email atau password salah.");
    }
    if (!verifyPassword(password, user.password_hash)) {
      throw httpError(401, "INVALID_LOGIN", "Email atau password salah.");
    }
    if (!user.active) {
      throw httpError(403, "ACCOUNT_DISABLED", "Akun customer dinonaktifkan admin.");
    }

    const token = newSession({ userId: user.id });
    setSessionCookie(res, token);
    return sendJson(res, 200, {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        approvalStatus: user.approval_status,
        rejectionReason: user.rejection_reason || ""
      }
    });
  }

  if (method === "POST" && pathname === "/api/auth/logout") {
    const token = parseCookies(req).sb_session;
    if (token) {
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
    }
    clearSessionCookie(res);
    return sendJson(res, 200, { ok: true });
  }

  if (method === "GET" && pathname === "/api/me") {
    const auth = currentAuth(req);
    if (!auth) return sendJson(res, 200, { authenticated: false });
    return sendJson(res, 200, {
      authenticated: true,
      ...auth,
      ...((auth.kind === "customer" || auth.kind === "customer_status") ? { rentals: customerRentals(auth.id) } : {})
    });
  }

  if (method === "POST" && pathname === "/api/rentals") {
    const auth = requireCustomer(req);
    const body = await parseJsonBody(req, 256 * 1024);
    const rental = transaction(() => createRentalInTransaction(auth.id, body, { approvalStatus: 'pending', reserveStock: false }));
    return sendJson(res, 201, { rental });
  }

  if (method === "GET" && pathname === "/api/rentals/mine") {
    const auth = requireCustomer(req);
    return sendJson(res, 200, { rentals: customerRentals(auth.id) });
  }

  if (method === "POST" && pathname.startsWith("/api/rentals/") && pathname.endsWith("/extend")) {
    const auth = requireCustomer(req);
    const match = pathname.match(/^\/api\/rentals\/(\d+)\/extend$/);
    if (!match) throw httpError(404, "NOT_FOUND", "Endpoint tidak ditemukan.");

    const rentalId = Number(match[1]);
    const body = await parseJsonBody(req, 64 * 1024);
    const additionalDays = Math.floor(Number(body.additionalDays));

    if (!Number.isInteger(additionalDays) || additionalDays < 1 || additionalDays > 30) {
      throw httpError(400, "INVALID_EXTENSION", "Perpanjangan harus 1 sampai 30 hari.");
    }

    const result = transaction(() => {
      const rental = db.prepare(`
        SELECT id, user_id, start_date AS startDate, return_date AS returnDate,
               days, total_price AS totalPrice, status, approval_status AS approvalStatus
        FROM rentals
        WHERE id = ? AND user_id = ?
      `).get(rentalId, auth.id);

      if (!rental) throw httpError(404, "NOT_FOUND", "Pesanan tidak ditemukan.");
      if (rental.approvalStatus !== "approved") {
        throw httpError(409, "RENTAL_NOT_APPROVED", "Pesanan belum disetujui admin.");
      }
      if (rental.status === "Dikembalikan") {
        throw httpError(409, "ALREADY_RETURNED", "Pesanan yang sudah dikembalikan tidak dapat diperpanjang.");
      }

      const pending = db.prepare(`
        SELECT id FROM rental_extensions
        WHERE rental_id = ? AND status = 'pending'
        ORDER BY id DESC LIMIT 1
      `).get(rentalId);
      if (pending) {
        throw httpError(409, "EXTENSION_PENDING", "Permintaan perpanjangan sebelumnya masih menunggu persetujuan admin.");
      }

      const items = db.prepare(`
        SELECT quantity, unit_price AS unitPrice
        FROM rental_items
        WHERE rental_id = ?
      `).all(rentalId);

      if (!items.length) throw httpError(409, "NO_ITEMS", "Pesanan tidak memiliki item.");

      const extraTotal = items.reduce(
        (sum, item) => sum + Number(item.unitPrice) * Number(item.quantity) * additionalDays,
        0
      );
      const requestedReturnDate = addDaysDateOnly(rental.returnDate, additionalDays);

      const created = db.prepare(`
        INSERT INTO rental_extensions (
          rental_id, additional_days, previous_return_date, requested_return_date, extra_total, status
        ) VALUES (?, ?, ?, ?, ?, 'pending')
      `).run(rentalId, additionalDays, rental.returnDate, requestedReturnDate, extraTotal);

      return {
        extensionId: Number(created.lastInsertRowid),
        rentalId,
        previousReturnDate: rental.returnDate,
        requestedReturnDate,
        addedDays: additionalDays,
        extraTotal,
        currentTotal: Number(rental.totalPrice),
        requestedTotal: Number(rental.totalPrice) + extraTotal,
        status: "pending"
      };
    });

    return sendJson(res, 201, { extension: result });
  }

  // ADMIN AUTH
  if (method === "POST" && pathname === "/api/admin/login") {
    rateLimit(req, "admin-login", 8, 10 * 60 * 1000);
    const body = await parseJsonBody(req, 128 * 1024);
    const email = cleanEmail(body.email);
    const password = body.password;
    if (!email || !password) throw httpError(400, "INVALID_LOGIN", "Email dan password wajib diisi.");

    const admin = db.prepare("SELECT * FROM admin_users WHERE email = ?").get(email);
    if (!admin || !admin.active || !verifyPassword(password, admin.password_hash)) {
      throw httpError(401, "INVALID_LOGIN", "Email atau password salah.");
    }

    const token = newSession({ adminId: admin.id });
    setSessionCookie(res, token);
    return sendJson(res, 200, {
      admin: {
        id: admin.id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
        isDefault: Number(admin.is_default) === 1
      }
    });
  }

  if (method === "POST" && pathname === "/api/admin/logout") {
    const auth = requireAdmin(req);
    const token = parseCookies(req).sb_session;
    if (token) {
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
    }
    clearSessionCookie(res);
    return sendJson(res, 200, { ok: true, adminId: auth.id });
  }

  if (method === "GET" && pathname === "/api/admin/me") {
    const auth = currentAuth(req);
    if (!auth || auth.kind !== "admin") return sendJson(res, 200, { authenticated: false });
    return sendJson(res, 200, { authenticated: true, admin: auth });
  }

  // APPROVALS: admin must approve accounts and every new rental before they become active.
  if (method === "PATCH" && pathname.match(/^\/api\/admin\/users\/\d+\/approval$/)) {
    requireAdmin(req);
    const userId = Number(pathname.split("/")[4]);
    const body = await parseJsonBody(req, 32 * 1024);
    const next = cleanText(body.status, 20);
    const reason = cleanText(body.reason, 500);

    if (!["approved", "rejected"].includes(next)) {
      throw httpError(400, "INVALID_APPROVAL", "Status persetujuan akun tidak valid.");
    }
    if (next === "rejected" && reason.length < 3) {
      throw httpError(400, "REJECTION_REASON_REQUIRED", "Alasan penolakan akun wajib diisi.");
    }

    const user = db.prepare("SELECT id, approval_status FROM users WHERE id=?").get(userId);
    if (!user) throw httpError(404, "NOT_FOUND", "Customer tidak ditemukan.");

    transaction(() => {
      if (next === "approved") {
        db.prepare(`
          UPDATE users
          SET approval_status='approved', rejection_reason='', active=1
          WHERE id=?
        `).run(userId);
      } else {
        db.prepare(`
          UPDATE users
          SET approval_status='rejected', rejection_reason=?
          WHERE id=?
        `).run(reason, userId);

        // A rejected account cannot keep pending rental requests open.
        const related = db.prepare(`
          UPDATE rentals
          SET approval_status='rejected',
              rejection_reason=?,
              rejected_at=datetime('now')
          WHERE user_id=? AND approval_status='pending'
        `).run(`Akun customer ditolak: ${reason}`, userId);
      }
    });

    return sendJson(res, 200, {
      ok: true,
      approvalStatus: next,
      rejectionReason: next === "rejected" ? reason : ""
    });
  }

  if (method === "PATCH" && pathname.match(/^\/api\/admin\/rental-extensions\/\d+\/approval$/)) {
    requireAdmin(req);
    const extensionId = Number(pathname.split("/")[4]);
    const body = await parseJsonBody(req, 32 * 1024);
    const next = cleanText(body.status, 20);
    const reason = cleanText(body.reason, 500);

    if (!["approved", "rejected"].includes(next)) {
      throw httpError(400, "INVALID_APPROVAL", "Status persetujuan perpanjangan tidak valid.");
    }
    if (next === "rejected" && reason.length < 3) {
      throw httpError(400, "REJECTION_REASON_REQUIRED", "Alasan penolakan perpanjangan wajib diisi.");
    }

    transaction(() => {
      const extension = db.prepare(`
        SELECT e.*, r.user_id AS userId, r.return_date AS rentalReturnDate,
               r.status AS rentalStatus, r.approval_status AS rentalApprovalStatus,
               u.approval_status AS userApprovalStatus
        FROM rental_extensions e
        JOIN rentals r ON r.id=e.rental_id
        JOIN users u ON u.id=r.user_id
        WHERE e.id=?
      `).get(extensionId);

      if (!extension) throw httpError(404, "NOT_FOUND", "Permintaan perpanjangan tidak ditemukan.");
      if (extension.status !== "pending") {
        throw httpError(409, "EXTENSION_ALREADY_DECIDED", "Permintaan perpanjangan ini sudah diproses.");
      }
      if (extension.rentalApprovalStatus !== "approved" || extension.userApprovalStatus !== "approved") {
        throw httpError(409, "ACCOUNT_OR_RENTAL_NOT_APPROVED", "Akun dan pesanan harus sudah disetujui.");
      }

      if (next === "approved") {
        if (extension.rentalStatus === "Dikembalikan") {
          throw httpError(409, "ALREADY_RETURNED", "Pesanan sudah dikembalikan.");
        }
        const latest = db.prepare(`
          SELECT return_date AS returnDate, days, total_price AS totalPrice
          FROM rentals WHERE id=?
        `).get(extension.rental_id);
        if (!latest) throw httpError(404, "NOT_FOUND", "Pesanan tidak ditemukan.");
        if (latest.returnDate !== extension.rentalReturnDate) {
          throw httpError(409, "RENTAL_CHANGED", "Tanggal sewa berubah. Silakan minta customer mengajukan perpanjangan lagi.");
        }

        db.prepare(`
          UPDATE rentals
          SET return_date=?, days=?, total_price=?, status='Diperpanjang'
          WHERE id=?
        `).run(
          extension.requested_return_date,
          Number(latest.days) + Number(extension.additional_days),
          Number(latest.totalPrice) + Number(extension.extra_total),
          extension.rental_id
        );
        db.prepare(`
          UPDATE rental_extensions
          SET status='approved', rejection_reason='', approved_at=datetime('now')
          WHERE id=?
        `).run(extensionId);
      } else {
        db.prepare(`
          UPDATE rental_extensions
          SET status='rejected', rejection_reason=?, rejected_at=datetime('now')
          WHERE id=?
        `).run(reason, extensionId);
      }
    });

    return sendJson(res, 200, {
      ok: true,
      approvalStatus: next,
      rejectionReason: next === "rejected" ? reason : ""
    });
  }

  if (method === "PATCH" && pathname.match(/^\/api\/admin\/rentals\/\d+\/approval$/)) {
    requireAdmin(req);
    const rentalId = Number(pathname.split("/")[4]);
    const body = await parseJsonBody(req, 32 * 1024);
    const next = cleanText(body.status, 20);
    const reason = cleanText(body.reason, 500);

    if (!["approved", "rejected"].includes(next)) {
      throw httpError(400, "INVALID_APPROVAL", "Status persetujuan sewa tidak valid.");
    }
    if (next === "rejected" && reason.length < 3) {
      throw httpError(400, "REJECTION_REASON_REQUIRED", "Alasan penolakan pesanan wajib diisi.");
    }

    transaction(() => {
      const rental = db.prepare(`
        SELECT r.*, u.approval_status AS userApprovalStatus
        FROM rentals r
        JOIN users u ON u.id=r.user_id
        WHERE r.id=?
      `).get(rentalId);

      if (!rental) throw httpError(404, "NOT_FOUND", "Pesanan tidak ditemukan.");

      if (next === "approved") {
        if (rental.approval_status === "approved") return;
        if (rental.userApprovalStatus !== "approved") {
          throw httpError(409, "ACCOUNT_NOT_APPROVED", "Akun customer harus disetujui terlebih dahulu.");
        }
        if (rental.start_date < nowIso().slice(0, 10)) {
          throw httpError(409, "START_DATE_PASSED", "Tanggal mulai sewa sudah lewat. Minta customer membuat pesanan baru.");
        }

        const items = db.prepare(`
          SELECT catalog_id AS catalogId, quantity, equipment_name AS equipmentName
          FROM rental_items
          WHERE rental_id=?
        `).all(rentalId);

        const takeStock = db.prepare(`
          UPDATE catalog
          SET stock=stock-?, updated_at=datetime('now')
          WHERE id=? AND stock>=?
        `);

        for (const item of items) {
          const result = takeStock.run(item.quantity, item.catalogId, item.quantity);
          if (result.changes !== 1) {
            throw httpError(409, "STOCK_INSUFFICIENT", `Stok ${item.equipmentName} tidak mencukupi untuk menyetujui pesanan.`);
          }
        }

        db.prepare(`
          UPDATE rentals
          SET approval_status='approved',
              rejection_reason='',
              approved_at=datetime('now'),
              rejected_at=NULL
          WHERE id=?
        `).run(rentalId);
      } else {
        if (rental.approval_status === "approved") {
          throw httpError(409, "ALREADY_APPROVED", "Pesanan yang sudah disetujui tidak dapat ditolak dari menu persetujuan.");
        }
        db.prepare(`
          UPDATE rentals
          SET approval_status='rejected',
              rejection_reason=?,
              rejected_at=datetime('now')
          WHERE id=?
        `).run(reason, rentalId);
      }
    });

    return sendJson(res, 200, {
      ok:true,
      approvalStatus: next,
      rejectionReason: next === "rejected" ? reason : ""
    });
  }

  // POST-APPROVAL-MARKER
  // ADMIN DATA
  if (method === "GET" && pathname === "/api/admin/dashboard") {
    requireAdmin(req);
    return sendJson(res, 200, {
      stats: adminStats(),
      rentals: adminRentals(),
      catalog: adminCatalog(),
      users: db.prepare(`
        SELECT id, name, email, phone, active,
               approval_status AS approvalStatus, rejection_reason AS rejectionReason,
               created_at AS createdAt
        FROM users ORDER BY id DESC
      `).all()
    });
  }

  if (method === "GET" && pathname === "/api/admin/catalog") {
    requireAdmin(req);
    return sendJson(res, 200, { catalog: adminCatalog() });
  }

  if (method === "POST" && pathname === "/api/admin/catalog") {
    requireAdmin(req);
    const body = await parseJsonBody(req, 3 * 1024 * 1024);
    const name = cleanText(body.name, 120);
    const category = cleanText(body.category || "Alat", 60);
    const icon = cleanText(body.icon || "🎒", 10);
    const description = cleanText(body.description, 500);
    const price = Math.floor(Number(body.price));
    const stock = Math.floor(Number(body.stock));
    const active = body.active === false ? 0 : 1;
    const photo = validatePhotoData(body.photo || "");
    if (!Number.isInteger(price) || price < 0) throw httpError(400, "INVALID_PRICE", "Harga tidak valid.");
    if (!Number.isInteger(stock) || stock < 0) throw httpError(400, "INVALID_STOCK", "Stok tidak valid.");

    try {
      db.prepare(`
        INSERT INTO catalog (name, category, icon, description, price, stock, active, photo)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(name, category, icon, description, price, stock, active, photo);
    } catch (err) {
      if (String(err.message).includes("UNIQUE")) {
        throw httpError(409, "DUPLICATE_NAME", "Nama alat sudah digunakan.");
      }
      throw err;
    }

    return sendJson(res, 201, { item: db.prepare("SELECT * FROM catalog WHERE id = last_insert_rowid()").get() });
  }

  const catalogMatch = pathname.match(/^\/api\/admin\/catalog\/(\d+)$/);
  if (catalogMatch && ["PATCH", "DELETE"].includes(method)) {
    requireAdmin(req);
    const catalogId = Number(catalogMatch[1]);
    const existing = db.prepare("SELECT * FROM catalog WHERE id = ?").get(catalogId);
    if (!existing) throw httpError(404, "NOT_FOUND", "Alat tidak ditemukan.");

    if (method === "PATCH") {
      const body = await parseJsonBody(req, 3 * 1024 * 1024);
      const name = cleanText(body.name ?? existing.name, 120);
      const category = cleanText(body.category ?? existing.category, 60);
      const icon = cleanText(body.icon ?? existing.icon, 10) || "🎒";
      const description = cleanText(body.description ?? existing.description, 500);
      const price = Math.floor(Number(body.price ?? existing.price));
      const stock = Math.floor(Number(body.stock ?? existing.stock));
      const active = body.active === undefined ? existing.active : (body.active ? 1 : 0);
      const photo = body.photo === undefined ? existing.photo : validatePhotoData(body.photo || "");

      if (name.length < 2) throw httpError(400, "INVALID_NAME", "Nama alat wajib diisi.");
      if (!Number.isInteger(price) || price < 0) throw httpError(400, "INVALID_PRICE", "Harga tidak valid.");
      if (!Number.isInteger(stock) || stock < 0) throw httpError(400, "INVALID_STOCK", "Stok tidak valid.");

      try {
        db.prepare(`
          UPDATE catalog
          SET name=?, category=?, icon=?, description=?, price=?, stock=?, active=?, photo=?, updated_at=datetime('now')
          WHERE id=?
        `).run(name, category, icon, description, price, stock, active, photo, catalogId);
      } catch (err) {
        if (String(err.message).includes("UNIQUE")) {
          throw httpError(409, "DUPLICATE_NAME", "Nama alat sudah digunakan.");
        }
        throw err;
      }

      return sendJson(res, 200, { item: db.prepare("SELECT * FROM catalog WHERE id = ?").get(catalogId) });
    }

    const refs = Number(db.prepare("SELECT COUNT(*) AS c FROM rental_items WHERE catalog_id = ?").get(catalogId).c);
    if (refs > 0) throw httpError(409, "HAS_HISTORY", "Alat sudah memiliki riwayat transaksi. Nonaktifkan alat agar aman dari penghapusan.");
    db.prepare("DELETE FROM catalog WHERE id = ?").run(catalogId);
    return sendJson(res, 200, { ok: true });
  }

  if (method === "PATCH" && pathname.startsWith("/api/admin/rentals/")) {
    requireAdmin(req);
    const match = pathname.match(/^\/api\/admin\/rentals\/(\d+)\/status$/);
    if (!match) throw httpError(404, "NOT_FOUND", "Endpoint tidak ditemukan.");
    const rentalId = Number(match[1]);
    const body = await parseJsonBody(req, 64 * 1024);
    const nextStatus = cleanText(body.status, 30);
    if (!["Dipinjam", "Diperpanjang", "Dikembalikan"].includes(nextStatus)) {
      throw httpError(400, "INVALID_STATUS", "Status tidak valid.");
    }

    transaction(() => {
      const rental = db.prepare("SELECT * FROM rentals WHERE id = ?").get(rentalId);
      if (!rental) throw httpError(404, "NOT_FOUND", "Transaksi tidak ditemukan.");
      if (rental.status === nextStatus) return;

      const items = db.prepare(`
        SELECT catalog_id AS catalogId, quantity
        FROM rental_items
        WHERE rental_id = ?
      `).all(rentalId);

      const addStock = db.prepare(`
        UPDATE catalog SET stock = stock + ?, updated_at=datetime('now') WHERE id = ?
      `);
      const takeStock = db.prepare(`
        UPDATE catalog SET stock = stock - ?, updated_at=datetime('now')
        WHERE id = ? AND stock >= ?
      `);

      if (rental.status !== "Dikembalikan" && nextStatus === "Dikembalikan") {
        for (const item of items) addStock.run(item.quantity, item.catalogId);
        db.prepare(`
          UPDATE rentals SET status=?, returned_at=datetime('now') WHERE id=?
        `).run(nextStatus, rentalId);
      } else if (rental.status === "Dikembalikan" && nextStatus !== "Dikembalikan") {
        for (const item of items) {
          const result = takeStock.run(item.quantity, item.catalogId, item.quantity);
          if (result.changes !== 1) {
            throw httpError(409, "STOCK_INSUFFICIENT", "Stok tidak cukup untuk mengaktifkan kembali transaksi.");
          }
        }
        db.prepare(`
          UPDATE rentals SET status=?, returned_at=NULL WHERE id=?
        `).run(nextStatus, rentalId);
      } else {
        db.prepare("UPDATE rentals SET status=? WHERE id=?").run(nextStatus, rentalId);
      }
    });

    return sendJson(res, 200, { ok: true });
  }

  if (method === "PATCH" && pathname.startsWith("/api/admin/users/")) {
    requireAdmin();
    const match = pathname.match(/^\/api\/admin\/users\/(\d+)\/active$/);
    if (!match) throw httpError(404, "NOT_FOUND", "Endpoint tidak ditemukan.");
    const userId = Number(match[1]);
    const body = await parseJsonBody(req, 32 * 1024);
    const active = body.active ? 1 : 0;
    const result = db.prepare("UPDATE users SET active=? WHERE id=?").run(active, userId);
    if (result.changes !== 1) throw httpError(404, "NOT_FOUND", "Customer tidak ditemukan.");
    return sendJson(res, 200, { ok: true });
  }

  // ADMIN MANAGEMENT
  if (method === "GET" && pathname === "/api/admin/admins") {
    requireDefaultAdmin(req);
    return sendJson(res, 200, {
      admins: db.prepare(`
        SELECT id, name, email, role, is_default AS isDefault, active,
               created_at AS createdAt, updated_at AS updatedAt
        FROM admin_users ORDER BY id
      `).all()
    });
  }

  if (method === "POST" && pathname === "/api/admin/admins") {
    requireDefaultAdmin(req);
    const body = await parseJsonBody(req, 128 * 1024);
    const name = cleanText(body.name, 100);
    const email = cleanEmail(body.email);
    const password = body.password;
    if (name.length < 2 || !email || !validatePassword(password)) {
      throw httpError(400, "INVALID_ADMIN", "Nama, email, dan password admin tidak valid.");
    }
    try {
      db.prepare(`
        INSERT INTO admin_users (name, email, password_hash, role, is_default, active)
        VALUES (?, ?, ?, 'admin', 0, 1)
      `).run(name, email, hashPassword(password));
    } catch (err) {
      if (String(err.message).includes("UNIQUE")) {
        throw httpError(409, "DUPLICATE_EMAIL", "Email admin sudah digunakan.");
      }
      throw err;
    }
    return sendJson(res, 201, {
      admin: db.prepare(`
        SELECT id, name, email, role, is_default AS isDefault, active, created_at AS createdAt, updated_at AS updatedAt
        FROM admin_users WHERE email=?
      `).get(email)
    });
  }

  if (method === "PATCH" && pathname.match(/^\/api\/admin\/admins\/\d+$/)) {
    const auth = requireDefaultAdmin(req);
    const id = Number(pathname.split("/").pop());
    const existing = db.prepare("SELECT * FROM admin_users WHERE id=?").get(id);
    if (!existing) throw httpError(404, "NOT_FOUND", "Admin tidak ditemukan.");

    const body = await parseJsonBody(req, 128 * 1024);
    const active = body.active === undefined ? existing.active : (body.active ? 1 : 0);
    const name = cleanText(body.name ?? existing.name, 100);
    const role = ["admin", "superadmin"].includes(body.role) ? body.role : existing.role;

    if (Number(existing.is_default) === 1) {
      throw httpError(400, "DEFAULT_ADMIN_PROTECTED", "Admin default tidak dapat dinonaktifkan atau diubah melalui menu admin.");
    }

    const leavingSuperadmin = existing.role === "superadmin" && (active === 0 || role !== "superadmin");
    if (leavingSuperadmin) {
      const activeSuperadmins = Number(
        db.prepare("SELECT COUNT(*) AS c FROM admin_users WHERE role='superadmin' AND active=1").get().c
      );
      if (activeSuperadmins <= 1) {
        throw httpError(400, "LAST_SUPERADMIN", "Minimal satu superadmin aktif harus tetap tersedia.");
      }
    }

    db.prepare(`
      UPDATE admin_users SET name=?, role=?, active=?, updated_at=datetime('now') WHERE id=?
    `).run(name, role, active, id);

    return sendJson(res, 200, { ok: true });
  }

  if (method === "POST" && pathname === "/api/admin/change-password") {
    const auth = requireDefaultAdmin(req);
    const body = await parseJsonBody(req, 128 * 1024);
    const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
    const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";

    if (!currentPassword) {
      throw httpError(400, "CURRENT_PASSWORD_REQUIRED", "Password lama wajib diisi.");
    }

    const admin = db.prepare("SELECT password_hash FROM admin_users WHERE id=? AND is_default=1 AND active=1").get(auth.id);

    // Password lama selalu diverifikasi sebelum password baru dapat disimpan.
    if (!admin || !verifyPassword(currentPassword, admin.password_hash)) {
      throw httpError(401, "INVALID_CURRENT_PASSWORD", "Password lama salah.");
    }

    if (!validatePassword(newPassword)) {
      throw httpError(400, "INVALID_NEW_PASSWORD", "Password baru minimal 8 karakter.");
    }

    if (verifyPassword(newPassword, admin.password_hash)) {
      throw httpError(400, "PASSWORD_UNCHANGED", "Password baru harus berbeda dari password lama.");
    }

    db.prepare(`
      UPDATE admin_users SET password_hash=?, updated_at=datetime('now') WHERE id=?
    `).run(hashPassword(newPassword), auth.id);

    // Revoke all other admin sessions for this account for safety.
    db.prepare("DELETE FROM sessions WHERE admin_id=?").run(auth.id);
    const token = newSession({ adminId: auth.id });
    setSessionCookie(res, token);
    return sendJson(res, 200, { ok: true });
  }

  throw httpError(404, "NOT_FOUND", "Endpoint tidak ditemukan.");
}

async function requestHandler(req, res) {
  Object.assign(res, { _securityHeadersApplied: true });

  try {
    for (const [k, v] of Object.entries(securityHeaders())) res.setHeader(k, v);

    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (req.method === "HEAD") {
      if (url.pathname.startsWith("/api/")) return sendText(res, 404, "");
      return serveStatic(req, res, url.pathname);
    }

    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    if (req.method !== "GET") throw httpError(405, "METHOD_NOT_ALLOWED", "Method tidak diizinkan.");
    serveStatic(req, res, url.pathname);
  } catch (err) {
    const status = err.status || 500;
    const payload = {
      error: err.code || "SERVER_ERROR",
      message: status >= 500 ? "Terjadi kesalahan pada server." : err.message
    };
    if (err.details) payload.details = err.details;
    if (status >= 500) console.error(err);
    sendJson(res, status, payload);
  }
}

const server = http.createServer(requestHandler);
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Summit Base berjalan di http://localhost:${PORT}`);
  console.log(`Database: ${DB_FILE}`);
  console.log(`Environment: ${NODE_ENV}`);
});
