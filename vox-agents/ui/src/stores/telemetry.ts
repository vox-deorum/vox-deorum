import { ref, shallowRef } from 'vue';
import { api } from '../api/client';
import type { TelemetryMetadata, TelemetrySession, EnvoyThread } from '@/utils/types';

const pollIntervalMs = 5000;

export const activeSessions = ref<TelemetrySession[]>([]);
export const chatSessions = shallowRef<EnvoyThread[]>([]);
export const databases = ref<TelemetryMetadata[]>([]);
export const loading = ref(false);
export const loadingChats = ref(false);

let sessionsRequest: Promise<void> | null = null;
let databasesRequest: Promise<void> | null = null;
let chatsRequest: Promise<void> | null = null;
let telemetryDataRequest: Promise<void> | null = null;
let chatDataRequest: Promise<void> | null = null;
let sessionPollInterval: number | null = null;
let chatPollInterval: number | null = null;
let sessionPollingConsumers = 0;
let chatPollingConsumers = 0;
let chatRevision = 0;

/** Fetch active telemetry sessions, reusing a request already in progress. */
function fetchSessions(): Promise<void> {
  if (sessionsRequest) return sessionsRequest;
  sessionsRequest = api.getTelemetrySessions().then((response) => {
    activeSessions.value = response.sessions || [];
  }).catch((error) => {
    console.error('Failed to fetch telemetry sessions:', error);
  }).finally(() => {
    sessionsRequest = null;
  });
  return sessionsRequest;
}

/** Fetch telemetry databases, reusing a request already in progress. */
function fetchDatabases(): Promise<void> {
  if (databasesRequest) return databasesRequest;
  databasesRequest = api.getTelemetryDatabases().then((response) => {
    databases.value = (response.databases || []).sort((a, b) => {
      const dateA = new Date(a.lastModified).getTime();
      const dateB = new Date(b.lastModified).getTime();
      return dateB - dateA;
    });
  }).catch((error) => {
    console.error('Failed to fetch telemetry databases:', error);
  }).finally(() => {
    databasesRequest = null;
  });
  return databasesRequest;
}

/** Fetch chat threads, reusing a request already in progress. */
function fetchChatSessions(): Promise<void> {
  if (chatsRequest) return chatsRequest;
  const requestRevision = chatRevision;
  chatsRequest = api.getAgentChats().then((response) => {
    if (requestRevision === chatRevision) {
      chatSessions.value = response.chats || [];
    }
  }).catch((error) => {
    console.error('Failed to fetch chat threads:', error);
  }).finally(() => {
    chatsRequest = null;
  });
  return chatsRequest;
}

/** Fetch active sessions and telemetry databases once. */
export function fetchTelemetryData(): Promise<void> {
  if (telemetryDataRequest) return telemetryDataRequest;
  loading.value = true;
  telemetryDataRequest = Promise.all([fetchSessions(), fetchDatabases()]).then(() => undefined).finally(() => {
    loading.value = false;
    telemetryDataRequest = null;
  });
  return telemetryDataRequest;
}

/** Fetch chat sessions once. */
export function fetchChatData(): Promise<void> {
  if (chatDataRequest) return chatDataRequest;
  loadingChats.value = true;
  chatDataRequest = fetchChatSessions().finally(() => {
    loadingChats.value = false;
    chatDataRequest = null;
  });
  return chatDataRequest;
}

/** Remove a deleted chat immediately, invalidate older reads, then load a fresh list. */
export async function refreshChatDataAfterDelete(sessionId: string): Promise<void> {
  chatRevision++;
  chatSessions.value = chatSessions.value.filter((session) => session.id !== sessionId);

  while (chatsRequest) {
    await chatsRequest;
  }

  await fetchChatSessions();
}

/** Run one active-session polling tick. */
function pollSessions(): void {
  void fetchSessions();
}

/** Run one chat-session polling tick. */
function pollChats(): void {
  void fetchChatSessions();
}

/** Acquire active-session polling and return a cleanup handle. */
function acquireSessionPolling(): () => void {
  sessionPollingConsumers++;
  if (sessionPollInterval === null) {
    sessionPollInterval = window.setInterval(pollSessions, pollIntervalMs);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    sessionPollingConsumers = Math.max(0, sessionPollingConsumers - 1);
    if (sessionPollingConsumers > 0 || sessionPollInterval === null) return;
    window.clearInterval(sessionPollInterval);
    sessionPollInterval = null;
  };
}

/** Acquire chat-session polling and return a cleanup handle. */
function acquireChatPolling(): () => void {
  chatPollingConsumers++;
  if (chatPollInterval === null) {
    chatPollInterval = window.setInterval(pollChats, pollIntervalMs);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    chatPollingConsumers = Math.max(0, chatPollingConsumers - 1);
    if (chatPollingConsumers > 0 || chatPollInterval === null) return;
    window.clearInterval(chatPollInterval);
    chatPollInterval = null;
  };
}

/** Start telemetry-page loading and polling for one mounted consumer. */
export function startTelemetryPolling(): () => void {
  void fetchTelemetryData();
  return acquireSessionPolling();
}

/** Start active-session loading and polling for one mounted consumer. */
export function startActiveSessionPolling(): () => void {
  void fetchSessions();
  return acquireSessionPolling();
}

/** Start chat-page loading and polling for one mounted consumer. */
export function startChatPolling(): () => void {
  void fetchTelemetryData();
  void fetchChatData();
  const releaseSessions = acquireSessionPolling();
  const releaseChats = acquireChatPolling();
  return () => {
    releaseSessions();
    releaseChats();
  };
}
