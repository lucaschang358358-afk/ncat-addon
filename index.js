const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");

const TMDB_API_KEY = "fda2e44581f4c02ca5be907cd4a82cbd";

// 這裡填寫蘋果CMS (MacCMS) 的公開 API 介面
// 通常是網域後面加上 /api.php/provide/vod/
// 你可以隨時替換成其他支援 MacCMS 的採集源 API
const CMS_API_URL = "https://mvffm.net/api.php/provide/vod/"; 

const manifest = {
    id: "org.custom.maccms.api",
    version: "11.0.0",
    name: "MacCMS API 影視直連",
    description: "透過標準蘋果CMS API獲取高畫質直鏈",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: []
};

const builder = new addonBuilder(manifest);

// TMDB 片名轉換
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

// 核心：透過 JSON API 獲取資料，絕不碰 HTML
async function fetchFromCMSAPI(title) {
    const streams = [];
    try {
        console.log(`[CMS API] 開始搜尋: ${title}`);
        
        // 蘋果 CMS 標準搜尋格式： ?ac=detail&wd=片名
        const searchUrl = `${CMS_API_URL}?ac=detail&wd=${encodeURIComponent(title)}`;
        
        const response = await axios.get(searchUrl, {
            timeout: 10000,
            headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
        });

        const data = response.data;
        
        // 檢查 API 是否有回傳資料 (MacCMS 標準格式為 data.list)
        if (!data || !data.list || data.list.length === 0) {
            console.log(`[API 回應] 找不到 ${title} 的相關資料`);
            return streams;
        }

        const movieData = data.list[0];
        console.log(`[API 成功] 找到影片: ${movieData.vod_name}`);

        // MacCMS 的播放源格式通常長這樣："藍光$https://...m3u8#備用$https://...m3u8"
        if (movieData.vod_play_url) {
            const playList = movieData.vod_play_url.split('#');
            
            playList.forEach(play => {
                const parts = play.split('$');
                if (parts.length >= 2) {
                    const sourceName = parts[0];
                    const url = parts[1];
                    
                    // 只挑選 m3u8 資源
                    if (url.includes('.m3u8')) {
                        streams.push({
                            name: `CMS 線路\n${sourceName}`,
                            title: `${movieData.vod_name} - ${sourceName}`,
                            url: url,
                            behaviorHints: {
                                notWebReady: true
                            }
                        });
                    }
                }
            });
        }
    } catch (err) {
        console.error(`[API 錯誤]:`, err.message);
    }
    return streams;
}

builder.defineStreamHandler(async ({ type, id }) => {
    const [imdbId] = id.split(":");
    
    const meta = await getChineseTitle(imdbId, type);
    if (!meta) {
        return { streams: [] };
    }

    console.log(`[Nuvio 請求] 準備解析: ${meta.title}`);

    const streams = await fetchFromCMSAPI(meta.title);
    return { streams };
});

const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port });
