import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');
  if (!url) return NextResponse.json({ error: 'No URL' }, { status: 400 });

  try {
    const fullUrl = url.startsWith('http') ? url : `https://${url}`;
    const res = await fetch(fullUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Glimmers/1.0; +https://glimmers.vercel.app)' },
      signal: AbortSignal.timeout(8000),
    });
    const html = await res.text();

    const getMeta = (name: string): string | null =>
      html.match(new RegExp(`<meta[^>]*(?:name|property)=["']${name}["'][^>]*content=["']([^"']+)["']`, 'i'))?.[1] ||
      html.match(new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*(?:name|property)=["']${name}["']`, 'i'))?.[1] ||
      null;

    const siteName = (
      getMeta('og:site_name') ||
      getMeta('application-name') ||
      html.match(/<title[^>]*>([^<|·\-–]+)/i)?.[1] ||
      new URL(fullUrl).hostname.replace('www.', '')
    )?.trim().substring(0, 50) ?? 'Your Brand';

    const themeColor = getMeta('theme-color') || getMeta('msapplication-TileColor');
    const ogImage = getMeta('og:image');
    const description = getMeta('og:description') || getMeta('description') || '';

    const content = (description + ' ' + html.substring(0, 6000)).toLowerCase();

    const signals: Record<string, string[]> = {
      cpg:        ['consumer goods','packaged goods','fmcg','brand','product','consumer','household','snack','beverage'],
      food_bev:   ['food','beverage','drink','restaurant','brewery','spirits','wine','beer','nutrition','cuisine'],
      sports:     ['sports','athlete','fitness','team','league','stadium','athletic','gym','coach','training'],
      technology: ['software','technology','tech','platform','digital','saas','app','cloud','data','ai','startup','developer'],
      healthcare: ['health','medical','wellness','care','clinical','hospital','patient','pharma','therapy','mental health'],
      finance:    ['finance','financial','bank','investment','insurance','wealth','capital','fund','trading','fintech'],
      retail:     ['retail','shop','store','ecommerce','commerce','fashion','apparel','marketplace','shopping'],
      automotive: ['automotive','vehicle','car','truck','auto','motor','drive','mobility','electric vehicle'],
    };

    let industry = 'technology';
    let maxScore = 0;
    for (const [ind, kws] of Object.entries(signals)) {
      const score = kws.filter(k => content.includes(k)).length;
      if (score > maxScore) { maxScore = score; industry = ind; }
    }

    // Extract hex colors, filter out near-black and near-white
    const hexMatches = [...new Set((html.match(/#[0-9a-f]{6}\b/gi) || []).map(c => c.toLowerCase()))];
    const brandColors = hexMatches.filter(c => {
      const r = parseInt(c.slice(1,3),16), g = parseInt(c.slice(3,5),16), b = parseInt(c.slice(5,7),16);
      const br = (r*299 + g*587 + b*114) / 1000;
      return br > 35 && br < 215;
    }).slice(0, 8);

    const primaryColor = themeColor || brandColors[0] || '#84d0f9';

    return NextResponse.json({
      companyName: siteName,
      primaryColor,
      allColors: brandColors,
      ogImage,
      industry,
      description: description.substring(0, 200),
    });
  } catch {
    return NextResponse.json({ error: 'Could not fetch that URL. Make sure it is publicly accessible.' }, { status: 500 });
  }
}
