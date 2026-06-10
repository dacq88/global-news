const https = require('https');
const http = require('http');

const FEEDS = [
  { source: 'CNBC',      url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html' },
  { source: 'CNBC',      url: 'https://www.cnbc.com/id/15839135/device/rss/rss.html' },
  { source: 'CNN',       url: 'http://rss.cnn.com/rss/edition.rss' },
  { source: 'CNN',       url: 'http://rss.cnn.com/rss/edition_business.rss' },
  { source: 'Bloomberg', url: 'https://feeds.bloomberg.com/markets/news.rss' },
  { source: 'Bloomberg', url: 'https://feeds.bloomberg.com/technology/news.rss' },
  { source: 'Reuters',   url: 'https://feeds.reuters.com/reuters/topNews' },
  { source: 'Reuters',   url: 'https://feeds.reuters.com/reuters/businessNews' },
  { source: 'BBC',       url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
  { source: 'BBC',       url: 'https://feeds.bbci.co.uk/news/business/rss.xml' },
  { source: 'WSJ',       url: 'https://feeds.a.dj.com/rss/RSSMarketsMain.xml' },
  { source: 'WSJ',       url: 'https://feeds.a.dj.com/rss/WSJcomUSBusiness.xml' },
  { source: 'AP',        url: 'https://apnews.com/apf-topnews?format=rss' },
  { source: 'AP',        url: 'https://apnews.com/apf-business?format=rss' },
];

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
      },
      timeout: 8000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function cleanHtml(text) {
  return (text || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#\d+;/g, '')
    .replace(/\s+/g, ' ').trim();
}

function parseDate(str) {
  if (!str) return 0;
  try { return Math.floor(new Date(str).getTime() / 1000); } catch { return 0; }
}

function parseFeed(xml, source) {
  const results = [];
  try {
    const itemReg = /<item[\s>]([\s\S]*?)<\/item>/g;
    const entryReg = /<entry[\s>]([\s\S]*?)<\/entry>/g;
    const reg = xml.includes('<item') ? itemReg : entryReg;
    let match, count = 0;
    while ((match = reg.exec(xml)) !== null && count < 15) {
      const block = match[1];
      const get = (tag) => {
        const m = block.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i'))
          || block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
        return m ? m[1].trim() : '';
      };
      const title = cleanHtml(get('title'));
      if (!title || title.length < 5) continue;
      const desc = cleanHtml(get('description') || get('summary') || get('content')).slice(0, 250);
      let link = get('link') || '';
      if (!link) {
        const lm = block.match(/<link[^>]+href=["']([^"']+)["']/i);
        if (lm) link = lm[1];
      }
      const pub = get('pubDate') || get('published') || get('updated') || '';
      results.push({ source, title, desc: cleanHtml(link ? desc : ''), link: cleanHtml(link), timestamp: parseDate(pub) });
      count++;
    }
  } catch(e) {}
  return results;
}

async function fetchSource(feed) {
  try {
    const xml = await fetchUrl(feed.url);
    if (!xml || xml.length < 100) return [];
    return parseFeed(xml, feed.source);
  } catch { return []; }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');

  const seen = new Set();
  const seenSources = new Set();
  const all = [];

  await Promise.allSettled(
    FEEDS.map(async (feed) => {
      if (seenSources.has(feed.source)) return;
      const items = await fetchSource(feed);
      if (items.length) {
        seenSources.add(feed.source);
        items.forEach(item => {
          if (!seen.has(item.title)) {
            seen.add(item.title);
            all.push(item);
          }
        });
      }
    })
  );

  all.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  res.status(200).json(all);
};
