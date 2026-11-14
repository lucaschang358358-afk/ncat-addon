const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");

const manifest = {
    id: "org.custom.ncat.direct",
    version: "7.0.0",
    name: "網飛貓精準分流版",
    description: "確保不同電影和影集擁有獨立且正確的播放源",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: []
};

const builder = new addonBuilder(manifest);

// 這裡我們建立一個「以 IMDb ID (tt代號)」為主的精準對應字典
// 這樣不管片名怎麼轉，只要對應到正確的 IMDb ID 絕對不會播錯片！
const streamDatabase = {
    // 範例 1：《陷入我们的热恋》的 IMDb ID (假設你的這部片 IMDb ID 是這樣)
    // 請把 "ttXXXXXXXX" 換成你在 Nuvio 看到這部片真實的 tt 編號
    "ttXXXXXXXX": [
        {
            name: "網飛貓\n獨家線路",
            title: "陷入我们的热恋 - 專屬播放源",
            url: "https://hn.bfvvs.com/play/7e5J6YYa/index.m3u8", // 這邊放這部的正確網址
            behaviorHints: {
                notWebReady: true,
                proxyHeaders: {
                    request: {
                        "Referer": "https://ncat21.com/",
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
                    }
                }
            }
        }
    ]
};

builder.defineStreamHandler(async ({ type, id }) => {
    // 取得當前電影的 IMDb ID (例如 tt1234567)
    const [imdbId] = id.split(":");
    
    console.log(`[當前請求的 IMDb ID]: ${imdbId}`);

    // 如果資料庫裡有這個 ID，就回傳對應的資源
    if (streamDatabase[imdbId]) {
        console.log(`[精準命中] 成功載入 ${imdbId} 的專屬資源`);
        return { streams: streamDatabase[imdbId] };
    }

    // 如果沒有建檔，回傳空清單，避免亂跳到別的電影
    return { streams: [] };
});

const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port });
