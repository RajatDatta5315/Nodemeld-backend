const SPAM_KEYWORDS = ['viagra', 'casino', 'porn', 'xxx', 'gambling'];
const MIN_DESC_LEN = 50;

function isSpam(text) {
  return SPAM_KEYWORDS.some(k => text.toLowerCase().includes(k));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type': 'application/json'
    };

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    // GET products
    if (url.pathname === '/api/products') {
      const { results } = await env.DB.prepare('SELECT * FROM products ORDER BY created_at DESC LIMIT 200').all();
      return new Response(JSON.stringify(results || []), { headers: cors });
    }

    // GET single
    if (url.pathname.startsWith('/api/product/')) {
      const slug = url.pathname.split('/').pop();
      const { results } = await env.DB.prepare('SELECT * FROM products WHERE slug = ?').bind(slug).all();
      if (results.length > 0) {
        await env.DB.prepare('UPDATE products SET views = views + 1 WHERE slug = ?').bind(slug).run();
        return new Response(JSON.stringify(results[0]), { headers: cors });
      }
      return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: cors });
    }

    // SUBMIT
    if (url.pathname === '/api/submit' && request.method === 'POST') {
      const body = await request.json();
      
      if (!body.name || !body.url || !body.description) {
        return new Response(JSON.stringify({ error: 'Missing fields' }), { status: 400, headers: cors });
      }
      if (body.description.length < MIN_DESC_LEN) {
        return new Response(JSON.stringify({ error: 'Description too short' }), { status: 400, headers: cors });
      }
      if (isSpam(body.name + body.description)) {
        return new Response(JSON.stringify({ error: 'Spam detected' }), { status: 400, headers: cors });
      }
      
      const slug = body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 100);
      
      try {
        await env.DB.prepare(
          'INSERT INTO products (name, slug, description, url, pricing, category) VALUES (?, ?, ?, ?, ?, ?)'
        ).bind(body.name, slug, body.description, body.url, body.pricing || 'Free', body.category || 'Other').run();
        
        return new Response(JSON.stringify({ success: true, slug }), { headers: cors });
      } catch (e) {
        return new Response(JSON.stringify({ error: 'DB error' }), { status: 500, headers: cors });
      }
    }

    return new Response('NodeMeld API', { headers: cors });
  },

  // Auto-scrape every 6 hours
  async scheduled(event, env, ctx) {
    const GROQ_KEY = 'gsk_YOUR_KEY_HERE'; // Replace with your Groq key
    
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GROQ_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [{
            role: 'user',
            content: 'Generate 3 real micro-SaaS products. For each provide: name, url (real website), description (60 words), pricing, category. Output as JSON array only, no markdown.'
          }],
          temperature: 0.9
        })
      });
      
      const data = await res.json();
      const products = JSON.parse(data.choices[0].message.content);
      
      for (const p of products) {
        const slug = p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        try {
          await env.DB.prepare(
            'INSERT OR IGNORE INTO products (name, slug, description, url, pricing, category) VALUES (?, ?, ?, ?, ?, ?)'
          ).bind(p.name, slug, p.description, p.url, p.pricing, p.category).run();
        } catch (e) {}
      }
    } catch (e) {
      // Fallback: add manual products
      const fallback = [
        { name: 'Notion', url: 'https://notion.so', desc: 'All-in-one workspace', cat: 'Productivity', price: 'Free' },
        { name: 'Linear', url: 'https://linear.app', desc: 'Issue tracking', cat: 'Development', price: '$8/mo' }
      ];
      
      for (const f of fallback) {
        const slug = f.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        try {
          await env.DB.prepare(
            'INSERT OR IGNORE INTO products (name, slug, description, url, pricing, category) VALUES (?, ?, ?, ?, ?, ?)'
          ).bind(f.name, slug, f.desc, f.url, f.price, f.cat).run();
        } catch (e) {}
      }
    }
  }
};
