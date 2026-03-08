const SPAM_KEYWORDS = ['viagra', 'casino', 'porn', 'xxx', 'gambling'];

function isSpam(text) {
  return SPAM_KEYWORDS.some(k => text.toLowerCase().includes(k));
}

function isActualProduct(title) {
  const junkWords = ['best', 'top', 'tried', 'tested', 'guide', 'list', 'review', 'comparison', 'vs', 'how to', 'what is'];
  return !junkWords.some(word => title.toLowerCase().includes(word));
}

async function scrapeLogoFromUrl(url) {
  try {
    const domain = new URL(url).hostname;
    return `https://logo.clearbit.com/${domain}`;
  } catch { return null; }
}

// ─────────────────────────────────────────────
// SHOCK NOTIFICATION — Telegram (not email, nobody reads emails in 2026)
// ─────────────────────────────────────────────
async function sendTelegramShock(env, product) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHANNEL_ID) return;
  
  const message = `⚡ *New SaaS Discovered on NodeMeld*

🔥 *${product.name}*
📦 Category: ${product.category}
💰 Pricing: ${product.pricing}
🌐 URL: ${product.url}

_${product.description.substring(0, 120)}..._

[View Listing](https://nodemeld.kryv.network/product/${product.slug}) | [Submit Details](https://nodemeld.kryv.network/submit)`;

  try {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHANNEL_ID,
        text: message,
        parse_mode: 'Markdown',
        disable_web_page_preview: false
      })
    });
  } catch (e) {
    console.error('Telegram notification failed:', e);
  }
}

// ─────────────────────────────────────────────
// SCRAPE SMALL PROFITABLE INDIE SAAS
// Sources: r/SideProject, r/indiehackers, IndieHackers, BetaList, Product Hunt (indie filter)
// Target: Small founders making $100-$10k MRR, NOT VC-backed startups
// ─────────────────────────────────────────────
async function scrapeIndieFounders(env) {
  // Search queries specifically targeting indie/solo founders
  const queries = [
    'site:reddit.com/r/SideProject launched my saas',
    'site:reddit.com/r/indiehackers built tool revenue',
    'site:reddit.com/r/startups solo founder product launched',
    'indie saas profitable bootstrapped tool 2025 2026',
    'built micro saas solo founder making money online tool',
    'launched my app indie hacker bootstrapped profitable',
  ];

  let totalAdded = 0;

  for (const query of queries) {
    try {
      const res = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'X-API-KEY': env.SERPER_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query, num: 8 })
      });

      const data = await res.json();

      for (const result of (data.organic || [])) {
        if (!result.link) continue;

        // Skip Reddit itself — we want the actual product URL, not the Reddit post
        // Skip big VC-backed companies
        const skipDomains = ['reddit.com', 'ycombinator.com', 'techcrunch.com', 'producthunt.com', 'twitter.com', 'x.com', 'linkedin.com', 'medium.com', 'substack.com'];
        const isSkip = skipDomains.some(d => result.link.includes(d));
        if (isSkip) continue;

        // Extract product URLs from snippets/titles
        if (!isActualProduct(result.title || '')) continue;

        let domain;
        try {
          domain = new URL(result.link).hostname.replace('www.', '');
        } catch { continue; }

        // Skip if too generic (news sites, etc.)
        const genericTLDs = ['medium.com', 'dev.to', 'hashnode.dev', 'wordpress.com', 'blogspot.com'];
        if (genericTLDs.some(d => domain.includes(d))) continue;

        const productName = domain.split('.')[0];
        const productNameClean = productName.charAt(0).toUpperCase() + productName.slice(1);

        // Avoid duplicates
        const existing = await env.DB.prepare('SELECT id FROM products WHERE url = ? OR name = ?')
          .bind(result.link, productNameClean).first();
        if (existing) continue;

        try {
          const logoUrl = await scrapeLogoFromUrl(result.link);

          const aiRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'llama-3.3-70b-versatile',
              messages: [{
                role: 'user',
                content: `Indie SaaS product: ${productNameClean} at ${result.link}. Context: ${result.snippet || ''}. Generate JSON only: {"description":"60-80 word description of what this indie tool does, who the target user is, and what problem it solves. Be specific.","pricing":"realistic estimate: Free, Freemium, $5-$29/mo, $49-$99/mo, or One-time","category":"Productivity, Marketing, Development, Design, AI, Analytics, Finance, or Other","is_indie":true}`
              }],
              temperature: 0.3
            })
          });

          const aiData = await aiRes.json();
          let details;
          try { details = JSON.parse(aiData.choices[0].message.content); }
          catch { continue; }

          const slug = productNameClean.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60) + '-' + Date.now();

          await env.DB.prepare(
            'INSERT INTO products (name, slug, description, url, pricing, category, logo_url, upvotes) VALUES (?, ?, ?, ?, ?, ?, ?, 0)'
          ).bind(productNameClean, slug, details.description, result.link, details.pricing, details.category, logoUrl).run();

          totalAdded++;

          // Notify Telegram channel (not email!)
          await sendTelegramShock(env, {
            name: productNameClean, slug, url: result.link,
            description: details.description, pricing: details.pricing, category: details.category
          });

          await new Promise(r => setTimeout(r, 1500));
        } catch (e) {
          console.error('Processing error:', e.message);
        }
      }
    } catch (e) {
      console.error('Serper query error:', e.message);
    }
  }

  return totalAdded;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type': 'application/json'
    };

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    // GET products
    if (url.pathname === '/api/products') {
      try {
        const page = parseInt(url.searchParams.get('page') || '1');
        const limit = 50;
        const offset = (page - 1) * limit;
        const { results } = await env.DB.prepare(
          'SELECT * FROM products ORDER BY upvotes DESC, id DESC LIMIT ? OFFSET ?'
        ).bind(limit, offset).all();
        return new Response(JSON.stringify(results || []), { headers: cors });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
      }
    }

    // SEARCH
    if (url.pathname === '/api/search') {
      const q = url.searchParams.get('q') || '';
      try {
        const { results } = await env.DB.prepare(
          'SELECT * FROM products WHERE name LIKE ? OR description LIKE ? OR category LIKE ? ORDER BY upvotes DESC LIMIT 100'
        ).bind(`%${q}%`, `%${q}%`, `%${q}%`).all();
        return new Response(JSON.stringify(results || []), { headers: cors });
      } catch (e) {
        return new Response(JSON.stringify([]), { headers: cors });
      }
    }

    // GET single product
    if (url.pathname.startsWith('/api/product/')) {
      const slug = url.pathname.split('/').pop();
      try {
        const { results } = await env.DB.prepare('SELECT * FROM products WHERE slug = ?').bind(slug).all();
        if (results && results.length > 0) {
          await env.DB.prepare('UPDATE products SET views = views + 1 WHERE slug = ?').bind(slug).run();
          return new Response(JSON.stringify(results[0]), { headers: cors });
        }
        return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: cors });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
      }
    }

    // UPVOTE
    if (url.pathname.startsWith('/api/upvote/')) {
      const slug = url.pathname.split('/').pop();
      try {
        await env.DB.prepare('UPDATE products SET upvotes = upvotes + 1 WHERE slug = ?').bind(slug).run();
        const { results } = await env.DB.prepare('SELECT upvotes FROM products WHERE slug = ?').bind(slug).all();
        return new Response(JSON.stringify({ upvotes: results[0]?.upvotes || 0 }), { headers: cors });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
      }
    }

    // GET SIMILAR
    if (url.pathname === '/api/similar') {
      const category = url.searchParams.get('category') || '';
      try {
        const { results } = await env.DB.prepare(
          'SELECT * FROM products WHERE category = ? ORDER BY upvotes DESC LIMIT 5'
        ).bind(category).all();
        return new Response(JSON.stringify(results || []), { headers: cors });
      } catch (e) {
        return new Response(JSON.stringify([]), { headers: cors });
      }
    }

    // SUBMIT (founder submits their own SaaS)
    if (url.pathname === '/api/submit' && request.method === 'POST') {
      try {
        const body = await request.json();
        if (!body.name || !body.url || !body.description)
          return new Response(JSON.stringify({ error: 'Missing: name, url, description' }), { status: 400, headers: cors });
        if (body.description.length < 50)
          return new Response(JSON.stringify({ error: 'Description must be at least 50 characters' }), { status: 400, headers: cors });
        if (isSpam(body.name + body.description))
          return new Response(JSON.stringify({ error: 'Spam detected' }), { status: 400, headers: cors });

        const existing = await env.DB.prepare('SELECT id FROM products WHERE url = ? OR name = ?').bind(body.url, body.name).first();
        if (existing)
          return new Response(JSON.stringify({ error: 'This SaaS already exists!' }), { status: 400, headers: cors });

        const slug = body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 80) + '-' + Date.now();
        let logoUrl = body.logo_url;
        if (!logoUrl || logoUrl.length > 500000) logoUrl = await scrapeLogoFromUrl(body.url);

        await env.DB.prepare(
          'INSERT INTO products (name, slug, description, url, pricing, category, logo_url, upvotes) VALUES (?, ?, ?, ?, ?, ?, ?, 0)'
        ).bind(body.name, slug, body.description, body.url, body.pricing || 'Free', body.category || 'Other', logoUrl).run();

        await sendTelegramShock(env, { name: body.name, slug, url: body.url, description: body.description, pricing: body.pricing || 'Free', category: body.category || 'Other' });

        return new Response(JSON.stringify({ success: true, slug }), { headers: cors });
      } catch (e) {
        return new Response(JSON.stringify({ error: `Error: ${e.message}` }), { status: 500, headers: cors });
      }
    }

    // MANUAL SCRAPE TRIGGER
    if (url.pathname === '/api/scrape-now' && request.method === 'POST') {
      try {
        const added = await scrapeIndieFounders(env);
        return new Response(JSON.stringify({ success: true, added }), { headers: cors });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
      }
    }

    // STATS
    if (url.pathname === '/api/stats') {
      try {
        const total = await env.DB.prepare('SELECT COUNT(*) as count FROM products').first();
        const cats = await env.DB.prepare('SELECT category, COUNT(*) as count FROM products GROUP BY category ORDER BY count DESC').all();
        return new Response(JSON.stringify({ total: total?.count || 0, categories: cats.results || [] }), { headers: cors });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
      }
    }

    return new Response('NodeMeld API v3 — KRYV Network', { headers: cors });
  },

  async scheduled(event, env, ctx) {
    try { await scrapeIndieFounders(env); }
    catch (e) { console.error('Cron error:', e); }
  }
};
