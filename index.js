const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");

// 已填入你的 TMDB API Key
const TMDB_API_KEY = "fda2e44581f4c02ca5be907cd4a82cbd";

const manifest = {
    id: "org.custom.ncat.addon",
    version: "1.0.0",
    name: "網飛貓資源轉接",
    description: "為 Nuvio 提供中文影視資源解析",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"]
};

const builder = new addonBuilder(manifest);

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

async function fetchFromNcat(title, year, type, season, episode) {
    // 這裡之後補上抓取網飛貓 API 的邏輯
    // 目前先回傳測試用的範例連結確認流程通暢
    return [
        {
            name: "網飛貓\n1080P",
            title: `${title} (${year}) - 測試線路`,
            url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"
        }
    ];
}

builder.defineStreamHandler(async ({ type, id }) => {
    const [imdbId, season, episode] = id.split(":");
    const meta = await getChineseTitle(imdbId, type);
    if (!meta) return { streams: [] };

    const streams = await fetchFromNcat(meta.title, meta.year, type, season, episode);
    return { streams };
});

// Render 會自動帶入 process.env.PORT，本地則用 7000
const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port });