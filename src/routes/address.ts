import { Router } from "express";
import { pool } from "../config/db";
import { authenticate, AuthRequest } from "../middleware/auth";
import { z } from "zod";
import camelcaseKeys from "camelcase-keys";

const router = Router();

/**
 * ✅ Zod Schemas
 */
export const createAddressSchema = z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    fullAddress: z.string().min(5, "Address must be at least 5 characters"),
    state: z.string().optional(),
    city: z.string().optional(),
    area: z.string().optional(),
    flatInfo: z.string().optional(),
    buildingName: z.string().optional(),
    landmark: z.string().optional(),
    label: z.enum(["Home", "Work", "Other"]).default("Other"),
    isDefault: z.boolean().optional(),
});

export const updateAddressSchema = createAddressSchema.partial();

type CreateAddressInput = z.infer<typeof createAddressSchema>;
type UpdateAddressInput = z.infer<typeof updateAddressSchema>;

/**
 * 👉 Add new address
 */
router.post("/", authenticate, async (req: AuthRequest, res) => {
    try {
        const userId = req.user?.id;

        const parsed = createAddressSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                success: false,
                message: "Validation failed",
                errors: parsed.error.issues, // ✅ fixed
            });
        }

        const { latitude, longitude, fullAddress, state, city, area, flatInfo, buildingName, landmark, label, isDefault } =
            parsed.data;

        if (isDefault) {
            await pool.query(
                "UPDATE customer_addresses SET is_default = false WHERE user_id = $1",
                [userId]
            );
        }

        const result = await pool.query(
            `INSERT INTO customer_addresses
             (user_id, latitude, longitude, full_address, state, city, area, flat_info, building_name, landmark, label, is_default)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                     RETURNING *`,
            [
                userId,
                latitude,
                longitude,
                fullAddress,
                state,
                city,
                area,
                flatInfo,
                buildingName,
                landmark || null,
                label || "Other",
                isDefault || false,
            ]
        );

        const address = camelcaseKeys(result.rows[0], { deep: true });
        res.json({ success: true, message: "Address added", address });
    } catch (err) {
        console.error("❌ Error adding address:", err);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
});

/**
 * 👉 Get all addresses of logged-in user
 */
router.get("/", authenticate, async (req: AuthRequest, res) => {
    try {
        const userId = req.user?.id;
        const result = await pool.query(
            "SELECT * FROM customer_addresses WHERE user_id = $1 ORDER BY created_at DESC",
            [userId]
        );

        const addresses = camelcaseKeys(result.rows, { deep: true });
        res.json({ success: true, addresses });
    } catch (err) {
        console.error("❌ Error fetching addresses:", err);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
});

/**
 * 👉 Update an address
 */
router.put("/:id", authenticate, async (req: AuthRequest, res) => {
    try {
        const userId = req.user?.id;
        const { id } = req.params;

        const parsed = updateAddressSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                success: false,
                message: "Validation failed",
                errors: parsed.error.issues, // ✅ fixed
            });
        }

        const { latitude, longitude, fullAddress, state, city, area, flatInfo, buildingName, landmark, label, isDefault } =
            parsed.data;

        if (isDefault) {
            await pool.query(
                "UPDATE customer_addresses SET is_default = false WHERE user_id = $1",
                [userId]
            );
        }

        const result = await pool.query(
            `UPDATE customer_addresses
             SET latitude = $1, longitude = $2, full_address = $3, state = $4, city = $5, area = $6,  flat_info = $7,
                building_name = $8, landmark = $9, label = $10, is_default = $11, updated_at = now()
             WHERE id = $12 AND user_id = $13
                 RETURNING *`,
            [
                latitude,
                longitude,
                fullAddress,
                state,
                city,
                area,
                flatInfo,
                buildingName,
                landmark || null,
                label || "other",
                isDefault || false,
                id,
                userId,
            ]
        );

        if (result.rowCount === 0) {
            return res
                .status(404)
                .json({ success: false, message: "Address not found" });
        }

        const address = camelcaseKeys(result.rows[0], { deep: true });
        res.json({ success: true, message: "Address updated", address });
    } catch (err) {
        console.error("❌ Error updating address:", err);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
});

/**
 * 👉 Delete an address
 */
router.delete("/:id", authenticate, async (req: AuthRequest, res) => {
    try {
        const userId = req.user?.id;
        const { id } = req.params;

        const result = await pool.query(
            "DELETE FROM customer_addresses WHERE id = $1 AND user_id = $2 RETURNING *",
            [id, userId]
        );

        if (result.rowCount === 0) {
            return res
                .status(404)
                .json({ success: false, message: "Address not found" });
        }

        res.json({ success: true, message: "Address deleted" });
    } catch (err) {
        console.error("❌ Error deleting address:", err);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
});

export default router;
