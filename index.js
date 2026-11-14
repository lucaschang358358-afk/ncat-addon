const express = require("express");
const { addonBuilder, getRouter } = require("stremio-addon-sdk");
const axios = require("axios");

const TMDB_API_KEY = "fda2e44581f4c02ca5be907cd4a82cbd";
const APP_URL = process.env.RENDER_EXTERNAL_URL || "https://ncat-addon.onrender.com";

// 擴充多個高效能的公開蘋果 CMS 資源站 API，維持你原本的架構，同時極大化播放線路
const CMS_APIS = [
    "https://ikunzyapi.com/api.php/provide/vod/",
    "https://api.olemovapi.com/api.php/provide/vod/",
    "https://suoniapi.com/api.php/provide/vod/",
    "https://cj.lziapi.com/api.php/provide/vod/",
    "https://bfzyapi.com/api.php/provide/vod/",
    "https://gzyunapi.com/api.php/provide/vod/"
];

const manifest = {
    id: "org.custom.nuvio.multisource.clean",
    version: "30.0.0",
    name: "Nuvio 多源極速直連",
    description: "維持原汁原味架構的多源 CMS 聚合播放源",
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
        return axios.get(searchUrl, { timeout: 8000 }).catch(() => null);
    });

    const responses = await Promise.all(requests);

    responses.forEach((response, apiIndex) => {
        if (!response || !response.data || !response.data.list || response.data.list.length === 0) return;

        const matchedMovies = response.data.list.slice(0, 2);

        matchedMovies.forEach(movieData => {
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
                } else {
                    if (epList[0] && epList[0].includes('$')) {
                        const [epName, epUrl] = epList[0].split('$');
                        targetUrl = epUrl;
                        targetTitle = sourceName;
                    }
                }

                if (targetUrl && targetUrl.includes('.m3u8')) {
                    const proxyUrl = `${APP_URL}/proxy?url=${encodeURIComponent(targetUrl)}`;
                    streams.push({
                        name: `聚合源 #${apiIndex + 1}\n${sourceName}`,
                        title: `${movieData.vod_name} - ${targetTitle}`,
                        url: proxyUrl
                    });
                }
            }
        });
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

const app = express();

app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    next();
});

app.get('/proxy', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send("No URL");

    try {
        const response = await axios({
            method: "GET",
            url: targetUrl,
            responseType: "text",
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
                "Referer": "https://mvffm.net/"
            }
        });

        res.set("Content-Type", "application/vnd.apple.mpegurl");
        const lines = response.data.split('\n');
        const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
        
        const rewritten = lines.map(line => {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('#')) {
                let absoluteUrl = trimmed;
                if (!trimmed.startsWith('http')) {
                    absoluteUrl = trimmed.startsWith('/') ? new URL(trimmed, targetUrl).href : baseUrl + trimmed;
                }
                
                if (absoluteUrl.includes('.m3u8')) {
                    return `${APP_URL}/proxy?url=${encodeURIComponent(absoluteUrl)}`;
                }
                return absoluteUrl;
            }
            return line;
        }).join('\n');
        
        res.send(rewritten);
    } catch (err) {
        res.status(500).send("Proxy Error");
    }
});

app.use('/', getRouter(builder.getInterface()));

const port = process.env.PORT || 7000;
app.listen(port, () => console.log(`Clean CMS Proxy Engine is running on port ${port}`));
