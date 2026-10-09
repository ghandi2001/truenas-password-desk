import WebSocket from 'ws';
import type { Config } from './config';

export class NasFailure extends Error {
  constructor(public readonly uncertain = false) {
    super('The password could not be changed.');
  }
}
export class TrueNasClient {
  private socket?: WebSocket;
  private sequence = 0;
  private pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private dispatched = false;
  constructor(
    private c: Config,
    private endpoint = c.nasUrl.replace(/^https:/, 'wss:') + '/api/current',
    private timeout = 10000,
  ) {}
  async connect() {
    await new Promise<void>((resolve, reject) => {
      const ws = (this.socket = new WebSocket(this.endpoint, {
        handshakeTimeout: this.timeout,
        maxPayload: 1024 * 1024,
        followRedirects: false,
        rejectUnauthorized: true,
      }));
      ws.on('error', () => {
        reject(new NasFailure(this.dispatched));
        this.fail();
      });
      ws.on('close', () => {
        reject(new NasFailure(this.dispatched));
        this.fail();
      });
      ws.on('message', (raw) => {
        try {
          const m = JSON.parse(raw.toString());
          const p = this.pending.get(m.id);
          if (!p) return;
          clearTimeout(p.timer);
          this.pending.delete(m.id);
          if (
            m.jsonrpc !== '2.0' ||
            !Object.hasOwn(m, 'result') ||
            Object.hasOwn(m, 'error')
          )
            p.reject(new NasFailure(this.dispatched));
          else p.resolve(m.result);
        } catch {
          this.fail();
          this.close();
        }
      });
      ws.once('open', () => resolve());
    });
  }
  private fail() {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new NasFailure(this.dispatched));
    }
    this.pending.clear();
  }
  private call(method: string, params: unknown[]): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (this.socket?.readyState !== WebSocket.OPEN) {
        reject(new NasFailure(this.dispatched));
        return;
      }
      const id = ++this.sequence;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new NasFailure(this.dispatched));
      }, this.timeout);
      this.pending.set(id, { resolve, reject, timer });
      if (method === 'user.set_password') this.dispatched = true;
      this.socket.send(
        JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        (e) => {
          if (e) {
            this.fail();
          }
        },
      );
    });
  }
  async authenticate() {
    if ((await this.call('auth.login_with_api_key', [this.c.apiKey])) !== true)
      throw new NasFailure();
    const version = await this.call('system.version', []);
    // Exact allowlist of contract-verified releases; not all 25.10.x.
    if (
      typeof version !== 'string' ||
      !/^(TrueNAS-)?25\.10\.(0|7)$/.test(version)
    )
      throw new NasFailure();
  }
  async setUserPassword(username: string, newPassword: string) {
    try {
      await this.connect();
      await this.authenticate();
      // old_password is schema-optional; a FULL_ADMIN key skips its check anyway.
      if (
        (await this.call('user.set_password', [
          { username, new_password: newPassword },
        ])) !== null
      )
        throw new NasFailure(true);
    } catch (e) {
      throw e instanceof NasFailure ? e : new NasFailure(this.dispatched);
    } finally {
      this.close();
    }
  }
  /** Real Samba accounts (passdb), not the always-false user.query smb flag. */
  async listSmbUsers(): Promise<string[]> {
    try {
      await this.connect();
      await this.authenticate();
      const rows = await this.call('smb.passdb_list', []);
      if (!Array.isArray(rows)) throw new NasFailure();
      return rows
        .map((r) =>
          r && typeof r === 'object' && typeof r.username === 'string'
            ? r.username
            : '',
        )
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
    } catch (e) {
      throw e instanceof NasFailure ? e : new NasFailure();
    } finally {
      this.close();
    }
  }
  close() {
    this.fail();
    this.socket?.terminate();
  }
}
