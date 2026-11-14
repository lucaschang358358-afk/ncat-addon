const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");

const TMDB_API_KEY = "fda2e44581f4c02ca5be907cd4a82cbd";

// 這裡精選了目前影視站 (包含 MovieFFM) 背後最常用的三大片源庫
const CMS_APIS = [
    "https://cj.ffzyapi.com/api.php/provide/vod/",     // 非凡資源 (ffm3u8)
    "https://api.tiankongapi.com/api.php/provide/vod/",// 天空資源 (tkm3u8)
    "https://ikunzyapi.com/api.php/provide/vod/"       // 愛坤資源 (ikm3u8)
];

const manifest = {
    id: "org.custom.maccms.nuvio",
    version: "14.0.0",
    name: "Nuvio 影視直連增強版",
    description: "破解防盜鏈，App內秒播 MovieFFM 同款線路",
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

async function fetchFromMultipleCMS(title, type, targetEpisode) {
    const streams = [];
    
    const requests = CMS_APIS.map(apiUrl => {
        const searchUrl = `${apiUrl}?ac=detail&wd=${encodeURIComponent(title)}`;
        return axios.get(searchUrl, { timeout: 8000 }).catch(err => null);
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
                if (!targetUrl && epList.length >= parseInt(targetEpisode)) {
                    const fallbackStr = epList[parseInt(targetEpisode) - 1];
                    if (fallbackStr && fallbackStr.includes('$')) {
                        const [epName, epUrl] = fallbackStr.split('$');
                        targetUrl = epUrl;
                        targetTitle = epName;
                    }
                }
            } else {
                if (epList[0] && epList[0].includes('$')) {
                    const [epName, epUrl] = epList[0].split('$');
                    targetUrl = epUrl;
                    targetTitle = sourceName;
                }
            }

            if (targetUrl && targetUrl.includes('.m3u8')) {
                streams.push({
                    name: `Nuvio 直連\n${sourceName}`,
                    title: `${movieData.vod_name} - ${targetTitle}`,
                    url: targetUrl,
                    // 【關鍵修復】告訴 Nuvio App 播放時要帶上偽裝標頭，騙過防盜鏈！
                    behaviorHints: {
                        notWebReady: true,
                        proxyHeaders: {
                            request: {
                                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
                                "Referer": "https://mvffm.net/",
                                "Origin": "https://mvffm.net"
                            }
                        }
                    }
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

    const streams = await fetchFromMultipleCMS(meta.title, type, episode);
    return { streams };
});

serveHTTP(builder.getInterface(), { port: process.env.PORT || 7000 });
