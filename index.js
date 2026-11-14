const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");

const TMDB_API_KEY = "fda2e44581f4c02ca5be907cd4a82cbd";
const CMS_API_URL = "https://cj.ffzyapi.com/api.php/provide/vod/"; 

const manifest = {
    id: "org.custom.maccms.api",
    version: "12.0.0",
    name: "MacCMS 精準集數版",
    description: "自動過濾集數，提供多線路直連",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: []
};

const builder = new addonBuilder(manifest);

async function getChineseTitle(imdbId, type) {
    try {
        const url = `https://api.themoviedb.org/3/find/${imdbId}?api_key=${TMDB_API_KEY}&external_source=imdb_id&language=zh-CN`;
        const { data } = await axios.get(url);
        const result = type === "movie" ? data.movie_results[0] : data.tv_results[0];
        if (!result) return null;
        return { title: result.title || result.name };
    } catch (err) {
        return null;
    }
}

async function fetchFromCMSAPI(title, type, targetEpisode) {
    const streams = [];
    try {
        const searchUrl = `${CMS_API_URL}?ac=detail&wd=${encodeURIComponent(title)}`;
        const response = await axios.get(searchUrl, { timeout: 10000 });
        const data = response.data;
        
        if (!data || !data.list || data.list.length === 0) return streams;

        const movieData = data.list[0];
        
        // 解析 MacCMS 標準格式
        // vod_play_from: "非凡資源$$$量子資源"
        // vod_play_url: "第1集$url1#第2集$url2$$$第1集$url3#第2集$url4"
        const sources = (movieData.vod_play_from || "預設線路").split('$$$');
        const urlsGroups = (movieData.vod_play_url || "").split('$$$');

        for (let i = 0; i < sources.length; i++) {
            const sourceName = sources[i];
            const epList = (urlsGroups[i] || "").split('#');

            let targetUrl = null;
            let targetTitle = "";

            if (type === "series" && targetEpisode) {
                // 如果是影集，精準尋找對應的集數
                for (const epStr of epList) {
                    const [epName, epUrl] = epStr.split('$');
                    const numMatch = epName.match(/\d+/);
                    if (numMatch && parseInt(numMatch[0]) === parseInt(targetEpisode)) {
                        targetUrl = epUrl;
                        targetTitle = epName;
                        break;
                    }
                }
                // 容錯機制：如果沒抓到數字，用集數去推算索引位置
                if (!targetUrl && epList.length >= parseInt(targetEpisode)) {
                    const [epName, epUrl] = epList[parseInt(targetEpisode) - 1].split('$');
                    targetUrl = epUrl;
                    targetTitle = epName;
                }
            } else {
                // 如果是電影，直接取第一筆
                const [epName, epUrl] = epList[0].split('$');
                targetUrl = epUrl;
                targetTitle = sourceName;
            }

            // 確認取得正確的 m3u8 後推入選單
            if (targetUrl && targetUrl.includes('.m3u8')) {
                streams.push({
                    name: `CMS線路\n${sourceName}`,
                    title: `${movieData.vod_name} - ${targetTitle}`,
                    url: targetUrl,
                    behaviorHints: { notWebReady: true }
                });
            }
        }
    } catch (err) {
        console.error(`[API 錯誤]:`, err.message);
    }
    return streams;
}

builder.defineStreamHandler(async ({ type, id }) => {
    // 精準拆分出 season (季) 和 episode (集)
    const [imdbId, season, episode] = id.split(":");
    
    const meta = await getChineseTitle(imdbId, type);
    if (!meta) return { streams: [] };

    // 將 type 和 episode 傳入進行精準比對
    const streams = await fetchFromCMSAPI(meta.title, type, episode);
    return { streams };
});

serveHTTP(builder.getInterface(), { port: process.env.PORT || 7000 });
