import { BrowserDemoRuntime } from "./browserRuntime";
import type { ArmRuntime } from "./sceneTypes";
import { WebSocketRuntime } from "./websocketRuntime";

export function createRuntime(): ArmRuntime {
  const configuredMode = process.env.NEXT_PUBLIC_RUNTIME;
  const websocketUrl = process.env.NEXT_PUBLIC_WS_URL;
  if (configuredMode === "websocket" || websocketUrl) {
    return new WebSocketRuntime(websocketUrl ?? "ws://localhost:8000/ws");
  }
  return new BrowserDemoRuntime();
}

