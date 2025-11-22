// api/proxy.js

const fetch = require('node-fetch');

module.exports = async (req, res) => {
    // শুধুমাত্র GET রিকোয়েস্ট সাপোর্ট করা
    if (req.method !== 'GET') {
        return res.status(405).send('Method Not Allowed');
    }
    
    // URL প্যারামিটার থেকে আসল ভিডিও লিংক নেওয়া
    const targetUrl = req.query.url;

    if (!targetUrl) {
        return res.status(400).send('URL parameter is missing.');
    }

    try {
        // ১. ক্লায়েন্ট থেকে আসা হেডারগুলি কপি করা
        const headers = { ...req.headers };
        // Host হেডার বাদ দেওয়া, কারণ সার্ভার নিজেই এটি সেট করবে
        delete headers.host; 
        
        // ২. টার্গেট URL-এ রিকোয়েস্ট পাঠানো (ভিডিও সার্ভারে)
        const response = await fetch(targetUrl, {
            method: 'GET',
            headers: headers, // ক্লায়েন্টের হেডারগুলি পাস করা
        });

        if (!response.ok) {
            // যদি রিকোয়েস্ট সফল না হয় (যেমন 404, 403), স্ট্যাটাস কোড ফিরিয়ে দেওয়া
            return res.status(response.status).send(`Failed to fetch the content from target. Status: ${response.status}`);
        }

        const contentType = response.headers.get('content-type') || '';
        
        // Response Body হিসেবে Text বা Buffer নেওয়া
        let responseBody;
        if (contentType.includes('mpegurl') || contentType.includes('dash+xml') || contentType.includes('text') || contentType.includes('json')) {
            responseBody = await response.text();
        } else {
            // যদি ভিডিও সেগমেন্ট বা বাইনারি ডেটা হয় (যেমন .ts, .mp4, .key)
            responseBody = await response.buffer(); 
        }

        // ৩. ম্যানিফেস্ট চেঞ্জিং লজিক (শুধুমাত্র .m3u8 বা .mpd এর জন্য)
        if (typeof responseBody === 'string' && (contentType.includes('mpegurl') || contentType.includes('dash+xml'))) {
            
            const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
            // Vercel-এর প্রক্সি URL হবে /api/proxy
            const proxyUrlBase = `/api/proxy?url=`; 

            // সমস্ত আপেক্ষিক বা পরম URL-কে প্রক্সি URL এ পরিবর্তন
            responseBody = responseBody.replace(/(URI\s*=\s*")?([^,"\s]+(\.m3u8|\.ts|\.aac|\.mp4|\.key|\.mpd|\.vtt))/g, (match, p1, p2) => {
                let originalUrl = p2;

                // যদি URL http বা / দিয়ে শুরু না হয়, তবে Base URL যোগ করা
                if (!originalUrl.startsWith('http') && !originalUrl.startsWith('/')) {
                    originalUrl = baseUrl + originalUrl;
                }
                
                const proxyUrl = proxyUrlBase + encodeURIComponent(originalUrl);
                
                if (p1) {
                    return p1 + proxyUrl + '"';
                }
                return proxyUrl;
            });
        }
        
        // ৪. ক্লায়েন্টের কাছে হেডার ও বডি পাঠানো
        
        // Content-Length হেডার যোগ করা (ভিডিও সেগমেন্টের জন্য গুরুত্বপূর্ণ)
        const contentLength = response.headers.get('content-length');
        if (contentLength) {
             res.setHeader('Content-Length', contentLength);
        }
        
        // অন্যান্য প্রয়োজনীয় হেডারগুলি ক্লায়েন্টের কাছে পাস করা
        response.headers.forEach((value, name) => {
             // কিছু প্রোটোকল হেডার বাদ দেওয়া
             if (!['transfer-encoding', 'connection', 'keep-alive', 'server', 'content-encoding', 'content-length'].includes(name.toLowerCase())) {
                res.setHeader(name, value);
             }
        });

        // চূড়ান্ত রেসপন্স পাঠানো
        res.status(response.status).send(responseBody);

    } catch (error) {
        console.error('Proxy Error:', error);
        // যেকোনো সার্ভার বা নেটওয়ার্ক ত্রুটির জন্য 500 এরর দেওয়া
        res.status(500).send('Internal Proxy Server Error');
    }
};
