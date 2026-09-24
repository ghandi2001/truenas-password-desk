-- A durable claim survives process death. Never automatically clear an ambiguous claim.
CREATE UNIQUE INDEX "PasswordLink_one_inflight_per_user" ON "PasswordLink" (lower("username")) WHERE "claimedAt" IS NOT NULL AND "usedAt" IS NULL AND "revokedAt" IS NULL;
