import { createHmac, timingSafeEqual } from "node:crypto";
import { ensureLocalQuizUserFromAccounts } from "./localUsers.mjs";

const SERVICE = "quiz_maker";
const MAX_SKEW_MS = 5 * 60 * 1000;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Dragotoba accounts → product provision auth (same contract as UCF).
 *
 * Headers:
 *   X-Dragotoba-Service: quiz_maker
 *   X-Dragotoba-Timestamp: unix seconds (or ms)
 *   X-Dragotoba-Signature: sha256=<HMAC-SHA256(secret, `${timestamp}.${rawBody}`)>
 *
 * Env: IDENTITY_PROVISION_SECRET
 */
export function authenticateIdentityProvision(req, res, next) {
  const secret = process.env.IDENTITY_PROVISION_SECRET?.trim();
  if (!secret) {
    res.status(503).json({ ok: false, error: "Provision is not configured." });
    return;
  }

  const service = req.headers["x-dragotoba-service"];
  if (typeof service !== "string" || service.trim() !== SERVICE) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  const timestampHeader = req.headers["x-dragotoba-timestamp"];
  const signatureHeader = req.headers["x-dragotoba-signature"];
  if (typeof timestampHeader !== "string" || typeof signatureHeader !== "string") {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  const timestamp = timestampHeader.trim();
  if (!/^\d+$/.test(timestamp)) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  let timestampMs = Number(timestamp);
  if (!Number.isFinite(timestampMs)) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }
  // Accept unix seconds or milliseconds.
  if (timestamp.length <= 11) {
    timestampMs *= 1000;
  }
  if (Math.abs(Date.now() - timestampMs) > MAX_SKEW_MS) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  const rawBody = req.rawBody;
  if (!Buffer.isBuffer(rawBody)) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  const sigMatch = /^sha256=([0-9a-fA-F]+)$/.exec(signatureHeader.trim());
  if (!sigMatch) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  const expectedHex = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody.toString("utf8")}`)
    .digest("hex");
  const providedHex = sigMatch[1].toLowerCase();
  if (expectedHex.length !== providedHex.length) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  try {
    const expected = Buffer.from(expectedHex, "hex");
    const provided = Buffer.from(providedHex, "hex");
    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }
  } catch {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  next();
}

/**
 * POST /api/internal/identity/provision
 * @param {import("pg").Pool} pool
 */
export function createIdentityProvisionHandler(pool) {
  return async function identityProvision(req, res) {
    const dragotobaAccountId =
      typeof req.body?.dragotobaAccountId === "string"
        ? req.body.dragotobaAccountId.trim()
        : "";
    const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
    const displayName =
      typeof req.body?.displayName === "string" ? req.body.displayName.trim() : "";
    const emailVerified = req.body?.emailVerified === true;

    if (!UUID_RE.test(dragotobaAccountId) || !email || !displayName) {
      res.status(400).json({
        ok: false,
        error: "dragotobaAccountId, email, and displayName are required.",
      });
      return;
    }

    try {
      const { user, created } = await ensureLocalQuizUserFromAccounts(
        pool,
        {
          id: dragotobaAccountId,
          email,
          name: displayName,
        },
        { touchLastLogin: false },
      );

      if (emailVerified) {
        await pool.query(
          `UPDATE users
           SET email_verified_at = COALESCE(email_verified_at, NOW()),
               updated_at = NOW()
           WHERE id = $1 AND email_verified_at IS NULL`,
          [user.id],
        );
      }

      res.status(created ? 201 : 200).json({
        ok: true,
        created,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          displayName: user.displayName,
          dragotobaAccountId,
        },
      });
    } catch (error) {
      if (error?.code === "EMAIL_LINK_CONFLICT") {
        res.status(409).json({ ok: false, error: error.message });
        return;
      }
      console.error("Identity provision failed:", error);
      res.status(500).json({ ok: false, error: "Could not provision user." });
    }
  };
}
