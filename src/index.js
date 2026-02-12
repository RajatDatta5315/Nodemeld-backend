const SPAM_KEYWORDS = ['viagra', 'casino', 'porn', 'xxx', 'gambling', 'drugs'];
const MIN_DESC = 50;

function isSpam(text) {
  return SPAM_KEYWORDS.some(k => text.toLowerCase().includes(k));
}

async function scrapeRealSaaS(env) {
  const queries = [
    'best micro saas products 2026',
    'new saas tools productivity',
    'ai saas platforms',
    'marketing automation tools',
    'developer tools saas'
  ];
  
  let totalAdded = 0;
  
  for (const query of queries) {
    try {
      // Use Serper to find real SaaS
      const res = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: {
          'X-API-KEY': env.SERPER_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ q: query, num: 10 })
      });
      
      const data = await res.json();
      
      // Extract SaaS from search results
      for (const result of (data.organic || [])) {
        if (!result.link || !result.title) continue;
        
        // Use Groq to generate description
        try {
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
                content: `Based on this SaaS: "${result.title}" at ${result.link}. Generate: description (50-80 words), pricing (estimate), category (one of: Productivity, Marketing, Development, Design, AI, Analytics). Output as JSON: {"description":"...","pricing":"...","category":"..."}`
              }],
              temperature: 0.7
            })
          });
          
          const aiData = await aiRes.json();
          const details = JSON.parse(aiData.choices[0].message.content);
          
          const slug = result.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 100);
          
          await env.DB.prepare(
            'INSERT OR IGNORE INTO products (name, slug, description, url, pricing, category, logo_url) VALUES (?, ?, ?, ?, ?, ?, ?)'
          ).bind(
            result.title,
            slug,
            details.description,
            result.link,
            details.pricing || 'Contact',
            details.category || 'Other',
            `https://www.google.com/s2/favicons?domain=${result.link}&sz=128`
          ).run();
          
          totalAdded++;
          
          // Rate limit
          await new Promise(r => setTimeout(r, 1000));
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
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type': 'application/json'
    };

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    // GET products
    if (url.pathname === '/api/products') {
      try {
        const { results } = await env.DB.prepare(
          'SELECT * FROM products ORDER BY created_at DESC LIMIT 500'
        ).all();
        return new Response(JSON.stringify(results || []), { headers: cors });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
      }
    }

    // SEARCH products
    if (url.pathname === '/api/search') {
      const q = url.searchParams.get('q') || '';
      try {
        const { results } = await env.DB.prepare(
          'SELECT * FROM products WHERE name LIKE ? OR description LIKE ? OR category LIKE ? LIMIT 100'
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

    // SUBMIT with better error handling
    if (url.pathname === '/api/submit' && request.method === 'POST') {
      try {
        const body = await request.json();
        
        if (!body.name || !body.url || !body.description) {
          return new Response(JSON.stringify({ error: 'Missing required fields: name, url, description' }), { status: 400, headers: cors });
        }
        if (body.description.length < MIN_DESC) {
          return new Response(JSON.stringify({ error: `Description must be at least ${MIN_DESC} characters` }), { status: 400, headers: cors });
        }
        if (isSpam(body.name + body.description)) {
          return new Response(JSON.stringify({ error: 'Spam content detected' }), { status: 400, headers: cors });
        }
        
        const slug = body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 100) + '-' + Date.now();
        const logoUrl = body.logo_url || `https://www.google.com/s2/favicons?domain=${body.url}&sz=128`;
        
        const result = await env.DB.prepare(
          'INSERT INTO products (name, slug, description, url, pricing, category, logo_url) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).bind(
          body.name,
          slug,
          body.description,
          body.url,
          body.pricing || 'Free',
          body.category || 'Other',
          logoUrl
        ).run();
        
        console.log('Insert result:', result);
        
        return new Response(JSON.stringify({ success: true, slug, message: 'Product added successfully!' }), { headers: cors });
      } catch (e) {
        console.error('Submit error:', e);
        return new Response(JSON.stringify({ error: `Database error: ${e.message}` }), { status: 500, headers: cors });
      }
    }

    // MANUAL SCRAPE TRIGGER
    if (url.pathname === '/api/scrape-now' && request.method === 'POST') {
      try {
        const added = await scrapeRealSaaS(env);
        return new Response(JSON.stringify({ success: true, added }), { headers: cors });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
      }
    }

    return new Response('NodeMeld API - SaaS Directory', { headers: cors });
  },

  // Auto-scrape every 6 hours
  async scheduled(event, env, ctx) {
    console.log('Starting scheduled scrape...');
    try {
      await scrapeRealSaaS(env);
      console.log('Scheduled scrape complete');
    } catch (e) {
      console.error('Scheduled scrape error:', e);
    }
  }
};
