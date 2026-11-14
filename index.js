const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const puppeteer = require("puppeteer-core");
const chromium = require("@sparticuz/chromium");

const TMDB_API_KEY = "fda2e44581f4c02ca5be907cd4a82cbd";

const manifest = {
    id: "org.custom.ncat.puppeteer",
    version: "5.0.0",
    name: "網飛貓 Puppeteer 專屬解密版",
    description: "透過無頭瀏覽器自動繞過防爬蟲並動態抓取網飛貓真實線路",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: []
};

const builder = new addonBuilder(manifest);

// TMDB 轉換片名
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

// 核心：使用無頭瀏覽器模擬真實真人造訪，攔截網飛貓的 m3u8 播放源
async function fetchStreamWithPuppeteer(title) {
    let browser = null;
    try {
        console.log(`[Puppeteer] 正在啟動雲端瀏覽器尋找: ${title}`);
        
        // 設定雲端 Chrome 參數，繞過防除錯與機器人檢測
        browser = await puppeteer.launch({
            args: chromium.args,
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
            ignoreHTTPSErrors: true,
        });

        const page = await browser.newPage();
        
        // 偽裝 User-Agent 避免被一眼識破
        await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");

        let targetM3u8 = null;

        // 監聽所有網路請求，只要抓到 .m3u8 就把它攔截下來！
        page.on('request', (request) => {
            const url = request.url();
            if (url.includes('.m3u8')) {
                console.log(`[成功攔截串流] 找到真實網址: ${url}`);
                targetM3u8 = url;
            }
        });

        // 1. 先前往網飛貓首頁或搜尋頁
        const searchUrl = `https://ncat21.com/search?k=${encodeURIComponent(title)}`;
        await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });

        // 2. 嘗試自動點擊搜尋結果的第一部影片（模擬真人點擊）
        try {
            await page.waitForSelector('.module-item-pic a, .search-result a', { timeout: 5000 });
            await page.click('.module-item-pic a, .search-result a');
            
            // 等待播放頁面載入並觸發 m3u8 請求
            await page.waitForTimeout(4000);
        } catch (e) {
            console.log("[Puppeteer] 自動點擊失敗，嘗試直接讀取頁面元素");
        }

        await browser.close();
        return targetM3u8;

    } catch (err) {
        console.error("[Puppeteer 執行錯誤]:", err.message);
        if (browser) await browser.close();
        return null;
    }
}

// 接收 Nuvio 請求
builder.defineStreamHandler(async ({ type, id }) => {
    const [imdbId, season, episode] = id.split(":");
    
    const meta = await getChineseTitle(imdbId, type);
    if (!meta) {
        return { streams: [] };
    }

    console.log(`[開始解密] 目標片名: ${meta.title} (${meta.year})`);

    // 呼叫 Puppeteer 進行動態解密與抓包
    const realM3u8Url = await fetchStreamWithPuppeteer(meta.title);

    const streams = [];

    if (realM3u8Url) {
        streams.push({
            name: "網飛貓\nPuppeteer 獨家解密線路",
            title: `${meta.title} - 雲端自動繞過防禦成功`,
            url: realM3u8Url,
            behaviorHints: {
                notWebReady: true,
                proxyHeaders: {
                    request: {
                        "Referer": "https://ncat21.com/",
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                    }
                }
            }
        });
    } else {
        // 如果被擋下或找不到，提供一條提示性質的備用源
        streams.push({
            name: "網飛貓\n安全備用源",
            title: `${meta.title} - 防護攔截中，請稍後重試`,
            url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"
        });
    }

    return { streams };
});

const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port });
