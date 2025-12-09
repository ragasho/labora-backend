import request from 'supertest';
import express from 'express';
import { pool } from '../config/db';
import { getRedis, initRedis } from '../config/redis';
import cartRoutes from '../routes/cart';
import { AuthRequest } from '../middleware/auth';

// Mock the authentication middleware to simulate a logged-in user for all tests
jest.mock('../middleware/auth', () => ({
    ...jest.requireActual('../middleware/auth'),
    authenticate: (req: AuthRequest, res: express.Response, next: express.NextFunction) => {
        // For testing, we'll attach a static user object.
        // This user should exist in your development database.
        req.user = { id: '8e186c41-86b3-47ae-8d15-ada8f4371f75', phone: '917397153773' };
        next();
    },
}));

const app = express();
app.use(express.json());
app.use('/cart', cartRoutes);

const TEST_USER_ID = '8e186c41-86b3-47ae-8d15-ada8f4371f75'; // Must match the user ID in the mock above
const CART_KEY = `cart:${TEST_USER_ID}`;

describe('Cart Routes - Integration on Dev DB', () => {
    beforeAll(async () => {
        // Ensure Redis is connected before any tests run
        await initRedis();
    });

    // ⚠️ CRITICAL: This hook cleans up the database and Redis AFTER EACH test.
    // This is what prevents test data from permanently corrupting your dev database.
    afterEach(async () => {
        const redis = getRedis();
        await redis.del(CART_KEY);

        // TRUNCATE wipes the tables clean. RESTART IDENTITY resets auto-incrementing keys.
        // CASCADE handles foreign key relationships automatically.
        // Add any other tables your tests might touch to this list.
        await pool.query('TRUNCATE categories, products, carts, cart_items, orders, order_items RESTART IDENTITY CASCADE');
    });

    // Close connections after all tests in this file are complete
    afterAll(async () => {
        const redis = getRedis();
        if (redis.isOpen) await redis.quit();
        await pool.end();
    });

    test('GET /cart - should restore cart from PostgreSQL if Redis is empty', async () => {
        // 1. ARRANGE: Manually create a cart backup in your dev PostgreSQL.
        const client = await pool.connect();
        try {
            // Create a category to satisfy the foreign key constraint
            const categoryRes = await client.query(
                `INSERT INTO categories (name, image, icon) VALUES ('Test Category', 'test.jpg', 'test.svg') RETURNING id`
            );
            const categoryId = categoryRes.rows[0].id;

            // Create a product to ensure it exists and get its ID
            const productRes = await client.query(
                `INSERT INTO products (name, price, category_id, unit, in_stock) VALUES ('Test Soda', 2.50, $1, '12 oz can', true) RETURNING id`,
                [categoryId]
            );
            const productId = productRes.rows[0].id;

            await client.query('BEGIN');
            const { rows } = await client.query(
                'INSERT INTO carts (user_id) VALUES ($1) RETURNING id',
                [TEST_USER_ID]
            );
            const cartId = rows[0].id;
            await client.query(
                'INSERT INTO cart_items (cart_id, product_id, quantity) VALUES ($1, $2, $3)',
                [cartId, productId, 5]
            );
            await client.query('COMMIT');

            // 2. ACT: Call the GET /cart endpoint.
            const response = await request(app).get('/cart');

            // 3. ASSERT:
            // - The API should return the cart from the database.
            // - The cart should now be restored in Redis.
            expect(response.status).toBe(200);
            expect(response.body).toEqual({ [productId]: 5 });

            const redis = getRedis();
            const restoredCart = await redis.hGetAll(CART_KEY);
            expect(restoredCart).toEqual({ [productId]: '5' });
        } finally {
            client.release();
        }
    });

    test('POST /checkout - should create an order and clear the cart', async () => {
        // 1. ARRANGE:
        // Create a category and product to ensure it exists and we know its price.
        const categoryRes = await pool.query(
            `INSERT INTO categories (name, image, icon) VALUES ('Test Category 2', 'test2.jpg', 'test2.svg') RETURNING id`
        );
        const categoryId = categoryRes.rows[0].id;

        const productRes = await pool.query(
            `INSERT INTO products (name, price, category_id, unit, in_stock) VALUES ('Test Chips', 3.99, $1, '8 oz bag', true) RETURNING id`,
            [categoryId]
        );
        const productId = productRes.rows[0].id;

        // - Add the item to the user's Redis cart.
        const redis = getRedis();
        await redis.hSet(CART_KEY, productId, '3');

        // 2. ACT: Call the checkout endpoint.
        const response = await request(app).post('/cart/checkout');

        // 3. ASSERT:
        expect(response.status).toBe(200);
        expect(response.body.message).toBe('Checkout successful');
        expect(response.body.orderId).toBeDefined();

        // Verify Redis cart is cleared
        const redisCart = await redis.hGetAll(CART_KEY);
        expect(Object.keys(redisCart).length).toBe(0);

        // Verify PostgreSQL cart is cleared
        const pgCartResult = await pool.query('SELECT * FROM carts WHERE user_id = $1', [TEST_USER_ID]);
        expect(pgCartResult.rowCount).toBe(0);

        // Verify order was created
        const orderResult = await pool.query('SELECT * FROM orders WHERE user_id = $1', [TEST_USER_ID]);
        expect(orderResult.rowCount).toBe(1);
        const orderId = orderResult.rows[0].id;
        expect(parseFloat(orderResult.rows[0].total_amount)).toBeCloseTo(3.99 * 3);

        // Verify order items were created correctly
        const orderItemsResult = await pool.query('SELECT * FROM order_items WHERE order_id = $1', [orderId]);
        expect(orderItemsResult.rowCount).toBe(1);
        expect(orderItemsResult.rows[0].product_id).toBe(productId);
        expect(orderItemsResult.rows[0].quantity).toBe(3);
        expect(parseFloat(orderItemsResult.rows[0].price)).toBe(3.99);
    });
});