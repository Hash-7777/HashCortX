// ==============================================================
// platform/tauri/provider-bridge.js — the providers a web page cannot call
//
// SambaNova, NVIDIA and Kimi Code refuse every request that comes from a web
// page, and inside this app every request does. Theirs are sent by the app
// itself instead (src-tauri/src/commands/provider.rs), which reaches one fixed
// address per provider and route and nothing else.
//
// What comes back is an ordinary Response, streamed as it arrives, so the
// code that reads a provider's answer — status, error body, SSE stream, JSON —
// reads this one exactly as it reads a fetch. Nothing downstream needs to know
// which way the request went.
//
//   HC.providerBridge.request(provider, route, { key, body, signal })
//     provider  "samba" | "nvidia" | "kimi-code"
//     route     "chat" (body: a JSON string) | "models" (no body)
//     → Promise<Response>
//
// A stopped request is stopped here at once — the promise rejects, or the
// stream errors, with an AbortError like fetch's — and the app is told to drop
// the reply at its next read.
// ==============================================================

(function () {
  'use strict';

  window.HC = window.HC || {};

  // A Response with one of these statuses may not have a body at all.
  const NO_BODY = new Set([101, 204, 205, 304]);

  function abortError() {
    try { return new DOMException('The request was stopped.', 'AbortError'); }
    catch { return Object.assign(new Error('The request was stopped.'), { name: 'AbortError' }); }
  }

  function newId() {
    if (window.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }

  function request(provider, route, { key, body, signal } = {}) {
    const Channel = window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.Channel;
    if (!HC.isTauri || !Channel) {
      return Promise.reject(new TypeError(`${provider} can only be reached from the desktop app.`));
    }
    if (signal && signal.aborted) return Promise.reject(abortError());

    const requestId = newId();
    const encoder = new TextEncoder();
    let controller = null;
    let answered = false;   // the promise has resolved or rejected
    let closed = false;     // the stream has ended, one way or the other

    const stop = () => { HC.invoke('provider_request_cancel', { requestId }).catch(() => {}); };
    const stream = new ReadableStream({
      start(c) { controller = c; },
      // The reader walked away — a caller that has what it needed.
      cancel() { closed = true; stop(); },
    });

    return new Promise((resolve, reject) => {
      const finish = (err) => {
        if (signal) signal.removeEventListener('abort', onAbort);
        if (!answered) { answered = true; reject(err); return; }
        if (closed) return;
        closed = true;
        try { controller.error(err); } catch { /* already done */ }
      };
      function onAbort() { stop(); finish(abortError()); }
      if (signal) signal.addEventListener('abort', onAbort, { once: true });

      const channel = new Channel();
      channel.onmessage = (evt) => {
        if (!evt || typeof evt !== 'object') return;
        if (evt.kind === 'head') {
          if (answered) return;
          answered = true;
          const headers = new Headers();
          if (evt.mime) headers.set('content-type', evt.mime);
          if (evt.retry) headers.set('retry-after', evt.retry);
          const status = Number(evt.status);
          // The Response constructor throws outside 200–599; a provider sending
          // something else has sent nothing this app can read as an answer.
          if (!(status >= 200 && status <= 599)) {
            answered = false;
            finish(new TypeError(`${provider} answered with status ${evt.status}.`));
            return;
          }
          resolve(new Response(NO_BODY.has(status) ? null : stream, { status, headers }));
        } else if (evt.kind === 'chunk') {
          if (!closed && typeof evt.text === 'string') controller.enqueue(encoder.encode(evt.text));
        } else if (evt.kind === 'end') {
          if (signal) signal.removeEventListener('abort', onAbort);
          if (!closed) { closed = true; controller.close(); }
          if (!answered) { answered = true; reject(new TypeError(`${provider} closed the connection without answering.`)); }
        } else if (evt.kind === 'fail') {
          // A TypeError, like a fetch that could not connect, so the model
          // router reads it as a provider it could not reach.
          finish(new TypeError(`${provider}: ${evt.message || 'the request failed.'}`));
        }
      };

      HC.invoke('provider_request', {
        provider, route, key: String(key || ''), body: body == null ? null : String(body), requestId, onEvent: channel,
      }).catch((err) => finish(new TypeError(`${provider}: ${(err && err.message) || err}`)));
    });
  }

  HC.providerBridge = { request };
})();
