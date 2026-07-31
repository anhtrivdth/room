import { describe, expect, it } from "vitest";
import { SqliteSessionStore, ZaloAccountAlreadyBoundError } from "../src/zalo/session-store.js";

describe("SqliteSessionStore", () => {
  it("lưu nhóm độc lập theo đúng cặp Telegram và Zalo", () => {
    const store = new SqliteSessionStore(":memory:");
    store.saveBinding({ telegramUserId: "t1", zaloUserId: "z1" });
    store.saveBinding({ telegramUserId: "t2", zaloUserId: "z2" });
    store.addFollowedGroup("t1", "z1", { id: "g1", name: "Nhóm một" });
    store.addFollowedGroup("t1", "z2", { id: "g2", name: "Không được nạp nhầm" });

    expect(store.getFollowedGroups("t1", "z1")).toEqual([{ id: "g1", name: "Nhóm một" }]);
    expect(store.getFollowedGroups("t2", "z2")).toEqual([]);
  });

  it("không cho hai Telegram ID mở listener cho cùng một Zalo ID", () => {
    const store = new SqliteSessionStore(":memory:");
    store.saveBinding({ telegramUserId: "t1", zaloUserId: "z1" });
    expect(() => store.saveBinding({ telegramUserId: "t2", zaloUserId: "z1" })).toThrow(ZaloAccountAlreadyBoundError);
  });

  it("giữ nhóm cũ khi Telegram ID chuyển Zalo rồi đăng nhập lại Zalo ban đầu", () => {
    const store = new SqliteSessionStore(":memory:");
    store.saveBinding({ telegramUserId: "t1", zaloUserId: "z1" });
    store.addFollowedGroup("t1", "z1", { id: "g1", name: "Nhóm đã lưu" });
    store.saveBinding({ telegramUserId: "t1", zaloUserId: "z2" });
    expect(store.getFollowedGroups("t1", "z2")).toEqual([]);
    store.saveBinding({ telegramUserId: "t1", zaloUserId: "z1" });
    expect(store.getFollowedGroups("t1", "z1")).toEqual([{ id: "g1", name: "Nhóm đã lưu" }]);
  });
});
