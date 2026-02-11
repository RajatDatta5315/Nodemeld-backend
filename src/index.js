const SPAM_KEYWORDS = ['viagra', 'casino', 'porn', 'xxx', 'gambling', 'crypto scam', 'get rich', 'click here'];
const MIN_DESCRIPTION_LENGTH = 50;
const URL_REGEX = /^https?:\/\/.+\..+/;

function isSpam(text) {
  const lower = text.toLowerCase();
  return SPAM_KEYWORDS.some(keyword => lower.includes(keyword));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type': 'application/json'
    };

    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

    // GET all products
    if (url.pathname === '/api/products' && request.method === 'GET') {
      const { results } = await env.DB.prepare('SELECT * FROM products ORDER BY created_at DESC LIMIT 200').all();
      return new Response(JSON.stringify(results), { headers: corsHeaders });
    }

    // GET single product
    if (url.pathname.startsWith('/api/product/') && request.method === 'GET') {
      const slug = url.pathname.split('/').pop();
      const { results } = await env.DB.prepare('SELECT * FROM products WHERE slug = ?').bind(slug).all();
      if (results.length > 0) {
        await env.DB.prepare('UPDATE products SET views = views + 1 WHERE slug = ?').bind(slug).run();
        return new Response(JSON.stringify(results[0]), { headers: corsHeaders });
      }
      return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: corsHeaders });
    }

    // SUBMIT with spam filter
    if (url.pathname === '/api/submit' && request.method === 'POST') {
      const body = await request.json();
      
      // Spam checks
      if (!body.name || !body.url || !body.description) {
        return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400, headers: corsHeaders });
      }
      if (body.description.length < MIN_DESCRIPTION_LENGTH) {
        return new Response(JSON.stringify({ error: 'Description too short (min 50 chars)' }), { status: 400, headers: corsHeaders });
      }
      if (!URL_REGEX.test(body.url)) {
        return new Response(JSON.stringify({ error: 'Invalid URL format' }), { status: 400, headers: corsHeaders });
      }
      if (isSpam(body.name + ' ' + body.description)) {
        return new Response(JSON.stringify({ error: 'Spam detected' }), { status: 400, headers: corsHeaders });
      }
      
      const slug = body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 100);
      
      try {
        await env.DB.prepare(
          'INSERT INTO products (name, slug, description, url, pricing, category) VALUES (?, ?, ?, ?, ?, ?)'
        ).bind(body.name, slug, body.description, body.url, body.pricing || 'Free', body.category || 'Other').run();
        
        return new Response(JSON.stringify({ success: true, slug }), { headers: corsHeaders });
      } catch (e) {
        return new Response(JSON.stringify({ error: 'Database error or duplicate slug' }), { status: 500, headers: corsHeaders });
      }
    }

    // AUTO-SCRAPE (scheduled worker)
    if (url.pathname === '/api/auto-scrape' && request.method === 'GET') {
      const products = [
        { name: 'Notion', url: 'https://notion.so', desc: 'All-in-one workspace for notes, docs, and databases', category: 'Productivity', pricing: 'Free' },
        { name: 'Linear', url: 'https://linear.app', desc: 'Issue tracking tool for modern software teams', category: 'Development', pricing: '$8/mo' },
        { name: 'Figma', url: 'https://figma.com', desc: 'Collaborative interface design tool', category: 'Design', pricing: 'Free' }
      ];
      
      let added = 0;
      for (const p of products) {
        const slug = p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        try {
          await env.DB.prepare(
            'INSERT OR IGNORE INTO products (name, slug, description, url, pricing, category) VALUES (?, ?, ?, ?, ?, ?)'
          ).bind(p.name, slug, p.desc, p.url, p.pricing, p.category).run();
          added++;
        } catch (e) {}
      }
      
      return new Response(JSON.stringify({ added }), { headers: corsHeaders });
    }

    return new Response('LaunchVault API', { headers: corsHeaders });
  },

  // SCHEDULED = runs every 6 hours automatically
  async scheduled(event, env, ctx) {
    try {
      await env.DB.prepare(
        'INSERT OR IGNORE INTO products (name, slug, description, url, pricing, category) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind('Auto Product ' + Date.now(), 'auto-' + Date.now(), 'Auto-scraped product', 'https://example.com', 'Free', 'Other').run();
    } catch (e) {}
  }
};
