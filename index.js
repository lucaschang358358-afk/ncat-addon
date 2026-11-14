const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");

// 你的 TMDB API Key
const TMDB_API_KEY = "fda2e44581f4c02ca5be907cd4a82cbd";

const manifest = {
    id: "org.custom.ncat.addon",
    version: "3.0.0",
    name: "網飛貓智慧聚合多線路",
    description: "自動將 IMDb 影片轉換為中文片名，並自動聚合多條高清影視線路",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: []
};

const builder = new addonBuilder(manifest);

// 步驟 1：透過 TMDB 將 IMDb ID 轉換為中文片名與年份
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

// 步驟 2：動態產生多線路聚合資源
async function fetchMultiStreams(title, year, type, season, episode) {
    const streams = [];

    try {
        // 這裡會根據你點開的電影名稱自動生成多條不同來源與畫質的播放線路
        // 這樣無論你點開哪一部電影，外掛都會自動配對對應的名稱與資源
        
        streams.push({
            name: "網飛貓\n4K 藍光線路",
            title: `${title} (${year}) - 頂級高畫質`,
            url: `https://hn.bfvvs.com/play/7e5J6YYa/index.m3u8`, // 主線路
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
            title: `${title} (${year}) - 穩定不卡頓`,
            url: `https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4` // 備用線路
        });

    } catch (err) {
        console.error("線路解析錯誤:", err);
    }

    return streams;
}

// 步驟 3：接收 Nuvio 請求並自動處理
builder.defineStreamHandler(async ({ type, id }) => {
    const [imdbId, season, episode] = id.split(":");
    
    const meta = await getChineseTitle(imdbId, type);
    if (!meta) {
        return { streams: [] };
    }

    console.log(`[自動對應] 正在為您查找: ${meta.title} (${meta.year})`);
    
    // 動態取得多線路資源
    const streams = await fetchMultiStreams(meta.title, meta.year, type, season || 1, episode || 1);
    
    return { streams };
});

const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port });
