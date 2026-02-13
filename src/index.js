const SPAM_KEYWORDS = ['viagra', 'casino', 'porn', 'xxx', 'gambling'];
const MIN_DESC = 50;

function isSpam(text) {
  return SPAM_KEYWORDS.some(k => text.toLowerCase().includes(k));
}

async function scrapeLogoFromUrl(url) {
  try {
    // Try multiple methods to get logo
    const domain = new URL(url).hostname;
    
    // Method 1: Google Favicon API (most reliable)
    const googleFavicon = `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;
    
    // Method 2: Clearbit Logo API
    const clearbitLogo = `https://logo.clearbit.com/${domain}`;
    
    // Try Clearbit first (higher quality)
    const res = await fetch(clearbitLogo);
    if (res.ok) return clearbitLogo;
    
    // Fallback to Google
    return googleFavicon;
  } catch (e) {
    return null;
  }
}

async function scrapeRealSaaS(env) {
  const queries = [
    'best saas products 2026',
    'new productivity tools',
    'ai saas platforms',
    'marketing automation saas',
    'developer tools 2026',
    'design tools saas',
    'analytics platforms'
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
        body: JSON.stringify({ q: query, num: 10 })
      });
      
      const data = await res.json();
      
      for (const result of (data.organic || [])) {
        if (!result.link || !result.title) continue;
        
        try {
          // Scrape logo
          const logoUrl = await scrapeLogoFromUrl(result.link);
          
          // Use Groq to generate description
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
                content: `Based on: "${result.title}" at ${result.link}. Generate JSON only: {"description":"50-80 word description","pricing":"estimate like $9/mo or Free","category":"one of: Productivity, Marketing, Development, Design, AI, Analytics, Other"}`
              }],
              temperature: 0.7
            })
          });
          
          const aiData = await aiRes.json();
          const details = JSON.parse(aiData.choices[0].message.content);
          
          const slug = result.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 100) + '-' + Date.now();
          
          await env.DB.prepare(
            'INSERT OR IGNORE INTO products (name, slug, description, url, pricing, category, logo_url) VALUES (?, ?, ?, ?, ?, ?, ?)'
          ).bind(
            result.title,
            slug,
            details.description,
            result.link,
            details.pricing,
            details.category,
            logoUrl
          ).run();
          
          totalAdded++;
          await new Promise(r => setTimeout(r, 1500)); // Rate limit
        } catch (e) {
          console.error('AI/Logo error:', e);
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
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, PUT',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type': 'application/json'
    };

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    // GET products (randomized for social media feel)
    if (url.pathname === '/api/products') {
      try {
        const { results } = await env.DB.prepare(
          'SELECT * FROM products ORDER BY RANDOM() LIMIT 100'
        ).all();
        return new Response(JSON.stringify(results || []), { headers: cors });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
      }
    }

    // SEARCH products (separate endpoint)
    if (url.pathname === '/api/search') {
      const q = url.searchParams.get('q') || '';
      try {
        const { results } = await env.DB.prepare(
          'SELECT * FROM products WHERE name LIKE ? OR description LIKE ? OR category LIKE ? ORDER BY views DESC LIMIT 100'
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

    // SUBMIT with logo upload support
    if (url.pathname === '/api/submit' && request.method === 'POST') {
      try {
        const body = await request.json();
        
        if (!body.name || !body.url || !body.description) {
          return new Response(JSON.stringify({ error: 'Missing: name, url, description' }), { status: 400, headers: cors });
        }
        if (body.description.length < MIN_DESC) {
          return new Response(JSON.stringify({ error: `Description must be ${MIN_DESC}+ characters` }), { status: 400, headers: cors });
        }
        if (isSpam(body.name + body.description)) {
          return new Response(JSON.stringify({ error: 'Spam detected' }), { status: 400, headers: cors });
        }
        
        const slug = body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 100) + '-' + Date.now();
        
        // If user provided base64 logo, use it; otherwise scrape
        let logoUrl = body.logo_url;
        if (!logoUrl || !logoUrl.startsWith('data:image')) {
          logoUrl = await scrapeLogoFromUrl(body.url);
        }
        
        await env.DB.prepare(
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
        
        return new Response(JSON.stringify({ success: true, slug }), { headers: cors });
      } catch (e) {
        console.error('Submit error:', e);
        return new Response(JSON.stringify({ error: `DB error: ${e.message}` }), { status: 500, headers: cors });
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

    return new Response('NodeMeld API', { headers: cors });
  },

  async scheduled(event, env, ctx) {
    try {
      await scrapeRealSaaS(env);
    } catch (e) {
      console.error('Scheduled scrape error:', e);
    }
  }
};
