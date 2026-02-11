export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type': 'application/json'
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // GET all products
    if (url.pathname === '/api/products' && request.method === 'GET') {
      const { results } = await env.DB.prepare('SELECT * FROM products ORDER BY created_at DESC LIMIT 100').all();
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

    // SUBMIT product (auto-approve)
    if (url.pathname === '/api/submit' && request.method === 'POST') {
      const body = await request.json();
      const slug = body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      
      await env.DB.prepare(
        'INSERT INTO products (name, slug, description, url, pricing, category, logo_url) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(body.name, slug, body.description, body.url, body.pricing || 'Free', body.category || 'Other', body.logo_url || '').run();
      
      return new Response(JSON.stringify({ success: true, slug }), { headers: corsHeaders });
    }

    // SCRAPE and auto-add (Product Hunt scraper)
    if (url.pathname === '/api/scrape' && request.method === 'POST') {
      try {
        const phRes = await fetch('https://www.producthunt.com/');
        const html = await phRes.text();
        const products = [];
        
        // Simple regex scraping (you can improve this)
        const nameMatches = html.matchAll(/"name":"([^"]+)"/g);
        for (const match of nameMatches) {
          const name = match[1];
          if (name && name.length > 3) {
            const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
            try {
              await env.DB.prepare(
                'INSERT OR IGNORE INTO products (name, slug, description, url, category) VALUES (?, ?, ?, ?, ?)'
              ).bind(name, slug, 'Scraped from Product Hunt', `https://www.producthunt.com/posts/${slug}`, 'SaaS').run();
              products.push(name);
            } catch (e) {}
          }
        }
        
        return new Response(JSON.stringify({ scraped: products.length, products }), { headers: corsHeaders });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
      }
    }

    return new Response('MicroLaunch API', { headers: corsHeaders });
  }
};
