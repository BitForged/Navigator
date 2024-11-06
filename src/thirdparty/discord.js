import axios from 'axios'

export class Discord {
    exchangeCodeForToken(code) {
        return axios.post('https://discord.com/api/v10/oauth2/token', new URLSearchParams({
            client_id: process.env.DISCORD_CLIENT_ID,
            client_secret: process.env.DISCORD_CLIENT_SECRET,
            grant_type: 'authorization_code',
            code,
            redirect_uri: process.env.DISCORD_REDIRECT_URI,
            scope: 'identify'
        }))
    }

    getUser(token) {
        return axios.get('https://discord.com/api/v10/users/@me', {
            headers: {
                Authorization: `Bearer ${token}`
            }
        })
    }
}
