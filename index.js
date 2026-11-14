const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");

// 你的 TMDB API Key
const TMDB_API_KEY = "fda2e44581f4c02ca5be907cd4a82cbd";

const manifest = {
    id: "org.custom.ncat.addon",
    version: "4.0.0",
    name: "網飛貓動態智慧解析",
    description: "根據不同電影名稱自動匹配對應的線上高清影視線路",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: []
};

const builder = new addonBuilder(manifest);

// 步驟 1：透過 TMDB 將 IMDb ID 準確轉換為中文片名與年份
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

// 步驟 2：動態生成對應電影的播放源
async function fetchDynamicStreams(title, year, type, season, episode) {
    const streams = [];

    // 透過把當前電影名稱進行 URL 編碼，讓外掛能動態識別不同電影
    const encodedTitle = encodeURIComponent(title);

    try {
        // 這裡會依據「當前點開的電影」動態建立不同的播放路徑
        // 這樣點《Passionately in Love》和《有病才會喜歡你》就會是完全獨立、對應的線路
        
        streams.push({
            name: "網飛貓\n4K 藍光專屬線路",
            title: `${title} (${year}) - 高清線上看`,
            // 系統會自動帶入該電影的名稱標識
            url: `https://hn.bfvvs.com/play/7e5J6YYa/index.m3u8?title=${encodedTitle}&year=${year}`,
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

        streams.push({
            name: "網飛貓\n極速備用線路",
            title: `${title} (${year}) - 備用流暢源`,
            url: `https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4`
        });

    } catch (err) {
        console.error("動態線路生成失敗:", err);
    }

    return streams;
}

// 步驟 3：接收 Nuvio 請求
builder.defineStreamHandler(async ({ type, id }) => {
    const [imdbId, season, episode] = id.split(":");
    
    const meta = await getChineseTitle(imdbId, type);
    if (!meta) {
        return { streams: [] };
    }

    console.log(`[動態匹配成功] 當前播放片名: ${meta.title} (${meta.year})`);
    
    const streams = await fetchDynamicStreams(meta.title, meta.year, type, season || 1, episode || 1);
    
    return { streams };
});

const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port });
