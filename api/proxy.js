
// api/proxy.js

const fetch = require('node-fetch');

module.exports = async (req, res) => {
    // শুধুমাত্র GET রিকোয়েস্ট সাপোর্ট করা
    if (req.method !== 'GET') {
        return res.status(405).send('Method Not Allowed');
    }
    
    const targetUrl = req.query.url;

    if (!targetUrl) {
        return res.status(400).send('URL parameter is missing.');
    }

    try {
        // ১. ক্লায়েন্ট থেকে আসা হেডারগুলি কপি করা
        const headers = { ...req.headers };
        delete headers.host; 
        
        // ২. টার্গেট URL-এ রিকোয়েস্ট পাঠানো
        const response = await fetch(targetUrl, {
            method: 'GET',
            headers: headers,
        });

        if (!response.ok) {
            return res.status(response.status).send('Failed to fetch the content from target.');
        }

        const contentType = response.headers.get('content-type') || '';
        
        // Response Body
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
            const proxyUrlBase = `/api/proxy?url=`; 

            // সমস্ত আপেক্ষিক বা পরম URL-কে প্রক্সি URL এ পরিবর্তন
            responseBody = responseBody.replace(/(URI\s*=\s*")?([^,"\s]+(\.m3u8|\.ts|\.aac|\.mp4|\.key|\.mpd|\.vtt))/g, (match, p1, p2) => {
                let originalUrl = p2;

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
        response.headers.forEach((value, name) => {
             if (!['transfer-encoding', 'connection', 'keep-alive', 'server', 'content-encoding'].includes(name.toLowerCase())) {
                res.setHeader(name, value);
             }
        });

        res.status(response.status).send(responseBody);

    } catch (error) {
        console.error('Proxy Error:', error);
        res.status(500).send('Internal Proxy Server Error');
    }
};
