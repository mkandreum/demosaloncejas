import express from "express";
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { createServer as createViteServer } from "vite";
import path from "node:path";
import { google } from "googleapis";
import { GoogleGenAI, Type } from "@google/genai";
import { v4 as uuidv4 } from "uuid";
import rateLimit from "express-rate-limit";

import Database from "better-sqlite3";
import fs from "node:fs";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

let db: Database.Database;

interface Appointment {
  id: string;
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  startTime: string; // ISO
  endTime: string; // ISO
  status: "pending" | "attending" | "rescheduled" | "cancelled";
  eventId?: string; // Google Calendar Event ID
  massageType?: string;
}


const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;
const REDIRECT_URI = `${APP_URL}/api/auth/google/callback`;

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
const calendar = google.calendar({ version: "v3", auth: oauth2Client });
const gmail = google.gmail({ version: "v1", auth: oauth2Client });

// FIX: Persist refreshed tokens automatically so they don't expire after restart
oauth2Client.on('tokens', (newTokens) => {
  const current = (() => {
    const row = db.prepare("SELECT tokens FROM admin_auth WHERE id = 1").get() as any;
    return row ? JSON.parse(row.tokens) : null;
  })();
  if (current) {
    db.prepare("UPDATE admin_auth SET tokens = ? WHERE id = 1")
      .run(JSON.stringify({ ...current, ...newTokens }));
  }
});

// Setup Gemini
const ai = process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;

const ADMIN_API_KEY = process.env.ADMIN_API_KEY || "";

// Session store (SQLite persistent)
const sessions = {
  has: (sid: string): boolean => {
    if (!db) return false;
    const row = db.prepare("SELECT 1 FROM sessions WHERE id = ?").get(sid);
    return !!row;
  },
  get: (sid: string): { email: string } | undefined => {
    if (!db) return undefined;
    const row = db.prepare("SELECT email FROM sessions WHERE id = ?").get(sid) as { email: string } | undefined;
    return row;
  },
  set: (sid: string, data: { email: string }) => {
    if (!db) return;
    db.prepare("INSERT OR REPLACE INTO sessions (id, email, createdAt) VALUES (?, ?, ?)")
      .run(sid, data.email, new Date().toISOString());
  },
  delete: (sid: string) => {
    if (!db) return;
    db.prepare("DELETE FROM sessions WHERE id = ?").run(sid);
  }
};
const parseCookies = (cookieHeader?: string): Record<string, string> => {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach(c => {
    const eq = c.indexOf('=');
    if (eq > 0) cookies[c.slice(0, eq).trim()] = c.slice(eq + 1).trim();
  });
  return cookies;
};

// Rate limiters
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { error: "Demasiadas solicitudes. Intenta de nuevo en un minuto." },
});

const bookingLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: "Demasiadas solicitudes de reserva. Intenta de nuevo en un minuto." },
});

const emailLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 3,
  message: { error: "Demasiados envíos de correo. Intenta de nuevo en un minuto." },
});

// Auth middleware: protects admin endpoints
const requireAdmin = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  // If ADMIN_API_KEY is set, use Bearer token auth
  if (ADMIN_API_KEY) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ') || authHeader.slice(7) !== ADMIN_API_KEY) {
      return res.status(401).json({ error: "No autorizado" });
    }
    return next();
  }
  // Otherwise, use session cookie auth
  const sid = parseCookies(req.headers.cookie)["session"];
  if (!sid || !sessions.has(sid)) {
    return res.status(401).json({ error: "No autorizado" });
  }
  next();
};

// Interval mutex flags
let addressEmailRunning = false;
let remindersRunning = false;

// Interval references for graceful shutdown
let addressEmailInterval: ReturnType<typeof setInterval> | null = null;
let remindersInterval: ReturnType<typeof setInterval> | null = null;

async function startServer() {
  // Initialize persistent SQLite database
  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);
  db = new Database(path.join(dataDir, "database.sqlite"));

  // Create tables if they don't exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      bannerUrl TEXT,
      morningHours TEXT,
      afternoonHours TEXT,
      massageTypes TEXT,
      address TEXT DEFAULT '',
      logoUrl TEXT DEFAULT '',
      logoPosition TEXT DEFAULT '{"x":50,"y":50}',
      tagline TEXT DEFAULT 'Diseño y arquitectura de tu mirada',
      blockedDays TEXT DEFAULT '[]',
      blockedShifts TEXT DEFAULT '[]',
      phone TEXT DEFAULT '34623101111'
    );

    CREATE TABLE IF NOT EXISTS appointments (
      id TEXT PRIMARY KEY,
      clientName TEXT,
      clientEmail TEXT,
      clientPhone TEXT,
      startTime TEXT,
      endTime TEXT,
      status TEXT,
      eventId TEXT,
      massageType TEXT,
      price TEXT,
      duration TEXT,
      addressSent INTEGER DEFAULT 0,
      reminder6hSent INTEGER DEFAULT 0,
      reminder2hSent INTEGER DEFAULT 0,
      locationId TEXT
    );

    CREATE TABLE IF NOT EXISTS admin_auth (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      tokens TEXT -- JSON string
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      email TEXT,
      createdAt TEXT
    );

    CREATE TABLE IF NOT EXISTS locations (
      id TEXT PRIMARY KEY,
      name TEXT,
      address TEXT,
      morningHours TEXT DEFAULT '[]',
      afternoonHours TEXT DEFAULT '[]',
      blockedDays TEXT DEFAULT '[]',
      blockedShifts TEXT DEFAULT '[]'
    );
  `);

  // Initialize default config if empty
  const configCount = db.prepare("SELECT COUNT(*) as count FROM config").get() as { count: number };
  if (configCount.count === 0) {
    db.prepare("INSERT INTO config (id, bannerUrl, morningHours, afternoonHours, massageTypes, address, phone, tagline) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(1, "https://media.istockphoto.com/id/1340856746/es/foto/el-maquillador-realiza-un-procedimiento-de-depilaci%C3%B3n-facial-hermosa-chica-con-ojos-azules-con.jpg?s=612x612&w=0&k=20&c=FtUdNKaPY-yWj6J9pmwIWjqVLukhCAyA6hN1NO6dVtM=", 
        JSON.stringify(["09:00", "10:00", "11:00", "12:00", "13:00"]), 
        JSON.stringify(["15:00", "16:00", "17:00", "18:00", "19:00", "20:00"]),
        JSON.stringify([
          { id: "1", name: "Diseño de Cejas con Hilo + Tinte", price: "18€", duration: "30 min", description: "Diseño personalizado utilizando hilo de seda y tinte de larga duración para unas cejas perfectas." },
          { id: "2", name: "Laminado de Cejas (Brow Lamination)", price: "35€", duration: "45 min", description: "Tratamiento semipermanente para direccionar, peinar y dar volumen y definición a las cejas." },
          { id: "3", name: "Depilación & Diseño de Cejas con Pinza", price: "12€", duration: "25 min", description: "Perfilado preciso y limpio adaptado a las facciones de tu rostro." }
        ]),
        "",
        "34623101111",
        "Diseño y arquitectura de tu mirada"
      );
  } else {
    // Migration: Add massageTypes column if it doesn't exist
    try {
      db.exec("ALTER TABLE config ADD COLUMN massageTypes TEXT");
      db.prepare("UPDATE config SET massageTypes = ? WHERE id = 1")
        .run(JSON.stringify([
          { id: "1", name: "Diseño de Cejas con Hilo + Tinte", price: "18€", duration: "30 min", description: "Diseño personalizado utilizando hilo de seda y tinte de larga duración." },
          { id: "2", name: "Laminado de Cejas (Brow Lamination)", price: "35€", duration: "45 min", description: "Tratamiento semipermanente para direccionar y dar volumen a las cejas." },
          { id: "3", name: "Depilación & Diseño de Cejas con Pinza", price: "12€", duration: "25 min", description: "Perfilado preciso y limpio adaptado a tus facciones." }
        ]));
    } catch (e) { /* column may already exist */ }
  }

  // Initialize default locations if empty
  const locationCount = db.prepare("SELECT COUNT(*) as count FROM locations").get() as { count: number };
  if (locationCount.count === 0) {
    db.prepare("INSERT INTO locations (id, name, address, morningHours, afternoonHours, blockedDays, blockedShifts) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("albacete", "Albacete", "Calle Ancha 12, Albacete", 
        JSON.stringify(["09:00", "10:00", "11:00", "12:00", "13:00"]), 
        JSON.stringify(["15:00", "16:00", "17:00", "18:00", "19:00", "20:00"]),
        JSON.stringify([]),
        JSON.stringify([])
      );
    db.prepare("INSERT INTO locations (id, name, address, morningHours, afternoonHours, blockedDays, blockedShifts) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("alicante", "Alicante", "Avenida de Alfonso El Sabio 5, Alicante", 
        JSON.stringify(["09:00", "10:00", "11:00", "12:00", "13:00"]), 
        JSON.stringify(["15:00", "16:00", "17:00", "18:00", "19:00", "20:00"]),
        JSON.stringify([]),
        JSON.stringify([])
      );
  }

  // Migration: Add locationId column to appointments if it doesn't exist
  try {
    db.exec("ALTER TABLE appointments ADD COLUMN locationId TEXT");
  } catch (e) { /* column may already exist */ }

  // Migration: Add price and duration columns to appointments if they don't exist
  try {
    db.exec("ALTER TABLE appointments ADD COLUMN price TEXT");
    db.exec("ALTER TABLE appointments ADD COLUMN duration TEXT");
  } catch (e) { /* columns may already exist */ }

  // Migration: Add address column to config if it doesn't exist
  try {
    db.exec("ALTER TABLE config ADD COLUMN address TEXT");
  } catch (e) { /* column may already exist */ }

  // Migration: Add addressSent column to appointments if it doesn't exist
  try {
    db.exec("ALTER TABLE appointments ADD COLUMN addressSent INTEGER DEFAULT 0");
  } catch (e) { /* column may already exist */ }

  // Migration: Add reminder columns to appointments if they don't exist
  try {
    db.exec("ALTER TABLE appointments ADD COLUMN reminder6hSent INTEGER DEFAULT 0");
    db.exec("ALTER TABLE appointments ADD COLUMN reminder2hSent INTEGER DEFAULT 0");
  } catch (e) { /* columns may already exist */ }

  // Migration: Add logo columns to config if they don't exist
  try {
    db.exec("ALTER TABLE config ADD COLUMN logoUrl TEXT");
    db.exec("ALTER TABLE config ADD COLUMN logoPosition TEXT DEFAULT '{\"x\":50,\"y\":50}'");
  } catch (e) { /* columns may already exist */ }

  // Migration: Add tagline column to config if it doesn't exist
  try {
    db.exec("ALTER TABLE config ADD COLUMN tagline TEXT DEFAULT 'La energía que fluye'");
  } catch (e) { /* column may already exist */ }

  // Migration: Add blockedDays and blockedShifts columns to config if they don't exist
  try {
    db.exec("ALTER TABLE config ADD COLUMN blockedDays TEXT DEFAULT '[]'");
  } catch (e) { /* column may already exist */ }
  try {
    db.exec("ALTER TABLE config ADD COLUMN blockedShifts TEXT DEFAULT '[]'");
  } catch (e) { /* column may already exist */ }

  // Migration: Add phone column to config if it doesn't exist
  try {
    db.exec("ALTER TABLE config ADD COLUMN phone TEXT DEFAULT '34623101111'");
  } catch (e) { /* column may already exist */ }

  const app = express();
  app.use(express.json({ limit: "20mb" }));

  app.use("/api/", generalLimiter);

  // === API ROUTES ===

  // Helper to get config
  const getConfig = () => {
    const row = db.prepare("SELECT * FROM config WHERE id = 1").get() as any;
    let logoPosition = { x: 50, y: 50 };
    try { logoPosition = JSON.parse(row.logoPosition || '{"x":50,"y":50}'); } catch (e) {}
    let morningHours: string[] = [];
    try { morningHours = JSON.parse(row.morningHours); } catch (e) { morningHours = []; }
    let afternoonHours: string[] = [];
    try { afternoonHours = JSON.parse(row.afternoonHours); } catch (e) { afternoonHours = []; }
    let massageTypes: any[] = [];
    try { massageTypes = row.massageTypes ? JSON.parse(row.massageTypes) : []; } catch (e) { massageTypes = []; }
    let blockedDays: string[] = [];
    try { blockedDays = row.blockedDays ? JSON.parse(row.blockedDays) : []; } catch (e) { blockedDays = []; }
    let blockedShifts: string[] = [];
    try { blockedShifts = row.blockedShifts ? JSON.parse(row.blockedShifts) : []; } catch (e) { blockedShifts = []; }
    return {
      bannerUrl: row.bannerUrl,
      morningHours,
      afternoonHours,
      massageTypes,
      address: row.address || "",
      logoUrl: row.logoUrl || "",
      logoPosition,
      tagline: row.tagline || "La energía que fluye",
      blockedDays,
      blockedShifts,
      phone: row.phone || "34623101111"
    };
  };

  // Helper to get admin tokens
  const getAdminTokens = () => {
    const row = db.prepare("SELECT tokens FROM admin_auth WHERE id = 1").get() as any;
    return row ? JSON.parse(row.tokens) : null;
  };

  const getAdminEmail = () => {
    const data = getAdminTokens();
    return data?.adminEmail || null;
  };

  // Load stored Google tokens on startup so oauth2Client can auto-refresh them
  const storedTokens = getAdminTokens();
  if (storedTokens) {
    oauth2Client.setCredentials(storedTokens);
  }

  // Email Template Function
  const getHtmlTemplate = (title: string, content: string, clientName: string, dateStr: string, appointmentId?: string, massageType?: string, locationStr?: string) => {
    const config = getConfig();
    const manageUrl = appointmentId ? `${APP_URL}/?manage=${appointmentId}` : APP_URL;
    return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#130E0F;font-family:Georgia,serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#130E0F;padding:20px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#1B1617;border:1px solid rgba(176,130,117,0.25);border-radius:16px;overflow:hidden;">
        
        <!-- HEADER -->
        <tr>
          <td style="background:#262021;padding:30px 40px;border-bottom:1px solid rgba(176,130,117,0.2);">
            <p style="margin:0;font-family:Georgia,serif;font-size:28px;color:#FAF5F2;letter-spacing:1px;">Llanos Studio</p>
            <p style="margin:4px 0 0;font-size:11px;color:#B08275;letter-spacing:3px;text-transform:uppercase;">Brow & Lash Design</p>
            <p style="margin:6px 0 0;font-size:10px;color:#DEC5B9;letter-spacing:2px;font-style:italic;">${escapeHtml(config.tagline || 'Diseño y arquitectura de tu mirada')}</p>
          </td>
        </tr>

        <!-- BODY -->
        <tr>
          <td style="padding:35px 40px;">
            <h1 style="margin:0 0 20px;font-family:Georgia,serif;font-size:28px;color:#FAF5F2;font-weight:normal;">${title}</h1>
            <p style="margin:0 0 20px;font-size:15px;color:#A0A3A1;line-height:1.6;">Hola <strong style="color:#FAF5F2;">${escapeHtml(clientName)}</strong>,</p>
            <div style="font-size:15px;color:#A0A3A1;line-height:1.7;">${content}</div>

            <!-- INFO CARD -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#262021;border:1px solid rgba(176,130,117,0.15);border-radius:12px;margin:25px 0;">
              <tr>
                <td style="padding:20px 25px;">
                  <table width="100%" cellpadding="6" cellspacing="0">
                    <tr>
                      <td style="font-size:10px;color:#B08275;text-transform:uppercase;letter-spacing:1px;font-weight:700;width:100px;">Fecha</td>
                      <td style="font-size:14px;color:#FAF5F2;font-weight:500;">${dateStr}</td>
                    </tr>
                    <tr>
                      <td style="font-size:10px;color:#B08275;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Servicio</td>
                      <td style="font-size:14px;color:#FAF5F2;font-weight:500;">${escapeHtml(massageType || 'Diseño de Cejas')}</td>
                    </tr>
                    <tr>
                      <td style="font-size:10px;color:#B08275;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Ubicación</td>
                      <td style="font-size:14px;color:#FAF5F2;font-weight:500;">${escapeHtml(locationStr || 'Llanos Studio')}</td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <p style="font-size:14px;color:#A0A3A1;line-height:1.6;">Si necesitas modificar o cancelar tu cita, puedes hacerlo desde el siguiente enlace:</p>
            <a href="${manageUrl}" style="display:inline-block;background:#B08275;color:#FAF5F2;text-decoration:none;padding:14px 28px;border-radius:10px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:2px;margin-top:10px;">Gestionar mi Cita</a>
          </td>
        </tr>

        <!-- FOOTER -->
        <tr>
          <td style="padding:20px 40px;border-top:1px solid rgba(255,255,255,0.06);background:#130E0F;text-align:center;">
            <p style="margin:0;font-size:11px;color:#5A5D5B;">© 2026 Llanos Studio. Todos los derechos reservados.</p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
  };

  const sendEmail = async (to: string, subject: string, html: string) => {
  const tokens = getAdminTokens();
  if (!tokens) throw new Error("Google Calendar no conectado");

  if (to.includes('\r') || to.includes('\n')) {
    throw new Error("Invalid email address: contains newlines");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    throw new Error("Invalid email address format");
  }

  oauth2Client.setCredentials(tokens);
  const fromEmail = getAdminEmail() || "me";
  
  const encodedSubject = Buffer.from(subject, 'utf-8').toString('base64');
  
  // NO codificar el HTML en base64 — mandarlo como UTF-8 directamente
  const message = [
    `To: ${to}`,
    `From: "Llanos Studio" <${fromEmail}>`,
    `Subject: =?utf-8?B?${encodedSubject}?=`,
    `MIME-Version: 1.0`,
    `Content-Type: text/html; charset=utf-8`,
    `Content-Transfer-Encoding: 8bit`,  // ← cambio clave
    ``,
    html  // ← HTML plano, sin encodear
  ].join('\r\n');

  const encodedMessage = Buffer.from(message, "utf-8")
    .toString("base64url");

  await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw: encodedMessage }
  });
};

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/api/app-config", (req, res) => {
    res.json(getConfig());
  });

  app.put("/api/app-config", requireAdmin, (req, res) => {
    const { bannerUrl, morningHours, afternoonHours, massageTypes, address, logoUrl, logoPosition, tagline, blockedDays, blockedShifts, phone } = req.body;
    const current = getConfig();
    
    db.prepare("UPDATE config SET bannerUrl = ?, morningHours = ?, afternoonHours = ?, massageTypes = ?, address = ?, logoUrl = ?, logoPosition = ?, tagline = ?, blockedDays = ?, blockedShifts = ?, phone = ? WHERE id = 1")
      .run(
        bannerUrl || current.bannerUrl,
        morningHours ? JSON.stringify(morningHours) : JSON.stringify(current.morningHours),
        afternoonHours ? JSON.stringify(afternoonHours) : JSON.stringify(current.afternoonHours),
        massageTypes ? JSON.stringify(massageTypes) : JSON.stringify(current.massageTypes),
        address !== undefined ? address : (current.address || ""),
        logoUrl !== undefined ? logoUrl : (current.logoUrl || ""),
        logoPosition ? JSON.stringify(logoPosition) : JSON.stringify(current.logoPosition),
        tagline !== undefined ? tagline : (current.tagline || "Diseño y arquitectura de tu mirada"),
        blockedDays ? JSON.stringify(blockedDays) : JSON.stringify(current.blockedDays || []),
        blockedShifts ? JSON.stringify(blockedShifts) : JSON.stringify(current.blockedShifts || []),
        phone !== undefined ? phone : (current.phone || "34623101111")
      );
    
    res.json(getConfig());
  });

  // Locations CRUD API
  app.get("/api/locations", (req, res) => {
    try {
      const rows = db.prepare("SELECT * FROM locations").all() as any[];
      res.json(rows.map(r => ({
        id: r.id,
        name: r.name,
        address: r.address,
        morningHours: JSON.parse(r.morningHours || '[]'),
        afternoonHours: JSON.parse(r.afternoonHours || '[]'),
        blockedDays: JSON.parse(r.blockedDays || '[]'),
        blockedShifts: JSON.parse(r.blockedShifts || '[]')
      })));
    } catch (e) {
      res.status(500).json({ error: "Error al obtener ubicaciones" });
    }
  });

  app.post("/api/locations", requireAdmin, (req, res) => {
    try {
      const { id, name, address, morningHours, afternoonHours } = req.body;
      const locId = id || randomUUID();
      db.prepare("INSERT OR REPLACE INTO locations (id, name, address, morningHours, afternoonHours, blockedDays, blockedShifts) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(
          locId,
          name,
          address,
          JSON.stringify(morningHours || ["09:00", "10:00", "11:00", "12:00", "13:00"]),
          JSON.stringify(afternoonHours || ["15:00", "16:00", "17:00", "18:00", "19:00", "20:00"]),
          JSON.stringify([]),
          JSON.stringify([])
        );
      res.json({ success: true, id: locId });
    } catch (e) {
      res.status(500).json({ error: "Error al crear ubicación" });
    }
  });

  app.put("/api/locations/:id", requireAdmin, (req, res) => {
    try {
      const { id } = req.params;
      const { name, address, morningHours, afternoonHours, blockedDays, blockedShifts } = req.body;
      const current = db.prepare("SELECT * FROM locations WHERE id = ?").get(id) as any;
      if (!current) return res.status(404).json({ error: "Ubicación no encontrada" });

      db.prepare("UPDATE locations SET name = ?, address = ?, morningHours = ?, afternoonHours = ?, blockedDays = ?, blockedShifts = ? WHERE id = ?")
        .run(
          name !== undefined ? name : current.name,
          address !== undefined ? address : current.address,
          morningHours ? JSON.stringify(morningHours) : current.morningHours,
          afternoonHours ? JSON.stringify(afternoonHours) : current.afternoonHours,
          blockedDays ? JSON.stringify(blockedDays) : current.blockedDays,
          blockedShifts ? JSON.stringify(blockedShifts) : current.blockedShifts,
          id
        );
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: "Error al actualizar ubicación" });
    }
  });

  app.delete("/api/locations/:id", requireAdmin, (req, res) => {
    try {
      const { id } = req.params;
      db.prepare("DELETE FROM locations WHERE id = ?").run(id);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: "Error al eliminar ubicación" });
    }
  });

  app.get("/api/config", (req, res) => {
    res.json({ 
      hasCredentials: !!(CLIENT_ID && CLIENT_SECRET),
      isGoogleConnected: !!getAdminTokens() 
    });
  });

  // Admin OAuth flow
  app.get("/api/auth/google", (req, res) => {
    if (!CLIENT_ID) {
       return res.status(500).json({ error: "Falta GOOGLE_CLIENT_ID en variables de entorno." });
    }
    const url = oauth2Client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: [
        "https://www.googleapis.com/auth/calendar",
        "https://www.googleapis.com/auth/gmail.send",
        "https://www.googleapis.com/auth/userinfo.email"
      ]
    });
    res.redirect(url);
  });

  app.get("/api/auth/google/callback", async (req, res) => {
    const code = req.query.code as string;
    if (code) {
      try {
        const { tokens } = await oauth2Client.getToken(code);
        
        const oauth2 = google.oauth2({ auth: oauth2Client, version: "v2" });
        oauth2Client.setCredentials(tokens);
        const userInfo = await oauth2.userinfo.get();
        const userEmail = userInfo.data.email;
        
        const authorizedEmail = process.env.ADMIN_EMAIL;
        
        if (!authorizedEmail || userEmail !== authorizedEmail) {
           return res.status(403).json({ error: "No autorizado" });
        }

        db.prepare("INSERT OR REPLACE INTO admin_auth (id, tokens) VALUES (1, ?)")
          .run(JSON.stringify({ ...tokens, adminEmail: userEmail }));

        const sid = randomUUID();
        sessions.set(sid, { email: userEmail });
        res.cookie('session', sid, { httpOnly: true, sameSite: 'lax', maxAge: 24 * 60 * 60 * 1000, path: '/' });
        res.redirect("/?admin=true");
      } catch (e) {
        res.status(500).json({ error: "Error en la autenticación: " + String(e) });
      }
    } else {
      res.redirect("/");
    }
  });

  // Get current session info
  app.get("/api/auth/session", (req, res) => {
    const sid = parseCookies(req.headers.cookie)["session"];
    if (!sid || !sessions.has(sid)) {
      return res.json({ authenticated: false });
    }
    res.json({ authenticated: true, email: sessions.get(sid)!.email });
  });

  // Logout: clear session
  app.post("/api/auth/logout", (req, res) => {
    const sid = parseCookies(req.headers.cookie)["session"];
    if (sid) sessions.delete(sid);
    res.clearCookie('session', { path: '/' });
    res.json({ success: true });
  });

  // Appointments API
  app.get("/api/appointments", (req, res) => {
    const rows = db.prepare("SELECT * FROM appointments").all() as any[];
    res.json(rows);
  });

  app.get("/api/appointments/:id", requireAdmin, (req, res) => {
    const { id } = req.params;
    const appt = db.prepare("SELECT * FROM appointments WHERE id = ?").get(id) as any;
    if (!appt) return res.status(404).json({ error: "No encontrado" });
    res.json(appt);
  });

  app.post("/api/appointments", bookingLimiter, async (req, res) => {
    const { clientName, clientEmail, clientPhone, startTime, endTime, massageType, price, duration, locationId } = req.body;
    
    if (!clientName || !clientEmail || !startTime || !endTime) {
      return res.status(400).json({ error: "Faltan datos requeridos." });
    }

    if (clientEmail.includes('\r') || clientEmail.includes('\n')) {
      return res.status(400).json({ error: "Email inválido" });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail)) {
      return res.status(400).json({ error: "Email inválido" });
    }

    const id = uuidv4();
    let eventId = null;

    const loc = db.prepare("SELECT * FROM locations WHERE id = ?").get(locationId) as any;
    const locationStr = loc ? `${loc.name} - ${loc.address}` : "Llanos Studio";

    const tokens = getAdminTokens();
    if (tokens) {
      try {
        oauth2Client.setCredentials(tokens);
        const event = await calendar.events.insert({
          calendarId: "primary",
          requestBody: {
            summary: `Cita Cejas: ${clientName}`,
            description: `Ubicación: ${locationStr}\nTeléfono: ${clientPhone || ""}\nEmail: ${clientEmail}`,
            start: { dateTime: startTime, timeZone: "Europe/Madrid" },
            end: { dateTime: endTime, timeZone: "Europe/Madrid" },
            attendees: [{ email: clientEmail }]
          }
        });
        eventId = event.data.id;
      } catch (err) {
        console.error("Calendar Error:", err);
      }
    }

    db.prepare("INSERT INTO appointments (id, clientName, clientEmail, clientPhone, startTime, endTime, status, eventId, massageType, price, duration, locationId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, clientName, clientEmail, clientPhone, startTime, endTime, 'pending', eventId, massageType, price || null, duration || null, locationId || null);

    // Send emails in background (don't block the response)
    if (tokens) {
      const dateStr = new Date(startTime).toLocaleString('es-ES', { 
        weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid'
      });
      
      // Email to client
      const confirmUrl = `${APP_URL}/api/appointments/${id}/confirm`;
      const manageUrl = `${APP_URL}/?manage=${id}`;
      const actionButtons = `
<div style="margin:25px 0;">
  <p style="font-size:15px;color:#A0A3A1;line-height:1.6;">Por favor, confirma tu asistencia o reagenda si lo necesitas:</p>
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:10px 0;">
    <a href="${confirmUrl}" style="display:inline-block;background:#059669;color:#ffffff;text-decoration:none;padding:15px 30px;border-radius:12px;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;margin:0 6px 8px;">✓ Sí, asistiré</a>
    <a href="${manageUrl}" style="display:inline-block;background:#3B82F6;color:#ffffff;text-decoration:none;padding:15px 30px;border-radius:12px;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;margin:0 6px 8px;">↻ No, reagendar</a>
  </td></tr></table>
  <p style="font-size:12px;color:#7A7D7B;line-height:1.5;margin-top:10px;">Si no respondes, te enviaremos un recordatorio más tarde.</p>
</div>`;
      const addressNotice = loc && loc.address 
        ? `<p style="font-size:13px;color:#B08275;background:rgba(176,130,117,0.1);padding:12px 16px;border-radius:10px;margin-top:16px;">📬 Recibirás un correo con la dirección del estudio en <strong>${escapeHtml(loc.name)}</strong> (<em>${escapeHtml(loc.address)}</em>) <strong>2 horas antes</strong> de tu cita.</p>`
        : "";
      const clientHtml = getHtmlTemplate(
        "Cita Confirmada", 
        `<p>Tu sesión de cejas ha sido reservada con éxito. Estamos deseando recibirte para brindarte el mejor servicio y realzar tu mirada.</p>${actionButtons}${addressNotice}`,
        clientName,
        dateStr,
        id,
        massageType || 'Diseño de Cejas',
        locationStr
      );
      sendEmail(clientEmail, "Confirmación de Cita - Llanos Studio", clientHtml).catch(e => console.error("Email error:", e));

      // Email to admin
      const adminEmail = getAdminEmail();
      if (adminEmail) {
        const adminHtml = getHtmlTemplate(
          "Nueva Reserva",
          `<p>Has recibido una nueva reserva de cejas de <span style="color: #FAF5F2;">${escapeHtml(clientName)}</span>.</p>
           <p>Ubicación: ${escapeHtml(locationStr)}<br>Email: ${escapeHtml(clientEmail)}<br>Tel: ${escapeHtml(clientPhone || 'No prop.')}<br>Servicio: ${escapeHtml(massageType || 'Diseño de Cejas')}</p>`,
          "Llanos Studio Admin",
          dateStr,
          id,
          massageType || 'Diseño de Cejas',
          locationStr
        );
        sendEmail(adminEmail, `Nueva Cita Cejas (${loc ? loc.name : ''}): ${clientName}`, adminHtml).catch(e => console.error("Admin email error:", e));
      }
    }

    res.json({ id, clientName, clientEmail, clientPhone, startTime, endTime, status: 'pending', eventId, massageType, locationId });
  });

  app.put("/api/appointments/:id", requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { startTime, endTime } = req.body;
    const appt = db.prepare("SELECT * FROM appointments WHERE id = ?").get(id) as any;
    if (!appt) return res.status(404).json({ error: "No encontrado" });

    const now = new Date();
    if (new Date(appt.startTime) < now) {
      return res.status(400).json({ error: "No se puede modificar una cita pasada" });
    }

    const newStart = startTime || appt.startTime;
    const newEnd = endTime || appt.endTime;

    const tokens = getAdminTokens();
    if (tokens && appt.eventId) {
      try {
        oauth2Client.setCredentials(tokens);
        await calendar.events.patch({
          calendarId: "primary",
          eventId: appt.eventId,
          requestBody: {
            start: { dateTime: newStart },
            end: { dateTime: newEnd }
          }
        });
        
        const dateStr = new Date(newStart).toLocaleString('es-ES', { 
          weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid'
        });
        const confirmUrl = `${APP_URL}/api/appointments/${id}/confirm`;
        const manageUrl = `${APP_URL}/?manage=${id}`;
        const actionButtons = `
<div style="margin:25px 0;">
  <p style="font-size:15px;color:#A0A3A1;line-height:1.6;">Por favor, confirma tu asistencia o reagenda si lo necesitas:</p>
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:10px 0;">
    <a href="${confirmUrl}" style="display:inline-block;background:#059669;color:#ffffff;text-decoration:none;padding:15px 30px;border-radius:12px;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;margin:0 6px 8px;">✓ Sí, asistiré</a>
    <a href="${manageUrl}" style="display:inline-block;background:#3B82F6;color:#ffffff;text-decoration:none;padding:15px 30px;border-radius:12px;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;margin:0 6px 8px;">↻ No, reagendar</a>
  </td></tr></table>
  <p style="font-size:12px;color:#7A7D7B;line-height:1.5;margin-top:10px;">Si no respondes, te enviaremos un recordatorio más tarde.</p>
</div>`;
        const html = getHtmlTemplate(
          "Cita Reagendada",
          `<p>Tu cita ha sido modificada por el administrador a un nuevo horario. Por favor, confírmanos si puedes asistir en esta nueva fecha.</p>${actionButtons}`,
          appt.clientName,
          dateStr,
          id,
          appt.massageType
        );
        await sendEmail(appt.clientEmail, "Actualización de tu Cita - Llanos Studio", html);

        // FIX: Use stored admin email instead of calling Gmail API (avoids failure on expired token)
        const adminEmail = getAdminEmail();
        if (adminEmail) {
          const adminHtml = getHtmlTemplate(
            "Cita Reagendada",
            `<p>La cita de <span style="color: #F9F8F6;">${escapeHtml(appt.clientName)}</span> ha sido modificada.</p>
             <p>Nuevo horario: ${dateStr}<br>Email: ${escapeHtml(appt.clientEmail)}</p>`,
            "Admin Llanos Studio",
            dateStr
          );
          await sendEmail(adminEmail, `Cita Reagendada: ${appt.clientName}`, adminHtml);
        }
      } catch (e) { console.error(e); }
    }
    
    db.prepare("UPDATE appointments SET startTime = ?, endTime = ?, status = 'rescheduled' WHERE id = ?").run(newStart, newEnd, id);
    res.json({ ...appt, startTime: newStart, endTime: newEnd, status: 'rescheduled' });
  });

  app.delete("/api/appointments/:id", requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { reason } = req.body;
    
    const appt = db.prepare("SELECT * FROM appointments WHERE id = ?").get(id) as any;
    if (!appt) return res.status(404).json({ error: "No encontrado" });

    console.log("DELETE request for appointment:", id);

    const tokens = getAdminTokens();
    if (tokens && appt.eventId) {
      try {
        oauth2Client.setCredentials(tokens);
        await calendar.events.delete({ calendarId: "primary", eventId: appt.eventId });
        
        const dateStr = new Date(appt.startTime).toLocaleString('es-ES', { 
          weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid'
        });
        const html = getHtmlTemplate(
          "Cita Cancelada",
          `<p>Lamentamos informarte que tu cita ha sido cancelada.</p>
           ${reason ? `<p style="background: rgba(143,114,86,0.1); padding: 15px; border-radius: 10px; font-style: italic;">Motivo: ${escapeHtml(reason)}</p>` : ''}`,
          appt.clientName,
          dateStr
        );
        await sendEmail(appt.clientEmail, "Cita Cancelada - Llanos Studio", html);

        // FIX: Use stored admin email instead of calling Gmail API (avoids failure on expired token)
        const adminEmail = getAdminEmail();
        if (adminEmail) {
          const adminHtml = getHtmlTemplate(
            "Cita Cancelada",
            `<p>La cita de <span style="color: #F9F8F6;">${escapeHtml(appt.clientName)}</span> ha sido cancelada.</p>
             <p>Fecha: ${dateStr}<br>Email: ${escapeHtml(appt.clientEmail)}${reason ? `<br>Motivo: ${escapeHtml(reason)}` : ''}</p>`,
            "Admin Llanos Studio",
            dateStr
          );
          await sendEmail(adminEmail, `Cita Cancelada: ${appt.clientName}`, adminHtml);
        }
      } catch (e) { console.error(e); }
    }

    db.prepare("DELETE FROM appointments WHERE id = ?").run(id);
    console.log("Appointment deleted from DB:", id);
    res.json({ success: true });
  });

  // Confirm attendance
  app.get("/api/appointments/:id/confirm", (req, res) => {
    const { id } = req.params;
    const appt = db.prepare("SELECT * FROM appointments WHERE id = ?").get(id) as any;
    if (!appt) return res.status(404).json({ error: "Cita no encontrada" });

    db.prepare("UPDATE appointments SET status = 'attending' WHERE id = ?").run(id);

    res.send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0E1410;font-family:Georgia,serif;display:flex;align-items:center;justify-content:center;min-height:100vh;">
  <div style="background:#141A16;border:1px solid rgba(143,114,86,0.25);border-radius:16px;padding:40px;max-width:400px;text-align:center;">
    <div style="width:60px;height:60px;border-radius:50%;background:#059669;display:flex;align-items:center;justify-content:center;margin:0 auto 20px;"><span style="font-size:28px;color:#fff;">✓</span></div>
    <h1 style="color:#F9F8F6;font-size:24px;margin:0 0 10px;">¡Asistencia Confirmada!</h1>
    <p style="color:#A0A3A1;font-size:15px;line-height:1.6;margin:0;">Gracias por confirmar. Estaremos encantados de recibirte.</p>
  </div>
</body></html>`);
  });

  // Resend confirmation email for an appointment
  app.post("/api/appointments/:id/resend-email", requireAdmin, async (req, res) => {
    const { id } = req.params;
    const appt = db.prepare("SELECT * FROM appointments WHERE id = ?").get(id) as any;
    if (!appt) return res.status(404).json({ error: "Cita no encontrada" });

    const tokens = getAdminTokens();
    if (!tokens) return res.status(401).json({ error: "Google no conectado" });

    const loc = db.prepare("SELECT * FROM locations WHERE id = ?").get(appt.locationId) as any;
    const locationStr = loc ? `${loc.name} - ${loc.address}` : "Llanos Studio";

    const dateStr = new Date(appt.startTime).toLocaleString('es-ES', {
      weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid'
    });

    const confirmUrl = `${APP_URL}/api/appointments/${id}/confirm`;
    const manageUrl = `${APP_URL}/?manage=${id}`;
    const actionButtons = `
<div style="margin:25px 0;">
  <p style="font-size:15px;color:#A0A3A1;line-height:1.6;">Por favor, confirma tu asistencia o reagenda si lo necesitas:</p>
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:10px 0;">
    <a href="${confirmUrl}" style="display:inline-block;background:#059669;color:#ffffff;text-decoration:none;padding:15px 30px;border-radius:12px;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;margin:0 6px 8px;">✓ Sí, asistiré</a>
    <a href="${manageUrl}" style="display:inline-block;background:#3B82F6;color:#ffffff;text-decoration:none;padding:15px 30px;border-radius:12px;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;margin:0 6px 8px;">↻ No, reagendar</a>
  </td></tr></table>
  <p style="font-size:12px;color:#7A7D7B;line-height:1.5;margin-top:10px;">Si no respondes, te enviaremos un recordatorio más tarde.</p>
</div>`;
    const html = getHtmlTemplate(
      "Cita Confirmada",
      `<p>Tu sesión de cejas ha sido reservada con éxito. Estamos deseando recibirte para brindarte el mejor servicio y realzar tu mirada.</p>${actionButtons}`,
      appt.clientName,
      dateStr,
      id,
      appt.massageType || 'Diseño de Cejas',
      locationStr
    );

    try {
      await sendEmail(appt.clientEmail, "Confirmación de Cita - Llanos Studio", html);
      res.json({ success: true });
    } catch (e) {
      console.error("Resend email error:", e);
      res.status(500).json({ error: "Error al reenviar el correo" });
    }
  });

  // Send custom email (template + optional custom text)
  app.post("/api/appointments/:id/send-custom-email", requireAdmin, emailLimiter, async (req, res) => {
    const { id } = req.params;
    const { template, customText } = req.body;
    const appt = db.prepare("SELECT * FROM appointments WHERE id = ?").get(id) as any;
    if (!appt) return res.status(404).json({ error: "Cita no encontrada" });

    const tokens = getAdminTokens();
    if (!tokens) return res.status(401).json({ error: "Google no conectado" });

    const dateStr = new Date(appt.startTime).toLocaleString('es-ES', {
      weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid'
    });

    const cfg = getConfig();
    const loc = db.prepare("SELECT * FROM locations WHERE id = ?").get(appt.locationId) as any;
    const address = loc ? loc.address : cfg.address;
    const locationStr = loc ? `${loc.name} - ${loc.address}` : "Llanos Studio";

    let subject = "";
    let content = "";

    switch (template) {
      case "reminder":
        subject = "Recordatorio de tu Cita - Llanos Studio";
        content = "<p>Te recordamos que tienes una cita próxima en nuestro estudio. Estaremos encantados de recibirte para brindarte el mejor servicio de diseño de cejas y estética.</p><p>Por favor, confirma que podrás asistir o, si necesitas realizar algún cambio, utiliza el enlace de gestión que encontrarás más abajo.</p>";
        break;
      case "address":
        subject = "Dirección del Estudio - Llanos Studio";
        content = `<p>Tu cita está a punto de comenzar. Aquí tienes la dirección de nuestro estudio para que puedas llegar sin problemas:</p>
            <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}" target="_blank" style="text-decoration:none;">
              <div style="background:#262021;border:1px solid rgba(176,130,117,0.15);border-radius:12px;padding:24px;margin:25px 0;text-align:center;">
                <p style="margin:0;font-size:16px;color:#FAF5F2;font-weight:500;line-height:1.6;">${escapeHtml(address)}</p>
                <p style="margin:8px 0 0;font-size:11px;color:#3B82F6;letter-spacing:1px;">📌 Ver en Google Maps →</p>
              </div>
            </a>
            <p style="font-size:14px;color:#A0A3A1;line-height:1.6;">Te esperamos para realzar tu mirada.</p>`;
        break;
      default:
        subject = "Mensaje de tu Esteticista - Llanos Studio";
        content = customText
          ? `<p>${escapeHtml(customText).replace(/\n/g, '</p><p>')}</p>`
          : "<p>Mensaje de parte de tu esteticista.</p>";
        break;
    }

    if (template !== "custom" && customText) {
      content += `<div style="background:rgba(176,130,117,0.08);padding:15px 20px;border-radius:10px;border:1px solid rgba(176,130,117,0.15);margin-top:15px;"><p style="margin:0;font-size:14px;color:#B08275;font-style:italic;">${escapeHtml(customText).replace(/\n/g, '<br>')}</p></div>`;
    }

    const html = getHtmlTemplate(subject.split(' - ')[0], content, appt.clientName, dateStr, id, appt.massageType, locationStr);

    try {
      await sendEmail(appt.clientEmail, subject, html);
      res.json({ success: true });
    } catch (e) {
      console.error("Custom email error:", e);
      res.status(500).json({ error: "Error al enviar el correo" });
    }
  });

  // Add appointment to admin's Google Calendar
  app.post("/api/appointments/:id/add-to-calendar", requireAdmin, async (req, res) => {
    const { id } = req.params;
    const appt = db.prepare("SELECT * FROM appointments WHERE id = ?").get(id) as any;
    if (!appt) return res.status(404).json({ error: "Cita no encontrada" });

    const tokens = getAdminTokens();
    if (!tokens) return res.status(401).json({ error: "Google no conectado" });

    try {
      oauth2Client.setCredentials(tokens);

      if (appt.eventId) {
        try {
          await calendar.events.get({ calendarId: "primary", eventId: appt.eventId });
          return res.json({ success: true, eventId: appt.eventId, message: "El evento ya existe en el calendario" });
        } catch (e) {
          // Event was deleted from Google Calendar, create a new one
        }
      }

      const event = await calendar.events.insert({
        calendarId: "primary",
        requestBody: {
          summary: `Masaje: ${appt.clientName}`,
          description: `Teléfono: ${appt.clientPhone}\nEmail: ${appt.clientEmail}\nServicio: ${appt.massageType || 'No especificado'}`,
          start: { dateTime: appt.startTime, timeZone: "Europe/Madrid" },
          end: { dateTime: appt.endTime, timeZone: "Europe/Madrid" },
          attendees: [{ email: appt.clientEmail }]
        }
      });

      db.prepare("UPDATE appointments SET eventId = ? WHERE id = ?").run(event.data.id, id);
      res.json({ success: true, eventId: event.data.id });
    } catch (e) {
      console.error("Add to calendar error:", e);
      res.status(500).json({ error: "Error al añadir al calendario" });
    }
  });

  // BOT API
  app.post("/api/bot/verify", (req, res) => {
    const { email, verification } = req.body;
    if (!email || !verification) return res.status(400).json({ error: "Email y verificación requeridos" });
    
    const matched = db.prepare("SELECT * FROM appointments WHERE LOWER(clientEmail) = ?").all(email.trim().toLowerCase()) as any[];
    const now = new Date().toISOString();
    const filtered = matched.filter(a => 
      ((a.clientPhone || "").replace(/\s+/g, '') === verification.replace(/\s+/g, '') || 
      a.clientName.toLowerCase().includes(verification.trim().toLowerCase())) &&
      a.startTime > now
    );
    
    if (filtered.length > 0) res.json(filtered);
    else res.status(404).json({ error: "No se encontraron citas futuras." });
  });

  app.post("/api/bot/appointments/:id/reschedule", async (req, res) => {
    const { id } = req.params;
    const { newStartTime } = req.body;
    const appt = db.prepare("SELECT * FROM appointments WHERE id = ?").get(id) as any;
    if (!appt) return res.status(404).json({ error: "Cita no encontrada" });

    const now = new Date();
    if (new Date(appt.startTime) < now) {
      return res.status(400).json({ error: "No se puede reagendar una cita pasada" });
    }

    const newEnd = new Date(new Date(newStartTime).getTime() + 60*60*1000).toISOString();
    const tokens = getAdminTokens();

    if (tokens && appt.eventId) {
      try {
        oauth2Client.setCredentials(tokens);
        await calendar.events.patch({
          calendarId: "primary",
          eventId: appt.eventId,
          requestBody: { start: { dateTime: newStartTime }, end: { dateTime: newEnd } }
        });

        const dateStr = new Date(newStartTime).toLocaleString('es-ES', { 
          weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid'
        });
        const confirmUrl = `${APP_URL}/api/appointments/${id}/confirm`;
        const manageUrl = `${APP_URL}/?manage=${id}`;
        const actionButtons = `
<div style="margin:25px 0;">
  <p style="font-size:15px;color:#A0A3A1;line-height:1.6;">Por favor, confirma tu asistencia o reagenda si lo necesitas:</p>
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:10px 0;">
    <a href="${confirmUrl}" style="display:inline-block;background:#059669;color:#ffffff;text-decoration:none;padding:15px 30px;border-radius:12px;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;margin:0 6px 8px;">✓ Sí, asistiré</a>
    <a href="${manageUrl}" style="display:inline-block;background:#3B82F6;color:#ffffff;text-decoration:none;padding:15px 30px;border-radius:12px;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;margin:0 6px 8px;">↻ No, reagendar</a>
  </td></tr></table>
  <p style="font-size:12px;color:#7A7D7B;line-height:1.5;margin-top:10px;">Si no respondes, te enviaremos un recordatorio más tarde.</p>
</div>`;
        const html = getHtmlTemplate(
          "Cita Reagendada",
          `<p>Tu cita ha sido movida con éxito a través del asistente virtual. Por favor, confírmanos tu asistencia en el nuevo horario seleccionado.</p>${actionButtons}`,
          appt.clientName,
          dateStr,
          id,
          appt.massageType
        );
        await sendEmail(appt.clientEmail, "Cita Reagendada - Llanos Studio", html);
      } catch (e) { console.error(e); }
    }

    db.prepare("UPDATE appointments SET startTime = ?, endTime = ?, status = 'rescheduled' WHERE id = ?").run(newStartTime, newEnd, id);
    res.json({ ...appt, startTime: newStartTime, endTime: newEnd, status: 'rescheduled' });
  });

  app.post("/api/bot/appointments/:id/cancel", async (req, res) => {
    const { id } = req.params;
    const { email } = req.body;
    
    if (!email) return res.status(400).json({ error: "Email requerido para la cancelación" });

    const appt = db.prepare("SELECT * FROM appointments WHERE id = ?").get(id) as any;
    if (!appt) return res.status(404).json({ error: "Cita no encontrada" });
    
    // Verify that the email matches the appointment's clientEmail
    if (appt.clientEmail.toLowerCase() !== email.toLowerCase()) {
      return res.status(403).json({ error: "No tienes permiso para cancelar esta cita" });
    }
    
    const now = new Date();
    if (new Date(appt.startTime) < now) {
      return res.status(400).json({ error: "No se puede cancelar una cita pasada" });
    }
    
    const tokens = getAdminTokens();
    if (tokens && appt.eventId) {
      try {
        oauth2Client.setCredentials(tokens);
        await calendar.events.delete({ calendarId: "primary", eventId: appt.eventId });
        
        const dateStr = new Date(appt.startTime).toLocaleString('es-ES', { 
          weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid'
        });
        const html = getHtmlTemplate(
          "Cita Cancelada",
          `<p>Tu cita ha sido cancelada con éxito a través de nuestro asistente virtual.</p>`,
          appt.clientName,
          dateStr
        );
        await sendEmail(appt.clientEmail, "Cita Cancelada - Llanos Studio", html);
        
        const adminEmail = getAdminEmail();
        if (adminEmail) {
          const adminHtml = getHtmlTemplate(
            "Cita Cancelada",
            `<p>La cita de <span style="color: #F9F8F6;">${escapeHtml(appt.clientName)}</span> ha sido cancelada por el cliente a través del asistente virtual.</p>
             <p>Horario cancelado: ${dateStr}<br>Email: ${escapeHtml(appt.clientEmail)}</p>`,
            "Admin Llanos Studio",
            dateStr
          );
          await sendEmail(adminEmail, `Cita Cancelada: ${appt.clientName}`, adminHtml);
        }
      } catch (e) { console.error(e); }
    }
    
    db.prepare("DELETE FROM appointments WHERE id = ?").run(id);
    res.json({ success: true });
  });

  // AI Chat Route
  app.post("/api/chat", async (req, res) => {
     try {
       const { messages } = req.body;
       if (!messages || messages.length === 0) return res.status(400).json({ error: "Mensajes requeridos" });
       if (!ai) return res.status(500).json({ error: "Asistente AI no configurado. Falta GEMINI_API_KEY." });
       const appointments = db.prepare("SELECT * FROM appointments").all() as any[];
       const config = getConfig();

       const chat = ai.chats.create({
         model: "gemini-1.5-flash",
         config: {
           systemInstruction: `Eres el Asistente Concierge de Llanos Studio.
             Tu objetivo es ayudar a los clientes con sus reservas de depilación y diseño de cejas de forma profesional y elegante.
             
             SERVICIOS DISPONIBLES:
             ${config.massageTypes.map(m => `- ${m.name}: ${m.price} (${m.duration})`).join('\n')}
             
             HORARIOS:
             Mañana: ${config.morningHours.join(', ')}
             Tarde: ${config.afternoonHours.join(', ')}
             
             REGLAS:
             - Las citas duran 1 hora.
             - Sé amable, servicial y usa un tono premium.
             - Si el usuario pregunta por precios o tipos de servicios de cejas, usa la lista anterior.`,
           tools: [{
             functionDeclarations: [
               { name: "getAppointments", description: "Lista de todas las citas.", parameters: { type: Type.OBJECT, properties: {} } },
               { name: "bookAppointment", description: "Agenda cita.", parameters: { type: Type.OBJECT, properties: { clientName: { type: Type.STRING }, clientEmail: { type: Type.STRING }, clientPhone: { type: Type.STRING }, startTime: { type: Type.STRING }, massageType: { type: Type.STRING } }, required: ["clientName", "clientEmail", "startTime", "massageType"] } },
               { name: "cancelAppointment", description: "Cancela cita por ID.", parameters: { type: Type.OBJECT, properties: { appointmentId: { type: Type.STRING } }, required: ["appointmentId"] } },
               { name: "updateAppointment", description: "Reagenda cita.", parameters: { type: Type.OBJECT, properties: { appointmentId: { type: Type.STRING }, newStartTime: { type: Type.STRING } }, required: ["appointmentId", "newStartTime"] } }
             ]
           }],
         }
       });

       const lastMsg = messages[messages.length - 1];
       const result = await chat.sendMessage({ message: lastMsg.content });
       
       let responseText = result.text || "";
       let newAppointments = null;

       if (result.functionCalls && result.functionCalls.length > 0) {
          const fnCall = result.functionCalls[0];
          
          if (fnCall.name === "getAppointments") {
             responseText = "Citas actuales: " + JSON.stringify(appointments.map(a => ({ id: a.id, name: a.clientName, time: a.startTime })));
          } else if (fnCall.name === "bookAppointment") {
             const args = fnCall.args as any;
             const endTime = new Date(new Date(args.startTime).getTime() + 60*60*1000).toISOString();
             const id = uuidv4();
             
             db.prepare("INSERT INTO appointments (id, clientName, clientEmail, clientPhone, startTime, endTime, status, massageType, price, duration) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
                .run(id, args.clientName, args.clientEmail, args.clientPhone || "", args.startTime, endTime, 'confirmed', args.massageType || 'Diseño de Cejas', args.price || null, args.duration || null);
             
             responseText = `¡Cita agendada para ${args.clientName} (${args.massageType || 'Diseño de Cejas'}) a las ${new Date(args.startTime).toLocaleString('es-ES')}!`;
          } else if (fnCall.name === "cancelAppointment") {
             const args = fnCall.args as any;
             db.prepare("DELETE FROM appointments WHERE id = ?").run(args.appointmentId);
             responseText = `Cita cancelada.`;
          } else if (fnCall.name === "updateAppointment") {
              const args = fnCall.args as any;
              const appt = db.prepare("SELECT * FROM appointments WHERE id = ?").get(args.appointmentId) as any;
              if (appt) {
                const endTime = new Date(new Date(args.newStartTime).getTime() + 60*60*1000).toISOString();
                db.prepare("UPDATE appointments SET startTime = ?, endTime = ?, status = 'rescheduled' WHERE id = ?").run(args.newStartTime, endTime, args.appointmentId);
                
                const tokens = getAdminTokens();
                if (tokens) {
                  try {
                    const dateStr = new Date(args.newStartTime).toLocaleString('es-ES', { 
                      weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid'
                    });
                    const confirmUrl = `${APP_URL}/api/appointments/${appt.id}/confirm`;
                    const manageUrl = `${APP_URL}/?manage=${appt.id}`;
                    const actionButtons = `
<div style="margin:25px 0;">
  <p style="font-size:15px;color:#A0A3A1;line-height:1.6;">Por favor, confirma tu asistencia o reagenda si lo necesitas:</p>
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:10px 0;">
    <a href="${confirmUrl}" style="display:inline-block;background:#059669;color:#ffffff;text-decoration:none;padding:15px 30px;border-radius:12px;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;margin:0 6px 8px;">✓ Sí, asistiré</a>
    <a href="${manageUrl}" style="display:inline-block;background:#3B82F6;color:#ffffff;text-decoration:none;padding:15px 30px;border-radius:12px;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;margin:0 6px 8px;">↻ No, reagendar</a>
  </td></tr></table>
  <p style="font-size:12px;color:#7A7D7B;line-height:1.5;margin-top:10px;">Si no respondes, te enviaremos un recordatorio más tarde.</p>
</div>`;
                    const html = getHtmlTemplate(
                      "Cita Reagendada",
                      `<p>Tu cita ha sido modificada con éxito a través del asistente virtual. Por favor, confírmanos tu asistencia en el nuevo horario seleccionado.</p>${actionButtons}`,
                      appt.clientName,
                      dateStr,
                      appt.id,
                      appt.massageType
                    );
                    await sendEmail(appt.clientEmail, "Cita Reagendada - Llanos Studio", html);
                  } catch (e) { console.error("AI reschedule email error:", e); }
                }
              }
              responseText = `Cita movida a las ${new Date(args.newStartTime).toLocaleString('es-ES')}.`;
           }
       }
       res.json({ reply: responseText, functionCalled: result.functionCalls?.[0]?.name, newAppointments });
     } catch(e) {
        console.error(e);
        res.status(500).json({error: "Error AI"});
     }
  });


  // Scheduler: send address email 2 hours before each appointment
  const checkAndSendAddressEmails = async () => {
    if (addressEmailRunning) return;
    addressEmailRunning = true;
    try {
      if (!getAdminTokens()) return;

      const now = new Date();
      const twoHoursLater = new Date(now.getTime() + 2 * 60 * 60 * 1000);
      const tolerance = 5 * 60 * 1000;
      const lowerBound = new Date(twoHoursLater.getTime() - tolerance).toISOString();
      const upperBound = new Date(twoHoursLater.getTime() + tolerance).toISOString();

      const rows = db.prepare(
        "SELECT * FROM appointments WHERE startTime BETWEEN ? AND ? AND status = 'attending' AND (addressSent IS NULL OR addressSent = 0)"
      ).all(lowerBound, upperBound) as any[];

      const cfg = getConfig();

      for (const appt of rows) {
        try {
          const loc = db.prepare("SELECT * FROM locations WHERE id = ?").get(appt.locationId) as any;
          const address = loc ? loc.address : cfg.address;
          const locationStr = loc ? `${loc.name} - ${loc.address}` : "Llanos Studio";

          if (!address) continue;

          const dateStr = new Date(appt.startTime).toLocaleString('es-ES', {
            weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid'
          });

          const content = `<p>Tu cita de diseño de cejas es en aproximadamente <strong style="color:#FAF5F2;">2 horas</strong>. Aquí tienes la dirección del estudio:</p>
            <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}" target="_blank" style="text-decoration:none;">
              <div style="background:#262021;border:1px solid rgba(176,130,117,0.15);border-radius:12px;padding:24px;margin:25px 0;text-align:center;transition:background 0.2s;">
                <p style="margin:0;font-size:16px;color:#FAF5F2;font-weight:500;line-height:1.6;">${escapeHtml(address)}</p>
                <p style="margin:8px 0 0;font-size:11px;color:#3B82F6;letter-spacing:1px;">📌 Ver en Google Maps →</p>
              </div>
            </a>
            <p style="font-size:14px;color:#A0A3A1;line-height:1.6;">
              <strong style="color:#FAF5F2;">${dateStr}</strong><br>
              Servicio: ${escapeHtml(appt.massageType || 'Diseño de Cejas')}
            </p>
            <p style="font-size:14px;color:#A0A3A1;line-height:1.6;margin-top:20px;">Por favor, llega 5-10 minutos antes para disfrutar de una experiencia completa.</p>`;

          const addressHtml = getHtmlTemplate(
            "Tu cita está cerca",
            content,
            appt.clientName,
            dateStr,
            appt.id,
            appt.massageType,
            locationStr
          );

          await sendEmail(appt.clientEmail, "📍 Dirección del Estudio - Llanos Studio", addressHtml);
          db.prepare("UPDATE appointments SET addressSent = 1 WHERE id = ?").run(appt.id);
          console.log(`Address email sent for appointment ${appt.id}`);
        } catch (e) {
          console.error(`Failed to send address email for ${appt.id}:`, e);
        }
      }
    } finally {
      addressEmailRunning = false;
    }
  };
  addressEmailInterval = setInterval(checkAndSendAddressEmails, 60 * 1000);
  checkAndSendAddressEmails().catch(e => console.error("Initial address check error:", e));

  const checkAndSendReminders = async () => {
    if (remindersRunning) return;
    remindersRunning = true;
    try {
      const tokens = getAdminTokens();
      if (!tokens) return;

      const now = new Date();
      const tolerance = 5 * 60 * 1000;

      // 6 hours before — first reminder
      const sixHoursLater = new Date(now.getTime() + 6 * 60 * 60 * 1000);
      const reminder6hRows = db.prepare(
        "SELECT * FROM appointments WHERE startTime BETWEEN ? AND ? AND status = 'pending' AND (reminder6hSent IS NULL OR reminder6hSent = 0)"
      ).all(
        new Date(sixHoursLater.getTime() - tolerance).toISOString(),
        new Date(sixHoursLater.getTime() + tolerance).toISOString()
      ) as any[];

      for (const appt of reminder6hRows) {
        try {
          const loc = db.prepare("SELECT * FROM locations WHERE id = ?").get(appt.locationId) as any;
          const locationStr = loc ? `${loc.name} - ${loc.address}` : "Llanos Studio";

          const dateStr = new Date(appt.startTime).toLocaleString('es-ES', {
            weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid'
          });
          const confirmUrl = `${APP_URL}/api/appointments/${appt.id}/confirm`;
          const manageUrl = `${APP_URL}/?manage=${appt.id}`;
          const reminderHtml = getHtmlTemplate(
            "Recordatorio de Confirmación",
            `<p>Te recordamos que aún no has confirmado tu asistencia para la siguiente cita:</p>
             <div style="background:#262021;border:1px solid rgba(176,130,117,0.15);border-radius:12px;padding:20px;margin:20px 0;">
               <p style="margin:0;font-size:14px;color:#FAF5F2;"><strong>${dateStr}</strong></p>
               <p style="margin:5px 0 0;font-size:13px;color:#A0A3A1;">${escapeHtml(appt.massageType || 'Diseño de Cejas')}</p>
             </div>
             <div style="margin:20px 0;text-align:center;">
               <a href="${confirmUrl}" style="display:inline-block;background:#059669;color:#fff;text-decoration:none;padding:14px 28px;border-radius:10px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;margin:0 5px 8px;">✓ Confirmar Asistencia</a>
               <a href="${manageUrl}" style="display:inline-block;background:#3B82F6;color:#fff;text-decoration:none;padding:14px 28px;border-radius:10px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;margin:0 5px 8px;">↻ Reagendar</a>
             </div>
             <p style="font-size:13px;color:#7A7D7B;">Si no respondes, te enviaremos otro recordatorio más cerca de la fecha.</p>`,
            appt.clientName,
            dateStr,
            appt.id,
            appt.massageType,
            locationStr
          );
          await sendEmail(appt.clientEmail, "Recordatorio: Confirma tu cita - Llanos Studio", reminderHtml);
          db.prepare("UPDATE appointments SET reminder6hSent = 1 WHERE id = ?").run(appt.id);
          console.log(`Reminder 6h sent for appointment ${appt.id}`);
        } catch (e) {
          console.error(`Failed to send 6h reminder for ${appt.id}:`, e);
        }
      }

      // 2 hours before — second reminder (if still pending)
      const twoHoursLater = new Date(now.getTime() + 2 * 60 * 60 * 1000);
      const reminder2hRows = db.prepare(
        "SELECT * FROM appointments WHERE startTime BETWEEN ? AND ? AND status = 'pending' AND (reminder2hSent IS NULL OR reminder2hSent = 0)"
      ).all(
        new Date(twoHoursLater.getTime() - tolerance).toISOString(),
        new Date(twoHoursLater.getTime() + tolerance).toISOString()
      ) as any[];

      for (const appt of reminder2hRows) {
        try {
          const loc = db.prepare("SELECT * FROM locations WHERE id = ?").get(appt.locationId) as any;
          const locationStr = loc ? `${loc.name} - ${loc.address}` : "Llanos Studio";

          const dateStr = new Date(appt.startTime).toLocaleString('es-ES', {
            weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid'
          });
          const confirmUrl = `${APP_URL}/api/appointments/${appt.id}/confirm`;
          const manageUrl = `${APP_URL}/?manage=${appt.id}`;
          const reminderHtml = getHtmlTemplate(
            "Último Recordatorio",
            `<p>Tu cita es en aproximadamente <strong style="color:#FAF5F2;">2 horas</strong> y aún no has confirmado tu asistencia.</p>
             <div style="background:#262021;border:1px solid rgba(176,130,117,0.15);border-radius:12px;padding:20px;margin:20px 0;">
               <p style="margin:0;font-size:14px;color:#FAF5F2;"><strong>${dateStr}</strong></p>
               <p style="margin:5px 0 0;font-size:13px;color:#A0A3A1;">${escapeHtml(appt.massageType || 'Diseño de Cejas')}</p>
             </div>
             <p style="font-size:15px;color:#A0A3A1;line-height:1.6;">Por favor, confirma si podrás asistir o reagenda a otro horario:</p>
             <div style="margin:20px 0;text-align:center;">
               <a href="${confirmUrl}" style="display:inline-block;background:#059669;color:#fff;text-decoration:none;padding:14px 28px;border-radius:10px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;margin:0 5px 8px;">✓ Sí, asistiré</a>
               <a href="${manageUrl}" style="display:inline-block;background:#3B82F6;color:#fff;text-decoration:none;padding:14px 28px;border-radius:10px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;margin:0 5px 8px;">↻ Reagendar</a>
             </div>`,
            appt.clientName,
            dateStr,
            appt.id,
            appt.massageType,
            locationStr
          );
          await sendEmail(appt.clientEmail, "⏰ Tu cita es pronto - Llanos Studio", reminderHtml);
          db.prepare("UPDATE appointments SET reminder2hSent = 1 WHERE id = ?").run(appt.id);
          console.log(`Reminder 2h sent for appointment ${appt.id}`);
        } catch (e) {
          console.error(`Failed to send 2h reminder for ${appt.id}:`, e);
        }
      }
    } finally {
      remindersRunning = false;
    }
  };
  remindersInterval = setInterval(checkAndSendReminders, 60 * 1000);
  checkAndSendReminders().catch(e => console.error("Initial reminders check error:", e));

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch(e => {
  console.error("Server startup error:", e);
  process.exit(1);
});

// Global error handling - prevent crashes from unhandled rejections
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down...');
  if (addressEmailInterval) clearInterval(addressEmailInterval);
  if (remindersInterval) clearInterval(remindersInterval);
  db.close();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Shutting down...');
  if (addressEmailInterval) clearInterval(addressEmailInterval);
  if (remindersInterval) clearInterval(remindersInterval);
  db.close();
  process.exit(0);
});
