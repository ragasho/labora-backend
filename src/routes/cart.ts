import { Router } from "express";
import { getRedis } from "../config/redis";
import { authenticate, AuthRequest } from "../middleware/auth";
import { pool } from "../config/db";
import { parseCart } from "../utils/cart";

const router = Router();

const CART_TTL = 60 * 60 * 24; // 24 hours
const CART_KEY_PREFIX = "cart:";

const handleRedisError = (res: any, err: any, message: string) => {
    console.error("❌ Redis error:", err);
    res.status(500).json({ error: message });
};

// ✅ Add item to cart
router.post("/add", authenticate, async (req: AuthRequest, res) => {
    const redis = getRedis();
    const { productId, quantity } = req.body;
    const userId = req.user?.id;

    if (!userId) return res.status(401).json({ error: "User not authenticated" });

    const cartKey = `${CART_KEY_PREFIX}${userId}`;

    if (!productId || typeof quantity !== "number" || quantity <= 0) {
        return res.status(400).json({ error: "Valid productId and quantity required" });
    }

    try {
        await redis.hIncrBy(cartKey, productId, quantity);
        await redis.expire(cartKey, CART_TTL);

        // 🔹 Mark dirty
        await redis.sAdd("dirtyCarts", userId);

        res.json({ message: "Item added to cart" });
    } catch (err) {
        handleRedisError(res, err, "Failed to add to cart");
    }
});


// ✅ Get cart (if Redis empty → fallback to Postgres)
router.get("/", authenticate, async (req: AuthRequest, res) => {
    const redis = getRedis();
    const userId = req.user?.id;
    const cartKey = `${CART_KEY_PREFIX}${userId}`;

    try {
        let cartRaw = await redis.hGetAll(cartKey);

        if (Object.keys(cartRaw).length === 0) {
            // Load from Postgres
            const { rows } = await pool.query(
                `SELECT ci.product_id, ci.quantity
                 FROM cart_items ci
                 JOIN carts c ON ci.cart_id = c.id
                 WHERE c.user_id = $1`,
                [userId]
            );

            if (rows.length > 0) {
                const cart = rows.reduce((acc, row) => {
                    acc[row.product_id] = row.quantity;
                    return acc;
                }, {} as Record<string, number>);

                // Restore to Redis
                const pipeline = redis.multi();
                for (const [pId, qty] of Object.entries(cart)) {
                    pipeline.hSet(cartKey, pId, String(qty));
                }
                pipeline.expire(cartKey, CART_TTL);
                await pipeline.exec();

                return res.json(cart);
            }
            // No cart in Redis or PostgreSQL, return empty object.
            return res.json({});
        }

        // Cart was found in Redis, parse and return it.
        res.json(parseCart(cartRaw));
    } catch (err) {
        handleRedisError(res, err, "Failed to fetch cart");
    }
});

// ✅ Update quantity
router.put("/update", authenticate, async (req: AuthRequest, res) => {
    const redis = getRedis();
    const { productId, quantity } = req.body;
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "User not authenticated" });

    const cartKey = `${CART_KEY_PREFIX}${userId}`;

    if (!productId) return res.status(400).json({ error: "productId required" });
    if (quantity != null && typeof quantity !== "number") {
        return res.status(400).json({ error: "Quantity must be a number" });
    }

    try {
        if (quantity == null || quantity <= 0) {
            await redis.hDel(cartKey, productId);
        } else {
            await redis.hSet(cartKey, productId, quantity.toString());
        }
        await redis.expire(cartKey, CART_TTL);

        // 🔹 Mark dirty
        await redis.sAdd("dirtyCarts", userId);

        res.json({ message: "Cart updated" });
    } catch (err) {
        handleRedisError(res, err, "Failed to update cart");
    }
});


// ✅ Clear cart
router.delete("/clear", authenticate, async (req: AuthRequest, res) => {
    const redis = getRedis();
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "User not authenticated" });

    const cartKey = `${CART_KEY_PREFIX}${userId}`;
    try {
        await redis.del(cartKey);
        await pool.query(`DELETE FROM carts WHERE user_id = $1`, [userId]);

        // 🔹 Mark dirty
        await redis.sAdd("dirtyCarts", userId);

        res.json({ message: "Cart cleared" });
    } catch (err) {
        handleRedisError(res, err, "Failed to clear cart");
    }
});


// ✅ Bulk update
router.post("/update-bulk", authenticate, async (req: AuthRequest, res) => {
    const redis = getRedis();
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "User not authenticated" });

    const cartKey = `${CART_KEY_PREFIX}${userId}`;
    const { items } = req.body;
    if (!Array.isArray(items)) return res.status(400).json({ error: "Items array required" });

    try {
        const pipeline = redis.multi();
        for (const { productId, quantity } of items) {
            if (quantity > 0) {
                pipeline.hSet(cartKey, productId, quantity.toString());
            } else {
                pipeline.hDel(cartKey, productId);
            }
        }
        await pipeline.exec();
        await redis.expire(cartKey, CART_TTL);

        // 🔹 Mark dirty
        await redis.sAdd("dirtyCarts", userId);

        res.json({ message: "Cart updated in bulk" });
    } catch (err) {
        handleRedisError(res, err, "Failed to bulk update cart");
    }
});


// ✅ Checkout → Save Redis cart to PostgreSQL orders
router.post("/checkout", authenticate, async (req: AuthRequest, res) => {
    const redis = getRedis();
    const userId = req.user?.id;
    const cartKey = `${CART_KEY_PREFIX}${userId}`;

    try {
        const cartRaw = await redis.hGetAll(cartKey);
        const cart = parseCart(cartRaw);

        if (Object.keys(cart).length === 0) {
            return res.status(400).json({ error: "Cart is empty" });
        }

        // The authenticate middleware guarantees user is present.
        // Add a check for robustness and to satisfy TypeScript.
        if (!userId) {
            return res.status(401).json({ error: "Authentication error, user not found." });
        }

        const client = await pool.connect();
        try {
            await client.query("BEGIN");

            // Fetch product prices
            const productIds = Object.keys(cart);
            const priceResult = await client.query(
                `SELECT id, price FROM products WHERE id = ANY($1)`,
                [productIds]
            );
            const prices: Record<string, number> = priceResult.rows.reduce((acc, row) => {
                acc[row.id] = row.price;
                return acc;
            }, {});

            if (priceResult.rows.length !== productIds.length) {
                throw new Error("One or more products in the cart not found.");
            }

            // Calculate total amount from the prices fetched from the database
            let totalAmount = 0;
            for (const [productId, quantity] of Object.entries(cart)) {
                totalAmount += prices[productId] * quantity;
            }

            // Generate a simple, unique order number
            const orderNumber = `ORD-${Date.now()}-${userId.substring(0, 4)}`;

            // Create order
            const { rows } = await client.query(
                `INSERT INTO orders (user_id, status, placed_at, total_amount)
                 VALUES ($1, 'pending', NOW(), $2)
                 RETURNING id`,
                [userId, totalAmount]
            );
            const orderId = rows[0].id;

            // Insert items
            for (const [productId, quantity] of Object.entries(cart)) {
                const price = prices[productId];
                await client.query(
                    `INSERT INTO order_items (order_id, product_id, quantity, price)
                     VALUES ($1, $2, $3, $4)`,
                    [orderId, productId, quantity, price]
                );
            }

            await client.query("COMMIT");

            // The order is saved, now clear the cart from both Redis and PostgreSQL.
            // This prevents the cart from being restored from the DB backup on a subsequent GET /cart call.
            await redis.del(cartKey);
            await pool.query(`DELETE FROM carts WHERE user_id = $1`, [userId]);

            res.json({ message: "Checkout successful", orderId });
        } catch (err) {
            await client.query("ROLLBACK");
            console.error("❌ Checkout failed:", err);
            res.status(500).json({ error: "Checkout failed" });
            return;
        } finally {
            client.release();
        }
    } catch (err) {
        console.error("❌ Checkout failed (Redis error):", err);
        res.status(500).json({ error: "Checkout failed" });
    }
});

export default router;
