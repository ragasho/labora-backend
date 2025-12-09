// src/config/redis.ts
import { createClient, RedisClientType } from "redis";

let redis: RedisClientType | null = null;

export async function initRedis() {
    if (!redis) {
        redis = createClient({
            url: process.env.REDIS_URL || "redis://localhost:6379",
        });

        redis.on("error", (err) => console.error("❌ Redis Client Error:", err));

        await redis.connect();
        console.log("✅ Redis connected");
    }
    return redis;
}

export function getRedis(): RedisClientType {
    if (!redis) {
        throw new Error("Redis client not initialized. Call initRedis() first.");
    }
    return redis;
}
