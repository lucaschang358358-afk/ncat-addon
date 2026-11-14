const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const cheerio = require("cheerio");

const TMDB_API_KEY = "fda2e44581f4c02ca5be907cd4a82cbd";

const manifest = {
    id: "org.custom.movieffm.real",
    version: "10.0.0",
    name: "MovieFFM 真實動態抓取",
    description: "真正透過搜尋引擎即時抓取 MovieFFM 資源",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: []
};

const builder = new addonBuilder(manifest);

// 1. TMDB 片名轉換
async function getChineseTitle(imdbId, type) {
    try {
        const url = `https://api.themoviedb.org/3/find/${imdbId}?api_key=${TMDB_API_KEY}&external_source=imdb_id&language=zh-CN`;
        const { data } = await axios.get(url);
        const result = type === "movie" ? data.movie_results[0] : data.tv_results[0];
        if (!result) return null;
        return {
            title: result.title || result.name,
            year: (result.release_date || result.first_air_date || "").split("-")[0]
        };
    } catch (err) {
        console.error("TMDB 轉換失敗:", err.message);
        return null;
    }
}

// 2. 核心功能：去 MovieFFM 真正搜尋並抓出 m3u8
async function scrapeMovieFFM(title) {
    try {
        console.log(`[真實爬蟲] 開始在 MovieFFM 搜尋: ${title}`);
        const searchUrl = `https://mvffm.net/?s=${encodeURIComponent(title)}`;
        
        // 發送搜尋請求
        const searchRes = await axios.get(searchUrl, {
            headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
        });
        const $ = cheerio.load(searchRes.data);

        let movieUrl = null;

        // 尋找搜尋結果中的第一部電影網址
        $('a').each((i, el) => {
            const href = $(el).attr('href');
            if (href && (href.includes('/movies/') || href.includes('/tvshows/')) && !movieUrl) {
                movieUrl = href;
            }
        });

        if (!movieUrl) {
            console.log(`[爬蟲結果] 找不到 ${title} 的電影頁面`);
            return null;
        }

        console.log(`[爬蟲結果] 找到電影頁面: ${movieUrl}，正在進入解析...`);

        // 進入該電影頁面
        const movieRes = await axios.get(movieUrl, {
            headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
        });

        const html = movieRes.data;
        const decodedHtml = decodeURIComponent(html); // 預防網址被編碼
        
        // 透過正規表達式尋找網頁原始碼內隱藏的 m3u8 直鏈 或 play.xluuss.com 網址
        let realM3u8 = null;
        const m3u8Match = decodedHtml.match(/(https:\/\/[^"']+\.m3u8)/i) || html.match(/(https:\/\/[^"']+\.m3u8)/i);
        const xluussMatch = decodedHtml.match(/(https:\/\/[^"']+xluuss[^"']+)/i) || html.match(/(https:\/\/[^"']+xluuss[^"']+)/i);

        if (m3u8Match) {
            realM3u8 = m3u8Match[1].replace(/\\/g, ''); // 清理轉義字元
        } else if (xluussMatch) {
            realM3u8 = xluussMatch[1].replace(/\\/g, '');
        }

        if (realM3u8) {
            console.log(`[爬蟲成功] 成功抓取真實播放源: ${realM3u8}`);
            return realM3u8;
        } else {
            console.log(`[爬蟲失敗] 進入了頁面，但找不到 m3u8 連結`);
            return null;
        }

    } catch (err) {
        console.error("[爬蟲發生錯誤]:", err.message);
        return null;
    }
}

// 3. 接收 Nuvio 請求
builder.defineStreamHandler(async ({ type, id }) => {
    const [imdbId] = id.split(":");
    
    const meta = await getChineseTitle(imdbId, type);
    if (!meta) {
        return { streams: [] };
    }

    console.log(`[Nuvio 請求觸發] 準備解析: ${meta.title}`);

    // 呼叫真實爬蟲
    const realUrl = await scrapeMovieFFM(meta.title);
    
    if (realUrl) {
        return {
            streams: [
                {
                    name: "MovieFFM\n真實抓取源",
                    title: `${meta.title} - 自動解析線路`,
                    url: realUrl,
                    behaviorHints: {
                        notWebReady: true,
                        proxyHeaders: {
                            request: {
                                "Referer": "https://mvffm.net/",
                                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
                            }
                        }
                    }
                }
            ]
        };
    }

    return { streams: [] };
});

const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port });
