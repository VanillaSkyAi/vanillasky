// Queue SSE carries the same status objects as polling. The caller must validate
// statusUrl before credentials reach this helper. Never use URLs in SSE events.
// https://fal.ai/docs/documentation/model-apis/inference/queue#stream-status-updates
export async function streamFalStatus(statusUrl, { fetcher, headers, signal, onStatus, poll }) {
  signal.throwIfAborted();
  const controller = new AbortController();
  let timer;
  let settled = false;
  let streaming = true;
  let polling = false;
  let finish;
  const result = new Promise((resolve, reject) => {
    finish = (status, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      controller.abort();
      if (error) reject(error);
      else resolve(status);
    };
  });
  const abort = () => finish(null, signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  const observe = status => {
    if (settled) return;
    if (!status || typeof status !== 'object' || !['IN_QUEUE', 'IN_PROGRESS', 'COMPLETED'].includes(status.status)) throw new Error('Invalid status stream');
    onStatus(status);
    if (status.status === 'COMPLETED') finish(status);
    else arm();
  };
  const check = async () => {
    polling = true;
    try { observe(await poll(controller.signal)); }
    catch (error) { if (!streaming) finish(null, error); }
    finally {
      polling = false;
      if (!streaming) finish(null);
      else arm();
    }
  };
  // A healthy stream stays open during a silent generation. The watchdog checks
  // that same job after 1.5s without status updates; either completion can win.
  // At most one stream and one status request are active, within caller deadline.
  function arm() {
    clearTimeout(timer);
    if (!settled && !polling) timer = setTimeout(() => { void check(); }, 1500);
  }
  arm();
  void readStatusStream(statusUrl, { fetcher, headers, signal: controller.signal, onStatus: observe }).then(
    status => { streaming = false; if (status || !polling) finish(status); },
    () => { streaming = false; if (!polling) finish(null); },
  );
  try { return await result; }
  finally { signal.removeEventListener('abort', abort); }
}

async function readStatusStream(statusUrl, { fetcher, headers, signal, onStatus }) {
  const url = new URL(statusUrl);
  url.pathname = `${url.pathname.replace(/\/$/, '')}/stream`;
  const response = await fetcher(url.href, {
    headers: { ...headers, Accept: 'text/event-stream' }, redirect: 'manual', signal,
  });
  if (!response.ok || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'text/event-stream' || !response.body) {
    void response.body?.cancel().catch(() => {});
    return null;
  }
  const reader = response.body.getReader();
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  const decoder = new TextDecoder();
  let bytes = 0;
  let buffer = '';
  let data = [];
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) return null;
      bytes += value.byteLength;
      if (bytes > 65536) throw new Error('Invalid status stream');
      buffer += decoder.decode(value, { stream: true });
      while (true) {
        const boundary = buffer.search(/[\r\n]/);
        if (boundary < 0 || (buffer[boundary] === '\r' && boundary === buffer.length - 1)) break;
        const line = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + (buffer.slice(boundary, boundary + 2) === '\r\n' ? 2 : 1));
        if (line === '') {
          if (!data.length) continue;
          const status = JSON.parse(data.join('\n'));
          data = [];
          onStatus(status);
          if (status.status === 'COMPLETED') return status;
        } else if (line === 'data' || line.startsWith('data:')) {
          data.push(line === 'data' ? '' : line.slice(5).replace(/^ /, ''));
        }
      }
    }
  } finally {
    signal.removeEventListener('abort', abort);
    void reader.cancel().catch(() => {});
  }
}
