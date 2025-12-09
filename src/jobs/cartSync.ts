import cron from "node-cron";
import { getRedis } from "../config/redis";
import { pool } from "../config/db";
import { parseCart } from "../utils/cart";

// 🔹 Sync one user's cart from Redis → PostgreSQL
const syncCartToPostgres = async (userId: string, cart: Record<string, number>) => {
    if (!cart || Object.keys(cart).length === 0) return;

    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        // Ensure cart exists in Postgres
        const { rows } = await client.query(
            `INSERT INTO carts (user_id, updated_at, last_synced_at)
             VALUES ($1, NOW(), NOW())
             ON CONFLICT (user_id) DO UPDATE
             SET updated_at = NOW(), last_synced_at = NOW()
             RETURNING id`,
            [userId]
        );
        const cartId = rows[0].id;

        // Clear old items
        await client.query("DELETE FROM cart_items WHERE cart_id = $1", [cartId]);

        // UPSERT instead of delete+insert
        const items = Object.entries(cart);
        if (items.length > 0) {
            const values = items.flatMap(([productId, quantity]) => [cartId, productId, quantity]);
            const valuePlaceholders = items
                .map((_, i) => `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3}, NOW())`)
                .join(", ");

            const queryText = `
                INSERT INTO cart_items (cart_id, product_id, quantity, updated_at)
                VALUES ${valuePlaceholders}
                ON CONFLICT (cart_id, product_id)
                DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = NOW()
            `;
            await client.query(queryText, values);
        }

        await client.query("COMMIT");
        console.log(`✅ Synced cart for user ${userId} with ${Object.keys(cart).length} items`);
    } catch (err) {
        await client.query("ROLLBACK");
        console.error(`❌ Failed to sync cart for user ${userId}:`, err);
    } finally {
        client.release();
    }
};

// 🔹 Cron job: run every hour
export const startCartSyncJob = () => {
    cron.schedule("0 * * * *", async () => {
        console.log("⏳ Running cart sync job (dirty set)...");

        const redis = getRedis();
        try {
            const userIds = await redis.sMembers("dirtyCarts");
            console.log(`Found ${userIds.length} dirty carts`);

            for (const userId of userIds) {
                const cartRaw = await redis.hGetAll(`cart:${userId}`);
                const cart = parseCart(cartRaw);

                await syncCartToPostgres(userId, cart);

                // remove from dirty set after successful sync
                await redis.sRem("dirtyCarts", userId);
            }
            console.log("✅ Cart sync job finished");
        } catch (err) {
            console.error("❌ Cart sync job failed:", err);
        }
    });
};
