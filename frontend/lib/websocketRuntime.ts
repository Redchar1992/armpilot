import type {
  ArmRuntime,
  RuntimeCommand,
  RuntimeMessage,
} from "./sceneTypes";

export class WebSocketRuntime implements ArmRuntime {
  readonly mode = "websocket" as const;
  readonly label = "MuJoCo live";
  readonly description = "FastAPI · 30 Hz WebSocket · real physics";

  private socket: WebSocket | null = null;
  private emit: ((message: RuntimeMessage) => void) | null = null;
  private retryTimer: number | null = null;
  private closed = false;

  constructor(private readonly url: string) {}

  connect(emit: (message: RuntimeMessage) => void): void {
    this.emit = emit;
    this.closed = false;
    this.open();
  }

  send(command: RuntimeCommand): void {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      this.emit?.({ type: "error", message: "MuJoCo backend is not connected." });
      return;
    }
    this.socket.send(JSON.stringify(command));
  }

  dispose(): void {
    this.closed = true;
    if (this.retryTimer !== null) window.clearTimeout(this.retryTimer);
    this.socket?.close();
    this.socket = null;
    this.emit = null;
  }

  private open(): void {
    this.emit?.({ type: "connection", connected: false, message: `connecting to ${this.url}` });
    const socket = new WebSocket(this.url);
    this.socket = socket;
    socket.onopen = () => {
      this.emit?.({ type: "connection", connected: true, message: "MuJoCo stream connected" });
    };
    socket.onmessage = (event) => {
      try {
        this.emit?.(JSON.parse(event.data) as RuntimeMessage);
      } catch {
        this.emit?.({ type: "error", message: "Ignored malformed backend frame." });
      }
    };
    socket.onerror = () => {
      this.emit?.({ type: "error", message: "WebSocket transport error." });
    };
    socket.onclose = () => {
      this.emit?.({ type: "connection", connected: false, message: "MuJoCo stream disconnected" });
      if (!this.closed) this.retryTimer = window.setTimeout(() => this.open(), 1500);
    };
  }
}

