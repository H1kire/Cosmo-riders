const baseValue = process.env.PAGES_URL || 'https://h1kire.github.io/Cosmo-riders/';
const base = new URL(baseValue.endsWith('/') ? baseValue : baseValue + '/');
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function getWithRetry(url, attempts = 10) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15000) });
      if (response.ok) return response;
      lastError = new Error(url + ' returned HTTP ' + response.status);
    } catch (error) { lastError = error; }
    if (attempt < attempts) await wait(3000);
  }
  throw lastError;
}
async function checkResource(pageUrl, source, expectedType) {
  const url = new URL(source, pageUrl);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) throw new Error('Unexpected external or out-of-project resource: ' + url.href);
  const response = await getWithRetry(url.href, 2);
  const type = (response.headers.get('content-type') || '').toLowerCase();
  if (!type.includes(expectedType)) throw new Error(url.href + ' has incorrect Content-Type: ' + type + ' (expected ' + expectedType + ')');
  return response;
}
for (const pagePath of ['', 'lab/']) {
  const pageUrl = new URL(pagePath, base);
  const response = await getWithRetry(pageUrl.href);
  const pageType = (response.headers.get('content-type') || '').toLowerCase();
  if (!pageType.includes('text/html')) throw new Error(pageUrl.href + ' is not served as HTML: ' + pageType);
  const html = await response.text();
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)].map(match => match[1]);
  const styles = [...html.matchAll(/<link\b(?=[^>]*\brel=["']stylesheet["'])[^>]*\bhref=["']([^"']+)["'][^>]*>/gi)].map(match => match[1]);
  if (!scripts.length) throw new Error(pageUrl.href + ' has no script entry point.');
  for (const source of scripts) {
    if (/\.tsx?(?:$|[?#])/i.test(source)) throw new Error('Published HTML references raw TypeScript: ' + source);
    await checkResource(pageUrl, source, 'javascript');
  }
  for (const source of styles) await checkResource(pageUrl, source, 'text/css');
  process.stdout.write('PASS live page ' + pageUrl.href + '\n');
}
process.stdout.write('LIVE DEPLOYMENT AUDIT PASSED: both pages and their JS/CSS MIME types are reachable.\n');
