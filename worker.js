const CAMPUS_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#111827">
  <title>The OGEN Complex Campus</title>
  <style>
    :root {
      color-scheme: light dark;
      font-family: Arial, sans-serif;
    }

    body {
      margin: 0;
      min-height: 100vh;
      background: #f8fafc;
      color: #111827;
    }

    main {
      width: min(960px, calc(100% - 32px));
      margin: 0 auto;
      padding: 48px 0;
    }

    section {
      background: #ffffff;
      border: 1px solid #e5e7eb;
      border-radius: 16px;
      box-shadow: 0 10px 24px rgb(15 23 42 / 8%);
      margin-top: 24px;
      padding: 24px;
    }

    h1 {
      font-size: clamp(2.25rem, 7vw, 5rem);
      margin: 0;
      letter-spacing: -0.06em;
    }

    p {
      line-height: 1.6;
      max-width: 68ch;
    }

    button,
    input::file-selector-button {
      background: #111827;
      border: 0;
      border-radius: 999px;
      color: #ffffff;
      cursor: pointer;
      font: inherit;
      margin-right: 8px;
      padding: 10px 16px;
    }

    canvas {
      border: 1px solid #d1d5db;
      border-radius: 12px;
      display: block;
      margin-top: 16px;
      max-width: 100%;
    }

    .hidden {
      display: none;
    }
  </style>
</head>
<body>
  <main>
    <h1>The OGEN Complex</h1>
    <p>A single-file campus running on Cloudflare Workers.</p>

    <section aria-labelledby="image-tools-title">
      <h2 id="image-tools-title">Campus Image Tools</h2>
      <p>Upload an image to preview it on canvas, then download a local PNG copy.</p>
      <input id="imageUpload" type="file" accept="image/*">
      <button id="downloadImage" type="button">Download image</button>
      <canvas id="imageCanvas" class="hidden"></canvas>
    </section>
  </main>

  <script>
    document.getElementById('imageUpload').onchange = e => {
        let img = new Image();
        img.src = URL.createObjectURL(e.target.files[0]);
        img.onload = () => {
            let canvas = document.getElementById('imageCanvas');
            canvas.width = img.width;
            canvas.height = img.height;
            canvas.getContext('2d').drawImage(img, 0, 0);
            canvas.classList.remove('hidden');
        };
    };

    document.getElementById('downloadImage').onclick = () => {
        let canvas = document.getElementById('imageCanvas');
        if (canvas.width) {
            let a = document.createElement('a');
            a.href = canvas.toDataURL();
            a.download = 'ogen_image.png';
            a.click();
        }
    };

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js');
    }
  </script>
</body>
</html>`;

let fallbackCampusHtml = CAMPUS_HTML;
let previousFallbackCampusHtml = null;
const CAMPUS_HTML_KEY = 'campus_html';
const PREVIOUS_CAMPUS_HTML_KEY = 'previous_campus_html';

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === '/api/deploy' && req.method === 'POST') {
      try {
        const { html, ts, token } = await req.json();
        if (token !== env.DEPLOY_SECRET) {
          return new Response('Unauthorized', { status: 401 });
        }
        if (typeof ts !== 'number' || Date.now() - ts > 300000) {
          return new Response('Expired (older than 5 minutes)', { status: 401 });
        }
        if (typeof html !== 'string' || !html.trim()) {
          return new Response('Missing html', { status: 400 });
        }

        const currentHtml = await getCampusHtml(env);
        await putCampusHtml(env, html, currentHtml);

        return json({ ok: true, updatedAt: new Date().toISOString() });
      } catch (error) {
        return new Response('Bad request', { status: 400 });
      }
    }

    if (path === '/api/rollback' && req.method === 'POST') {
      try {
        const { ts, token } = await req.json();
        if (token !== env.DEPLOY_SECRET) {
          return new Response('Unauthorized', { status: 401 });
        }
        if (typeof ts !== 'number' || Date.now() - ts > 300000) {
          return new Response('Expired (older than 5 minutes)', { status: 401 });
        }

        const previousHtml = await getPreviousCampusHtml(env);
        if (!previousHtml) {
          return new Response('No rollback version available', { status: 404 });
        }

        const currentHtml = await getCampusHtml(env);
        await putCampusHtml(env, previousHtml, currentHtml);

        return json({ ok: true, rolledBackAt: new Date().toISOString() });
      } catch (error) {
        return new Response('Bad request', { status: 400 });
      }
    }

    if (path === '/api/ledger' && req.method === 'GET') {
      const html = await getCampusHtml(env);
      const digest = await sha256(html);

      return json({
        ok: true,
        sha256: digest,
        bytes: new TextEncoder().encode(html).length,
      });
    }

    if (path === '/sw.js') {
      return new Response(SERVICE_WORKER_JS, {
        headers: {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Cache-Control': 'no-cache',
        },
      });
    }

    if (path === '/' || path === '/campus') {
      return htmlResponse(await getCampusHtml(env));
    }

    return new Response('Not found', { status: 404 });
  },
};

async function getCampusHtml(env) {
  if (env.CAMPUS_KV) {
    return (await env.CAMPUS_KV.get(CAMPUS_HTML_KEY)) || CAMPUS_HTML;
  }

  return fallbackCampusHtml;
}

async function getPreviousCampusHtml(env) {
  if (env.CAMPUS_KV) {
    return env.CAMPUS_KV.get(PREVIOUS_CAMPUS_HTML_KEY);
  }

  return previousFallbackCampusHtml;
}

async function putCampusHtml(env, html, previousHtml) {
  if (env.CAMPUS_KV) {
    await Promise.all([
      env.CAMPUS_KV.put(CAMPUS_HTML_KEY, html),
      env.CAMPUS_KV.put(PREVIOUS_CAMPUS_HTML_KEY, previousHtml),
    ]);
    return;
  }

  previousFallbackCampusHtml = previousHtml;
  fallbackCampusHtml = html;
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

function htmlResponse(html) {
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache',
    },
  });
}

function json(body, init = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...(init.headers || {}),
    },
  });
}

const SERVICE_WORKER_JS = `const CACHE_NAME = 'ogen-campus-v1';
const OFFLINE_URLS = ['/', '/campus'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(OFFLINE_URLS)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(response => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then(response => response || caches.match('/campus')))
  );
});`;
