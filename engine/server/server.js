import bcrypt from "bcrypt";
import express from "express";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool, transaction } from "./db.js";

const app = express();
const port = Number(process.env.PORT || 3001);
const sessionDays = Number(process.env.SESSION_DAYS || 7);
const directory = path.dirname(fileURLToPath(import.meta.url));
const assetDirectory = path.join(directory, "../data/assets");
await mkdir(assetDirectory, { recursive: true });

app.use(express.json({ limit: "12mb" }));

function parseCookies(header = "") {
  return Object.fromEntries(header.split(";").filter(Boolean).map((entry) => {
    const [name, ...value] = entry.trim().split("=");
    return [name, decodeURIComponent(value.join("="))];
  }));
}

function tokenHash(token) {
  return createHash("sha256").update(token).digest();
}

function sessionCookie(token, maxAge) {
  return [
    `timeline_session=${encodeURIComponent(token)}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${maxAge}`,
  ].join("; ");
}

async function createSession(client, userId) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + sessionDays * 86400000);
  await client.query(
    "INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)",
    [userId, tokenHash(token), expiresAt],
  );
  return { token, expiresAt };
}

async function requireUser(request, response, next) {
  try {
    const token = parseCookies(request.headers.cookie).timeline_session;
    if (!token) return response.status(401).json({ error: "Authentication required" });
    const result = await pool.query(
      `SELECT users.id, users.email
       FROM sessions JOIN users ON users.id = sessions.user_id
       WHERE sessions.token_hash = $1 AND sessions.revoked_at IS NULL
         AND sessions.expires_at > now() AND users.status = 'active'`,
      [tokenHash(token)],
    );
    if (result.rowCount !== 1) return response.status(401).json({ error: "Session expired" });
    request.user = result.rows[0];
    request.sessionToken = token;
    return next();
  } catch (error) {
    return response.status(500).json({ error: error.message });
  }
}

app.post("/api/auth/signup", async (request, response) => {
  const email = String(request.body.email || "").trim().toLowerCase();
  const password = String(request.body.password || "");
  if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 8) {
    return response.status(400).json({ error: "Valid email and 8-character password required" });
  }
  try {
    const result = await transaction(async (client) => {
      const passwordHash = await bcrypt.hash(password, 12);
      const user = await client.query(
        "INSERT INTO users (email) VALUES ($1) RETURNING id, email",
        [email],
      );
      await client.query(
        "INSERT INTO password_credentials (user_id, password_hash) VALUES ($1, $2)",
        [user.rows[0].id, passwordHash],
      );
      await client.query("INSERT INTO user_settings (user_id) VALUES ($1)", [user.rows[0].id]);
      return { user: user.rows[0], session: await createSession(client, user.rows[0].id) };
    });
    response.setHeader("Set-Cookie", sessionCookie(result.session.token, sessionDays * 86400));
    return response.status(201).json({ user: result.user });
  } catch (error) {
    if (error.code === "23505") return response.status(409).json({ error: "Email already registered" });
    return response.status(500).json({ error: error.message });
  }
});

app.post("/api/auth/login", async (request, response) => {
  const email = String(request.body.email || "").trim().toLowerCase();
  const password = String(request.body.password || "");
  try {
    const result = await pool.query(
      `SELECT users.id, users.email, password_credentials.password_hash
       FROM users JOIN password_credentials ON password_credentials.user_id = users.id
       WHERE users.email = $1 AND users.status = 'active'`,
      [email],
    );
    if (result.rowCount !== 1 || !await bcrypt.compare(password, result.rows[0].password_hash)) {
      return response.status(401).json({ error: "Invalid email or password" });
    }
    const session = await createSession(pool, result.rows[0].id);
    response.setHeader("Set-Cookie", sessionCookie(session.token, sessionDays * 86400));
    return response.json({ user: { id: result.rows[0].id, email: result.rows[0].email } });
  } catch (error) {
    return response.status(500).json({ error: error.message });
  }
});

app.get("/api/auth/session", requireUser, (request, response) => {
  response.json({ user: request.user });
});

app.post("/api/auth/logout", requireUser, async (request, response) => {
  await pool.query("UPDATE sessions SET revoked_at = now() WHERE token_hash = $1", [
    tokenHash(request.sessionToken),
  ]);
  response.setHeader("Set-Cookie", sessionCookie("", 0));
  response.status(204).end();
});

app.get("/api/project/save", requireUser, async (request, response) => {
  const result = await pool.query(
    `SELECT projects.id, projects.updated_at AS "savedAt",
       COALESCE(jsonb_array_length(project_revisions.document->'editingVideos'), 0) AS "videoCount",
       COALESCE(jsonb_array_length(project_revisions.document->'editingMusic'), 0) AS "musicCount"
     FROM projects
     JOIN project_revisions ON project_revisions.project_id = projects.id
       AND project_revisions.version = projects.current_version
     WHERE projects.owner_id = $1 AND projects.status = 'active'
     ORDER BY projects.updated_at DESC`,
    [request.user.id],
  );
  response.json({ projects: result.rows });
});

app.get("/api/project/save/:projectId", requireUser, async (request, response) => {
  const result = await pool.query(
    `SELECT project_revisions.document
     FROM projects JOIN project_revisions ON project_revisions.project_id = projects.id
       AND project_revisions.version = projects.current_version
     WHERE projects.id = $1 AND projects.owner_id = $2 AND projects.status = 'active'`,
    [request.params.projectId, request.user.id],
  );
  if (result.rowCount !== 1) return response.status(404).json({ error: "Project not found" });
  return response.json(result.rows[0].document);
});

app.put("/api/project/save", requireUser, async (request, response) => {
  try {
    const saved = await transaction(async (client) => {
      const project = await client.query(
        "INSERT INTO projects (owner_id, current_version) VALUES ($1, 1) RETURNING id, updated_at",
        [request.user.id],
      );
      await client.query(
        `INSERT INTO project_revisions (project_id, version, document, created_by)
         VALUES ($1, 1, $2, $3)`,
        [project.rows[0].id, request.body, request.user.id],
      );
      return project.rows[0];
    });
    return response.json({ saved: true, projectId: saved.id, savedAt: saved.updated_at });
  } catch (error) {
    return response.status(400).json({ error: error.message });
  }
});

for (const [route, key] of [["music", "editingMusic"], ["text", "textOverlays"]]) {
  app.get(`/api/project/${route}`, requireUser, async (request, response) => {
    const result = await pool.query("SELECT settings->$2 AS value FROM user_settings WHERE user_id = $1", [
      request.user.id, key,
    ]);
    response.json(route === "music"
      ? { tracks: result.rows[0]?.value || [] }
      : { overlays: result.rows[0]?.value || [] });
  });
  app.put(`/api/project/${route}`, requireUser, async (request, response) => {
    await pool.query(
      `INSERT INTO user_settings (user_id, settings, updated_at)
       VALUES ($1, jsonb_build_object($2::text, $3::jsonb), now())
       ON CONFLICT (user_id) DO UPDATE SET
         settings = user_settings.settings || jsonb_build_object($2::text, $3::jsonb),
         updated_at = now()`,
      [request.user.id, key, JSON.stringify(request.body)],
    );
    response.json({ saved: true });
  });
}

async function readRawBody(request, limit = 1024 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new Error("Asset exceeds upload limit");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function uploadAsset(request, response, mediaKind) {
  try {
    const bytes = await readRawBody(request);
    const id = randomUUID();
    const storageKey = `${request.user.id}/${id}`;
    const userDirectory = path.join(assetDirectory, request.user.id);
    await mkdir(userDirectory, { recursive: true });
    await writeFile(path.join(assetDirectory, storageKey), bytes);
    const mimeType = String(request.headers["content-type"] || "application/octet-stream");
    await pool.query(
      `INSERT INTO media_assets
       (id, owner_id, storage_key, original_filename, media_kind, mime_type, byte_size, checksum_sha256)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, request.user.id, storageKey, request.headers["x-file-name"] || id,
        mediaKind === "visual" ? (mimeType.startsWith("image/") ? "image" : "video") : "audio",
        mimeType, bytes.length, createHash("sha256").update(bytes).digest()],
    );
    return response.json({ assetId: id, size: bytes.length, url: `/api/${mediaKind === "visual" ? "video" : "audio"}-assets/${id}` });
  } catch (error) {
    return response.status(400).json({ error: error.message });
  }
}

app.post("/api/video-assets", requireUser, (request, response) => uploadAsset(request, response, "visual"));
app.post("/api/audio-assets", requireUser, (request, response) => uploadAsset(request, response, "audio"));

async function serveAsset(request, response) {
  const result = await pool.query(
    "SELECT storage_key, mime_type FROM media_assets WHERE id = $1 AND owner_id = $2",
    [request.params.assetId, request.user.id],
  );
  if (result.rowCount !== 1) return response.status(404).end();
  const filePath = path.join(assetDirectory, result.rows[0].storage_key);
  const details = await stat(filePath);
  const range = request.headers.range?.match(/bytes=(\d+)-(\d*)/);
  response.setHeader("Content-Type", result.rows[0].mime_type);
  response.setHeader("Accept-Ranges", "bytes");
  if (!range) {
    response.setHeader("Content-Length", details.size);
    return response.send(await readFile(filePath));
  }
  const start = Number(range[1]);
  const end = Math.min(range[2] ? Number(range[2]) : details.size - 1, details.size - 1);
  if (!Number.isSafeInteger(start) || start > end || start >= details.size) {
    response.status(416).setHeader("Content-Range", `bytes */${details.size}`);
    return response.end();
  }
  const bytes = await readFile(filePath);
  response.status(206);
  response.setHeader("Content-Range", `bytes ${start}-${end}/${details.size}`);
  response.setHeader("Content-Length", end - start + 1);
  return response.send(bytes.subarray(start, end + 1));
}

app.get("/api/video-assets/:assetId", requireUser, serveAsset);
app.get("/api/audio-assets/:assetId", requireUser, serveAsset);

app.use((error, request, response, next) => {
  if (response.headersSent) return next(error);
  return response.status(500).json({ error: error.message });
});

const server = app.listen(port, "127.0.0.1", () => {
  console.log(`Timeline Studio backend listening on http://127.0.0.1:${port}`);
});

async function shutdown() {
  server.close();
  await pool.end();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
