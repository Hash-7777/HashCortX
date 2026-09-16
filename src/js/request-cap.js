// ==============================================================
// A cap on AI requests to cloud providers
//
// Runs are bounded by their steps, but nothing bounded how many requests the
// whole app sent: a Swarm team failing over, a loop that went wrong, or text
// that talked an agent into repeating itself could spend a provider quota at
// the speed of the network. Every cloud AI request now passes this cap:
//
//   · at most 30 in any minute, and
//   · at most 6 running at once, across the whole app.
//
// A request over the cap is refused at once with an error saying which part
// was reached; it is not queued. It counts a request to a cloud provider's
// own address that sends something (a POST), which is what asks a model for
// an answer, and the three providers the app calls through Rust on their
// "chat" route. Model lists, local models, web search and every other request
// are not counted. A running request holds its place until its answer has
// been read to the end, stopped, or failed — or for three minutes at most, so
// an answer nobody reads cannot hold a place for good.
//
// Loaded after js/providers.js and platform/tauri/provider-bridge.js and
// before app.js; published as window.HCRequestCap.
// Checked by scripts/checks/request-cap.mjs.
// ==============================================================

(function () {
  'use strict';

  const PER_MINUTE = 30;
  const AT_ONCE = 6;
  const WINDOW_MS = 60 * 1000;
  const HOLD_MS = 3 * 60 * 1000;
  // A Response with one of these statuses has no body to wait for.
  const NO_BODY = new Set([101, 204, 205, 304]);

  /** Refused by the app's own cap. Worded so no failover reads it as a provider's limit. */
  function capError(which) {
    const message = which === 'minute'
      ? `HashCortX held this back: it would be more than ${PER_MINUTE} cloud AI requests in one minute, the app's own cap. Wait a minute before sending more.`
      : `HashCortX held this back: it would be more than ${AT_ONCE} cloud AI requests running at once, the app's own cap. Wait for one to finish.`;
    return Object.assign(new Error(message), { name: 'RequestCapError', cap: which });
  }

  /**
   * The counting, with its clock passed in. `take()` returns a function that
   * gives the place back (safe to call more than once), or throws capError.
   */
  function createCap(options = {}) {
    const perMinute = options.perMinute || PER_MINUTE;
    const atOnce = options.atOnce || AT_ONCE;
    const windowMs = options.windowMs || WINDOW_MS;
    const now = options.now || (() => Date.now());
    const started = [];
    let running = 0;
    return {
      take() {
        const t = now();
        while (started.length && t - started[0] >= windowMs) started.shift();
        if (started.length >= perMinute) throw capError('minute');
        if (running >= atOnce) throw capError('once');
        started.push(t);
        running++;
        let given = false;
        return () => { if (!given) { given = true; running--; } };
      },
      state() {
        const t = now();
        return { inLastMinute: started.filter((s) => t - s < windowMs).length, running };
      },
    };
  }

  /** Whether a fetch is a cloud AI request: a POST to a provider's own address. */
  function isCloudAiRequest(input, init, origins) {
    let url;
    let method = (init && init.method) || (input && typeof input === 'object' && input.method) || 'GET';
    try { url = new URL(typeof input === 'string' ? input : (input && input.url) || String(input)); } catch { return false; }
    return String(method).toUpperCase() === 'POST' && origins.has(url.origin);
  }

  /**
   * `response` with its place given back once its body is finished — read to
   * the end, cancelled, or errored — or after `holdMs`, or when `signal` stops.
   */
  function holdUntilRead(response, give, { holdMs = HOLD_MS, signal, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    let timer = null;
    const done = () => { if (timer !== null) { clearTimer(timer); timer = null; } give(); };
    if (!response || !response.body || NO_BODY.has(response.status)) { done(); return response; }
    timer = setTimer(done, holdMs);
    if (signal) {
      if (signal.aborted) done();
      else signal.addEventListener('abort', done, { once: true });
    }
    const reader = response.body.getReader();
    const body = new ReadableStream({
      async pull(controller) {
        try {
          const { done: end, value } = await reader.read();
          if (end) { done(); controller.close(); } else controller.enqueue(value);
        } catch (err) {
          done();
          controller.error(err);
        }
      },
      cancel(reason) { done(); return reader.cancel(reason); },
    });
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  }

  /** Put the cap in front of `win.fetch` and `hc.providerBridge.request`. */
  function install(win, hc, cap, opts = {}) {
    const origins = () => new Set((win.HCProviders && win.HCProviders.allHosts()) || []);
    const realFetch = win.fetch.bind(win);
    win.fetch = async function cappedFetch(input, init) {
      if (!isCloudAiRequest(input, init, origins())) return realFetch(input, init);
      const give = cap.take();
      let response;
      try { response = await realFetch(input, init); }
      catch (err) { give(); throw err; }
      return holdUntilRead(response, give, { ...opts, signal: init && init.signal });
    };
    const bridge = hc && hc.providerBridge;
    if (bridge && typeof bridge.request === 'function') {
      const realRequest = bridge.request.bind(bridge);
      bridge.request = async function cappedRequest(provider, route, options = {}) {
        if (route !== 'chat') return realRequest(provider, route, options);
        const give = cap.take();
        let response;
        try { response = await realRequest(provider, route, options); }
        catch (err) { give(); throw err; }
        return holdUntilRead(response, give, { ...opts, signal: options.signal });
      };
    }
  }

  const cap = createCap();
  window.HCRequestCap = { PER_MINUTE, AT_ONCE, createCap, isCloudAiRequest, holdUntilRead, install, capError, state: () => cap.state() };
  if (typeof window.fetch === 'function') install(window, window.HC, cap);
})();
