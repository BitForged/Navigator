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
                database: process.env.DB_NAME || 'bitjourney',
                multipleStatements: true
            });
            return this.db;
        } else {
            return this.db;
        }
    },

    asyncQuery: (query, params) => {
        return new Promise((resolve, reject) => {
            this.db.query(query, params, (err, results) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(results);
                }
            });
        });
    },

    getCategoriesForUser(userId) {
        return this.asyncQuery('SELECT * FROM image_categories WHERE owner_id = ?', [userId]);
    },

    async getCategoryById(categoryId) {
        let results = await this.asyncQuery('SELECT * FROM image_categories WHERE id = ?', [categoryId]);
        if (results.length === 0) {
            return null;
        } else {
            return results[0];
        }
    },

    async getImageById(imageId) {
        let results = await this.asyncQuery('SELECT * FROM images WHERE id = ?', [imageId]);
        if (results.length === 0) {
            return null;
        } else {
            return results[0];
        }
    },

    // We use this to get the metadata for an image, such as the category it belongs to, the owner, etc.
    // Technically, we could use the regular getImageById function, but that would return the image data itself,
    // which we don't need, and is a heavy operation.
    async getImageMetadata(imageId) {
        let results = await this.asyncQuery('SELECT category_id, created_at, message_id, owner_id FROM images WHERE id = ?', [imageId]);
        if (results.length === 0) {
            return null;
        } else {
            return results[0];
        }
    },

    async getModels() {
        return await this.asyncQuery('SELECT * FROM models');
    }
}