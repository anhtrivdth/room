export type ZaloSessionStatus =
  | "logged_out"
  | "creating_qr"
  | "waiting_scan"
  | "waiting_confirm"
  | "logged_in"
  | "expired"
  | "error";

export type ZaloSessionState = {
  telegramUserId: string;
  status: ZaloSessionStatus;
  zaloUserId?: string;
  zaloDisplayName?: string;
  followedGroups?: Array<{ id: string; name: string }>;
  createdAt?: Date;
  updatedAt?: Date;
};

export type ZaloQrStatus = "waiting_scan" | "waiting_confirm" | "expired" | "declined" | "error";

export type ZaloQrLoginResult = { image: Buffer; expiresAt: Date };
export type ZaloLoginResult = { success: true; zaloUserId?: string; displayName?: string };

export type ZaloConversation = {
  id: string;
  name: string;
  type: "user" | "group";
  avatarUrl?: string;
  lastMessage?: string;
  lastActivityAt?: Date;
};

export type ZaloIncomingMessage = {
  id: string;
  groupId: string;
  senderId: string;
  senderName?: string;
  text?: string;
  imageUrl?: string;
  timestamp: Date;
  quote?: {
    content: string | Record<string, unknown>;
    msgType: string;
    propertyExt?: Record<string, unknown>;
    uidFrom: string;
    msgId: string;
    cliMsgId: string;
    ts: string;
    ttl: number;
  };
};

export class ZaloSessionExpiredError extends Error {
  constructor(message = "Zalo session expired") {
    super(message);
    this.name = "ZaloSessionExpiredError";
  }
}

export interface ZaloClient {
  createQrLogin(onStatus?: (status: ZaloQrStatus) => void): Promise<ZaloQrLoginResult>;
  waitForLogin(): Promise<ZaloLoginResult>;
  getConversations(): Promise<ZaloConversation[]>;
  logout(): Promise<void>;
  destroy(): Promise<void>;
  isAuthenticated(): Promise<boolean>;
  startMessageListener(onMessage: (message: ZaloIncomingMessage) => void | Promise<void>): Promise<void>;
  stopMessageListener(): Promise<void>;
  replyToGroupMessage(message: ZaloIncomingMessage, text: string): Promise<void>;
}

export type ZaloClientFactory = (telegramUserId: string) => ZaloClient;
