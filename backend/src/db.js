import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import { runVersionedMigrations } from "./database/migrations.js";

const { Pool } = pg;

const PROCESSING_STATUSES = [
  "submitted",
  "extracting_content",
  "generating_points",
  "generating_questions",
  "quality_checking",
  "auto_regenerating_questions"
];

const INTERRUPTED_STATUS = "failed_questions";
const INTERRUPTED_TEXT = "生成中断，请重新生成";
const INTERRUPTED_REASON = "云端服务在生成过程中重启，任务已中断，请点击重新生成。";
const DEFAULT_GENERATION_JOB_LOCK_MS = readPositiveInt(process.env.GENERATION_JOB_LOCK_MS, 420_000);
const DEFAULT_GENERATION_JOB_MAX_ATTEMPTS = readPositiveInt(process.env.GENERATION_JOB_MAX_ATTEMPTS, 2);

const connectionString = process.env.DATABASE_URL || "";

export const hasDatabase = Boolean(connectionString);

export const databasePool = hasDatabase
  ? new Pool({
      connectionString,
      ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined
    })
  : null;

const pool = databasePool;

export async function initDatabase() {
  if (!pool) return { ok: false, storage: "memory" };

  await pool.query(`
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      provider_subject_hash TEXT NOT NULL,
      email_hash TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ,
      deleted_reason TEXT NOT NULL DEFAULT ''
    );

    ALTER TABLE accounts
      ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'apple',
      ADD COLUMN IF NOT EXISTS provider_subject_hash TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS email_hash TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS deleted_reason TEXT NOT NULL DEFAULT '';

    CREATE UNIQUE INDEX IF NOT EXISTS accounts_provider_subject_active_uidx
      ON accounts(provider, provider_subject_hash)
      WHERE deleted_at IS NULL;

    CREATE TABLE IF NOT EXISTS account_device_links (
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
      linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (account_id, device_id)
    );

    CREATE INDEX IF NOT EXISTS account_device_links_device_idx
      ON account_device_links(device_id, last_seen_at DESC);

    CREATE TABLE IF NOT EXISTS account_deletion_jobs (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      requested_device_id TEXT NOT NULL,
      status TEXT NOT NULL,
      metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      error_message TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS account_deletion_jobs_account_created_idx
      ON account_deletion_jobs(account_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS chapters (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      title TEXT NOT NULL,
      chapter_json JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ,
      deleted_reason TEXT NOT NULL DEFAULT ''
    );

    ALTER TABLE chapters
      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS deleted_reason TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS account_id TEXT;

    CREATE INDEX IF NOT EXISTS chapters_device_created_idx
      ON chapters(device_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS chapters_device_active_created_idx
      ON chapters(device_id, created_at DESC)
      WHERE deleted_at IS NULL;

    CREATE INDEX IF NOT EXISTS chapters_account_active_created_idx
      ON chapters(account_id, created_at DESC)
      WHERE deleted_at IS NULL AND account_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
      chapter_id TEXT NOT NULL,
      notification_json JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ,
      deleted_reason TEXT NOT NULL DEFAULT ''
    );

    ALTER TABLE notifications
      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS deleted_reason TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS account_id TEXT;

    CREATE INDEX IF NOT EXISTS notifications_device_created_idx
      ON notifications(device_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS notifications_device_active_created_idx
      ON notifications(device_id, created_at DESC)
      WHERE deleted_at IS NULL;

    CREATE INDEX IF NOT EXISTS notifications_account_active_created_idx
      ON notifications(account_id, created_at DESC)
      WHERE deleted_at IS NULL AND account_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS generation_jobs (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
      chapter_id TEXT NOT NULL,
      status TEXT NOT NULL,
      current_stage TEXT NOT NULL,
      error_message TEXT NOT NULL DEFAULT '',
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finished_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ,
      deleted_reason TEXT NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS generation_jobs_device_chapter_idx
      ON generation_jobs(device_id, chapter_id, updated_at DESC);

    ALTER TABLE generation_jobs
      ADD COLUMN IF NOT EXISTS job_type TEXT NOT NULL DEFAULT 'create_chapter',
      ADD COLUMN IF NOT EXISTS payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS queue_status TEXT NOT NULL DEFAULT 'completed',
      ADD COLUMN IF NOT EXISTS attempt_count INT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS max_attempts INT NOT NULL DEFAULT 2,
      ADD COLUMN IF NOT EXISTS available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS locked_by TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS last_error TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS idempotency_key TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS deleted_reason TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS account_id TEXT;

    CREATE INDEX IF NOT EXISTS generation_jobs_queue_idx
      ON generation_jobs(queue_status, available_at, updated_at);

    CREATE INDEX IF NOT EXISTS generation_jobs_lock_idx
      ON generation_jobs(queue_status, locked_until);

    CREATE INDEX IF NOT EXISTS generation_jobs_idempotency_idx
      ON generation_jobs(device_id, idempotency_key, updated_at DESC)
      WHERE idempotency_key <> '';

    CREATE UNIQUE INDEX IF NOT EXISTS generation_jobs_pending_idempotency_uidx
      ON generation_jobs(device_id, idempotency_key)
      WHERE idempotency_key <> '' AND queue_status IN ('queued', 'running');

    CREATE TABLE IF NOT EXISTS generation_quota_claims (
      device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
      request_id TEXT NOT NULL,
      quota_day DATE NOT NULL,
      account_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (device_id, request_id)
    );

    ALTER TABLE generation_quota_claims
      ADD COLUMN IF NOT EXISTS account_id TEXT;

    CREATE INDEX IF NOT EXISTS generation_quota_claims_device_day_idx
      ON generation_quota_claims(device_id, quota_day, created_at DESC);

    CREATE INDEX IF NOT EXISTS generation_quota_claims_account_day_idx
      ON generation_quota_claims(account_id, quota_day, created_at DESC)
      WHERE account_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS device_push_tokens (
      device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
      token TEXT NOT NULL,
      platform TEXT NOT NULL DEFAULT 'ios',
      environment TEXT NOT NULL DEFAULT 'production',
      preferred_language TEXT NOT NULL DEFAULT 'zh-Hans',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (device_id, token)
    );

    ALTER TABLE device_push_tokens
      ADD COLUMN IF NOT EXISTS preferred_language TEXT NOT NULL DEFAULT 'zh-Hans',
      ADD COLUMN IF NOT EXISTS account_id TEXT;

    CREATE INDEX IF NOT EXISTS device_push_tokens_device_idx
      ON device_push_tokens(device_id, updated_at DESC);

    CREATE INDEX IF NOT EXISTS device_push_tokens_account_idx
      ON device_push_tokens(account_id, updated_at DESC)
      WHERE account_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS favorite_questions (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
      chapter_id TEXT NOT NULL,
      question_id TEXT NOT NULL,
      favorite_json JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ,
      deleted_reason TEXT NOT NULL DEFAULT '',
      UNIQUE (device_id, chapter_id, question_id)
    );

    ALTER TABLE favorite_questions
      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS deleted_reason TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS account_id TEXT;

    CREATE INDEX IF NOT EXISTS favorite_questions_device_created_idx
      ON favorite_questions(device_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS favorite_questions_device_active_created_idx
      ON favorite_questions(device_id, created_at DESC)
      WHERE deleted_at IS NULL;

    CREATE INDEX IF NOT EXISTS favorite_questions_account_active_created_idx
      ON favorite_questions(account_id, created_at DESC)
      WHERE deleted_at IS NULL AND account_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      snapshot_json JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS audit_events_device_created_idx
      ON audit_events(device_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS audit_events_entity_idx
      ON audit_events(entity_type, entity_id, created_at DESC);
  `);
  await runVersionedMigrations(pool);

  await markInterruptedGenerationJobs();
  return { ok: true, storage: "postgres" };
}

export async function checkDatabase() {
  if (!pool) return { ok: false };
  try {
    await pool.query("SELECT 1");
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "database unavailable" };
  }
}

export async function chapterCount() {
  if (!pool) return 0;
  const result = await pool.query("SELECT COUNT(*)::int AS count FROM chapters WHERE deleted_at IS NULL");
  return result.rows[0]?.count || 0;
}

export async function ensureDevice(deviceId) {
  if (!pool) return;
  await pool.query(
    `INSERT INTO devices (id)
     VALUES ($1)
     ON CONFLICT (id)
     DO UPDATE SET last_seen_at = NOW()`,
    [deviceId]
  );
}

export async function incrementCapturePersistenceEpochForDevice(queryable, deviceId) {
  const stableDeviceId = String(deviceId || "").trim();
  if (!queryable || !stableDeviceId) throw new Error("queryable and deviceId are required");
  const result = await queryable.query(
    `UPDATE devices
        SET capture_persistence_epoch = capture_persistence_epoch + 1,
            last_seen_at = NOW()
      WHERE id = $1
      RETURNING id, capture_persistence_epoch`,
    [stableDeviceId]
  );
  if (!result.rows[0]) throw new Error("capture persistence device not found");
  return {
    deviceIds: result.rows.map((row) => String(row.id)),
    epochs: result.rows.map((row) => String(row.capture_persistence_epoch))
  };
}

export async function incrementCapturePersistenceEpochsForAccount(queryable, {
  accountId,
  requestedDeviceId
} = {}) {
  const stableAccountId = String(accountId || "").trim();
  const stableDeviceId = String(requestedDeviceId || "").trim();
  if (!queryable || !stableAccountId || !stableDeviceId) {
    throw new Error("queryable, accountId and requestedDeviceId are required");
  }
  const result = await queryable.query(
    `UPDATE devices
        SET capture_persistence_epoch = capture_persistence_epoch + 1,
            last_seen_at = NOW()
      WHERE id IN (
        SELECT device_id FROM account_device_links WHERE account_id = $1
        UNION
        SELECT device_id FROM captures WHERE account_id = $1
        UNION
        SELECT $2::text
      )
      RETURNING id, capture_persistence_epoch`,
    [stableAccountId, stableDeviceId]
  );
  return {
    deviceIds: result.rows.map((row) => String(row.id)),
    epochs: result.rows.map((row) => String(row.capture_persistence_epoch))
  };
}

export function hashAccountIdentifier(value, options = {}) {
  const provider = normalizeAccountProvider(options.provider);
  const raw = String(value || "").trim();
  if (!raw) throw new Error("account identifier is required");
  const salt = process.env.RECALLO_ACCOUNT_HASH_SALT || "recallo-account-v1";
  return createHash("sha256").update(`${salt}:${provider}:${raw}`).digest("hex");
}

export function normalizeAccountProvider(value = "") {
  return String(value || "").trim().toLowerCase() === "apple" ? "apple" : String(value || "").trim().toLowerCase();
}

function createId(prefix) {
  return `${prefix}-${randomUUID()}`;
}

export async function findOrCreateAccountForProvider({
  provider = "apple",
  providerSubject,
  email = "",
  deviceId = ""
} = {}) {
  if (!pool) return null;
  const normalizedProvider = normalizeAccountProvider(provider);
  if (normalizedProvider !== "apple") throw new Error("unsupported account provider");
  const subjectHash = hashAccountIdentifier(providerSubject, { provider: normalizedProvider });
  const emailHash = String(email || "").trim()
    ? hashAccountIdentifier(String(email).trim().toLowerCase(), { provider: `${normalizedProvider}:email` })
    : "";
  const stableDeviceId = String(deviceId || "").trim();
  if (!stableDeviceId) throw new Error("deviceId is required to link account");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO devices (id)
       VALUES ($1)
       ON CONFLICT (id)
       DO UPDATE SET last_seen_at = NOW()`,
      [stableDeviceId]
    );

    let account = await selectAccountByProviderSubject(client, normalizedProvider, subjectHash);
    if (!account) {
      try {
        const created = await client.query(
          `INSERT INTO accounts (id, provider, provider_subject_hash, email_hash, created_at, updated_at)
           VALUES ($1, $2, $3, $4, NOW(), NOW())
           RETURNING id, provider, provider_subject_hash, email_hash, created_at, updated_at, deleted_at`,
          [createId("account"), normalizedProvider, subjectHash, emailHash]
        );
        account = created.rows[0];
      } catch (error) {
        if (error?.code !== "23505") throw error;
        account = await selectAccountByProviderSubject(client, normalizedProvider, subjectHash);
      }
    } else if (emailHash && !account.email_hash) {
      const updated = await client.query(
        `UPDATE accounts
            SET email_hash = $2,
                updated_at = NOW()
          WHERE id = $1
          RETURNING id, provider, provider_subject_hash, email_hash, created_at, updated_at, deleted_at`,
        [account.id, emailHash]
      );
      account = updated.rows[0];
    }

    await client.query(
      `INSERT INTO account_device_links (account_id, device_id, linked_at, last_seen_at)
       VALUES ($1, $2, NOW(), NOW())
       ON CONFLICT (account_id, device_id)
       DO UPDATE SET last_seen_at = NOW()`,
      [account.id, stableDeviceId]
    );

    const ownership = await attachDeviceDataToAccount(client, {
      accountId: account.id,
      deviceId: stableDeviceId
    });
    await insertAuditEvent(client, {
      deviceId: stableDeviceId,
      action: "account.link_device",
      entityType: "account",
      entityId: account.id,
      metadata: {
        provider: normalizedProvider,
        ownership
      },
      snapshot: null
    });
    await client.query("COMMIT");
    return {
      account: serializeAccountRow(account),
      linkedDeviceId: stableDeviceId,
      ownership
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getAccountForDevice(deviceId) {
  if (!pool) return null;
  await ensureDevice(deviceId);
  const result = await pool.query(
    `SELECT a.id, a.provider, a.provider_subject_hash, a.email_hash, a.created_at, a.updated_at, a.deleted_at
       FROM account_device_links l
       JOIN accounts a ON a.id = l.account_id
      WHERE l.device_id = $1
        AND a.deleted_at IS NULL
      ORDER BY l.last_seen_at DESC
      LIMIT 1`,
    [deviceId]
  );
  return result.rows[0] ? serializeAccountRow(result.rows[0]) : null;
}

async function getLinkedAccountId(queryable, deviceId) {
  const result = await queryable.query(
    `SELECT a.id
       FROM account_device_links l
       JOIN accounts a ON a.id = l.account_id
      WHERE l.device_id = $1
        AND a.deleted_at IS NULL
      ORDER BY l.last_seen_at DESC
      LIMIT 1`,
    [deviceId]
  );
  return result.rows[0]?.id || null;
}

async function selectAccountByProviderSubject(queryable, provider, providerSubjectHash) {
  const result = await queryable.query(
    `SELECT id, provider, provider_subject_hash, email_hash, created_at, updated_at, deleted_at
       FROM accounts
      WHERE provider = $1
        AND provider_subject_hash = $2
        AND deleted_at IS NULL
      LIMIT 1`,
    [provider, providerSubjectHash]
  );
  return result.rows[0] || null;
}

function serializeAccountRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    provider: row.provider,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    deletedAt: toIsoString(row.deleted_at)
  };
}

async function attachDeviceDataToAccount(queryable, { accountId, deviceId } = {}) {
  const tables = [
    "chapters",
    "favorite_questions",
    "notifications",
    "generation_jobs",
    "generation_quota_claims",
    "device_push_tokens",
    "captures",
    "memory_cards"
  ];
  const counts = {};
  for (const table of tables) {
    const result = await queryable.query(
      `UPDATE ${table}
          SET account_id = $1
        WHERE device_id = $2
          AND account_id IS NULL`,
      [accountId, deviceId]
    );
    counts[table] = result.rowCount || 0;
  }
  return counts;
}

export async function deleteAccountData(accountId, {
  requestedDeviceId = "",
  reason = "account_deleted_by_user"
} = {}) {
  if (!pool) return null;
  const stableAccountId = String(accountId || "").trim();
  const stableDeviceId = String(requestedDeviceId || "").trim();
  if (!stableAccountId || !stableDeviceId) throw new Error("accountId and requestedDeviceId are required");
  await ensureDevice(stableDeviceId);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const jobId = createId("account-deletion");
    await client.query(
      `INSERT INTO account_deletion_jobs (id, account_id, requested_device_id, status, metadata_json, created_at)
       VALUES ($1, $2, $3, 'running', $4::jsonb, NOW())`,
      [jobId, stableAccountId, stableDeviceId, JSON.stringify({ reason })]
    );

    const chapters = await softDeleteRowsByAccount(client, {
      table: "chapters",
      jsonColumn: "chapter_json",
      accountId: stableAccountId,
      reason
    });
    const favorites = await softDeleteRowsByAccount(client, {
      table: "favorite_questions",
      jsonColumn: "favorite_json",
      accountId: stableAccountId,
      reason
    });
    const notifications = await softDeleteRowsByAccount(client, {
      table: "notifications",
      jsonColumn: "notification_json",
      accountId: stableAccountId,
      reason
    });
    const generationJobs = await softDeleteGenerationJobsByAccount(client, {
      accountId: stableAccountId,
      reason
    });
    const capturePersistenceEpochs = await incrementCapturePersistenceEpochsForAccount(client, {
      accountId: stableAccountId,
      requestedDeviceId: stableDeviceId
    });
    const captureMemoryCards = await client.query(
      "DELETE FROM captures WHERE account_id = $1 RETURNING id",
      [stableAccountId]
    );
    const pushTokens = await client.query(
      `DELETE FROM device_push_tokens
        WHERE account_id = $1
        RETURNING token, platform, environment, preferred_language, created_at, updated_at`,
      [stableAccountId]
    );
    const quotaClaims = await client.query(
      `DELETE FROM generation_quota_claims
        WHERE account_id = $1
        RETURNING request_id, quota_day, created_at`,
      [stableAccountId]
    );
    const links = await client.query(
      `DELETE FROM account_device_links
        WHERE account_id = $1
        RETURNING device_id, linked_at, last_seen_at`,
      [stableAccountId]
    );
    await client.query(
      `UPDATE accounts
          SET deleted_at = NOW(),
              deleted_reason = $2,
              updated_at = NOW()
        WHERE id = $1
          AND deleted_at IS NULL`,
      [stableAccountId, reason]
    );
    const counts = {
      chapters: chapters.rowCount || 0,
      favorites: favorites.rowCount || 0,
      notifications: notifications.rowCount || 0,
      generationJobs: generationJobs.rowCount || 0,
      captureMemoryCards: captureMemoryCards.rowCount || 0,
      capturePersistenceEpochs: capturePersistenceEpochs.deviceIds.length,
      pushTokens: pushTokens.rowCount || 0,
      quotaClaims: quotaClaims.rowCount || 0,
      deviceLinks: links.rowCount || 0
    };
    await insertAuditEvent(client, {
      deviceId: stableDeviceId,
      action: "account.soft_delete",
      entityType: "account",
      entityId: stableAccountId,
      metadata: {
        reason,
        counts
      },
      snapshot: {
        chapters: chapters.rows.map((row) => row.snapshot),
        favorites: favorites.rows.map((row) => row.snapshot),
        notifications: notifications.rows.map((row) => row.snapshot),
        generationJobs: generationJobs.rows.map((row) => row.snapshot),
        pushTokens: pushTokens.rows,
        quotaClaims: quotaClaims.rows,
        deviceLinks: links.rows
      }
    });
    await client.query(
      `UPDATE account_deletion_jobs
          SET status = 'completed',
              completed_at = NOW(),
              metadata_json = $2::jsonb
        WHERE id = $1`,
      [jobId, JSON.stringify({ reason, counts })]
    );
    await client.query("COMMIT");
    return { accountId: stableAccountId, deletionJobId: jobId, counts };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listChapters(deviceId) {
  await ensureDevice(deviceId);
  const result = await pool.query(
    `SELECT chapter_json
       FROM chapters
      WHERE device_id = $1
        AND deleted_at IS NULL
      ORDER BY created_at DESC`,
    [deviceId]
  );
  return result.rows.map((row) => row.chapter_json);
}

export async function getChapter(deviceId, chapterId) {
  await ensureDevice(deviceId);
  const result = await pool.query(
    `SELECT chapter_json
       FROM chapters
      WHERE device_id = $1
        AND id = $2
        AND deleted_at IS NULL`,
    [deviceId, chapterId]
  );
  return result.rows[0]?.chapter_json || null;
}

export async function upsertChapter(deviceId, chapter) {
  await ensureDevice(deviceId);
  await pool.query(
    `INSERT INTO chapters (id, device_id, account_id, status, title, chapter_json, created_at, updated_at)
     VALUES (
       $1,
       $2,
       (SELECT account_id FROM account_device_links WHERE device_id = $2 ORDER BY last_seen_at DESC LIMIT 1),
       $3,
       $4,
       $5::jsonb,
       $6,
       $7
     )
     ON CONFLICT (id)
     DO UPDATE SET
       account_id = COALESCE(chapters.account_id, EXCLUDED.account_id),
       status = EXCLUDED.status,
       title = EXCLUDED.title,
       chapter_json = EXCLUDED.chapter_json,
       updated_at = EXCLUDED.updated_at,
       deleted_at = NULL,
       deleted_reason = ''`,
    [
      chapter.id,
      deviceId,
      chapter.status || "completed",
      chapter.title || "未命名章节",
      JSON.stringify(chapter),
      chapter.createdAt || new Date().toISOString(),
      chapter.updatedAt || new Date().toISOString()
    ]
  );
  return getChapter(deviceId, chapter.id);
}

export async function deleteChapter(deviceId, chapterId) {
  await ensureDevice(deviceId);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const chapter = await softDeleteRows(client, {
      table: "chapters",
      jsonColumn: "chapter_json",
      deviceId,
      whereSql: "id = $2",
      params: [chapterId],
      reason: "chapter_deleted_by_user"
    });
    if (chapter.rowCount === 0) {
      await client.query("ROLLBACK");
      return false;
    }

    const favorites = await softDeleteRows(client, {
      table: "favorite_questions",
      jsonColumn: "favorite_json",
      deviceId,
      whereSql: "chapter_id = $2",
      params: [chapterId],
      reason: "chapter_deleted_by_user"
    });
    const notifications = await softDeleteRows(client, {
      table: "notifications",
      jsonColumn: "notification_json",
      deviceId,
      whereSql: "chapter_id = $2",
      params: [chapterId],
      reason: "chapter_deleted_by_user"
    });
    const jobs = await softDeleteGenerationJobs(client, {
      deviceId,
      whereSql: "chapter_id = $2",
      params: [chapterId],
      reason: "chapter_deleted_by_user"
    });
    await insertAuditEvent(client, {
      deviceId,
      action: "chapter.soft_delete",
      entityType: "chapter",
      entityId: chapterId,
      metadata: {
        reason: "chapter_deleted_by_user",
        cascade: {
          favorites: favorites.rowCount,
          notifications: notifications.rowCount,
          generationJobs: jobs.rowCount
        }
      },
      snapshot: {
        chapter: chapter.rows[0]?.snapshot || null,
        favorites: favorites.rows.map((row) => row.snapshot),
        notifications: notifications.rows.map((row) => row.snapshot),
        generationJobs: jobs.rows.map((row) => row.snapshot)
      }
    });
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteDeviceData(deviceId) {
  await ensureDevice(deviceId);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const capturePersistenceEpochs = await incrementCapturePersistenceEpochForDevice(client, deviceId);
    const pushTokens = await client.query(
      `DELETE FROM device_push_tokens
        WHERE device_id = $1
        RETURNING token, platform, environment, preferred_language, created_at, updated_at`,
      [deviceId]
    );
    const favorites = await softDeleteRows(client, {
      table: "favorite_questions",
      jsonColumn: "favorite_json",
      deviceId,
      whereSql: "TRUE",
      reason: "device_data_deleted_by_user"
    });
    const notifications = await softDeleteRows(client, {
      table: "notifications",
      jsonColumn: "notification_json",
      deviceId,
      whereSql: "TRUE",
      reason: "device_data_deleted_by_user"
    });
    const generationJobs = await softDeleteGenerationJobs(client, {
      deviceId,
      whereSql: "TRUE",
      reason: "device_data_deleted_by_user"
    });
    const chapters = await softDeleteRows(client, {
      table: "chapters",
      jsonColumn: "chapter_json",
      deviceId,
      whereSql: "TRUE",
      reason: "device_data_deleted_by_user"
    });
    const captureMemoryCards = await client.query(
      "DELETE FROM captures WHERE device_id = $1 RETURNING id",
      [deviceId]
    );
    await insertAuditEvent(client, {
      deviceId,
      action: "device_data.soft_delete",
      entityType: "device",
      entityId: deviceId,
      metadata: {
        reason: "device_data_deleted_by_user",
        counts: {
          chapters: chapters.rowCount,
          notifications: notifications.rowCount,
          generationJobs: generationJobs.rowCount,
          favorites: favorites.rowCount,
          pushTokens: pushTokens.rowCount,
          captureMemoryCards: captureMemoryCards.rowCount,
          capturePersistenceEpochs: capturePersistenceEpochs.deviceIds.length
        }
      },
      snapshot: {
        chapters: chapters.rows.map((row) => row.snapshot),
        notifications: notifications.rows.map((row) => row.snapshot),
        generationJobs: generationJobs.rows.map((row) => row.snapshot),
        favorites: favorites.rows.map((row) => row.snapshot),
        pushTokens: pushTokens.rows
      }
    });
    await client.query("COMMIT");
    return {
      chapters: chapters.rowCount || 0,
      notifications: notifications.rowCount || 0,
      generationJobs: generationJobs.rowCount || 0,
      favorites: favorites.rowCount || 0,
      pushTokens: pushTokens.rowCount || 0,
      captureMemoryCards: captureMemoryCards.rowCount || 0,
      capturePersistenceEpochs: capturePersistenceEpochs.deviceIds.length
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listFavoriteQuestions(deviceId) {
  await ensureDevice(deviceId);
  const result = await pool.query(
    `SELECT favorite_json
       FROM favorite_questions
      WHERE device_id = $1
        AND deleted_at IS NULL
      ORDER BY created_at DESC`,
    [deviceId]
  );
  return result.rows.map((row) => row.favorite_json);
}

export async function getFavoriteQuestion(deviceId, favoriteId) {
  await ensureDevice(deviceId);
  const result = await pool.query(
    `SELECT favorite_json
       FROM favorite_questions
      WHERE device_id = $1
        AND id = $2
        AND deleted_at IS NULL`,
    [deviceId, favoriteId]
  );
  return result.rows[0]?.favorite_json || null;
}

export async function upsertFavoriteQuestion(deviceId, favorite) {
  await ensureDevice(deviceId);
  await pool.query(
    `INSERT INTO favorite_questions (id, device_id, account_id, chapter_id, question_id, favorite_json, created_at, updated_at)
     VALUES (
       $1,
       $2,
       (SELECT account_id FROM account_device_links WHERE device_id = $2 ORDER BY last_seen_at DESC LIMIT 1),
       $3,
       $4,
       $5::jsonb,
       $6,
       NOW()
     )
     ON CONFLICT (device_id, chapter_id, question_id)
     DO UPDATE SET
       account_id = COALESCE(favorite_questions.account_id, EXCLUDED.account_id),
       favorite_json = EXCLUDED.favorite_json,
       updated_at = NOW(),
       deleted_at = NULL,
       deleted_reason = ''`,
    [
      favorite.id,
      deviceId,
      favorite.chapterId,
      favorite.questionId,
      JSON.stringify(favorite),
      favorite.createdAt || new Date().toISOString()
    ]
  );
  return getFavoriteQuestion(deviceId, favorite.id);
}

export async function deleteFavoriteQuestion(deviceId, favoriteId) {
  await ensureDevice(deviceId);
  const result = await softDeleteRows(pool, {
    table: "favorite_questions",
    jsonColumn: "favorite_json",
    deviceId,
    whereSql: "id = $2",
    params: [favoriteId],
    reason: "favorite_deleted_by_user"
  });
  if (result.rowCount > 0) {
    await insertAuditEvent(pool, {
      deviceId,
      action: "favorite_question.soft_delete",
      entityType: "favorite_question",
      entityId: favoriteId,
      metadata: { reason: "favorite_deleted_by_user" },
      snapshot: result.rows[0]?.snapshot || null
    });
  }
  return result.rowCount > 0;
}

export async function listDeletedChapters(deviceId, options = {}) {
  await ensureDevice(deviceId);
  const limit = readPositiveInt(options.limit, 50);
  const result = await pool.query(
    `SELECT id, title, status, chapter_json, created_at, updated_at, deleted_at, deleted_reason
       FROM chapters
      WHERE device_id = $1
        AND deleted_at IS NOT NULL
      ORDER BY deleted_at DESC
      LIMIT $2`,
    [deviceId, limit]
  );
  return result.rows.map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    chapter: row.chapter_json,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    deletedAt: toIsoString(row.deleted_at),
    deletedReason: String(row.deleted_reason || "")
  }));
}

export async function restoreChapter(deviceId, chapterId) {
  await ensureDevice(deviceId);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const chapter = await client.query(
      `UPDATE chapters
          SET deleted_at = NULL,
              deleted_reason = '',
              updated_at = NOW()
        WHERE device_id = $1
          AND id = $2
          AND deleted_at IS NOT NULL
        RETURNING chapter_json`,
      [deviceId, chapterId]
    );
    if (chapter.rowCount === 0) {
      await client.query("ROLLBACK");
      return null;
    }
    const favorites = await client.query(
      `UPDATE favorite_questions
          SET deleted_at = NULL,
              deleted_reason = '',
              updated_at = NOW()
        WHERE device_id = $1
          AND chapter_id = $2
          AND deleted_at IS NOT NULL
          AND deleted_reason IN ('chapter_deleted_by_user', 'device_data_deleted_by_user')
        RETURNING favorite_json`,
      [deviceId, chapterId]
    );
    const notifications = await client.query(
      `UPDATE notifications
          SET deleted_at = NULL,
              deleted_reason = '',
              updated_at = NOW()
        WHERE device_id = $1
          AND chapter_id = $2
          AND deleted_at IS NOT NULL
          AND deleted_reason IN ('chapter_deleted_by_user', 'device_data_deleted_by_user')
        RETURNING notification_json`,
      [deviceId, chapterId]
    );
    await insertAuditEvent(client, {
      deviceId,
      action: "chapter.restore",
      entityType: "chapter",
      entityId: chapterId,
      metadata: {
        favorites: favorites.rowCount,
        notifications: notifications.rowCount
      },
      snapshot: {
        chapter: chapter.rows[0]?.chapter_json || null,
        favorites: favorites.rows.map((row) => row.favorite_json),
        notifications: notifications.rows.map((row) => row.notification_json)
      }
    });
    await client.query("COMMIT");
    return getChapter(deviceId, chapterId);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function softDeleteRows(queryable, options = {}) {
  const table = validateSoftDeleteTable(options.table);
  const jsonColumn = validateSnapshotColumn(table, options.jsonColumn);
  const deviceId = String(options.deviceId || "");
  const reason = String(options.reason || "soft_deleted").slice(0, 200);
  const whereSql = String(options.whereSql || "FALSE");
  const params = Array.isArray(options.params) ? options.params : [];
  return queryable.query(
    `UPDATE ${table}
        SET deleted_at = NOW(),
            deleted_reason = $${params.length + 2},
            updated_at = NOW()
      WHERE device_id = $1
        AND deleted_at IS NULL
        AND (${whereSql})
      RETURNING id, ${jsonColumn} AS snapshot`,
    [deviceId, ...params, reason]
  );
}

async function softDeleteRowsByAccount(queryable, options = {}) {
  const table = validateSoftDeleteTable(options.table);
  const jsonColumn = validateSnapshotColumn(table, options.jsonColumn);
  const accountId = String(options.accountId || "");
  const reason = String(options.reason || "soft_deleted").slice(0, 200);
  return queryable.query(
    `UPDATE ${table}
        SET deleted_at = NOW(),
            deleted_reason = $2,
            updated_at = NOW()
      WHERE account_id = $1
        AND deleted_at IS NULL
      RETURNING id, ${jsonColumn} AS snapshot`,
    [accountId, reason]
  );
}

async function softDeleteGenerationJobs(queryable, options = {}) {
  const deviceId = String(options.deviceId || "");
  const reason = String(options.reason || "soft_deleted").slice(0, 200);
  const whereSql = String(options.whereSql || "FALSE");
  const params = Array.isArray(options.params) ? options.params : [];
  return queryable.query(
    `UPDATE generation_jobs
        SET deleted_at = NOW(),
            deleted_reason = $${params.length + 2},
            queue_status = CASE
              WHEN queue_status IN ('queued', 'running') THEN 'cancelled'
              ELSE queue_status
            END,
            locked_by = '',
            locked_until = NULL,
            updated_at = NOW()
      WHERE device_id = $1
        AND deleted_at IS NULL
        AND (${whereSql})
      RETURNING id, to_jsonb(generation_jobs) AS snapshot`,
    [deviceId, ...params, reason]
  );
}

async function softDeleteGenerationJobsByAccount(queryable, options = {}) {
  const accountId = String(options.accountId || "");
  const reason = String(options.reason || "soft_deleted").slice(0, 200);
  return queryable.query(
    `UPDATE generation_jobs
        SET deleted_at = NOW(),
            deleted_reason = $2,
            queue_status = CASE
              WHEN queue_status IN ('queued', 'running') THEN 'cancelled'
              ELSE queue_status
            END,
            locked_by = '',
            locked_until = NULL,
            updated_at = NOW()
      WHERE account_id = $1
        AND deleted_at IS NULL
      RETURNING id, to_jsonb(generation_jobs) AS snapshot`,
    [accountId, reason]
  );
}

async function insertAuditEvent(queryable, event = {}) {
  const deviceId = String(event.deviceId || "");
  await queryable.query(
    `INSERT INTO audit_events (
       id,
       device_id,
       action,
       entity_type,
       entity_id,
       metadata_json,
       snapshot_json,
       created_at
     )
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, NOW())`,
    [
      randomUUID(),
      deviceId,
      String(event.action || "unknown"),
      String(event.entityType || "unknown"),
      String(event.entityId || ""),
      JSON.stringify(event.metadata && typeof event.metadata === "object" ? event.metadata : {}),
      event.snapshot === undefined ? null : JSON.stringify(event.snapshot)
    ]
  );
}

function validateSoftDeleteTable(table) {
  if (["chapters", "favorite_questions", "notifications"].includes(table)) return table;
  throw new Error(`unsupported soft delete table: ${table}`);
}

function validateSnapshotColumn(table, column) {
  const allowed = {
    chapters: "chapter_json",
    favorite_questions: "favorite_json",
    notifications: "notification_json"
  };
  if (allowed[table] === column) return column;
  throw new Error(`unsupported snapshot column: ${table}.${column}`);
}

export async function upsertPushToken(deviceId, pushToken) {
  await ensureDevice(deviceId);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM device_push_tokens WHERE device_id = $1", [deviceId]);
    await client.query(
      `INSERT INTO device_push_tokens (device_id, account_id, token, platform, environment, preferred_language, created_at, updated_at)
       VALUES (
         $1,
         (SELECT account_id FROM account_device_links WHERE device_id = $1 ORDER BY last_seen_at DESC LIMIT 1),
         $2,
         $3,
         $4,
         $5,
         NOW(),
         NOW()
       )`,
      [
        deviceId,
        pushToken.token,
        pushToken.platform || "ios",
        pushToken.environment || "production",
        normalizePreferredLanguage(pushToken.preferredLanguage || pushToken.preferred_language)
      ]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listPushTokens(deviceId) {
  await ensureDevice(deviceId);
  const result = await pool.query(
    `SELECT token, platform, environment, preferred_language, created_at, updated_at
       FROM device_push_tokens
      WHERE device_id = $1
      ORDER BY updated_at DESC`,
    [deviceId]
  );
  return result.rows.map((row) => ({
    token: row.token,
    platform: row.platform,
    environment: row.environment,
    preferredLanguage: normalizePreferredLanguage(row.preferred_language),
    createdAt: row.created_at?.toISOString?.() || "",
    updatedAt: row.updated_at?.toISOString?.() || ""
  }));
}

function normalizePreferredLanguage(value = "") {
  return value === "en" ? "en" : "zh-Hans";
}

export async function listNotifications(deviceId) {
  await ensureDevice(deviceId);
  const result = await pool.query(
    `SELECT notification_json
       FROM notifications
      WHERE device_id = $1
        AND deleted_at IS NULL
      ORDER BY created_at DESC`,
    [deviceId]
  );
  return result.rows.map((row) => row.notification_json);
}

export async function getNotification(deviceId, notificationId) {
  await ensureDevice(deviceId);
  const result = await pool.query(
    `SELECT notification_json
       FROM notifications
      WHERE device_id = $1
        AND id = $2
        AND deleted_at IS NULL`,
    [deviceId, notificationId]
  );
  return result.rows[0]?.notification_json || null;
}

export async function upsertNotification(deviceId, notification) {
  await ensureDevice(deviceId);
  await pool.query(
    `INSERT INTO notifications (id, device_id, account_id, chapter_id, notification_json, created_at, updated_at)
     VALUES (
       $1,
       $2,
       (SELECT account_id FROM account_device_links WHERE device_id = $2 ORDER BY last_seen_at DESC LIMIT 1),
       $3,
       $4::jsonb,
       $5,
       NOW()
     )
     ON CONFLICT (id)
     DO UPDATE SET
       account_id = COALESCE(notifications.account_id, EXCLUDED.account_id),
       notification_json = EXCLUDED.notification_json,
       updated_at = NOW(),
       deleted_at = NULL,
       deleted_reason = ''`,
    [
      notification.id,
      deviceId,
      notification.chapterId,
      JSON.stringify(notification),
      notification.createdAt || new Date().toISOString()
    ]
  );
  return getNotification(deviceId, notification.id);
}

export async function deleteNotificationsForChapter(deviceId, chapterId, type = "") {
  await ensureDevice(deviceId);
  if (type) {
    const result = await softDeleteRows(pool, {
      table: "notifications",
      jsonColumn: "notification_json",
      deviceId,
      whereSql: "chapter_id = $2 AND notification_json->>'type' = $3",
      params: [chapterId, type],
      reason: "notification_dismissed_for_chapter"
    });
    if (result.rowCount > 0) {
      await insertAuditEvent(pool, {
        deviceId,
        action: "notification.soft_delete_for_chapter",
        entityType: "chapter",
        entityId: chapterId,
        metadata: { reason: "notification_dismissed_for_chapter", type, count: result.rowCount },
        snapshot: { notifications: result.rows.map((row) => row.snapshot) }
      });
    }
    return;
  }
  const result = await softDeleteRows(pool, {
    table: "notifications",
    jsonColumn: "notification_json",
    deviceId,
    whereSql: "chapter_id = $2",
    params: [chapterId],
    reason: "notifications_deleted_for_chapter"
  });
  if (result.rowCount > 0) {
    await insertAuditEvent(pool, {
      deviceId,
      action: "notification.soft_delete_for_chapter",
      entityType: "chapter",
      entityId: chapterId,
      metadata: { reason: "notifications_deleted_for_chapter", count: result.rowCount },
      snapshot: { notifications: result.rows.map((row) => row.snapshot) }
    });
  }
}

export async function startGenerationJob(deviceId, job) {
  await ensureDevice(deviceId);
  await pool.query(
    `INSERT INTO generation_jobs (id, device_id, account_id, chapter_id, status, current_stage, started_at, updated_at)
     VALUES (
       $1,
       $2,
       (SELECT account_id FROM account_device_links WHERE device_id = $2 ORDER BY last_seen_at DESC LIMIT 1),
       $3,
       $4,
       $5,
       NOW(),
       NOW()
     )
     ON CONFLICT (id)
     DO UPDATE SET
       account_id = COALESCE(generation_jobs.account_id, EXCLUDED.account_id),
       status = EXCLUDED.status,
       current_stage = EXCLUDED.current_stage,
       error_message = '',
       finished_at = NULL,
       deleted_at = NULL,
       deleted_reason = '',
       updated_at = NOW()`,
    [job.id, deviceId, job.chapterId, job.status, job.currentStage]
  );
}

export async function enqueueGenerationJob(deviceId, job) {
  await ensureDevice(deviceId);
  const record = normalizeGenerationJobInput(job);
  await pool.query(
     `INSERT INTO generation_jobs (
       id,
       device_id,
       account_id,
       chapter_id,
       status,
       current_stage,
       job_type,
       payload_json,
       queue_status,
       attempt_count,
       max_attempts,
       available_at,
       locked_by,
       locked_until,
       last_error,
       idempotency_key,
       started_at,
       updated_at
     )
     VALUES (
       $1,
       $2,
       (SELECT account_id FROM account_device_links WHERE device_id = $2 ORDER BY last_seen_at DESC LIMIT 1),
       $3,
       $4,
       $5,
       $6,
       $7::jsonb,
       'queued',
       0,
       $8,
       $9,
       '',
       NULL,
       '',
       $10,
       NOW(),
       NOW()
     )
     ON CONFLICT (id)
     DO UPDATE SET
       account_id = COALESCE(generation_jobs.account_id, EXCLUDED.account_id),
       status = EXCLUDED.status,
       current_stage = EXCLUDED.current_stage,
       job_type = EXCLUDED.job_type,
       payload_json = EXCLUDED.payload_json,
       idempotency_key = EXCLUDED.idempotency_key,
       queue_status = 'queued',
       attempt_count = 0,
       max_attempts = EXCLUDED.max_attempts,
       available_at = EXCLUDED.available_at,
       locked_by = '',
       locked_until = NULL,
       last_error = '',
       finished_at = NULL,
       deleted_at = NULL,
       deleted_reason = '',
       updated_at = NOW()`,
    [
      record.id,
      deviceId,
      record.chapterId,
      record.status,
      record.currentStage,
      record.jobType,
      JSON.stringify(record.payload),
      record.maxAttempts,
      record.availableAt,
      record.idempotencyKey
    ]
  );
  return getGenerationJob(deviceId, record.id);
}

export async function enqueueIdempotentGenerationJob(deviceId, job) {
  await ensureDevice(deviceId);
  const record = normalizeGenerationJobInput(job);
  if (!record.idempotencyKey) {
    return {
      job: await enqueueGenerationJob(deviceId, record),
      reused: false
    };
  }

  const existing = await getPendingGenerationJobByIdempotencyKey(deviceId, record.idempotencyKey);
  if (existing) {
    return { job: existing, reused: true };
  }

  try {
    return {
      job: await enqueueGenerationJob(deviceId, record),
      reused: false
    };
  } catch (error) {
    if (error?.code !== "23505") throw error;
    const raced = await getPendingGenerationJobByIdempotencyKey(deviceId, record.idempotencyKey);
    if (raced) return { job: raced, reused: true };
    throw error;
  }
}

export async function getPendingGenerationJobByIdempotencyKey(deviceId, idempotencyKey) {
  await ensureDevice(deviceId);
  const key = String(idempotencyKey || "").trim();
  if (!key) return null;

  const result = await pool.query(
    `SELECT *
       FROM generation_jobs
      WHERE device_id = $1
        AND idempotency_key = $2
        AND queue_status IN ('queued', 'running')
        AND deleted_at IS NULL
      ORDER BY updated_at DESC
      LIMIT 1`,
    [deviceId, key]
  );
  return result.rows[0] ? normalizeGenerationJobRow(result.rows[0]) : null;
}

export async function claimDailyGenerationQuota(deviceId, {
  requestId,
  quotaDay,
  limit
} = {}) {
  await ensureDevice(deviceId);
  const stableRequestId = String(requestId || "").trim();
  const day = String(quotaDay || "").trim();
  const dailyLimit = Number.parseInt(String(limit || ""), 10);
  if (!stableRequestId || !day || !Number.isFinite(dailyLimit) || dailyLimit <= 0) {
    throw new Error("invalid generation quota claim");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const accountId = await getLinkedAccountId(client, deviceId);
    const quotaOwner = accountId || deviceId;
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [quotaOwner, day]);

    const existing = accountId
      ? await client.query(
          `SELECT 1
             FROM generation_quota_claims
            WHERE account_id = $1
              AND request_id = $2
            LIMIT 1`,
          [accountId, stableRequestId]
        )
      : await client.query(
          `SELECT 1
             FROM generation_quota_claims
            WHERE device_id = $1
              AND request_id = $2
            LIMIT 1`,
          [deviceId, stableRequestId]
        );
    if (existing.rowCount > 0) {
      const used = await generationQuotaUsedCount(client, { deviceId, accountId, quotaDay: day });
      await client.query("COMMIT");
      return {
        allowed: true,
        reused: true,
        used,
        limit: dailyLimit,
        quotaDay: day
      };
    }

    const usedBefore = await generationQuotaUsedCount(client, { deviceId, accountId, quotaDay: day });
    if (usedBefore >= dailyLimit) {
      await client.query("COMMIT");
      return {
        allowed: false,
        reused: false,
        used: usedBefore,
        limit: dailyLimit,
        quotaDay: day
      };
    }

    await client.query(
      `INSERT INTO generation_quota_claims (device_id, account_id, request_id, quota_day)
       VALUES ($1, $2, $3, $4::date)`,
      [deviceId, accountId, stableRequestId, day]
    );
    await client.query("COMMIT");
    return {
      allowed: true,
      reused: false,
      used: usedBefore + 1,
      limit: dailyLimit,
      quotaDay: day
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function generationQuotaUsedCount(client, { deviceId, accountId = null, quotaDay } = {}) {
  const result = accountId
    ? await client.query(
        `SELECT COUNT(*)::int AS count
           FROM generation_quota_claims
          WHERE account_id = $1
            AND quota_day = $2::date`,
        [accountId, quotaDay]
      )
    : await client.query(
        `SELECT COUNT(*)::int AS count
           FROM generation_quota_claims
          WHERE device_id = $1
            AND quota_day = $2::date`,
        [deviceId, quotaDay]
      );
  return result.rows[0]?.count || 0;
}

export async function getGenerationJob(deviceId, jobId) {
  await ensureDevice(deviceId);
  const result = await pool.query(
    `SELECT *
       FROM generation_jobs
      WHERE device_id = $1
        AND id = $2
        AND deleted_at IS NULL`,
    [deviceId, jobId]
  );
  return result.rows[0] ? normalizeGenerationJobRow(result.rows[0]) : null;
}

export async function claimNextGenerationJob(workerId, options = {}) {
  if (!pool) return null;
  const lockMs = readPositiveInt(options.lockMs, DEFAULT_GENERATION_JOB_LOCK_MS);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `WITH next_job AS (
         SELECT id
           FROM generation_jobs
          WHERE (
              queue_status = 'queued'
              OR (queue_status = 'running' AND locked_until IS NOT NULL AND locked_until < NOW())
            )
            AND deleted_at IS NULL
            AND available_at <= NOW()
          ORDER BY available_at ASC, updated_at ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
       )
       UPDATE generation_jobs
          SET queue_status = 'running',
              attempt_count = attempt_count + 1,
              locked_by = $1,
              locked_until = NOW() + ($2::text)::interval,
              updated_at = NOW()
        WHERE id = (SELECT id FROM next_job)
        RETURNING *`,
      [workerId, `${lockMs} milliseconds`]
    );
    await client.query("COMMIT");
    return result.rows[0] ? normalizeGenerationJobRow(result.rows[0]) : null;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function completeGenerationJob(deviceId, jobId, fields = {}) {
  await ensureDevice(deviceId);
  const result = await pool.query(
    `UPDATE generation_jobs
        SET status = COALESCE($3, status),
            current_stage = COALESCE($4, current_stage),
            error_message = '',
            queue_status = 'completed',
            locked_by = '',
            locked_until = NULL,
            last_error = '',
            finished_at = NOW(),
            updated_at = NOW()
      WHERE device_id = $1
        AND id = $2
        AND deleted_at IS NULL
      RETURNING *`,
    [
      deviceId,
      jobId,
      fields.status || null,
      fields.currentStage || fields.status || null
    ]
  );
  return result.rows[0] ? normalizeGenerationJobRow(result.rows[0]) : null;
}

export async function failGenerationJob(deviceId, jobId, fields = {}) {
  await ensureDevice(deviceId);
  const current = await getGenerationJob(deviceId, jobId);
  if (!current) return null;
  const errorMessage = String(fields.errorMessage || fields.lastError || current.lastError || "");
  const retry = fields.retry === undefined
    ? shouldRetryGenerationJob(current)
    : Boolean(fields.retry) && shouldRetryGenerationJob(current);
  const delayMs = readPositiveInt(fields.retryDelayMs, 5_000);
  const result = await pool.query(
    `UPDATE generation_jobs
        SET status = COALESCE($3, status),
            current_stage = COALESCE($4, current_stage),
            error_message = COALESCE($5, error_message),
            queue_status = $6,
            available_at = CASE WHEN $6 = 'queued' THEN NOW() + ($7::text)::interval ELSE available_at END,
            locked_by = '',
            locked_until = NULL,
            last_error = COALESCE($5, last_error),
            finished_at = CASE WHEN $6 = 'failed' THEN NOW() ELSE finished_at END,
            updated_at = NOW()
      WHERE device_id = $1
        AND id = $2
        AND deleted_at IS NULL
      RETURNING *`,
    [
      deviceId,
      jobId,
      fields.status || null,
      fields.currentStage || fields.status || null,
      errorMessage || null,
      retry ? "queued" : "failed",
      `${delayMs} milliseconds`
    ]
  );
  return result.rows[0] ? normalizeGenerationJobRow(result.rows[0]) : null;
}

export async function getGenerationQueueSummary() {
  if (!pool) return { queued: 0, running: 0, failed: 0, completed: 0, cancelled: 0 };
  const result = await pool.query(
    `SELECT queue_status, COUNT(*)::int AS count
       FROM generation_jobs
      WHERE deleted_at IS NULL
      GROUP BY queue_status`
  );
  const summary = { queued: 0, running: 0, failed: 0, completed: 0, cancelled: 0 };
  for (const row of result.rows) {
    summary[row.queue_status] = row.count;
  }
  return summary;
}

export async function updateGenerationJob(deviceId, jobId, fields) {
  await ensureDevice(deviceId);
  await pool.query(
    `UPDATE generation_jobs
        SET status = COALESCE($3, status),
            current_stage = COALESCE($4, current_stage),
            error_message = COALESCE($5, error_message),
            finished_at = CASE WHEN $6::boolean THEN NOW() ELSE finished_at END,
            updated_at = NOW()
      WHERE device_id = $1
        AND id = $2
        AND deleted_at IS NULL`,
    [
      deviceId,
      jobId,
      fields.status || null,
      fields.currentStage || null,
      fields.errorMessage || null,
      Boolean(fields.finished)
    ]
  );
}

async function markInterruptedGenerationJobs() {
  const result = await pool.query(
    `SELECT id, device_id, chapter_id
      FROM generation_jobs
      WHERE status = ANY($1::text[])
        AND queue_status = 'completed'
        AND deleted_at IS NULL`,
    [PROCESSING_STATUSES]
  );

  for (const row of result.rows) {
    const chapter = await getChapter(row.device_id, row.chapter_id);
    if (chapter && PROCESSING_STATUSES.includes(chapter.status)) {
      const now = new Date().toISOString();
      const meta = chapter.generationMeta || {};
      chapter.status = INTERRUPTED_STATUS;
      chapter.displayStatusText = INTERRUPTED_TEXT;
      chapter.failureReason = INTERRUPTED_REASON;
      chapter.generationMeta = {
        ...meta,
        currentStage: INTERRUPTED_STATUS,
        failedStage: meta.currentStage || INTERRUPTED_STATUS,
        failureReason: INTERRUPTED_REASON,
        stages: [
          ...((Array.isArray(meta.stages) ? meta.stages : []).slice(-8)),
          { status: INTERRUPTED_STATUS, displayStatusText: INTERRUPTED_TEXT, at: now }
        ]
      };
      chapter.updatedAt = now;
      await upsertChapter(row.device_id, chapter);
    }

    await updateGenerationJob(row.device_id, row.id, {
      status: INTERRUPTED_STATUS,
      currentStage: INTERRUPTED_STATUS,
      errorMessage: INTERRUPTED_REASON,
      finished: true
    });
  }
}

export function normalizeGenerationJobInput(job = {}) {
  return {
    id: String(job.id || ""),
    chapterId: String(job.chapterId || job.chapter_id || ""),
    status: String(job.status || "submitted"),
    currentStage: String(job.currentStage || job.current_stage || job.status || "submitted"),
    jobType: normalizeGenerationJobType(job.jobType || job.job_type),
    payload: job.payload && typeof job.payload === "object" && !Array.isArray(job.payload) ? job.payload : {},
    idempotencyKey: String(job.idempotencyKey || job.idempotency_key || ""),
    maxAttempts: readPositiveInt(job.maxAttempts ?? job.max_attempts, DEFAULT_GENERATION_JOB_MAX_ATTEMPTS),
    availableAt: job.availableAt || job.available_at || new Date().toISOString()
  };
}

export function normalizeGenerationJobRow(row = {}) {
  return {
    id: String(row.id || ""),
    deviceId: String(row.device_id || row.deviceId || ""),
    chapterId: String(row.chapter_id || row.chapterId || ""),
    status: String(row.status || "submitted"),
    currentStage: String(row.current_stage || row.currentStage || row.status || "submitted"),
    errorMessage: String(row.error_message || row.errorMessage || ""),
    jobType: normalizeGenerationJobType(row.job_type || row.jobType),
    payload: normalizePayloadJson(row.payload_json ?? row.payloadJson ?? row.payload),
    idempotencyKey: String(row.idempotency_key || row.idempotencyKey || ""),
    queueStatus: normalizeQueueStatus(row.queue_status || row.queueStatus),
    attemptCount: Number.isFinite(Number(row.attempt_count ?? row.attemptCount)) ? Number(row.attempt_count ?? row.attemptCount) : 0,
    maxAttempts: readPositiveInt(row.max_attempts ?? row.maxAttempts, DEFAULT_GENERATION_JOB_MAX_ATTEMPTS),
    availableAt: toIsoString(row.available_at ?? row.availableAt),
    lockedBy: String(row.locked_by || row.lockedBy || ""),
    lockedUntil: toIsoString(row.locked_until ?? row.lockedUntil),
    lastError: String(row.last_error || row.lastError || ""),
    startedAt: toIsoString(row.started_at ?? row.startedAt),
    finishedAt: toIsoString(row.finished_at ?? row.finishedAt),
    updatedAt: toIsoString(row.updated_at ?? row.updatedAt)
  };
}

export function shouldRetryGenerationJob(job = {}) {
  const attemptCount = Number.isFinite(Number(job.attemptCount ?? job.attempt_count))
    ? Number(job.attemptCount ?? job.attempt_count)
    : 0;
  const maxAttempts = readPositiveInt(job.maxAttempts ?? job.max_attempts, DEFAULT_GENERATION_JOB_MAX_ATTEMPTS);
  return attemptCount < maxAttempts;
}

function normalizeGenerationJobType(type) {
  return [
    "create_chapter",
    "regenerate_chapter",
    "v2_create_chapter",
    "v2_regenerate_chapter"
  ].includes(type)
    ? type
    : "create_chapter";
}

function normalizeQueueStatus(status) {
  return ["queued", "running", "completed", "failed", "cancelled"].includes(status) ? status : "completed";
}

function normalizePayloadJson(value) {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function toIsoString(value) {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function readPositiveInt(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : fallback;
}
