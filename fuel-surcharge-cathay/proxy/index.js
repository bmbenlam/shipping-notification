// Cloud Function: cathayProxy
// Fetches Cathay Pacific's fuel surcharge page and returns raw HTML.
// Acts as a proxy so Google Apps Script bypasses Akamai CDN bot blocking.
//
// Required env var: PROXY_API_KEY — set during deployment, mirrored in Apps Script Properties.

const CATHAY_URL =
  'https://www.cathaypacific.com/cx/zh_HK/latest-news/other-news/fuel-surcharge-updates.html';

exports.cathayProxy = async (req, res) => {
  const apiKey = process.env.PROXY_API_KEY;
  if (apiKey && req.headers['x-proxy-key'] !== apiKey) {
    res.status(403).send('Forbidden');
    return;
  }

  try {
    const upstream = await fetch(CATHAY_URL, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-HK,zh-TW;q=0.9,zh;q=0.8',
      },
      signal: AbortSignal.timeout(25000),
    });

    if (!upstream.ok) {
      res.status(502).send(`Upstream HTTP ${upstream.status}`);
      return;
    }

    const html = await upstream.text();
    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.status(200).send(html);
  } catch (e) {
    res.status(502).send(`Error: ${e.message}`);
  }
};
