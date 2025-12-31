import express from 'express';
import config from '../config.js';

const router = express.Router();

// NOTE: These should ideally be in env vars or config, but for this task I'll use the provided ones directly or pass them from environment.
// Ideally usage: process.env.ANILIST_CLIENT_ID
const ANILIST_CLIENT_ID = process.env.ANILIST_CLIENT_ID || '33881';
const ANILIST_CLIENT_SECRET = process.env.ANILIST_CLIENT_SECRET || 'pfNnXkpS2tpfhikwKfdevfKWv8XLa3qmTe3o4SZm';
const REDIRECT_URI = `https://${config.discord.clientId}.discordsays.com/.proxy/api/anilist/callback`;

// 1. Redirect to AniList
router.get('/login', (req, res) => {
    console.log('Login route hit!');
    console.log('Config Client ID:', config.discord.clientId);
    console.log('AniList Client ID:', ANILIST_CLIENT_ID);

    if (!config.discord.clientId) {
        return res.status(500).send('Server Error: Missing DISCORD_CLIENT_ID');
    }

    const redirectUri = `https://${config.discord.clientId}.discordsays.com/.proxy/api/anilist/callback`;
    const authUrl = `https://anilist.co/api/v2/oauth/authorize?client_id=${ANILIST_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code`;

    // Use client-side redirect + Manual Link
    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Redirecting...</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            body { background: #1a1a1a; color: white; display: flex; flex-direction: column; justify-content: center; align-items: center; height: 100vh; font-family: sans-serif; text-align: center; }
            a { color: #02A9FF; text-decoration: none; border: 2px solid #02A9FF; padding: 10px 20px; border-radius: 6px; margin-top: 20px; display: inline-block; font-weight: bold; }
            a:hover { background: #02A9FF; color: white; }
            p { color: #ccc; max-width: 80%; line-height: 1.5; }
        </style>
    </head>
    <body>
        <p>Redirecting to AniList login...</p>
        <p>If you are not redirected automatically, click the button below:</p>
        <a href="${authUrl}">Login to AniList</a>
        <script>
            setTimeout(function() {
                window.location.href = "${authUrl}";
            }, 500);
        </script>
    </body>
    </html>
    `;
    res.send(html);
});

// 2. Callback
router.get('/callback', async (req, res) => {
    const { code } = req.query;

    if (!code) {
        return res.status(400).send('No code provided');
    }

    try {
        const response = await fetch('https://anilist.co/api/v2/oauth/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
            body: JSON.stringify({
                grant_type: 'authorization_code',
                client_id: ANILIST_CLIENT_ID,
                client_secret: ANILIST_CLIENT_SECRET,
                redirect_uri: REDIRECT_URI,
                code: code,
            }),
        });

        const data = await response.json();

        if (!response.ok) {
            console.error('AniList token error:', data);
            return res.status(500).send('Failed to exchange token');
        }

        const { access_token, expires_in } = data;

        // Serve a page that displays the token for Manual Copy-Paste
        const html = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>AniList Connected</title>
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <style>
                    body { background: #1a1a1a; color: white; display: flex; align-items: center; justify-content: center; height: 100vh; font-family: sans-serif; margin: 0; }
                    .card { background: #2a2a2a; padding: 2rem; border-radius: 12px; max-width: 90%; width: 400px; text-align: center; box-shadow: 0 4px 6px rgba(0,0,0,0.3); }
                    h2 { color: #02A9FF; margin-top: 0; }
                    input { width: 100%; padding: 12px; margin: 16px 0; background: #111; border: 1px solid #333; color: #fff; border-radius: 6px; font-family: monospace; font-size: 1.1em; text-align: center; }
                    button { background: #02A9FF; color: white; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-size: 1rem; font-weight: bold; width: 100%; }
                    button:hover { background: #0288cc; }
                    p { color: #ccc; line-height: 1.5; }
                </style>
            </head>
            <body>
                <div class="card">
                    <h2>Success!</h2>
                    <p>Copy the code below and paste it back into AnimeTogether.</p>
                    <input type="text" value="${access_token}" id="token" readonly onclick="this.select()">
                    <button onclick="copyToken()">Copy Code</button>
                    <p id="msg" style="font-size: 0.9em; min-height: 1.5em; color: #4caf50;"></p>
                </div>
                <script>
                    function copyToken() {
                        const copyText = document.getElementById("token");
                        copyText.select();
                        copyText.setSelectionRange(0, 99999); 
                        navigator.clipboard.writeText(copyText.value).then(() => {
                            document.getElementById("msg").innerText = "Copied to clipboard!";
                        });
                    }
                </script>
            </body>
            </html>
        `;

        res.send(html);

    } catch (error) {
        console.error('AniList callback error:', error);
        res.status(500).send('Internal Server Error');
    }
});

// 3. GraphQL Proxy
router.post('/graphql', async (req, res) => {
    const { query, variables } = req.body;
    const token = req.headers.authorization; // Expect 'Bearer <token>'

    if (!token) {
        return res.status(401).json({ error: 'No authorization token provided' });
    }

    try {
        const response = await fetch('https://graphql.anilist.co', {
            method: 'POST',
            headers: {
                'Authorization': token,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
            body: JSON.stringify({ query, variables })
        });

        const data = await response.json();

        if (!response.ok) {
            console.error('AniList GraphQL Proxy Error:', data);
            return res.status(response.status).json(data);
        }

        res.json(data);
    } catch (error) {
        console.error('AniList GraphQL Proxy Network Error:', error);
        res.status(500).json({ error: 'Failed to proxy request to AniList' });
    }
});

export default router;
