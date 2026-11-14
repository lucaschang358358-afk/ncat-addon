const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");

const TMDB_API_KEY = "fda2e44581f4c02ca5be907cd4a82cbd";

// 準備多個穩定的 CMS API，保證一次吐出多條線路
const CMS_APIS = [
    "https://cj.ffzyapi.com/api.php/provide/vod/", // 非凡資源
    "https://cj.lzcjy.com/api.php/provide/vod/",   // 量子資源
    "https://suoniapi.com/api.php/provide/vod/"    // 索尼資源
];

const manifest = {
    id: "org.custom.maccms.multi",
    version: "13.0.0",
    name: "MacCMS 多源聚合版",
    description: "聚合多個資源站，保證多條備用線路",
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

// 核心：同時向多個資料庫發送請求，並彙整所有線路
async function fetchFromMultipleCMS(title, type, targetEpisode) {
    const streams = [];
    
    // 平行發送請求到所有 CMS API (提高速度)
    const requests = CMS_APIS.map(apiUrl => {
        const searchUrl = `${apiUrl}?ac=detail&wd=${encodeURIComponent(title)}`;
        return axios.get(searchUrl, { timeout: 8000 }).catch(err => null); // 忽略斷線的庫
    });

    const responses = await Promise.all(requests);

    responses.forEach(response => {
        if (!response || !response.data || !response.data.list || response.data.list.length === 0) return;

        const movieData = response.data.list[0];
        const sources = (movieData.vod_play_from || "").split('$$$');
        const urlsGroups = (movieData.vod_play_url || "").split('$$$');

        for (let i = 0; i < sources.length; i++) {
            const sourceName = sources[i];
            if (!sourceName) continue;
            
            const epList = (urlsGroups[i] || "").split('#');
            let targetUrl = null;
            let targetTitle = "";

            if (type === "series" && targetEpisode) {
                // 精準尋找對應的集數
                for (const epStr of epList) {
                    if (!epStr.includes('$')) continue;
                    const [epName, epUrl] = epStr.split('$');
                    const numMatch = epName.match(/\d+/);
                    if (numMatch && parseInt(numMatch[0]) === parseInt(targetEpisode)) {
                        targetUrl = epUrl;
                        targetTitle = epName;
                        break;
                    }
                }
                // 容錯機制
                if (!targetUrl && epList.length >= parseInt(targetEpisode)) {
                    const fallbackStr = epList[parseInt(targetEpisode) - 1];
                    if (fallbackStr && fallbackStr.includes('$')) {
                        const [epName, epUrl] = fallbackStr.split('$');
                        targetUrl = epUrl;
                        targetTitle = epName;
                    }
                }
            } else {
                // 電影直接取第一集
                if (epList[0] && epList[0].includes('$')) {
                    const [epName, epUrl] = epList[0].split('$');
                    targetUrl = epUrl;
                    targetTitle = sourceName;
                }
            }

            // 確認取得 m3u8 後放入選單
            if (targetUrl && targetUrl.includes('.m3u8')) {
                streams.push({
                    name: `聚合線路\n${sourceName}`,
                    title: `${movieData.vod_name} - ${targetTitle}`,
                    url: targetUrl,
                    behaviorHints: { notWebReady: true }
                });
            }
        }
    });

    return streams;
}

builder.defineStreamHandler(async ({ type, id }) => {
    const [imdbId, season, episode] = id.split(":");
    const meta = await getChineseTitle(imdbId, type);
    if (!meta) return { streams: [] };

    // 進行多源搜尋
    const streams = await fetchFromMultipleCMS(meta.title, type, episode);
    return { streams };
});

serveHTTP(builder.getInterface(), { port: process.env.PORT || 7000 });
