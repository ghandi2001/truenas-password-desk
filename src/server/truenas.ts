import { spawn } from 'node:child_process';
import path from 'node:path';
import WebSocket from 'ws';
import type { Config } from './config';

export class NasFailure extends Error {
  constructor(public readonly uncertain = false) {
    super('The password could not be changed.');
  }
}
export async function verifySmb(
  c: Config,
  username: string,
  password: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(
      c.python,
      [path.join(process.cwd(), 'scripts/verify_smb.py')],
      {
        stdio: ['pipe', 'ignore', 'ignore'],
        env: {
          NODE_ENV: process.env.NODE_ENV,
          PATH: process.env.PATH,
          PYTHONUNBUFFERED: '1',
        },
      },
    );
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve(false);
    }, 12000);
    child.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.stdin.on('error', () => {});
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
    child.stdin.end(
      JSON.stringify({ host: new URL(c.nasUrl).hostname, username, password }),
    );
  });
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
    private verifier: (
      username: string,
      password: string,
    ) => Promise<boolean> = (u, p) => verifySmb(c, u, p),
    private endpoint = c.nasUrl.replace(/^https:/, 'wss:') +
      '/api/' +
      c.apiVersion,
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
    if (typeof version !== 'string' || !/^(TrueNAS-)?25\.10\.0$/.test(version))
      throw new NasFailure();
  }
  async setUserPassword(
    username: string,
    oldPassword: string,
    newPassword: string,
  ) {
    try {
      await this.connect();
      await this.authenticate();
      // FULL_ADMIN bypasses old_password in TrueNAS: independently prove the SMB credential first.
      if (!(await this.verifier(username, oldPassword))) throw new NasFailure();
      if (
        (await this.call('user.set_password', [
          { username, old_password: oldPassword, new_password: newPassword },
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
