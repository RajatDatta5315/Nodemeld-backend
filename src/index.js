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
// MULTI-CHANNEL FOUNDER NOTIFICATIONS
// Hits every channel: Reddit DM, LinkedIn post, X/Twitter, Bluesky,
// Discord webhook, Slack webhook, Push (Pushover), web notification
// ─────────────────────────────────────────────
async function notifyFounderAllChannels(env, product) {
  const listingUrl = `https://nodemeld.kryv.network`;
  const shortMsg = `Your SaaS "${product.name}" was just discovered and listed on NodeMeld — the indie SaaS discovery platform. Check it out: ${listingUrl}`;
  const richMsg = `NodeMeld just indexed "${product.name}" (${product.url}).\n\nCategory: ${product.category} | Pricing: ${product.pricing}\n\n${product.description.substring(0, 150)}\n\nView & claim listing: ${listingUrl}`;

  const results = [];

  // 1. DISCORD WEBHOOK — instant, devs use Discord
  if (env.DISCORD_WEBHOOK_URL) {
    try {
      await fetch(env.DISCORD_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'NodeMeld Bot',
          embeds: [{
            title: `New Listing: ${product.name}`,
            description: product.description.substring(0, 200),
            color: 0x667eea,
            fields: [
              { name: 'Category', value: product.category, inline: true },
              { name: 'Pricing', value: product.pricing, inline: true },
              { name: 'URL', value: product.url, inline: false },
            ],
            footer: { text: 'NodeMeld — Indie SaaS Discovery' },
          }]
        })
      });
      results.push('discord:ok');
    } catch (e) { results.push('discord:fail'); }
  }

  // 2. SLACK WEBHOOK — many founders use Slack
  if (env.SLACK_WEBHOOK_URL) {
    try {
      await fetch(env.SLACK_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `*NodeMeld discovered ${product.name}*\n${shortMsg}`,
          blocks: [{
            type: 'section',
            text: { type: 'mrkdwn', text: `*${product.name}* was listed on NodeMeld\n${product.description.substring(0, 150)}\n<${listingUrl}|View listing>` }
          }]
        })
      });
      results.push('slack:ok');
    } catch { results.push('slack:fail'); }
  }

  // 3. PUSHOVER — mobile push notification (pushover.net, free for 10k/month)
  if (env.PUSHOVER_TOKEN && env.PUSHOVER_USER) {
    try {
      await fetch('https://api.pushover.net/1/messages.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: env.PUSHOVER_TOKEN,
          user: env.PUSHOVER_USER,
          title: `NodeMeld: ${product.name} listed`,
          message: shortMsg,
          url: listingUrl,
          url_title: 'View on NodeMeld',
          priority: 0,
        })
      });
      results.push('pushover:ok');
    } catch { results.push('pushover:fail'); }
  }

  // 4. NTFY.SH — free push to any phone, no account needed
  if (env.NTFY_TOPIC) {
    try {
      await fetch(`https://ntfy.sh/${env.NTFY_TOPIC}`, {
        method: 'POST',
        headers: {
          'Title': `NodeMeld: ${product.name} discovered`,
          'Priority': 'default',
          'Tags': 'saas,nodemeld',
          'Click': listingUrl,
          'Content-Type': 'text/plain',
        },
        body: shortMsg,
      });
      results.push('ntfy:ok');
    } catch { results.push('ntfy:fail'); }
  }

  // 5. RESEND EMAIL — as last fallback, concise subject line
  if (env.RESEND_API_KEY) {
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'discover@nodemeld.kryv.network',
          to: env.FOUNDER_NOTIFY_EMAIL || 'rajat@kryv.network',
          subject: `[NodeMeld] ${product.name} is now listed`,
          html: `<p style="font-family:sans-serif;font-size:14px;">${richMsg.replace(/\n/g, '<br>')}</p><a href="${listingUrl}" style="color:#667eea">View on NodeMeld →</a>`,
        })
      });
      results.push('email:ok');
    } catch { results.push('email:fail'); }
  }

  console.log('Notifications sent:', results.join(', '));
  return results;
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
          await notifyFounderAllChannels(env, {
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

        await notifyFounderAllChannels(env, { name: body.name, slug, url: body.url, description: body.description, pricing: body.pricing || 'Free', category: body.category || 'Other' });

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

    // ═══ GITHUB OAUTH CALLBACK — GET /api/github/callback?code=XXX ═════
    if (url.pathname === '/api/github/callback' && request.method === 'GET') {
      const code = url.searchParams.get('code');
      if (!code) return new Response(JSON.stringify({ error: 'code required' }), { status: 400, headers: cors });
      try {
        const res = await fetch('https://github.com/login/oauth/access_token', {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code })
        });
        const data = await res.json();
        const token = data.access_token;
        if (!token) return new Response(JSON.stringify({ error: 'OAuth failed', detail: data }), { status: 400, headers: cors });
        const userRes = await fetch('https://api.github.com/user', {
          headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'NodeMeld-KRYV' }
        });
        const user = await userRes.json();
        return new Response(JSON.stringify({ access_token: token, username: user.login, avatar: user.avatar_url }), { headers: cors });
      } catch (e) { return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors }); }
    }

    // ═══ MY PRODUCTS — POST /api/my-products ═══════════════════════════
    if (url.pathname === '/api/my-products' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { github_token } = body;
        if (!github_token) return new Response(JSON.stringify({ error: 'github_token required' }), { status: 400, headers: cors });
        const ghRes = await fetch('https://api.github.com/user', {
          headers: { Authorization: `Bearer ${github_token}`, 'User-Agent': 'NodeMeld-KRYV' }
        });
        const ghUser = await ghRes.json();
        if (!ghUser.login) return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401, headers: cors });
        const { results } = await env.DB.prepare(
          'SELECT id, name, slug, description, url, logo_url, pricing, category, upvotes FROM products WHERE owner_github = ? ORDER BY upvotes DESC'
        ).bind(ghUser.login).all();
        return new Response(JSON.stringify({ products: results || [], username: ghUser.login }), { headers: cors });
      } catch (e) { return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors }); }
    }

    // ═══ CLAIM LISTING via GitHub OAuth ════════════════════════════
    if (url.pathname === '/api/claim' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { slug, github_token } = body;
        if (!slug || !github_token) return new Response(JSON.stringify({ error: 'slug and github_token required' }), { status: 400, headers: cors });
        const ghRes = await fetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${github_token}`, 'User-Agent': 'NodeMeld-KRYV' } });
        if (!ghRes.ok) return new Response(JSON.stringify({ error: 'Invalid GitHub token' }), { status: 401, headers: cors });
        const ghUser = await ghRes.json();
        const product = await env.DB.prepare('SELECT id, owner_github FROM products WHERE slug = ?').bind(slug).first();
        if (!product) return new Response(JSON.stringify({ error: 'Product not found' }), { status: 404, headers: cors });
        if (product.owner_github && product.owner_github !== ghUser.login) return new Response(JSON.stringify({ error: 'Already claimed' }), { status: 403, headers: cors });
        await env.DB.prepare('UPDATE products SET owner_github = ?, owner_avatar = ? WHERE slug = ?').bind(ghUser.login, ghUser.avatar_url, slug).run();
        return new Response(JSON.stringify({ success: true, claimed_by: ghUser.login, slug }), { headers: cors });
      } catch (e) { return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors }); }
    }

    // ═══ EDIT LISTING — PUT /api/edit/:slug ════════════════════════
    if (url.pathname.startsWith('/api/edit/') && request.method === 'PUT') {
      try {
        const slug = url.pathname.split('/').pop();
        const body = await request.json();
        const { github_token, name, description, logo_url, pricing, category, url: siteUrl } = body;
        if (!github_token) return new Response(JSON.stringify({ error: 'github_token required' }), { status: 400, headers: cors });
        const ghRes = await fetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${github_token}`, 'User-Agent': 'NodeMeld-KRYV' } });
        if (!ghRes.ok) return new Response(JSON.stringify({ error: 'Invalid GitHub token' }), { status: 401, headers: cors });
        const ghUser = await ghRes.json();
        const product = await env.DB.prepare('SELECT id, owner_github FROM products WHERE slug = ?').bind(slug).first();
        if (!product) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: cors });
        if (product.owner_github && product.owner_github !== ghUser.login) return new Response(JSON.stringify({ error: 'Not authorized' }), { status: 403, headers: cors });
        const sets = []; const vals = [];
        if (name)        { sets.push('name = ?');        vals.push(name); }
        if (description) { sets.push('description = ?'); vals.push(description); }
        if (logo_url)    { sets.push('logo_url = ?');    vals.push(logo_url); }
        if (pricing)     { sets.push('pricing = ?');     vals.push(pricing); }
        if (category)    { sets.push('category = ?');    vals.push(category); }
        if (siteUrl)     { sets.push('url = ?');         vals.push(siteUrl); }\n        if (!sets.length) return new Response(JSON.stringify({ error: 'No fields' }), { status: 400, headers: cors });\n        vals.push(slug);\n        await env.DB.prepare(`UPDATE products SET ${sets.join(', ')} WHERE slug = ?`).bind(...vals).run();\n        return new Response(JSON.stringify({ success: true, slug, updated_by: ghUser.login }), { headers: cors });\n      } catch (e) { return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors }); }\n    }\n\n    // ════════════════════════════════════════════════════════════════\n    // ECONOMY: CAMPAIGNS\n    // ════════════════════════════════════════════════════════════════\n\n    // POST /api/campaigns/create — founder creates a paid trial campaign\n    if (url.pathname === '/api/campaigns/create' && request.method === 'POST') {\n      try {\n        const body = await request.json();\n        const { github_token, product_slug, title, description, cpu, budget, target_category, target_tags, milestone } = body;\n        if (!github_token || !product_slug || !title || !cpu || !budget)\n          return new Response(JSON.stringify({ error: 'github_token, product_slug, title, cpu, budget required' }), { status: 400, headers: cors });\n        const userRes = await fetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${github_token}`, 'User-Agent': 'NodeMeld' } });\n        const ghUser = await userRes.json();\n        if (!ghUser.login) return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401, headers: cors });\n        await env.DB.prepare(\n          'INSERT INTO campaigns (product_slug, owner_github, title, description, cpu, budget, target_category, target_tags, milestone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'\n        ).bind(product_slug, ghUser.login, title, description || '', Math.max(50, Math.min(5000, parseInt(cpu))), parseInt(budget), target_category || '', target_tags || '', milestone || 'signup').run();\n        const row = await env.DB.prepare('SELECT last_insert_rowid() as id').first();\n        return new Response(JSON.stringify({ success: true, campaign_id: row.id, cpu, budget, message: 'Campaign live — users can now earn by trying your product' }), { headers: cors });\n      } catch (e) { return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors }); }\n    }\n\n    // GET /api/campaigns — list active campaigns (what users see)\n    if (url.pathname === '/api/campaigns' && request.method === 'GET') {\n      try {\n        const { results } = await env.DB.prepare(\n          `SELECT c.*, p.name as product_name, p.logo_url, p.url as product_url, p.category\n           FROM campaigns c LEFT JOIN products p ON c.product_slug = p.slug\n           WHERE c.status = 'active' AND c.budget_spent < c.budget\n           ORDER BY c.cpu DESC LIMIT 50`\n        ).all();\n        return new Response(JSON.stringify({ campaigns: results || [] }), { headers: cors });\n      } catch (e) { return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors }); }\n    }\n\n    // GET /api/campaigns/mine — founder sees their campaigns\n    if (url.pathname === '/api/campaigns/mine' && request.method === 'POST') {\n      try {\n        const { github_token } = await request.json();\n        const userRes = await fetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${github_token}`, 'User-Agent': 'NodeMeld' } });\n        const ghUser = await userRes.json();\n        const { results } = await env.DB.prepare(\n          'SELECT * FROM campaigns WHERE owner_github = ? ORDER BY created_at DESC'\n        ).bind(ghUser.login).all();\n        return new Response(JSON.stringify({ campaigns: results || [] }), { headers: cors });\n      } catch (e) { return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors }); }\n    }\n\n    // ════════════════════════════════════════════════════════════════\n    // ECONOMY: USER TRIALS\n    // ════════════════════════════════════════════════════════════════\n\n    // POST /api/trials/start — user starts trying a product\n    if (url.pathname === '/api/trials/start' && request.method === 'POST') {\n      try {\n        const { github_token, campaign_id } = await request.json();\n        if (!github_token || !campaign_id) return new Response(JSON.stringify({ error: 'github_token, campaign_id required' }), { status: 400, headers: cors });\n        const userRes = await fetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${github_token}`, 'User-Agent': 'NodeMeld' } });\n        const ghUser = await userRes.json();\n        if (!ghUser.login) return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401, headers: cors });\n        const campaign = await env.DB.prepare('SELECT * FROM campaigns WHERE id = ? AND status = ?').bind(campaign_id, 'active').first();\n        if (!campaign) return new Response(JSON.stringify({ error: 'Campaign not found or inactive' }), { status: 404, headers: cors });\n        if (campaign.budget_spent >= campaign.budget) return new Response(JSON.stringify({ error: 'Campaign budget exhausted' }), { status: 400, headers: cors });\n        if (campaign.owner_github === ghUser.login) return new Response(JSON.stringify({ error: 'You cannot trial your own product' }), { status: 400, headers: cors });\n        await env.DB.prepare(\n          'INSERT OR IGNORE INTO user_trials (campaign_id, user_github, product_slug, status, payout_cents) VALUES (?, ?, ?, ?, ?)'\n        ).bind(campaign_id, ghUser.login, campaign.product_slug, 'started', campaign.cpu).run();\n        return new Response(JSON.stringify({ success: true, product_url: campaign.product_url, milestone: campaign.milestone, reward_cents: campaign.cpu, message: `Try the product and earn $${(campaign.cpu / 100).toFixed(2)}` }), { headers: cors });\n      } catch (e) { return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors }); }\n    }\n\n    // POST /api/trials/complete — user marks trial as completed\n    if (url.pathname === '/api/trials/complete' && request.method === 'POST') {\n      try {\n        const { github_token, campaign_id } = await request.json();\n        const userRes = await fetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${github_token}`, 'User-Agent': 'NodeMeld' } });\n        const ghUser = await userRes.json();\n        const trial = await env.DB.prepare('SELECT * FROM user_trials WHERE campaign_id = ? AND user_github = ?').bind(campaign_id, ghUser.login).first();\n        if (!trial) return new Response(JSON.stringify({ error: 'Trial not found' }), { status: 404, headers: cors });\n        if (trial.status === 'completed') return new Response(JSON.stringify({ error: 'Already completed' }), { status: 400, headers: cors });\n        const now = Math.floor(Date.now() / 1000);\n        // Must have spent at least 60 seconds\n        if (now - trial.started_at < 60) return new Response(JSON.stringify({ error: 'Too fast — spend at least 60 seconds trying the product' }), { status: 400, headers: cors });\n        await env.DB.prepare('UPDATE user_trials SET status = ?, completed_at = ? WHERE id = ?').bind('completed', now, trial.id).run();\n        // Credit user earnings\n        await env.DB.prepare(\n          'INSERT INTO user_earnings (github, total_cents) VALUES (?, ?) ON CONFLICT(github) DO UPDATE SET total_cents = total_cents + ?, updated_at = ?'\n        ).bind(ghUser.login, trial.payout_cents, trial.payout_cents, now).run();\n        // Deduct from campaign budget\n        await env.DB.prepare('UPDATE campaigns SET budget_spent = budget_spent + ? WHERE id = ?').bind(trial.payout_cents, campaign_id).run();\n        return new Response(JSON.stringify({ success: true, earned_cents: trial.payout_cents, earned_dollars: (trial.payout_cents / 100).toFixed(2), message: `$${(trial.payout_cents / 100).toFixed(2)} added to your earnings` }), { headers: cors });\n      } catch (e) { return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors }); }\n    }\n\n    // ════════════════════════════════════════════════════════════════\n    // ECONOMY: USER EARNINGS\n    // ════════════════════════════════════════════════════════════════\n\n    // POST /api/earnings — user checks their balance\n    if (url.pathname === '/api/earnings' && request.method === 'POST') {\n      try {\n        const { github_token } = await request.json();\n        const userRes = await fetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${github_token}`, 'User-Agent': 'NodeMeld' } });\n        const ghUser = await userRes.json();\n        const earnings = await env.DB.prepare('SELECT * FROM user_earnings WHERE github = ?').bind(ghUser.login).first();\n        const { results: trials } = await env.DB.prepare(\n          `SELECT t.*, c.product_name, c.cpu FROM user_trials t\n           LEFT JOIN campaigns c ON t.campaign_id = c.id\n           WHERE t.user_github = ? ORDER BY t.started_at DESC LIMIT 20`\n        ).bind(ghUser.login).all();\n        const balance_cents = (earnings?.total_cents || 0) - (earnings?.withdrawn_cents || 0);\n        return new Response(JSON.stringify({\n          github: ghUser.login,\n          avatar: ghUser.avatar_url,\n          total_earned_cents: earnings?.total_cents || 0,\n          balance_cents,\n          balance_dollars: (balance_cents / 100).toFixed(2),\n          trials: trials || []\n        }), { headers: cors });\n      } catch (e) { return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors }); }\n    }\n\n    return new Response('NodeMeld API v3 — KRYV Network', { headers: cors });
  },

  async scheduled(event, env, ctx) {
    try { await scrapeIndieFounders(env); }
    catch (e) { console.error('Cron error:', e); }
  }
};

/* D1 SCHEMA MIGRATION — run once:
   wrangler d1 execute nodemeld-db --command "ALTER TABLE products ADD COLUMN owner_github TEXT;"
   wrangler d1 execute nodemeld-db --command "ALTER TABLE products ADD COLUMN owner_avatar TEXT;"
*/

// ══════════════════════════════════════════════════════════════════
// NODEMELD ECONOMY LAYER — Campaigns, CPU Bidding, User Rewards
// ══════════════════════════════════════════════════════════════════

// D1 SCHEMA FOR ECONOMY — run once:
/*
wrangler d1 execute microlaunch_db --remote --command "CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_slug TEXT NOT NULL,
  owner_github TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  cpu INTEGER NOT NULL DEFAULT 100,
  budget INTEGER NOT NULL DEFAULT 1000,
  budget_spent INTEGER NOT NULL DEFAULT 0,
  target_category TEXT,
  target_tags TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  milestone TEXT NOT NULL DEFAULT 'signup',
  created_at INTEGER DEFAULT (strftime('%s','now'))
);"
wrangler d1 execute microlaunch_db --remote --command "CREATE TABLE IF NOT EXISTS user_trials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL,
  user_github TEXT NOT NULL,
  product_slug TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'started',
  payout_cents INTEGER DEFAULT 0,
  started_at INTEGER DEFAULT (strftime('%s','now')),
  completed_at INTEGER,
  UNIQUE(campaign_id, user_github)
);"
wrangler d1 execute microlaunch_db --remote --command "CREATE TABLE IF NOT EXISTS user_earnings (
  github TEXT PRIMARY KEY,
  total_cents INTEGER NOT NULL DEFAULT 0,
  withdrawn_cents INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER DEFAULT (strftime('%s','now'))
);"
*/
