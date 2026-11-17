import { useEffect, useRef } from 'react';
import type { ConversationMessage, HUDSettings, LiveHUDStatus, NeuralTelemetry } from '../main/types.js';

export interface AdvancedConsoleProps {
  status: LiveHUDStatus;
  conversation: ConversationMessage[];
  settings: HUDSettings;
  telemetry: NeuralTelemetry | null;
  pinned: boolean;
  chromeConnected: boolean;
  notice: string | null;
  onAction: (action: string, payload?: Record<string, unknown>) => void;
}

export function AdvancedConsole(props: AdvancedConsoleProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    const target = frame.current?.contentWindow;
    if (!target) return;
    target.postMessage({ type: 'gematron:state', state: {
      status: props.status,
      conversation: props.conversation,
      settings: props.settings,
      telemetry: props.telemetry,
      pinned: props.pinned,
      chromeConnected: props.chromeConnected,
      notice: props.notice,
    } }, '*');
  }, [props.status, props.conversation, props.settings, props.telemetry, props.pinned, props.chromeConnected, props.notice]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const data = event.data as { type?: unknown; action?: unknown; payload?: unknown };
      if (data?.type !== 'gematron:action' || typeof data.action !== 'string') return;
      const payload = data.payload && typeof data.payload === 'object'
        ? data.payload as Record<string, unknown>
        : undefined;
      latest.current.onAction(data.action, payload);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return <iframe ref={frame} title="Gematron Advanced Console" src="./advanced-console.html" style={{ width: '100%', height: '100%', border: 0, display: 'block', background: 'transparent' }} onLoad={() => {
    frame.current?.contentWindow?.postMessage({ type: 'gematron:state', state: {
      status: latest.current.status,
      conversation: latest.current.conversation,
      settings: latest.current.settings,
      telemetry: latest.current.telemetry,
      pinned: latest.current.pinned,
      chromeConnected: latest.current.chromeConnected,
      notice: latest.current.notice,
    } }, '*');
  }} />;
}
