import { Router } from "express";
import { pool } from "../config/db";
import { z } from "zod";

const router = Router();

// Zod schema for category
const CategorySchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    image: z.string().url(),
    icon: z.string(),
});

// GET /categories
router.get("/", async (_, res) => {
    try {
        const result = await pool.query("SELECT * FROM categories ORDER BY name");

        const categories = result.rows.map((row) => CategorySchema.parse(row));

        res.json(categories);
    } catch (err) {
        console.error("Error fetching categories:", err);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

export default router;
