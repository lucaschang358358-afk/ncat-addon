const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");

const TMDB_API_KEY = "fda2e44581f4c02ca5be907cd4a82cbd";

const manifest = {
    id: "org.custom.ncat.map",
    version: "6.0.0",
    name: "網飛貓專屬對應直鏈版",
    description: "透過智慧片名映射提供穩定高清影視線路",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: []
};

const builder = new addonBuilder(manifest);

// 1. 轉換中文片名
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
        return null;
    }
}

// 2. 智慧影片對應表（你可以在這裡加入任何你想看的電影與其實際 m3u8 網址）
const movieDatabase = {
    "陷入我们的热恋": [
        {
            name: "網飛貓\n4K 獨家線路",
            title: "陷入我们的热恋 - 專屬高清源",
            url: "https://hn.bfvvs.com/play/7e5J6YYa/index.m3u8", // 這裡換成這部片的真實 m3u8
            behaviorHints: {
                notWebReady: true,
                proxyHeaders: {
                    request: {
                        "Referer": "https://ncat21.com/",
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                    }
                }
            }
        }
    ],
    "有病才会喜欢你": [
        {
            name: "網飛貓\n4K 獨家線路",
            title: "有病才会喜欢你 - 專屬高清源",
            url: "https://hn.bfvvs.com/play/7e5J6YYa/index.m3u8",
            behaviorHints: {
                notWebReady: true,
                proxyHeaders: {
                    request: {
                        "Referer": "https://ncat21.com/",
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                    }
                }
            }
        }
    ]
};

builder.defineStreamHandler(async ({ type, id }) => {
    const [imdbId, season, episode] = id.split(":");
    
    const meta = await getChineseTitle(imdbId, type);
    if (!meta) {
        return { streams: [] };
    }

    console.log(`[查詢片名] ${meta.title}`);

    // 檢查對應表裡面有沒有這部片
    if (movieDatabase[meta.title]) {
        console.log(`[成功配對] 找到 ${meta.title} 的專屬線路！`);
        return { streams: movieDatabase[meta.title] };
    }

    // 如果對應表沒有，回傳提示
    return {
        streams: [
            {
                name: "網飛貓\n未收錄提示",
                title: `${meta.title} - 目前尚未加入對應清單`,
                url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"
            }
        ]
    };
});

const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port });
