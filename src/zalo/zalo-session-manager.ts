import type { ZaloClient, ZaloClientFactory, ZaloSessionState } from "./types.js";

export type ManagedZaloSession = { state: ZaloSessionState; client: ZaloClient; authTask?: Promise<void> };

export class ZaloSessionManager {
  private readonly sessions = new Map<string, ManagedZaloSession>();
  constructor(private readonly createClient: ZaloClientFactory) {}

  get(telegramUserId: string) { return this.sessions.get(telegramUserId); }

  getOrCreate(telegramUserId: string): ManagedZaloSession {
    let session = this.sessions.get(telegramUserId);
    if (!session) {
      const now = new Date();
      session = { state: { telegramUserId, status: "logged_out", createdAt: now, updatedAt: now }, client: this.createClient(telegramUserId) };
      this.sessions.set(telegramUserId, session);
    }
    return session;
  }

  setStatus(telegramUserId: string, status: ZaloSessionState["status"], details: Partial<ZaloSessionState> = {}) {
    const session = this.getOrCreate(telegramUserId);
    session.state = { ...session.state, ...details, telegramUserId, status, updatedAt: new Date() };
    return session;
  }

  async isLoggedIn(telegramUserId: string): Promise<boolean> {
    const session = this.sessions.get(telegramUserId);
    if (!session || session.state.status !== "logged_in") return false;
    try {
      if (await session.client.isAuthenticated()) return true;
    } catch { /* invalid session is handled below */ }
    await this.remove(telegramUserId);
    return false;
  }

  async remove(telegramUserId: string) {
    const session = this.sessions.get(telegramUserId);
    this.sessions.delete(telegramUserId);
    if (session) await session.client.destroy().catch(() => undefined);
  }

  async logout(telegramUserId: string) {
    const session = this.sessions.get(telegramUserId);
    this.sessions.delete(telegramUserId);
    if (!session) return;
    await session.client.logout().catch(() => undefined);
    await session.client.destroy().catch(() => undefined);
  }

  size() { return this.sessions.size; }
}
