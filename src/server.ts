// src/server.ts
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import categoriesRoutes from "./routes/categories";
import productsRoutes from "./routes/products";
import authRoutes from "./routes/auth"; // your existing auth routes
import { initRedis } from "./config/redis";
import { pool } from "./config/db";
import cartRoutes from "./routes/cart";
import addressRoutes from "./routes/address";
import couponsRoutes from "./routes/coupons";
import {startCartSyncJob} from "./jobs/cartSync"

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT);

app.use(cors({ origin: process.env.CLIENT_URL, credentials: true}));
app.use(express.json());

// Routes
app.use("/auth", authRoutes);
app.use("/categories", categoriesRoutes);
app.use("/products", productsRoutes);
app.use("/cart", cartRoutes);
app.use("/address", addressRoutes);
app.use("/coupons", couponsRoutes);

app.get("/health", (_, res) => {
    res.status(200).json({ status: "ok" });
});

async function startServer() {
    try {
        await initRedis();
        await pool.query("SELECT 1"); // Test DB connection
        console.log("🐘 PostgreSQL connected");

        // Start background jobs only after dependencies are ready
        startCartSyncJob();

        app.listen(PORT, () => {
            console.log(`🚀 Server running on http://localhost:${PORT}`);
        });
    } catch (err) {
        console.error("❌ Failed to start server:", err);
        process.exit(1);
    }
}

startServer();
