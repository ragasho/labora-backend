import { Router } from "express";
import camelcaseKeys from "camelcase-keys";
import { pool } from "../config/db";
import { z } from "zod";

const router = Router();

// NutritionalInfo schema
const NutritionalInfoSchema = z.object({
    calories: z.string().nullable().optional(),
    protein: z.string().nullable().optional(),
    carbs: z.string().nullable().optional(),
    fat: z.string().nullable().optional(),
    fiber: z.string().nullable().optional(),
    potassium: z.string().nullable().optional(),
    vitamin_c: z.string().nullable().optional(),
    calcium: z.string().nullable().optional(),
    vitamin_d: z.string().nullable().optional(),
    iron: z.string().nullable().optional(),
    sodium: z.string().nullable().optional(),
    folate: z.string().nullable().optional(),
    sugar: z.string().nullable().optional(),
    caffeine: z.string().nullable().optional(),
    antioxidants: z.string().nullable().optional(),
});

// ProductRatings schema
const ProductRatingsSchema = z.object({
    average: z.coerce.number().nullable().optional(),
    count: z.coerce.number().nullable().optional(),
});


// Product schema
const ProductSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    price: z.coerce.number(), // ✅ convert string → number
    originalPrice: z.coerce.number().nullable().optional(), // ✅ null allowed
    image: z.string(),
    categoryId: z.string(),
    unit: z.string(),
    inStock: z.boolean(),
    discount: z.coerce.number().nullable().optional(),
    description: z.string().nullable().optional(),
    brand: z.string().nullable().optional(),
    weight: z.string().nullable().optional(),
    nutritionalInfo: NutritionalInfoSchema.optional(),
    ingredients: z.array(z.string()).optional(),
    allergens: z.array(z.string()).optional(),
    storageInstructions: z.string().nullable().optional(),
    manufacturingDate: z.string().nullable().optional(), // ✅ allow null
    expiryDate: z.string().nullable().optional(),
    countryOfOrigin: z.string().nullable().optional(),
    ratings: ProductRatingsSchema.optional(),
    features: z.array(z.string()).optional(),
});



// ✅ GET /products
// ✅ GET /products (all or by IDs)
router.get("/", async (req, res) => {
    try {
        const ids = req.query.ids as string | undefined;

        let query = `
      SELECT
        p.*,
        ni.calories,
        ni.protein,
        ni.carbs,
        ni.fat,
        ni.fiber,
        ni.potassium,
        ni.vitamin_c,
        ni.calcium,
        ni.vitamin_d,
        ni.iron,
        ni.sodium,
        ni.folate,
        ni.sugar,
        ni.caffeine,
        ni.antioxidants,
        pr.average AS rating_average,
        pr.count AS rating_count
      FROM products p
               LEFT JOIN nutritional_info ni ON p.id = ni.product_id
               LEFT JOIN product_ratings pr ON p.id = pr.product_id
    `;

        if (ids) {
            const idList = ids.split(",").map((id) => `'${id}'`).join(",");
            query += ` WHERE p.id IN (${idList})`;
        }

        query += " ORDER BY p.name;";

        const result = await pool.query(query);
        const rows = result.rows.map((row) => camelcaseKeys(row, { deep: true }));

        const products = rows.map((row) =>
            ProductSchema.parse({
                ...row,
                nutritionalInfo: {
                    calories: row.calories,
                    protein: row.protein,
                    carbs: row.carbs,
                    fat: row.fat,
                    fiber: row.fiber,
                    potassium: row.potassium,
                    vitamin_c: row.vitaminC,
                    calcium: row.calcium,
                    vitamin_d: row.vitaminD,
                    iron: row.iron,
                    sodium: row.sodium,
                    folate: row.folate,
                    sugar: row.sugar,
                    caffeine: row.caffeine,
                    antioxidants: row.antioxidants,
                },
                ratings: row.ratingAverage
                    ? {
                        average: row.ratingAverage,
                        count: row.ratingCount,
                    }
                    : undefined,
            })
        );

        res.json(products);
    } catch (err) {
        console.error("Error fetching products:", err);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

export default router;
