import { Router } from "express";
import { pool } from "../config/db";
import { authenticate, AuthRequest } from "../middleware/auth";
import { z } from "zod";
import camelcaseKeys from "camelcase-keys";

const router = Router();

const getCouponsQuerySchema = z.object({
    cartTotal: z.preprocess(
        (val) => (typeof val === 'string' ? parseFloat(val) : val),
        z.number().min(0).optional()
    ),
});

/**
 * 👉 Get all applicable coupons
 * This endpoint returns coupons that are currently active and valid.
 * It can optionally filter by cart total if provided.
 */
router.get("/", async (req: AuthRequest, res) => {
    try {
        const validation = getCouponsQuerySchema.safeParse(req.query);

        if (!validation.success) {
            return res.status(400).json({ success: false, errors: validation.error.issues });
        }

        const { cartTotal } = validation.data;

        // Base query to get all currently active and valid coupons
        // We select columns explicitly for clarity and performance.
        // `end_date` is aliased to `expiry_date` so `camelcaseKeys` converts it to `expiryDate`,
        // matching the frontend's data structure from the mock data.
        let query = `
            SELECT 
                coupon_id,
                code,
                title,
                description,
                category,
                discount_type,
                discount_value,
                min_cart_value,
                max_discount,
                expiry_date 
            FROM coupons
            WHERE 
                is_active = true AND
                (start_date IS NULL OR start_date <= NOW()) AND
                (expiry_date IS NULL OR expiry_date >= NOW())
        `;

        const queryParams: any[] | undefined = [];

        // While we could filter by min_cart_value in the query,
        // it's better UX to return all valid coupons and let the frontend
        // show the user how much more they need to add to their cart.

        query += " ORDER BY min_cart_value ASC, discount_value DESC";

        const result = await pool.query(query, queryParams);

        // camelcaseKeys will convert snake_case (e.g., min_cart_value) to camelCase (minCartValue)
        const coupons = camelcaseKeys(result.rows);

        res.json({ success: true, coupons });
    } catch (err) {
        console.error("❌ Error fetching coupons:", err);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
});

export default router;