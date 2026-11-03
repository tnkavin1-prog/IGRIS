import type { LiveStatus } from '@gbl/shared';
import type { Tone } from './ui';

export interface StatusMeta {
  label: string;
  title: string;
  detail: string;
  tone: Tone;
  orb: 'idle' | 'listening' | 'thinking' | 'speaking' | 'acting' | 'waiting' | 'error';
}

export function statusMeta(status: LiveStatus, detail?: string | null): StatusMeta {
  switch (status) {
    case 'requesting-mic':
      return {
        label: 'Microphone',
        title: 'Waiting for permission',
        detail: 'Allow microphone access in the Chrome prompt.',
        tone: 'amber',
        orb: 'waiting',
      };
    case 'connecting':
      return {
        label: 'Connecting',
        title: 'Opening a secure Live session',
        detail: 'Minting a single-use token from the local bridge.',
        tone: 'violet',
        orb: 'waiting',
      };
    case 'listening':
      return {
        label: 'Listening',
        title: 'I’m listening',
        detail: 'Speak naturally. You can interrupt at any time.',
        tone: 'green',
        orb: 'listening',
      };
    case 'thinking':
      return {
        label: 'Thinking',
        title: 'Working through it',
        detail: 'Reasoning about the page and your request.',
        tone: 'violet',
        orb: 'thinking',
      };
    case 'speaking':
      return {
        label: 'Speaking',
        title: 'Gemini is speaking',
        detail: 'Start talking to interrupt instantly.',
        tone: 'cyan',
        orb: 'speaking',
      };
    case 'acting':
      return {
        label: 'Acting',
        title: 'Operating the page',
        detail: 'Running a verified browser action.',
        tone: 'amber',
        orb: 'acting',
      };
    case 'reconnecting':
      return {
        label: 'Reconnecting',
        title: 'Restoring the session',
        detail: 'A fresh token is being minted. The conversation is preserved.',
        tone: 'amber',
        orb: 'waiting',
      };
    case 'awaiting-approval':
      return {
        label: 'Approval',
        title: 'Your decision is needed',
        detail: 'Review the requested action below. Nothing has happened yet.',
        tone: 'amber',
        orb: 'waiting',
      };
    case 'quota':
      return {
        label: 'Quota',
        title: 'The Live quota is exhausted',
        detail: detail || 'Wait for the retry window, then start a new session.',
        tone: 'red',
        orb: 'error',
      };
    case 'error':
      return {
        label: 'Attention',
        title: 'The session needs attention',
        detail: detail || 'Check the local bridge and try again.',
        tone: 'red',
        orb: 'error',
      };
    case 'closed':
      return {
        label: 'Ended',
        title: 'Session ended',
        detail: detail || 'Start a new session whenever you are ready.',
        tone: 'neutral',
        orb: 'idle',
      };
    case 'idle':
    default:
      return {
        label: 'Ready',
        title: 'Your browser, in conversation',
        detail: 'Start a live session and ask for anything you would do in Chrome.',
        tone: 'violet',
        orb: 'idle',
      };
  }
}

export const SUGGESTIONS: readonly { label: string; prompt: string }[] = [
  { label: 'Summarize this page', prompt: 'Summarize this page and tell me what matters.' },
  { label: 'Find the key details', prompt: 'Find the most important details on this page.' },
  { label: 'Compare these tabs', prompt: 'Compare the open tabs and highlight the differences.' },
  { label: 'Fill this form', prompt: 'Help me fill in the form on this page.' },
];
