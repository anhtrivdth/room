declare module "zca-js" {
  export enum LoginQRCallbackEventType {
    QRCodeGenerated,
    QRCodeExpired,
    QRCodeScanned,
    QRCodeDeclined,
    GotLoginInfo,
  }

  type Actions = { retry(): unknown; abort(): unknown };
  export type LoginQRCallbackEvent =
    | { type: LoginQRCallbackEventType.QRCodeGenerated; data: { image: string }; actions: Actions }
    | { type: LoginQRCallbackEventType.QRCodeExpired; data: null; actions: Actions }
    | { type: LoginQRCallbackEventType.QRCodeScanned; data: { display_name: string; avatar: string }; actions: Actions }
    | { type: LoginQRCallbackEventType.QRCodeDeclined; data: { code: string }; actions: Actions }
    | { type: LoginQRCallbackEventType.GotLoginInfo; data: unknown; actions: null };

  export class API {
    listener: {
      on(event: "message", callback: (message: ZcaMessage) => unknown): unknown;
      off(event: "message", callback: (message: ZcaMessage) => unknown): unknown;
      start(options?: { retryOnClose?: boolean }): void;
      stop(): void;
    };
    getOwnId(): string;
    fetchAccountInfo(): Promise<unknown>;
    getAllFriends(): Promise<unknown[]>;
    getAllGroups(): Promise<{ version: string; gridVerMap: Record<string, string> }>;
    getGroupInfo(ids: string | string[]): Promise<unknown>;
    sendMessage(message: { msg: string; quote: NonNullable<import("./types.js").ZaloIncomingMessage["quote"]> }, threadId: string, type: ThreadType): Promise<unknown>;
  }

  export enum ThreadType { User = 0, Group = 1 }
  export type ZcaMessage = {
    type: ThreadType;
    threadId: string;
    isSelf: boolean;
    data: {
      msgId: string;
      cliMsgId: string;
      msgType: string;
      uidFrom: string;
      dName: string;
      ts: string;
      content: string | Record<string, unknown>;
      propertyExt?: Record<string, unknown>;
      ttl: number;
    };
  };

  export class Zalo {
    constructor(options?: { logging?: boolean });
    loginQR(options?: Record<string, unknown>, callback?: (event: LoginQRCallbackEvent) => unknown): Promise<API>;
  }
}
