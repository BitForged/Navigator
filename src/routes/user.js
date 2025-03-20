const router = require("express").Router();

const security = require("../security");
const database = require("../database");
const { getPermissionRole } = require("@/security");
const db = database.getConnectionPool();

router.get(
  /* /api/user/*/ "/me",
  security.isAuthenticated,
  async (req, res) => {
    const user = req.user;
    user.role = await getPermissionRole(req.user.discord_id);
    res.json({ user: req.user });
  },
);

router.get(/* /api/user/*/ "/jobs", security.isAuthenticated, (req, res) => {
  // Check if request has a category ID filter
  let categoryId = req.query.category_id;
  let categoryFilter = "";
  if (categoryId && !isNaN(categoryId) && categoryId !== "0") {
    categoryFilter = "AND category_id = ?";
  }

  // Grab a count of all images in the database for the user, to prepare for pagination
  db.query(
    `SELECT COUNT(*) AS count FROM images WHERE owner_id = ? ${categoryFilter}`,
    [req.user.discord_id, categoryId],
    (err, results) => {
      if (err) {
        console.error(err);
        res.status(500).json({ message: "Internal Server Error" });
        return;
      }

      let count = results[0].count;
      let limit = Number(req.query.limit) || 10;
      let page = Number(req.query.page) || 1;
      let offset = (page - 1) * limit;
      let totalPages = Math.ceil(count / limit);
      let currentPage = page;
      let previousPage = currentPage > 1 ? currentPage - 1 : null;
      let nextPage = currentPage < totalPages ? currentPage + 1 : null;

      if (categoryId && !isNaN(categoryId) && categoryId !== "0") {
        db.query(
          `SELECT id, category_id FROM images WHERE owner_id = ? AND category_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
          [req.user.discord_id, categoryId, limit, offset],
          (err, results) => {
            if (err) {
              console.error(err);
              res.status(500).json({ message: "Internal Server Error" });
              return;
            }
            res.json({
              count: count,
              totalPages: totalPages,
              currentPage: currentPage,
              previousPage: previousPage,
              nextPage: nextPage,
              images: results,
            });
          },
        );
      } else {
        db.query(
          `SELECT id, category_id FROM images WHERE owner_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
          [req.user.discord_id, limit, offset],
          (err, results) => {
            if (err) {
              console.error(err);
              res.status(500).json({ message: "Internal Server Error" });
              return;
            }
            res.json({
              count: count,
              totalPages: totalPages,
              currentPage: currentPage,
              previousPage: previousPage,
              nextPage: nextPage,
              images: results,
            });
          },
        );
      }
    },
  );
});

router.delete(
  /* /api/user/*/ "/image/:imageId",
  security.isAuthenticated,
  (req, res) => {
    db.query(
      "DELETE FROM images WHERE id = ? AND owner_id = ?",
      [req.params.imageId, req.user.discord_id],
      (err, _) => {
        if (err) {
          console.error(err);
          res.status(500).json({ message: "Internal Server Error" });
          return;
        }
        // TODO: Socket emit to instruct downstream bots to delete image from known channels.
        res.status(204).json({ message: "Image deleted" });
      },
    );
  },
);

router.get(
  /* /api/user/*/ "/image/:imageId/meta",
  security.isAuthenticated,
  async (req, res) => {
    let img = await database.getImageMetadata(req.params.imageId);
    if (img.owner_id !== req.user.discord_id) {
      res.status(403).json({ message: "You do not own this image" });
      return;
    }

    res.json(img);
  },
);

router.put(
  /* /api/user/*/ "/image/:imageId/category",
  security.isAuthenticated,
  async (req, res) => {
    if (
      req.body.categoryId !== 0 &&
      (!req.body.categoryId || !req.params.imageId)
    ) {
      res.status(400).json({ message: "Missing required fields" });
      return;
    }
    let imageId = req.params.imageId;
    let categoryId = Number(req.body.categoryId);

    // If the category ID is not a number, return a 400
    if (isNaN(categoryId)) {
      res.status(400).json({ message: "Category ID must be a number" });
      return;
    }

    // Ensure the user actually owns the image
    let image = await database.getImageById(imageId);
    if (!image || image.owner_id !== req.user.discord_id) {
      res
        .status(403)
        .json({ message: "Image does not exist or you do not own it" });
      return;
    }

    // Zero as a category ID means unset the category
    if (categoryId === 0) {
      categoryId = null;
    }

    // Don't attempt to look up a category if the category ID is null
    if (categoryId !== null) {
      try {
        // Ensure the user actually owns the category
        let category = await database.getCategoryById(categoryId);
        if (!category || category.owner_id !== req.user.discord_id) {
          res
            .status(403)
            .json({ message: "Category does not exist or you do not own it" });
          return;
        }
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Internal Server Error" });
      }
    }

    try {
      await database.asyncQuery(
        "UPDATE images SET category_id = ? WHERE id = ? AND owner_id = ?",
        [categoryId, imageId, req.user.discord_id],
      );
      res.status(204).json({ message: "Category updated" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  },
);

router.get(
  /* /api/user/*/ "/categories",
  security.isAuthenticated,
  async (req, res) => {
    try {
      let categories = await database.getCategoriesForUser(req.user.discord_id);
      // Decode base64 name
      categories = categories.map((category) => {
        category.name = Buffer.from(category.name64, "base64").toString(
          "utf-8",
        );
        // Delete the base64 name
        delete category.name64;
        return category;
      });
      res.json(categories);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  },
);

router.post(
  /* /api/user/*/ "/category",
  security.isAuthenticated,
  async (req, res) => {
    let name = req.body.name;
    if (name === undefined) {
      res.status(400).json({ message: "missing required fields" });
      return;
    }
    let name64 = Buffer.from(name).toString("base64");
    if (name64.length > 255) {
      res.status(400).json({ message: "Category name is too long" });
      return;
    }
    try {
      let category = await database.asyncQuery(
        "INSERT INTO image_categories (owner_id, name64) VALUES (?, ?)",
        [req.user.discord_id, name64],
      );
      res.json({ id: category.insertId });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  },
);

router.delete(
  /* /api/user/*/ "/category/:categoryId",
  security.isAuthenticated,
  async (req, res) => {
    if (isNaN(req.params.categoryId)) {
      res.status(400).json({ message: "Category ID must be a number" });
      return;
    }
    try {
      await database.asyncQuery(
        "DELETE FROM image_categories WHERE id = ? AND owner_id = ?",
        [req.params.categoryId, req.user.discord_id],
      );
      res.status(204).json({ message: "Category deleted" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  },
);

router.patch(
  /* /api/user/*/ "/category/:categoryId",
  security.isAuthenticated,
  async (req, res) => {
    let name = req.body.name;
    if (name === undefined) {
      res.status(400).json({ message: "missing required fields" });
      return;
    }
    if (isNaN(req.params.categoryId)) {
      res.status(400).json({ message: "Category ID must be a number" });
      return;
    }
    let name64 = Buffer.from(name).toString("base64");
    // Ensure the base64 length is less than 255
    if (name64.length > 255) {
      res.status(400).json({ message: "Category name is too long" });
      return;
    }
    try {
      await database.asyncQuery(
        "UPDATE image_categories SET name64 = ? WHERE id = ? AND owner_id = ?",
        [name64, req.params.categoryId, req.user.discord_id],
      );
      res.status(204).json({ message: "Category updated" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Internal Server Error" });
    }
  },
);

module.exports = router;
