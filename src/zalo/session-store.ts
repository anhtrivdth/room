import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type FollowedGroup = { id: string; name: string };
export type AccountBinding = {
  telegramUserId: string;
  zaloUserId: string;
  zaloDisplayName?: string;
};

export interface SessionStore {
  saveBinding(binding: AccountBinding): void;
  getFollowedGroups(telegramUserId: string, zaloUserId: string): FollowedGroup[];
  addFollowedGroup(telegramUserId: string, zaloUserId: string, group: FollowedGroup): void;
  removeFollowedGroup(telegramUserId: string, zaloUserId: string, groupId: string): void;
}

export class ZaloAccountAlreadyBoundError extends Error {
  constructor(readonly telegramUserId: string) {
    super("Zalo account is already bound to another Telegram user");
    this.name = "ZaloAccountAlreadyBoundError";
  }
}

export class MemorySessionStore implements SessionStore {
  private readonly bindings = new Map<string, AccountBinding>();
  private readonly groups = new Map<string, Map<string, FollowedGroup>>();

  saveBinding(binding: AccountBinding) {
    const existing = [...this.bindings.values()].find((item) => item.zaloUserId === binding.zaloUserId && item.telegramUserId !== binding.telegramUserId);
    if (existing) throw new ZaloAccountAlreadyBoundError(existing.telegramUserId);
    this.bindings.set(binding.telegramUserId, binding);
  }

  getFollowedGroups(telegramUserId: string, zaloUserId: string) {
    return [...(this.groups.get(this.key(telegramUserId, zaloUserId))?.values() ?? [])];
  }

  addFollowedGroup(telegramUserId: string, zaloUserId: string, group: FollowedGroup) {
    const key = this.key(telegramUserId, zaloUserId);
    let groups = this.groups.get(key);
    if (!groups) { groups = new Map(); this.groups.set(key, groups); }
    groups.set(group.id, group);
  }

  removeFollowedGroup(telegramUserId: string, zaloUserId: string, groupId: string) {
    this.groups.get(this.key(telegramUserId, zaloUserId))?.delete(groupId);
  }

  private key(telegramUserId: string, zaloUserId: string) { return `${telegramUserId}:${zaloUserId}`; }
}

export class SqliteSessionStore implements SessionStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS account_bindings (
        telegram_user_id TEXT PRIMARY KEY,
        zalo_user_id TEXT NOT NULL UNIQUE,
        zalo_display_name TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS followed_groups (
        telegram_user_id TEXT NOT NULL,
        zalo_user_id TEXT NOT NULL,
        group_id TEXT NOT NULL,
        group_name TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (telegram_user_id, zalo_user_id, group_id)
      );
    `);
  }

  saveBinding(binding: AccountBinding) {
    const owner = this.db.prepare("SELECT telegram_user_id FROM account_bindings WHERE zalo_user_id = ?").get(binding.zaloUserId) as { telegram_user_id?: string } | undefined;
    if (owner?.telegram_user_id && owner.telegram_user_id !== binding.telegramUserId) {
      throw new ZaloAccountAlreadyBoundError(owner.telegram_user_id);
    }
    this.db.prepare(`
      INSERT INTO account_bindings (telegram_user_id, zalo_user_id, zalo_display_name, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(telegram_user_id) DO UPDATE SET
        zalo_user_id = excluded.zalo_user_id,
        zalo_display_name = excluded.zalo_display_name,
        updated_at = excluded.updated_at
    `).run(binding.telegramUserId, binding.zaloUserId, binding.zaloDisplayName ?? null, new Date().toISOString());
  }

  getFollowedGroups(telegramUserId: string, zaloUserId: string) {
    const rows = this.db.prepare(`
      SELECT group_id, group_name FROM followed_groups
      WHERE telegram_user_id = ? AND zalo_user_id = ?
      ORDER BY updated_at, group_id
    `).all(telegramUserId, zaloUserId) as Array<{ group_id: string; group_name: string }>;
    return rows.map((row) => ({ id: row.group_id, name: row.group_name }));
  }

  addFollowedGroup(telegramUserId: string, zaloUserId: string, group: FollowedGroup) {
    this.db.prepare(`
      INSERT INTO followed_groups (telegram_user_id, zalo_user_id, group_id, group_name, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(telegram_user_id, zalo_user_id, group_id) DO UPDATE SET
        group_name = excluded.group_name,
        updated_at = excluded.updated_at
    `).run(telegramUserId, zaloUserId, group.id, group.name, new Date().toISOString());
  }

  removeFollowedGroup(telegramUserId: string, zaloUserId: string, groupId: string) {
    this.db.prepare(`
      DELETE FROM followed_groups WHERE telegram_user_id = ? AND zalo_user_id = ? AND group_id = ?
    `).run(telegramUserId, zaloUserId, groupId);
  }
}
