const mysql = require('mysql2')

const db = null;

module.exports = {
    getConnectionPool: () => {
        if (!db) {
            console.log('Creating new database connection pool');
            return mysql.createPool({
                host: process.env.DB_HOST || 'localhost',
                user: process.env.DB_USER || 'bitjourney',
                password: process.env.DB_PASSWORD || 'password',
                database: process.env.DB_NAME || 'bitjourney'
            })
        } else {
            return db;
        }
    }
}