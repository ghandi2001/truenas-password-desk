import { PrismaClient, type PasswordLink } from '@prisma/client';
import { z } from 'zod';
import type { Config } from './config';
import {
  createToken,
  digest,
  privateDigest,
  tokenPattern,
  usernamePattern,
  passwordError,
  verifyPassword,
  hashPassword,
} from './security';
import { NasFailure, TrueNasClient } from './truenas';

// Cache the SMB user listing briefly: the picker refetches on each admin page
// load, and the NAS should not see a query burst per keystroke.
const SMB_LIST_TTL_MS = 30_000;

export const genericFailure = 'The password could not be changed. Try again.';
export class SafeError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
const fields = z
  .object({
    currentPassword: z.string().max(512),
    newPassword: z.string().max(512),
    confirmPassword: z.string().max(512),
  })
  .strict();
const linkFields = z
  .object({
    username: z.string().regex(usernamePattern),
    minutes: z.number().int().min(1).max(1440),
    note: z.string().max(200).default(''),
  })
  .strict();
const active = (now: Date) => ({
  expiresAt: { gt: now },
  usedAt: null,
  revokedAt: null,
  claimedAt: null,
});
export const linkStatus = (l: PasswordLink) =>
  l.usedAt
    ? 'Used'
    : l.revokedAt
      ? 'Revoked'
      : l.claimedAt
        ? 'Needs review'
        : l.expiresAt <= new Date()
          ? 'Expired'
          : 'Active';
let dummy: Promise<string> | undefined;
export class Service {
  constructor(
    public db: PrismaClient,
    public config: Config,
    private changeNas: (u: string, o: string, n: string) => Promise<void> = (
      u,
      o,
      n,
    ) => new TrueNasClient(config).setUserPassword(u, o, n),
  ) {}
  async audit(
    action: string,
    status: string,
    ip: string,
    adminId?: string,
    linkId?: string,
    failureReason?: string,
  ) {
    await this.db.audit.create({
      data: { action, status, ipAddress: ip, adminId, linkId, failureReason },
    });
  }
  async limit(bucket: string, max: number) {
    const key = privateDigest(bucket, this.config.sessionSecret);
    const rows = await this.db.$queryRaw<
      { count: number }[]
    >`INSERT INTO "RateLimit" ("key","count","expiresAt") VALUES (${key},1,NOW() + ${this.config.windowMinutes} * interval '1 minute') ON CONFLICT ("key") DO UPDATE SET "count"=CASE WHEN "RateLimit"."expiresAt"<=NOW() THEN 1 ELSE LEAST("RateLimit"."count"+1,1000000) END,"expiresAt"=CASE WHEN "RateLimit"."expiresAt"<=NOW() THEN NOW() + ${this.config.windowMinutes} * interval '1 minute' ELSE "RateLimit"."expiresAt" END RETURNING "count"`;
    return rows[0].count <= max;
  }
  async login(username: string, password: string, ip: string) {
    const allowed = await this.limit('login-ip:' + ip, 20);
    const accountAllowed = await this.limit(
      'login-account:' + username.toLowerCase(),
      this.config.maxAttempts,
    );
    if (!allowed || !accountAllowed)
      throw new SafeError('Too many attempts. Try again later.', 429);
    const admin = await this.db.admin.findUnique({ where: { username } });
    dummy ??= hashPassword(createToken());
    const valid = await verifyPassword(
      admin?.passwordHash ?? (await dummy),
      password,
    );
    if (!admin || !valid) {
      await this.audit('login', 'denied', ip);
      throw new SafeError('Unable to sign in.', 401);
    }
    const token = createToken();
    const expiresAt = new Date(Date.now() + 8 * 3600000);
    await this.db.$transaction(async (tx) => {
      await tx.session.create({
        data: { tokenHash: digest(token), adminId: admin.id, expiresAt },
      });
      await tx.audit.create({
        data: {
          action: 'login',
          status: 'success',
          adminId: admin.id,
          ipAddress: ip,
        },
      });
    });
    return { token, expiresAt };
  }
  async session(token: string) {
    if (!tokenPattern.test(token)) return null;
    return this.db.session.findFirst({
      where: { tokenHash: digest(token), expiresAt: { gt: new Date() } },
      include: { admin: { select: { username: true } } },
    });
  }
  async logout(token: string, ip: string) {
    const session = await this.session(token);
    await this.db.session.deleteMany({ where: { tokenHash: digest(token) } });
    if (session) await this.audit('logout', 'success', ip, session.adminId);
  }
  async createLink(adminId: string, input: unknown, ip: string) {
    const parsed = linkFields.safeParse(input);
    if (!parsed.success)
      throw new SafeError(
        'Enter a valid username, duration (1–1440 minutes), and note (up to 200 characters).',
      );
    const data = parsed.data;
    const token = createToken();
    const link = await this.db.$transaction(async (tx) => {
      const row = await tx.passwordLink.create({
        data: {
          tokenHash: digest(token),
          username: data.username,
          createdBy: adminId,
          note: data.note,
          expiresAt: new Date(Date.now() + data.minutes * 60000),
        },
      });
      await tx.audit.create({
        data: {
          action: 'link_created',
          status: 'success',
          adminId,
          linkId: row.id,
          ipAddress: ip,
        },
      });
      return row;
    });
    return {
      id: link.id,
      url: `${this.config.appUrl}/password-change/${token}`,
    };
  }
  async listSmbUsers() {
    const cached = smbUserCache.get(this);
    if (cached && Date.now() - cached.at < SMB_LIST_TTL_MS) return cached.names;
    const names = await new TrueNasClient(this.config).listSmbUsers();
    smbUserCache.set(this, { at: Date.now(), names });
    return names;
  }
  async listLinks() {
    const rows = await this.db.passwordLink.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { creator: { select: { username: true } } },
    });
    return rows.map((l) => ({
      id: l.id,
      username: l.username,
      note: l.note,
      createdAt: l.createdAt,
      expiresAt: l.expiresAt,
      usedAt: l.usedAt,
      status: linkStatus(l),
      creator: l.creator.username,
    }));
  }
  async revoke(adminId: string, id: string, ip: string) {
    await this.db.$transaction(async (tx) => {
      const result = await tx.passwordLink.updateMany({
        where: { id, ...active(new Date()) },
        data: { revokedAt: new Date() },
      });
      if (!result.count)
        throw new SafeError('Link is unavailable or already processing.', 409);
      await tx.audit.create({
        data: {
          action: 'link_revoked',
          status: 'success',
          adminId,
          linkId: id,
          ipAddress: ip,
        },
      });
    });
  }
  async validLink(token: string) {
    if (!tokenPattern.test(token)) return null;
    return this.db.passwordLink.findFirst({
      where: { tokenHash: digest(token), ...active(new Date()) },
    });
  }
  async change(token: string, input: unknown, ip: string) {
    const error = () => new SafeError(genericFailure);
    if (!tokenPattern.test(token)) throw error();
    const l = await this.validLink(token);
    if (!l) throw error();
    const byToken = await this.limit('token:' + l.id, this.config.maxAttempts);
    const byUser = await this.limit(
      'user:' + l.username.toLowerCase(),
      this.config.maxAttempts,
    );
    if (!byToken || !byUser) throw new SafeError(genericFailure, 429);
    const parsed = fields.safeParse(input);
    if (!parsed.success) throw error();
    const p = parsed.data;
    if (
      passwordError(
        p.currentPassword,
        p.newPassword,
        p.confirmPassword,
        l.username,
        this.config.minLength,
      )
    )
      throw error();
    try {
      const claim = await this.db.passwordLink.updateMany({
        where: { id: l.id, ...active(new Date()) },
        data: { claimedAt: new Date() },
      });
      if (!claim.count) throw error();
    } catch {
      throw error();
    }
    try {
      await this.changeNas(l.username, p.currentPassword, p.newPassword);
    } catch (e) {
      const uncertain = !(e instanceof NasFailure) || e.uncertain;
      await this.db.$transaction(async (tx) => {
        if (!uncertain)
          await tx.passwordLink.update({
            where: { id: l.id },
            data: { claimedAt: null },
          });
        await tx.audit.create({
          data: {
            action: 'password_change',
            status: uncertain ? 'needs_review' : 'denied',
            linkId: l.id,
            ipAddress: ip,
            failureReason: uncertain
              ? 'outcome_unknown'
              : 'verification_failed',
          },
        });
      });
      throw error();
    }
    // If this transaction fails, the committed claim remains locked for operator review.
    await this.db.$transaction(async (tx) => {
      await tx.passwordLink.update({
        where: { id: l.id },
        data: { usedAt: new Date() },
      });
      await tx.audit.create({
        data: {
          action: 'password_change',
          status: 'success',
          linkId: l.id,
          ipAddress: ip,
        },
      });
    });
  }
}
