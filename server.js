const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { URL } = require("node:url");
const { MongoClient, ServerApiVersion } = require("mongodb");

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
const PORT = Number(process.env.PORT || 3000);
const NODE_ENV = process.env.NODE_ENV || "development";
const SESSION_TTL_DAYS = Math.max(1, Number(process.env.SESSION_TTL_DAYS || 7));
const COOKIE_SECURE = String(process.env.COOKIE_SECURE || (NODE_ENV === "production" ? "true" : "false")) === "true";
const TRUST_PROXY = String(process.env.TRUST_PROXY || (NODE_ENV === "production" ? "true" : "false")).toLowerCase() === "true";

const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || "admin@summitbase.local").trim().toLowerCase();
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || (NODE_ENV === "production" ? "" : "Admin!ChangeMe123"));
const ADMIN_NAME = String(process.env.ADMIN_NAME || "Summit Base Admin").trim();
const MONGODB_URI = String(process.env.MONGODB_URI || "").trim();
const MONGODB_DB = String(process.env.MONGODB_DB || "summit_base").trim();

if (NODE_ENV === "production" && (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 12)) {
  throw new Error("Production requires ADMIN_PASSWORD with at least 12 characters.");
}
if (!MONGODB_URI) {
  throw new Error("MONGODB_URI is required. Set it in .env locally or Vercel Environment Variables in production.");
}
if (!MONGODB_DB || !/^[A-Za-z0-9_-]{1,64}$/.test(MONGODB_DB)) {
  throw new Error("MONGODB_DB must be 1-64 characters using letters, numbers, underscore, or hyphen.");
}

const client = new MongoClient(MONGODB_URI, {
  maxPoolSize: 10,
  minPoolSize: 0,
  serverSelectionTimeoutMS: 10000,
  connectTimeoutMS: 10000,
  socketTimeoutMS: 30000,
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true
  }
});

const mongoDb = client.db(MONGODB_DB);
let initializationPromise = null;

function nowIso() {
  return new Date().toISOString();
}

function addDaysIso(days) {
  return new Date(Date.now() + Number(days || 0) * 86400000).toISOString();
}

function addDaysDateOnly(dateValue, days) {
  const base = new Date(`${dateValue}T00:00:00Z`);
  if (!dateValue || Number.isNaN(base.getTime())) return "";
  base.setUTCDate(base.getUTCDate() + Number(days || 0));
  return base.toISOString().slice(0, 10);
}

function dateOnly(value) {
  const s = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
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

function parseJsonBody(req, maxBytes = 4 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let data = "";
    let size = 0;
    let settled = false;

    req.on("data", chunk => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBytes) {
        settled = true;
        reject(httpError(413, "PAYLOAD_TOO_LARGE", "Data terlalu besar."));
        req.destroy();
        return;
      }
      data += chunk.toString("utf8");
    });
    req.on("end", () => {
      if (settled) return;
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(httpError(400, "INVALID_JSON", "Format JSON tidak valid."));
      }
    });
    req.on("error", err => {
      if (!settled) reject(err);
    });
  });
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  const out = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const raw = part.slice(idx + 1).trim();
    try {
      out[key] = decodeURIComponent(raw);
    } catch {
      out[key] = raw;
    }
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

function mongoOptions(session) {
  return session ? { session } : {};
}

async function getNextId(sequenceName, session = null) {
  const result = await mongoDb.collection("counters").findOneAndUpdate(
    { _id: sequenceName },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after", ...mongoOptions(session) }
  );
  const doc = result?.value ?? result;
  return Number(doc.seq);
}

async function withTransaction(work) {
  const session = client.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

async function ensureIndexesAndSeed() {
  await client.connect();
  await mongoDb.command({ ping: 1 });

  await Promise.all([
    mongoDb.collection("users").createIndex({ email: 1 }, { unique: true, name: "uq_users_email" }),
    mongoDb.collection("admin_users").createIndex({ email: 1 }, { unique: true, name: "uq_admin_email" }),
    mongoDb.collection("sessions").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "ttl_sessions" }),
    mongoDb.collection("catalog").createIndex({ name: 1 }, { unique: true, name: "uq_catalog_name" }),
    mongoDb.collection("rentals").createIndex({ userId: 1, id: -1 }, { name: "idx_rentals_user" }),
    mongoDb.collection("rentals").createIndex({ returnDate: 1 }, { name: "idx_rentals_return" }),
    mongoDb.collection("rental_extensions").createIndex({ rentalId: 1, id: -1 }, { name: "idx_extensions_rental" }),
    mongoDb.collection("rental_extensions").createIndex({ status: 1 }, { name: "idx_extensions_status" })
  ]);

  const adminCol = mongoDb.collection("admin_users");
  let admins = await adminCol.find({}).sort({ id: 1 }).toArray();

  if (!admins.length) {
    const id = await getNextId("admin_users");
    await adminCol.insertOne({
      id,
      name: ADMIN_NAME,
      email: ADMIN_EMAIL,
      passwordHash: hashPassword(ADMIN_PASSWORD),
      role: "superadmin",
      isDefault: true,
      active: true,
      createdAt: nowIso(),
      updatedAt: nowIso()
    });
    admins = await adminCol.find({}).sort({ id: 1 }).toArray();
  }

  const selectedDefault =
    admins.find(x => String(x.email).toLowerCase() === ADMIN_EMAIL) || admins[0];

  await adminCol.updateMany({}, { $set: { isDefault: false } });
  await adminCol.updateOne({ id: selectedDefault.id }, { $set: { isDefault: true } });

  const catalogCol = mongoDb.collection("catalog");
  const count = await catalogCol.countDocuments();
  if (!count) {
    const seeds = [
      ["Tenda 2–3 Orang", "Camping", "⛺", "Tenda ringkas untuk camping dan pendakian singkat.", 25000, 5],
      ["Carrier 45L", "Carrier", "🎒", "Nyaman membawa perlengkapan utama untuk perjalananmu.", 20000, 8],
      ["Kompor Portable", "Masak", "🔥", "Teman masak yang ringan dan praktis untuk di camp.", 10000, 10],
      ["Sleeping Bag", "Istirahat", "🛏️", "Menjaga tubuh tetap hangat saat bermalam di gunung.", 15000, 7]
    ];
    for (const row of seeds) {
      await catalogCol.insertOne({
        id: await getNextId("catalog"),
        name: row[0],
        category: row[1],
        icon: row[2],
        description: row[3],
        price: row[4],
        stock: row[5],
        active: true,
        photo: "",
        createdAt: nowIso(),
        updatedAt: nowIso()
      });
    }
  }
}

function initialize() {
  if (!initializationPromise) {
    initializationPromise = ensureIndexesAndSeed().catch(err => {
      initializationPromise = null;
      throw err;
    });
  }
  return initializationPromise;
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
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const key = `${forwarded || req.socket?.remoteAddress || "unknown"}:${bucket}`;
  const now = Date.now();
  let row = rateBuckets.get(key);
  if (!row || now - row.start > windowMs) row = { start: now, count: 0 };
  row.count += 1;
  rateBuckets.set(key, row);
  if (row.count > limit) {
    throw httpError(429, "RATE_LIMITED", "Terlalu banyak permintaan. Coba lagi sebentar.");
  }
}

setInterval(() => {
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
    ...securityHeaders(),
    ...extraHeaders
  });
  res.end(body);
}

function sendText(res, status, body, contentType = "text/plain; charset=utf-8", extraHeaders = {}) {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    ...securityHeaders(),
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
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8"
};

function serveStatic(req, res, pathname) {
  let requested = pathname === "/" ? "/index.html" : pathname;
  if (requested === "/admin") requested = "/admin.html";
  if (requested === "/customer") requested = "/customer.html";

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

async function newSession({ userId = null, adminId = null }, session = null) {
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  await mongoDb.collection("sessions").insertOne({
    _id: tokenHash,
    tokenHash,
    userId,
    adminId,
    expiresAt: new Date(Date.now() + SESSION_TTL_DAYS * 86400000),
    createdAt: nowIso()
  }, mongoOptions(session));
  return token;
}

async function currentAuth(req) {
  const token = parseCookies(req).sb_session;
  if (!token) return null;

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const session = await mongoDb.collection("sessions").findOne({
    _id: tokenHash,
    expiresAt: { $gt: new Date() }
  });
  if (!session) return null;

  if (session.userId) {
    const user = await mongoDb.collection("users").findOne({ id: session.userId });
    if (!user || !user.active) return null;
    if (user.approvalStatus === "approved") {
      return {
        kind: "customer",
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        approvalStatus: "approved",
        rejectionReason: ""
      };
    }
    if (["pending", "rejected"].includes(user.approvalStatus)) {
      return {
        kind: "customer_status",
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        approvalStatus: user.approvalStatus,
        rejectionReason: user.rejectionReason || ""
      };
    }
  }

  if (session.adminId) {
    const admin = await mongoDb.collection("admin_users").findOne({ id: session.adminId });
    if (!admin || !admin.active) return null;
    return {
      kind: "admin",
      id: admin.id,
      name: admin.name,
      email: admin.email,
      role: admin.role,
      isDefault: Boolean(admin.isDefault)
    };
  }

  return null;
}

async function requireCustomer(req) {
  const auth = await currentAuth(req);
  if (!auth || auth.kind !== "customer") throw httpError(401, "AUTH_REQUIRED", "Silakan login sebagai customer.");
  return auth;
}

async function requireAdmin(req, superOnly = false) {
  const auth = await currentAuth(req);
  if (!auth || auth.kind !== "admin") throw httpError(401, "AUTH_REQUIRED", "Silakan login sebagai admin.");
  if (superOnly && auth.role !== "superadmin") throw httpError(403, "FORBIDDEN", "Akses superadmin diperlukan.");
  return auth;
}

async function requireDefaultAdmin(req) {
  const auth = await requireAdmin(req);
  if (!auth.isDefault) {
    throw httpError(403, "DEFAULT_ADMIN_ONLY", "Hanya akun admin default yang dapat mengelola akun admin lain.");
  }
  return auth;
}

function checkSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return;

  const useForwarded = TRUST_PROXY;
  const first = (value, fallback) => {
    const item = String(value || "").split(",")[0].trim();
    return item || fallback;
  };
  const host = useForwarded ? first(req.headers["x-forwarded-host"], req.headers.host) : req.headers.host;
  const proto = useForwarded
    ? first(req.headers["x-forwarded-proto"], COOKIE_SECURE ? "https" : "http")
    : (COOKIE_SECURE ? "https" : "http");

  try {
    const expected = `${proto}://${host}`;
    if (origin !== expected) throw httpError(403, "BAD_ORIGIN", "Origin request tidak valid.");
  } catch (err) {
    if (err.code) throw err;
    throw httpError(403, "BAD_ORIGIN", "Origin request tidak valid.");
  }
}

function publicCatalogFilter() {
  return { active: true };
}

async function publicCatalog() {
  return mongoDb.collection("catalog")
    .find(publicCatalogFilter(), { projection: { _id: 0, id: 1, name: 1, category: 1, icon: 1, description: 1, price: 1, stock: 1, active: 1, photo: 1 } })
    .sort({ id: -1 })
    .toArray();
}

async function adminCatalog() {
  return mongoDb.collection("catalog")
    .find({}, { projection: { _id: 0 } })
    .sort({ id: -1 })
    .toArray();
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

async function createRental(userId, payload, options = {}, session = null) {
  const startDate = dateOnly(payload.startDate);
  const returnDate = dateOnly(payload.returnDate);
  const days = daysInclusive(startDate, returnDate);
  if (!startDate || !returnDate || days < 1) throw httpError(400, "INVALID_DATES", "Tanggal mulai dan tanggal kembali tidak valid.");

  const today = nowIso().slice(0, 10);
  if (startDate < today) throw httpError(400, "START_IN_PAST", "Tanggal mulai tidak boleh di masa lalu.");

  const items = validateItems(payload.items);
  const resolved = [];
  let total = 0;
  const catalogCol = mongoDb.collection("catalog");

  for (const item of items) {
    const row = await catalogCol.findOne({ id: item.catalogId }, { projection: { _id: 0 }, ...mongoOptions(session) });
    if (!row || !row.active) throw httpError(409, "ITEM_UNAVAILABLE", `Alat dengan ID ${item.catalogId} tidak tersedia.`);
    if (item.quantity > row.stock) throw httpError(409, "STOCK_INSUFFICIENT", `Stok ${row.name} tidak mencukupi. Tersedia ${row.stock} unit.`);

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
  if (!["pending", "approved"].includes(approvalStatus)) throw httpError(400, "INVALID_APPROVAL", "Status persetujuan tidak valid.");

  const rentalId = await getNextId("rentals", session);
  await mongoDb.collection("rentals").insertOne({
    id: rentalId,
    userId,
    startDate,
    returnDate,
    days,
    totalPrice: total,
    status: "Dipinjam",
    approvalStatus,
    rejectionReason: "",
    approvedAt: approvalStatus === "approved" ? nowIso() : null,
    rejectedAt: null,
    createdAt: nowIso(),
    returnedAt: null,
    items: resolved.map(x => ({
      catalogId: x.catalogId,
      equipment: x.equipmentName,
      quantity: x.quantity,
      unitPrice: x.unitPrice,
      subtotal: x.subtotal
    }))
  }, mongoOptions(session));

  if (reserveStock) {
    for (const item of resolved) {
      const result = await catalogCol.updateOne(
        { id: item.catalogId, stock: { $gte: item.quantity }, active: true },
        { $inc: { stock: -item.quantity }, $set: { updatedAt: nowIso() } },
        mongoOptions(session)
      );
      if (result.modifiedCount !== 1) {
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

async function latestExtensionMap(rentalIds) {
  if (!rentalIds.length) return new Map();
  const rows = await mongoDb.collection("rental_extensions")
    .find({ rentalId: { $in: rentalIds } }, { projection: { _id: 0 } })
    .sort({ id: -1 })
    .toArray();
  const map = new Map();
  for (const row of rows) if (!map.has(row.rentalId)) map.set(row.rentalId, row);
  return map;
}

function shapeExtension(ext) {
  if (!ext) return null;
  return {
    id: ext.id,
    additionalDays: ext.additionalDays,
    previousReturnDate: ext.previousReturnDate,
    requestedReturnDate: ext.requestedReturnDate,
    extraTotal: ext.extraTotal,
    status: ext.status,
    rejectionReason: ext.rejectionReason || "",
    createdAt: ext.createdAt,
    approvedAt: ext.approvedAt || null,
    rejectedAt: ext.rejectedAt || null
  };
}

async function customerRentals(userId) {
  const rentals = await mongoDb.collection("rentals").find({ userId }, { projection: { _id: 0 } }).sort({ id: -1 }).toArray();
  const extMap = await latestExtensionMap(rentals.map(r => r.id));
  return rentals.map(r => ({
    id: r.id,
    startDate: r.startDate,
    returnDate: r.returnDate,
    days: r.days,
    totalPrice: r.totalPrice,
    status: r.status,
    approvalStatus: r.approvalStatus,
    rejectionReason: r.rejectionReason || "",
    approvedAt: r.approvedAt || null,
    rejectedAt: r.rejectedAt || null,
    createdAt: r.createdAt,
    returnedAt: r.returnedAt || null,
    items: Array.isArray(r.items) ? r.items : [],
    extensionRequest: shapeExtension(extMap.get(r.id))
  }));
}

async function adminRentals() {
  const rentals = await mongoDb.collection("rentals").find({}, { projection: { _id: 0 } }).sort({ id: -1 }).toArray();
  const userIds = [...new Set(rentals.map(r => r.userId))];
  const users = await mongoDb.collection("users").find({ id: { $in: userIds } }, { projection: { _id: 0 } }).toArray();
  const usersById = new Map(users.map(u => [u.id, u]));
  const extMap = await latestExtensionMap(rentals.map(r => r.id));

  return rentals.map(r => {
    const u = usersById.get(r.userId) || {};
    return {
      id: r.id,
      startDate: r.startDate,
      returnDate: r.returnDate,
      days: r.days,
      totalPrice: r.totalPrice,
      status: r.status,
      approvalStatus: r.approvalStatus,
      rejectionReason: r.rejectionReason || "",
      approvedAt: r.approvedAt || null,
      rejectedAt: r.rejectedAt || null,
      createdAt: r.createdAt,
      returnedAt: r.returnedAt || null,
      userId: r.userId,
      userName: u.name || "-",
      userEmail: u.email || "-",
      userPhone: u.phone || "-",
      items: Array.isArray(r.items) ? r.items : [],
      extensionRequest: shapeExtension(extMap.get(r.id))
    };
  });
}

function effectiveRentalStatus(rental) {
  if (rental.status === "Dikembalikan") return "Dikembalikan";
  const today = nowIso().slice(0, 10);
  return rental.returnDate < today ? "Terlambat" : rental.status;
}

async function adminStats() {
  const [users, pendingAccounts, rentals, pendingExtensions, tools] = await Promise.all([
    mongoDb.collection("users").countDocuments({ active: true, approvalStatus: "approved" }),
    mongoDb.collection("users").countDocuments({ approvalStatus: "pending" }),
    adminRentals(),
    mongoDb.collection("rental_extensions").countDocuments({ status: "pending" }),
    mongoDb.collection("catalog").countDocuments({ active: true })
  ]);

  const active = rentals.filter(r => r.approvalStatus === "approved" && r.status !== "Dikembalikan");
  const today = nowIso().slice(0, 10);
  const dueToday = active.filter(r => r.returnDate === today);
  const overdue = active.filter(r => r.returnDate < today);
  const pendingRentals = rentals.filter(r => r.approvalStatus === "pending");
  return {
    totalAccounts: Number(users),
    activeRentals: active.length,
    dueToday: dueToday.length,
    overdueRentals: overdue.length,
    newOrders: Number(pendingAccounts) + pendingRentals.length + Number(pendingExtensions),
    pendingExtensions: Number(pendingExtensions),
    activeTools: Number(tools)
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
  if (bytes > 1_500_000) throw httpError(413, "PHOTO_TOO_LARGE", "Foto terlalu besar. Gunakan ukuran maksimal sekitar 1.5 MB.");
  return value;
}

function isDuplicateKey(err) {
  return Boolean(err && (err.code === 11000 || String(err.message || "").includes("E11000")));
}

async function handleApi(req, res, url) {
  await initialize();

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
    return sendJson(res, 200, { catalog: await publicCatalog() });
  }

  if (method === "GET" && pathname === "/api/health") {
    return sendJson(res, 200, { ok: true, time: nowIso(), database: "mongodb" });
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

    const rentalResult = await withTransaction(async session => {
      const userCol = mongoDb.collection("users");
      const exists = await userCol.findOne({ email }, { ...mongoOptions(session) });
      if (exists) throw httpError(409, "EMAIL_EXISTS", "Email sudah terdaftar.");

      const userId = await getNextId("users", session);
      await userCol.insertOne({
        id: userId,
        name,
        email,
        phone,
        passwordHash: hashPassword(password),
        active: true,
        approvalStatus: "pending",
        rejectionReason: "",
        createdAt: nowIso()
      }, mongoOptions(session));

      const rental = await createRental(userId, body, { approvalStatus: "pending", reserveStock: false }, session);
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

    const user = await mongoDb.collection("users").findOne({ email });
    if (!user || !verifyPassword(password, user.passwordHash)) throw httpError(401, "INVALID_LOGIN", "Email atau password salah.");
    if (!user.active) throw httpError(403, "ACCOUNT_DISABLED", "Akun customer dinonaktifkan admin.");

    const token = await newSession({ userId: user.id });
    setSessionCookie(res, token);
    return sendJson(res, 200, {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        approvalStatus: user.approvalStatus,
        rejectionReason: user.rejectionReason || ""
      }
    });
  }

  if (method === "POST" && pathname === "/api/auth/logout") {
    const token = parseCookies(req).sb_session;
    if (token) {
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      await mongoDb.collection("sessions").deleteOne({ _id: tokenHash });
    }
    clearSessionCookie(res);
    return sendJson(res, 200, { ok: true });
  }

  if (method === "GET" && pathname === "/api/me") {
    const auth = await currentAuth(req);
    if (!auth) return sendJson(res, 200, { authenticated: false });
    return sendJson(res, 200, {
      authenticated: true,
      ...auth,
      ...((auth.kind === "customer" || auth.kind === "customer_status") ? { rentals: await customerRentals(auth.id) } : {})
    });
  }

  if (method === "POST" && pathname === "/api/rentals") {
    const auth = await requireCustomer(req);
    const body = await parseJsonBody(req, 256 * 1024);
    const rental = await withTransaction(session => createRental(auth.id, body, { approvalStatus: "pending", reserveStock: false }, session));
    return sendJson(res, 201, { rental });
  }

  if (method === "GET" && pathname === "/api/rentals/mine") {
    const auth = await requireCustomer(req);
    return sendJson(res, 200, { rentals: await customerRentals(auth.id) });
  }

  if (method === "POST" && pathname.startsWith("/api/rentals/") && pathname.endsWith("/extend")) {
    const auth = await requireCustomer(req);
    const match = pathname.match(/^\/api\/rentals\/(\d+)\/extend$/);
    if (!match) throw httpError(404, "NOT_FOUND", "Endpoint tidak ditemukan.");
    const rentalId = Number(match[1]);
    const body = await parseJsonBody(req, 64 * 1024);
    const additionalDays = Math.floor(Number(body.additionalDays));
    if (!Number.isInteger(additionalDays) || additionalDays < 1 || additionalDays > 30) throw httpError(400, "INVALID_EXTENSION", "Perpanjangan harus 1 sampai 30 hari.");

    const result = await withTransaction(async session => {
      const rental = await mongoDb.collection("rentals").findOne({ id: rentalId, userId: auth.id }, { ...mongoOptions(session) });
      if (!rental) throw httpError(404, "NOT_FOUND", "Pesanan tidak ditemukan.");
      if (rental.approvalStatus !== "approved") throw httpError(409, "RENTAL_NOT_APPROVED", "Pesanan belum disetujui admin.");
      if (rental.status === "Dikembalikan") throw httpError(409, "ALREADY_RETURNED", "Pesanan yang sudah dikembalikan tidak dapat diperpanjang.");

      const pending = await mongoDb.collection("rental_extensions").findOne({ rentalId, status: "pending" }, { ...mongoOptions(session) });
      if (pending) throw httpError(409, "EXTENSION_PENDING", "Permintaan perpanjangan sebelumnya masih menunggu persetujuan admin.");

      const items = Array.isArray(rental.items) ? rental.items : [];
      if (!items.length) throw httpError(409, "NO_ITEMS", "Pesanan tidak memiliki item.");

      const extraTotal = items.reduce((sum, item) => sum + Number(item.unitPrice) * Number(item.quantity) * additionalDays, 0);
      const requestedReturnDate = addDaysDateOnly(rental.returnDate, additionalDays);
      const extensionId = await getNextId("rental_extensions", session);
      await mongoDb.collection("rental_extensions").insertOne({
        id: extensionId,
        rentalId,
        additionalDays,
        previousReturnDate: rental.returnDate,
        requestedReturnDate,
        extraTotal,
        status: "pending",
        rejectionReason: "",
        createdAt: nowIso(),
        approvedAt: null,
        rejectedAt: null
      }, mongoOptions(session));

      return {
        extensionId,
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

    const admin = await mongoDb.collection("admin_users").findOne({ email });
    if (!admin || !admin.active || !verifyPassword(password, admin.passwordHash)) throw httpError(401, "INVALID_LOGIN", "Email atau password salah.");

    const token = await newSession({ adminId: admin.id });
    setSessionCookie(res, token);
    return sendJson(res, 200, {
      admin: { id: admin.id, name: admin.name, email: admin.email, role: admin.role, isDefault: Boolean(admin.isDefault) }
    });
  }

  if (method === "POST" && pathname === "/api/admin/logout") {
    const auth = await requireAdmin(req);
    const token = parseCookies(req).sb_session;
    if (token) {
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      await mongoDb.collection("sessions").deleteOne({ _id: tokenHash });
    }
    clearSessionCookie(res);
    return sendJson(res, 200, { ok: true, adminId: auth.id });
  }

  if (method === "GET" && pathname === "/api/admin/me") {
    const auth = await currentAuth(req);
    if (!auth || auth.kind !== "admin") return sendJson(res, 200, { authenticated: false });
    return sendJson(res, 200, { authenticated: true, admin: auth });
  }

  // APPROVALS
  if (method === "PATCH" && /^\/api\/admin\/users\/\d+\/approval$/.test(pathname)) {
    await requireAdmin(req);
    const userId = Number(pathname.split("/")[4]);
    const body = await parseJsonBody(req, 32 * 1024);
    const next = cleanText(body.status, 20);
    const reason = cleanText(body.reason, 500);
    if (!["approved", "rejected"].includes(next)) throw httpError(400, "INVALID_APPROVAL", "Status persetujuan akun tidak valid.");
    if (next === "rejected" && reason.length < 3) throw httpError(400, "REJECTION_REASON_REQUIRED", "Alasan penolakan akun wajib diisi.");

    const result = await withTransaction(async session => {
      const userCol = mongoDb.collection("users");
      const user = await userCol.findOne({ id: userId }, mongoOptions(session));
      if (!user) throw httpError(404, "NOT_FOUND", "Customer tidak ditemukan.");

      if (next === "approved") {
        await userCol.updateOne({ id: userId }, { $set: { approvalStatus: "approved", rejectionReason: "", active: true } }, mongoOptions(session));
      } else {
        await userCol.updateOne({ id: userId }, { $set: { approvalStatus: "rejected", rejectionReason: reason } }, mongoOptions(session));
        await mongoDb.collection("rentals").updateMany(
          { userId, approvalStatus: "pending" },
          { $set: { approvalStatus: "rejected", rejectionReason: `Akun customer ditolak: ${reason}`, rejectedAt: nowIso() } },
          mongoOptions(session)
        );
      }
      return { approvalStatus: next, rejectionReason: next === "rejected" ? reason : "" };
    });

    return sendJson(res, 200, { ok: true, ...result });
  }

  if (method === "PATCH" && /^\/api\/admin\/rental-extensions\/\d+\/approval$/.test(pathname)) {
    await requireAdmin(req);
    const extensionId = Number(pathname.split("/")[4]);
    const body = await parseJsonBody(req, 32 * 1024);
    const next = cleanText(body.status, 20);
    const reason = cleanText(body.reason, 500);
    if (!["approved", "rejected"].includes(next)) throw httpError(400, "INVALID_APPROVAL", "Status persetujuan perpanjangan tidak valid.");
    if (next === "rejected" && reason.length < 3) throw httpError(400, "REJECTION_REASON_REQUIRED", "Alasan penolakan perpanjangan wajib diisi.");

    const result = await withTransaction(async session => {
      const extension = await mongoDb.collection("rental_extensions").findOne({ id: extensionId }, mongoOptions(session));
      if (!extension) throw httpError(404, "NOT_FOUND", "Permintaan perpanjangan tidak ditemukan.");
      if (extension.status !== "pending") throw httpError(409, "EXTENSION_ALREADY_DECIDED", "Permintaan perpanjangan ini sudah diproses.");

      const rental = await mongoDb.collection("rentals").findOne({ id: extension.rentalId }, mongoOptions(session));
      if (!rental) throw httpError(404, "NOT_FOUND", "Pesanan tidak ditemukan.");
      const user = await mongoDb.collection("users").findOne({ id: rental.userId }, mongoOptions(session));
      if (!user || rental.approvalStatus !== "approved" || user.approvalStatus !== "approved") {
        throw httpError(409, "ACCOUNT_OR_RENTAL_NOT_APPROVED", "Akun dan pesanan harus sudah disetujui.");
      }

      if (next === "approved") {
        if (rental.status === "Dikembalikan") throw httpError(409, "ALREADY_RETURNED", "Pesanan sudah dikembalikan.");
        if (rental.returnDate !== extension.previousReturnDate) throw httpError(409, "RENTAL_CHANGED", "Tanggal sewa berubah. Silakan minta customer mengajukan perpanjangan lagi.");

        await mongoDb.collection("rentals").updateOne(
          { id: rental.id, returnDate: extension.previousReturnDate },
          { $set: {
            returnDate: extension.requestedReturnDate,
            days: Number(rental.days) + Number(extension.additionalDays),
            totalPrice: Number(rental.totalPrice) + Number(extension.extraTotal),
            status: "Diperpanjang"
          } },
          mongoOptions(session)
        );
        await mongoDb.collection("rental_extensions").updateOne(
          { id: extensionId, status: "pending" },
          { $set: { status: "approved", rejectionReason: "", approvedAt: nowIso() } },
          mongoOptions(session)
        );
      } else {
        await mongoDb.collection("rental_extensions").updateOne(
          { id: extensionId, status: "pending" },
          { $set: { status: "rejected", rejectionReason: reason, rejectedAt: nowIso() } },
          mongoOptions(session)
        );
      }
      return { approvalStatus: next, rejectionReason: next === "rejected" ? reason : "" };
    });

    return sendJson(res, 200, { ok: true, ...result });
  }

  if (method === "PATCH" && /^\/api\/admin\/rentals\/\d+\/approval$/.test(pathname)) {
    await requireAdmin(req);
    const rentalId = Number(pathname.split("/")[4]);
    const body = await parseJsonBody(req, 32 * 1024);
    const next = cleanText(body.status, 20);
    const reason = cleanText(body.reason, 500);
    if (!["approved", "rejected"].includes(next)) throw httpError(400, "INVALID_APPROVAL", "Status persetujuan sewa tidak valid.");
    if (next === "rejected" && reason.length < 3) throw httpError(400, "REJECTION_REASON_REQUIRED", "Alasan penolakan pesanan wajib diisi.");

    const result = await withTransaction(async session => {
      const rentalCol = mongoDb.collection("rentals");
      const catalogCol = mongoDb.collection("catalog");
      const rental = await rentalCol.findOne({ id: rentalId }, mongoOptions(session));
      if (!rental) throw httpError(404, "NOT_FOUND", "Pesanan tidak ditemukan.");
      if (next === "approved") {
        if (rental.approvalStatus === "approved") return { approvalStatus: "approved", rejectionReason: "" };
        const user = await mongoDb.collection("users").findOne({ id: rental.userId }, mongoOptions(session));
        if (!user || user.approvalStatus !== "approved") throw httpError(409, "ACCOUNT_NOT_APPROVED", "Akun customer harus disetujui terlebih dahulu.");
        if (rental.startDate < nowIso().slice(0, 10)) throw httpError(409, "START_DATE_PASSED", "Tanggal mulai sewa sudah lewat. Minta customer membuat pesanan baru.");

        for (const item of Array.isArray(rental.items) ? rental.items : []) {
          const result = await catalogCol.updateOne(
            { id: item.catalogId, stock: { $gte: Number(item.quantity) }, active: true },
            { $inc: { stock: -Number(item.quantity) }, $set: { updatedAt: nowIso() } },
            mongoOptions(session)
          );
          if (result.modifiedCount !== 1) throw httpError(409, "STOCK_INSUFFICIENT", `Stok ${item.equipment} tidak mencukupi untuk menyetujui pesanan.`);
        }

        await rentalCol.updateOne(
          { id: rentalId, approvalStatus: { $ne: "approved" } },
          { $set: { approvalStatus: "approved", rejectionReason: "", approvedAt: nowIso(), rejectedAt: null } },
          mongoOptions(session)
        );
        return { approvalStatus: "approved", rejectionReason: "" };
      }

      if (rental.approvalStatus === "approved") throw httpError(409, "ALREADY_APPROVED", "Pesanan yang sudah disetujui tidak dapat ditolak dari menu persetujuan.");
      await rentalCol.updateOne(
        { id: rentalId, approvalStatus: { $ne: "approved" } },
        { $set: { approvalStatus: "rejected", rejectionReason: reason, rejectedAt: nowIso() } },
        mongoOptions(session)
      );
      return { approvalStatus: "rejected", rejectionReason: reason };
    });

    return sendJson(res, 200, { ok: true, ...result });
  }

  // ADMIN DATA
  if (method === "GET" && pathname === "/api/admin/dashboard") {
    await requireAdmin(req);
    const [stats, rentals, catalog, users] = await Promise.all([
      adminStats(),
      adminRentals(),
      adminCatalog(),
      mongoDb.collection("users").find({}, { projection: { _id: 0, id: 1, name: 1, email: 1, phone: 1, active: 1, approvalStatus: 1, rejectionReason: 1, createdAt: 1 } }).sort({ id: -1 }).toArray()
    ]);
    return sendJson(res, 200, { stats, rentals, catalog, users });
  }

  if (method === "GET" && pathname === "/api/admin/catalog") {
    await requireAdmin(req);
    return sendJson(res, 200, { catalog: await adminCatalog() });
  }

  if (method === "POST" && pathname === "/api/admin/catalog") {
    await requireAdmin(req);
    const body = await parseJsonBody(req, 3 * 1024 * 1024);
    const name = cleanText(body.name, 120);
    const category = cleanText(body.category || "Alat", 60);
    const icon = cleanText(body.icon || "🎒", 10);
    const description = cleanText(body.description, 500);
    const price = Math.floor(Number(body.price));
    const stock = Math.floor(Number(body.stock));
    const active = body.active === false ? false : true;
    const photo = validatePhotoData(body.photo || "");
    if (name.length < 2) throw httpError(400, "INVALID_NAME", "Nama alat wajib diisi.");
    if (!Number.isInteger(price) || price < 0) throw httpError(400, "INVALID_PRICE", "Harga tidak valid.");
    if (!Number.isInteger(stock) || stock < 0) throw httpError(400, "INVALID_STOCK", "Stok tidak valid.");

    const item = {
      id: await getNextId("catalog"), name, category, icon, description, price, stock, active, photo,
      createdAt: nowIso(), updatedAt: nowIso()
    };
    try {
      await mongoDb.collection("catalog").insertOne(item);
    } catch (err) {
      if (isDuplicateKey(err)) throw httpError(409, "DUPLICATE_NAME", "Nama alat sudah digunakan.");
      throw err;
    }
    const created = await mongoDb.collection("catalog").findOne({ id: item.id }, { projection: { _id: 0 } });
    return sendJson(res, 201, { item: created });
  }

  const catalogMatch = pathname.match(/^\/api\/admin\/catalog\/(\d+)$/);
  if (catalogMatch && ["PATCH", "DELETE"].includes(method)) {
    await requireAdmin(req);
    const catalogId = Number(catalogMatch[1]);
    const catalogCol = mongoDb.collection("catalog");
    const existing = await catalogCol.findOne({ id: catalogId }, { projection: { _id: 0 } });
    if (!existing) throw httpError(404, "NOT_FOUND", "Alat tidak ditemukan.");

    if (method === "PATCH") {
      const body = await parseJsonBody(req, 3 * 1024 * 1024);
      const name = cleanText(body.name ?? existing.name, 120);
      const category = cleanText(body.category ?? existing.category, 60);
      const icon = cleanText(body.icon ?? existing.icon, 10) || "🎒";
      const description = cleanText(body.description ?? existing.description, 500);
      const price = Math.floor(Number(body.price ?? existing.price));
      const stock = Math.floor(Number(body.stock ?? existing.stock));
      const active = body.active === undefined ? Boolean(existing.active) : Boolean(body.active);
      const photo = body.photo === undefined ? String(existing.photo || "") : validatePhotoData(body.photo || "");
      if (name.length < 2) throw httpError(400, "INVALID_NAME", "Nama alat wajib diisi.");
      if (!Number.isInteger(price) || price < 0) throw httpError(400, "INVALID_PRICE", "Harga tidak valid.");
      if (!Number.isInteger(stock) || stock < 0) throw httpError(400, "INVALID_STOCK", "Stok tidak valid.");

      try {
        await catalogCol.updateOne({ id: catalogId }, { $set: { name, category, icon, description, price, stock, active, photo, updatedAt: nowIso() } });
      } catch (err) {
        if (isDuplicateKey(err)) throw httpError(409, "DUPLICATE_NAME", "Nama alat sudah digunakan.");
        throw err;
      }
      const updated = await catalogCol.findOne({ id: catalogId }, { projection: { _id: 0 } });
      return sendJson(res, 200, { item: updated });
    }

    const refs = await mongoDb.collection("rentals").countDocuments({ "items.catalogId": catalogId });
    if (refs > 0) throw httpError(409, "HAS_HISTORY", "Alat sudah memiliki riwayat transaksi. Nonaktifkan alat agar aman dari penghapusan.");
    await catalogCol.deleteOne({ id: catalogId });
    return sendJson(res, 200, { ok: true });
  }

  if (method === "PATCH" && pathname.startsWith("/api/admin/rentals/")) {
    await requireAdmin(req);
    const match = pathname.match(/^\/api\/admin\/rentals\/(\d+)\/status$/);
    if (!match) throw httpError(404, "NOT_FOUND", "Endpoint tidak ditemukan.");
    const rentalId = Number(match[1]);
    const body = await parseJsonBody(req, 64 * 1024);
    const nextStatus = cleanText(body.status, 30);
    if (!["Dipinjam", "Diperpanjang", "Dikembalikan"].includes(nextStatus)) throw httpError(400, "INVALID_STATUS", "Status tidak valid.");

    await withTransaction(async session => {
      const rentalCol = mongoDb.collection("rentals");
      const catalogCol = mongoDb.collection("catalog");
      const rental = await rentalCol.findOne({ id: rentalId }, mongoOptions(session));
      if (!rental) throw httpError(404, "NOT_FOUND", "Transaksi tidak ditemukan.");
      if (rental.status === nextStatus) return;

      const items = Array.isArray(rental.items) ? rental.items : [];
      if (rental.status !== "Dikembalikan" && nextStatus === "Dikembalikan") {
        for (const item of items) {
          await catalogCol.updateOne({ id: item.catalogId }, { $inc: { stock: Number(item.quantity) }, $set: { updatedAt: nowIso() } }, mongoOptions(session));
        }
        await rentalCol.updateOne({ id: rentalId }, { $set: { status: nextStatus, returnedAt: nowIso() } }, mongoOptions(session));
      } else if (rental.status === "Dikembalikan" && nextStatus !== "Dikembalikan") {
        for (const item of items) {
          const result = await catalogCol.updateOne(
            { id: item.catalogId, stock: { $gte: Number(item.quantity) }, active: true },
            { $inc: { stock: -Number(item.quantity) }, $set: { updatedAt: nowIso() } },
            mongoOptions(session)
          );
          if (result.modifiedCount !== 1) throw httpError(409, "STOCK_INSUFFICIENT", "Stok tidak cukup untuk mengaktifkan kembali transaksi.");
        }
        await rentalCol.updateOne({ id: rentalId }, { $set: { status: nextStatus, returnedAt: null } }, mongoOptions(session));
      } else {
        await rentalCol.updateOne({ id: rentalId }, { $set: { status: nextStatus } }, mongoOptions(session));
      }
    });

    return sendJson(res, 200, { ok: true });
  }

  if (method === "PATCH" && pathname.startsWith("/api/admin/users/")) {
    await requireAdmin(req);
    const match = pathname.match(/^\/api\/admin\/users\/(\d+)\/active$/);
    if (!match) throw httpError(404, "NOT_FOUND", "Endpoint tidak ditemukan.");
    const userId = Number(match[1]);
    const body = await parseJsonBody(req, 32 * 1024);
    const active = Boolean(body.active);
    const result = await mongoDb.collection("users").updateOne({ id: userId }, { $set: { active } });
    if (result.matchedCount !== 1) throw httpError(404, "NOT_FOUND", "Customer tidak ditemukan.");
    return sendJson(res, 200, { ok: true });
  }

  // ADMIN MANAGEMENT
  if (method === "GET" && pathname === "/api/admin/admins") {
    await requireDefaultAdmin(req);
    const admins = await mongoDb.collection("admin_users")
      .find({}, { projection: { _id: 0, id: 1, name: 1, email: 1, role: 1, isDefault: 1, active: 1, createdAt: 1, updatedAt: 1 } })
      .sort({ id: 1 }).toArray();
    return sendJson(res, 200, { admins });
  }

  if (method === "POST" && pathname === "/api/admin/admins") {
    await requireDefaultAdmin(req);
    const body = await parseJsonBody(req, 128 * 1024);
    const name = cleanText(body.name, 100);
    const email = cleanEmail(body.email);
    const password = body.password;
    if (name.length < 2 || !email || !validatePassword(password)) throw httpError(400, "INVALID_ADMIN", "Nama, email, dan password admin tidak valid.");

    const item = {
      id: await getNextId("admin_users"),
      name,
      email,
      passwordHash: hashPassword(password),
      role: "admin",
      isDefault: false,
      active: true,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    try {
      await mongoDb.collection("admin_users").insertOne(item);
    } catch (err) {
      if (isDuplicateKey(err)) throw httpError(409, "DUPLICATE_EMAIL", "Email admin sudah digunakan.");
      throw err;
    }
    const created = await mongoDb.collection("admin_users").findOne(
      { id: item.id },
      { projection: { _id: 0, id: 1, name: 1, email: 1, role: 1, isDefault: 1, active: 1, createdAt: 1, updatedAt: 1 } }
    );
    return sendJson(res, 201, { admin: created });
  }

  if (method === "PATCH" && /^\/api\/admin\/admins\/\d+$/.test(pathname)) {
    await requireDefaultAdmin(req);
    const id = Number(pathname.split("/").pop());
    const adminCol = mongoDb.collection("admin_users");
    const existing = await adminCol.findOne({ id });
    if (!existing) throw httpError(404, "NOT_FOUND", "Admin tidak ditemukan.");

    const body = await parseJsonBody(req, 128 * 1024);
    const active = body.active === undefined ? Boolean(existing.active) : Boolean(body.active);
    const name = cleanText(body.name ?? existing.name, 100);
    const role = ["admin", "superadmin"].includes(body.role) ? body.role : existing.role;
    if (Boolean(existing.isDefault)) throw httpError(400, "DEFAULT_ADMIN_PROTECTED", "Admin default tidak dapat dinonaktifkan atau diubah melalui menu admin.");

    const leavingSuperadmin = existing.role === "superadmin" && (!active || role !== "superadmin");
    if (leavingSuperadmin) {
      const activeSuperadmins = await adminCol.countDocuments({ role: "superadmin", active: true });
      if (activeSuperadmins <= 1) throw httpError(400, "LAST_SUPERADMIN", "Minimal satu superadmin aktif harus tetap tersedia.");
    }

    await adminCol.updateOne({ id }, { $set: { name, role, active, updatedAt: nowIso() } });
    return sendJson(res, 200, { ok: true });
  }

  if (method === "POST" && pathname === "/api/admin/change-password") {
    const auth = await requireDefaultAdmin(req);
    const body = await parseJsonBody(req, 128 * 1024);
    const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
    const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
    if (!currentPassword) throw httpError(400, "CURRENT_PASSWORD_REQUIRED", "Password lama wajib diisi.");

    const adminCol = mongoDb.collection("admin_users");
    const admin = await adminCol.findOne({ id: auth.id, isDefault: true, active: true });
    if (!admin || !verifyPassword(currentPassword, admin.passwordHash)) throw httpError(401, "INVALID_CURRENT_PASSWORD", "Password lama salah.");
    if (!validatePassword(newPassword)) throw httpError(400, "INVALID_NEW_PASSWORD", "Password baru minimal 8 karakter.");
    if (verifyPassword(newPassword, admin.passwordHash)) throw httpError(400, "PASSWORD_UNCHANGED", "Password baru harus berbeda dari password lama.");

    const result = await withTransaction(async session => {
      await adminCol.updateOne({ id: auth.id }, { $set: { passwordHash: hashPassword(newPassword), updatedAt: nowIso() } }, mongoOptions(session));
      await mongoDb.collection("sessions").deleteMany({ adminId: auth.id }, mongoOptions(session));
      return newSession({ adminId: auth.id }, session);
    });

    setSessionCookie(res, result);
    return sendJson(res, 200, { ok: true });
  }

  throw httpError(404, "NOT_FOUND", "Endpoint tidak ditemukan.");
}

async function requestHandler(req, res) {
  try {
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
    if (!res.headersSent) sendJson(res, status, payload);
    else res.end();
  }
}

module.exports = requestHandler;

if (require.main === module) {
  initialize()
    .then(() => {
      const server = http.createServer(requestHandler);
      server.listen(PORT, "0.0.0.0", () => {
        console.log(`Summit Base berjalan di http://localhost:${PORT}`);
        console.log(`MongoDB: ${MONGODB_DB}`);
        console.log(`Environment: ${NODE_ENV}`);
      });
    })
    .catch(err => {
      console.error("Gagal menginisialisasi MongoDB:", err);
      process.exit(1);
    });
}
