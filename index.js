const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");

const TMDB_API_KEY = "fda2e44581f4c02ca5be907cd4a82cbd";

const manifest = {
    id: "org.custom.movieffm.dynamic",
    version: "9.0.0",
    name: "MovieFFM 動態分流播放",
    description: "根據不同電影與劇集提供正確的串流播放源",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: []
};

const builder = new addonBuilder(manifest);

// 1. 透過 TMDB 將 IMDb ID 轉成中文片名
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

// 2. 影片真實網址對應字典（你之後看哪部片，只要把名稱跟對應的 m3u8 填進來）
const videoDatabase = {
    "陷入我们的热恋": [
        {
            name: "MovieFFM\n藍光線路",
            title: "陷入我们的热恋 - 正確播放源",
            url: "https://play.xluuss.com/play/xe7Nj4Qd/index.m3u8", // 這部片的真實網址
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
    ],
    // 如果你要加第二部片，格式如下：
    // "其他電影名稱": [
    //     {
    //         name: "MovieFFM\n藍光線路",
    //         title: "其他電影名稱 - 播放源",
    //         url: "你的m3u8網址",
    //         behaviorHints: { notWebReady: true, proxyHeaders: { request: { "Referer": "https://mvffm.net/" } } }
    //     }
    // ]
};

// 3. 接收 Nuvio 請求
builder.defineStreamHandler(async ({ type, id }) => {
    const [imdbId] = id.split(":");
    
    const meta = await getChineseTitle(imdbId, type);
    if (!meta) {
        return { streams: [] };
    }

    console.log(`[Nuvio 請求] 當前查詢片名: ${meta.title}`);

    // 檢查字典裡有沒有這部片
    if (videoDatabase[meta.title]) {
        console.log(`[成功對應] 找到 ${meta.title} 的專屬直鏈`);
        return { streams: videoDatabase[meta.title] };
    }

    console.log(`[未收錄] 找不到 ${meta.title} 的對應源`);
    return { streams: [] };
});

const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port });
