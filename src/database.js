const mysql = require('mysql2')

const db = null;

module.exports = {
    getConnectionPool: () => {
        if (!db) {
            console.log('Creating new database connection pool');
            this.db = mysql.createPool({
                host: process.env.DB_HOST || 'localhost',
                user: process.env.DB_USER || 'bitjourney',
                password: process.env.DB_PASSWORD || 'password',
                database: process.env.DB_NAME || 'bitjourney'
            });
            return this.db;
        } else {
            return this.db;
        }
    }
}