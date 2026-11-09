import { Platform } from 'react-native';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { buildAssistantSnapshot } from '../domain/assistant';
import { useStore } from '../store';
import { call } from '../store/sync';

export interface AssistantConnection {
  id: string;
  name: string;
  createdAt: number;
  lastUsedAt: number | null;
  /** may it add transactions (otherwise it only reads) */
  canWrite: boolean;
}

interface Assistant {
  /** false until the first answer of the API */
  loaded: boolean;
  connections: AssistantConnection[];
  /** the address to paste in the assistant (Claude: Settings, Connectors, add a custom connector) */
  mcpUrl: string;
  /** when the picture of the finances the assistant reads was last published */
  snapshotAt: number | null;
  refresh: () => Promise<void>;
  disconnect: (id: string) => Promise<void>;
  /** lets a connection add transactions, or not */
  setCanWrite: (id: string, write: boolean) => Promise<void>;
  /** the link that opens Claude's "add custom connector" form already filled in; Claude then asks for the person's OK */
  connectLink: string;
  /** publishes the picture now (used right before a connection is approved) */
  publishNow: () => Promise<void>;
}

const Ctx = createContext<Assistant | null>(null);
/** a changed picture is published a little after the last change, and never more often than this */
const PUBLISH_DELAY_MS = 3000;

/**
 * The connected assistants (Claude) of the account, and the publishing of the picture of the finances they read: only while
 * somebody is connected, like the shared summary, and only when it changed.
 */
export function AssistantProvider({ children }: { children: React.ReactNode }) {
  const { data, ready } = useStore();
  const [loaded, setLoaded] = useState(false);
  const [connections, setConnections] = useState<AssistantConnection[]>([]);
  const [mcpUrl, setMcpUrl] = useState('');
  const [snapshotAt, setSnapshotAt] = useState<number | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await call<{ connections: AssistantConnection[]; snapshotAt: number | null; mcpUrl: string }>('/assistant/connections');
      if (!alive.current) return;
      setConnections(res.connections);
      setSnapshotAt(res.snapshotAt);
      setMcpUrl(res.mcpUrl);
      setLoaded(true);
    } catch {
      if (alive.current) setLoaded(true);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const lastPublished = useRef('');
  const publish = useCallback(async () => {
    const snap = buildAssistantSnapshot(data);
    // what makes it "changed": everything but the clock
    const fingerprint = JSON.stringify({ ...snap, generatedAt: 0, today: '' });
    if (fingerprint === lastPublished.current) return;
    await call('/assistant/snapshot', { method: 'PUT', body: snap });
    lastPublished.current = fingerprint;
    if (alive.current) setSnapshotAt(snap.generatedAt);
  }, [data]);

  useEffect(() => {
    if (!ready || connections.length === 0) return;
    const timer = setTimeout(() => void publish().catch(() => {}), PUBLISH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [ready, connections.length, publish]);

  const disconnect = useCallback(
    async (id: string) => {
      await call('/assistant/connections/revoke', { method: 'POST', body: { id } });
      lastPublished.current = '';
      await refresh();
    },
    [refresh],
  );

  const setCanWrite = useCallback(
    async (id: string, write: boolean) => {
      await call('/assistant/connections/permissions', { method: 'POST', body: { id, write } });
      await refresh();
    },
    [refresh],
  );
  const address = mcpUrl || (Platform.OS === 'web' ? `${window.location.origin}/api/mcp` : '');
  const connectLink = `https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=${encodeURIComponent('Ctrl+Cash')}&connectorUrl=${encodeURIComponent(address)}`;

  // a connection is about to exist: the first publish is allowed (the server keeps a snapshot only while somebody is connected)
  const publishNow = useCallback(async () => {
    lastPublished.current = '';
    const snap = buildAssistantSnapshot(data);
    try {
      await call('/assistant/snapshot', { method: 'PUT', body: snap });
    } catch {
      // not connected yet (409): the app publishes it as soon as the connection shows up
    }
  }, [data]);

  const value = useMemo<Assistant>(() => ({ loaded, connections, mcpUrl: address, snapshotAt, refresh, disconnect, setCanWrite, connectLink, publishNow }), [loaded, connections, address, snapshotAt, refresh, disconnect, setCanWrite, connectLink, publishNow]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAssistant(): Assistant {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAssistant outside AssistantProvider');
  return v;
}
