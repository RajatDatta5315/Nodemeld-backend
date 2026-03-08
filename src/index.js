const SPAM_KEYWORDS = ['viagra', 'casino', 'porn', 'xxx', 'gambling'];

function isSpam(text) {
  return SPAM_KEYWORDS.some(k => text.toLowerCase().includes(k));
}

function isActualProduct(title) {
  const junkWords = ['best', 'top', 'tried', 'tested', 'guide', 'list', 'review', 'comparison', 'vs'];
  return !junkWords.some(word => title.toLowerCase().includes(word));
}

async function scrapeLogoFromUrl(url) {
  try {
    const domain = new URL(url).hostname;
    return `https://logo.clearbit.com/${domain}`;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────
// SHOCK EMAIL — Send founder notification via Resend
// ─────────────────────────────────────────────
async function sendShockEmail(env, product) {
  if (!env.RESEND_API_KEY) return;

  const domain = new URL(product.url).hostname;
  const founderEmail = `hello@${domain}`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { background: #0a0a0f; color: #e0e0e0; font-family: 'Courier New', monospace; margin: 0; padding: 40px 20px; }
    .container { max-width: 600px; margin: 0 auto; }
    .badge { background: linear-gradient(135deg, #667eea, #764ba2); padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: 700; display: inline-block; color: white; margin-bottom: 24px; }
    h1 { font-size: 28px; font-weight: 900; color: #fff; margin: 0 0 8px 0; }
    .domain { font-size: 14px; color: #667eea; margin-bottom: 32px; }
    .card { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; padding: 24px; margin-bottom: 20px; }
    .label { font-size: 10px; color: #666; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 8px; }
    .value { font-size: 14px; color: #e0e0e0; line-height: 1.6; }
    .cta { display: block; background: linear-gradient(135deg, #667eea, #764ba2); color: white; text-decoration: none; padding: 16px 32px; border-radius: 12px; font-weight: 800; font-size: 14px; text-align: center; margin: 32px 0; letter-spacing: 2px; text-transform: uppercase; }
    .footer { font-size: 10px; color: #333; text-align: center; margin-top: 40px; }
    .highlight { color: #667eea; font-weight: 700; }
  </style>
</head>
<body>
  <div class="container">
    <div class="badge">⚡ NodeMeld Discovery Alert</div>
    <h1>We Found <span class="highlight">${product.name}</span></h1>
    <div class="domain">${domain}</div>

    <div class="card">
      <div class="label">Our scouts discovered your product</div>
      <div class="value">
        <strong>${product.name}</strong> has been automatically indexed on <strong>NodeMeld</strong> — 
        the AI-curated SaaS discovery platform built for founders.
        <br><br>
        Your product is now visible to thousands of indie hackers, developers, and decision-makers 
        who discover tools exactly like yours every day.
      </div>
    </div>

    <div class="card">
      <div class="label">Your listing snapshot</div>
      <div class="value">
        📦 <strong>Category:</strong> ${product.category}<br>
        💰 <strong>Pricing:</strong> ${product.pricing}<br>
        📝 <strong>Description:</strong> ${product.description.substring(0, 120)}...
      </div>
    </div>

    <a href="https://nodemeld.kryv.network/product/${product.slug}" class="cta">
      🔥 View Your Listing on NodeMeld
    </a>

    <div class="card">
      <div class="label">Want to boost your listing?</div>
      <div class="value">
        Submit your official description, logo, and details to get a verified badge. 
        Verified listings get 5x more clicks from our community.
      </div>
    </div>

    <div class="footer">
      NodeMeld by KRYV Network · nodemeld.kryv.network<br>
      You received this because we discovered ${domain} on the web.<br>
      <a href="https://nodemeld.kryv.network/unsubscribe" style="color: #333;">Unsubscribe</a>
    </div>
  </div>
</body>
</html>`;

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'NodeMeld Discovery <discover@nodemeld.kryv.network>',
        to: [founderEmail],
        subject: `⚡ ${product.name} was just discovered on NodeMeld`,
        html
      })
    });
    console.log(`Shock email sent to ${founderEmail}`);
  } catch (e) {
    console.error('Email send failed:', e);
  }
}

async function scrapeRealSaaS(env) {
  const queries = [
    'notion productivity tool site:notion.so',
    'linear issue tracker site:linear.app',
    'figma design tool site:figma.com',
    'vercel deployment site:vercel.com',
    'stripe payments site:stripe.com'
  ];
  
  let totalAdded = 0;
  
  for (const query of queries) {
    try {
      const res = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: {
          'X-API-KEY': env.SERPER_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ q: query, num: 5 })
      });
      
      const data = await res.json();
      
      for (const result of (data.organic || [])) {
        if (!result.link || !isActualProduct(result.title)) continue;
        
        const domain = new URL(result.link).hostname.replace('www.', '');
        const productName = domain.split('.')[0];
        const productNameClean = productName.charAt(0).toUpperCase() + productName.slice(1);
        
        const existing = await env.DB.prepare('SELECT id FROM products WHERE url = ? OR name = ?').bind(result.link, productNameClean).first();
        if (existing) continue;
        
        try {
          const logoUrl = await scrapeLogoFromUrl(result.link);
          
          const aiRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${env.GROQ_API_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              model: 'llama-3.3-70b-versatile',
              messages: [{
                role: 'user',
                content: `Product: ${productNameClean} at ${result.link}. Generate JSON: {"description":"50-80 word description of what this tool does and who uses it","pricing":"estimate like Free, $9/mo, $99/year","category":"Productivity, Marketing, Development, Design, AI, or Analytics"}`
              }],
              temperature: 0.7
            })
          });
          
          const aiData = await aiRes.json();
          const details = JSON.parse(aiData.choices[0].message.content);
          
          const slug = productNameClean.toLowerCase() + '-' + Date.now();
          
          await env.DB.prepare(
            'INSERT INTO products (name, slug, description, url, pricing, category, logo_url) VALUES (?, ?, ?, ?, ?, ?, ?)'
          ).bind(productNameClean, slug, details.description, result.link, details.pricing, details.category, logoUrl).run();
          
          totalAdded++;

          // 🔔 SHOCK EMAIL — notify the founder
          await sendShockEmail(env, {
            name: productNameClean,
            slug,
            url: result.link,
            description: details.description,
            pricing: details.pricing,
            category: details.category
          });

          await new Promise(r => setTimeout(r, 2000));
        } catch (e) {
          console.error('AI error:', e);
        }
      }
    } catch (e) {
      console.error('Serper error:', e);
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
          'SELECT * FROM products ORDER BY upvotes DESC, RANDOM() LIMIT ? OFFSET ?'
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
          'SELECT * FROM products WHERE name LIKE ? OR description LIKE ? OR category LIKE ? ORDER BY upvotes DESC, views DESC LIMIT 100'
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

    // SUBMIT
    if (url.pathname === '/api/submit' && request.method === 'POST') {
      try {
        const body = await request.json();
        if (!body.name || !body.url || !body.description) {
          return new Response(JSON.stringify({ error: 'Missing: name, url, description' }), { status: 400, headers: cors });
        }
        if (body.description.length < 50) {
          return new Response(JSON.stringify({ error: 'Description must be MINIMUM 50 characters (you have ' + body.description.length + ')' }), { status: 400, headers: cors });
        }
        if (isSpam(body.name + body.description)) {
          return new Response(JSON.stringify({ error: 'Spam detected' }), { status: 400, headers: cors });
        }
        const existing = await env.DB.prepare('SELECT id FROM products WHERE url = ? OR name = ?').bind(body.url, body.name).first();
        if (existing) {
          return new Response(JSON.stringify({ error: 'This SaaS already exists in our database!' }), { status: 400, headers: cors });
        }
        const slug = body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 100) + '-' + Date.now();
        let logoUrl = body.logo_url;
        if (!logoUrl || !logoUrl.startsWith('data:image')) {
          logoUrl = await scrapeLogoFromUrl(body.url);
        } else if (logoUrl.length > 500000) {
          logoUrl = await scrapeLogoFromUrl(body.url);
        }
        await env.DB.prepare(
          'INSERT INTO products (name, slug, description, url, pricing, category, logo_url, upvotes) VALUES (?, ?, ?, ?, ?, ?, ?, 0)'
        ).bind(body.name, slug, body.description, body.url, body.pricing || 'Free', body.category || 'Other', logoUrl).run();

        // Send shock email to the founder who submitted
        await sendShockEmail(env, { name: body.name, slug, url: body.url, description: body.description, pricing: body.pricing || 'Free', category: body.category || 'Other' });

        return new Response(JSON.stringify({ success: true, slug }), { headers: cors });
      } catch (e) {
        return new Response(JSON.stringify({ error: `Error: ${e.message}` }), { status: 500, headers: cors });
      }
    }

    // MANUAL SCRAPE
    if (url.pathname === '/api/scrape-now' && request.method === 'POST') {
      try {
        const added = await scrapeRealSaaS(env);
        return new Response(JSON.stringify({ success: true, added }), { headers: cors });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
      }
    }

    // STATS
    if (url.pathname === '/api/stats') {
      try {
        const total = await env.DB.prepare('SELECT COUNT(*) as count FROM products').first();
        const categories = await env.DB.prepare('SELECT category, COUNT(*) as count FROM products GROUP BY category ORDER BY count DESC').all();
        return new Response(JSON.stringify({ total: total?.count || 0, categories: categories.results || [] }), { headers: cors });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
      }
    }

    return new Response('NodeMeld API v2 — KRYV Network', { headers: cors });
  },

  async scheduled(event, env, ctx) {
    try {
      await scrapeRealSaaS(env);
    } catch (e) {
      console.error('Scheduled scrape error:', e);
    }
  }
};
