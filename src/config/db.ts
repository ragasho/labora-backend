// src/config/db.ts
import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

const pool = new Pool({
    user: process.env.POSTGRES_USER,
    host: process.env.POSTGRES_HOST,
    database: process.env.POSTGRES_DB,
    password: process.env.POSTGRES_PASSWORD,
    port: process.env.POSTGRES_PORT ? Number(process.env.POSTGRES_PORT) : 5432,
    ssl: process.env.POSTGRES_SSL === "true" ? { rejectUnauthorized: false } : undefined,
});

// Test connection once at startup
(async () => {
    try {
        await pool.query("SELECT NOW()");
        console.log("✅ Connected to PostgreSQL");
    } catch (err) {
        console.error("❌ PostgreSQL connection error:", err);
    }
})();



export { pool };
