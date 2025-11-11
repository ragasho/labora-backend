// src/utils/otp.ts
import crypto from "crypto";
import { getRedis } from "../config/redis";

/**
 * Generate a secure 6-digit OTP
 */
export function generateOtp(length: number = 6): string {
    const min = Math.pow(10, length - 1);
    const max = Math.pow(10, length) - 1;
    return crypto.randomInt(min, max).toString();
}

/**
 * Save OTP in Redis with expiry (default 5 minutes)
 */
export async function saveOtp(phone: string, otp: string, ttl: number = 300): Promise<void> {
    try {
        const redis = getRedis(); // safer than always calling initRedis
        await redis.set(`otp:${phone}`, otp, { EX: ttl });
    } catch (err) {
        console.error("❌ Failed to save OTP in Redis:", err);
        throw err;
    }
}

/**
 * Retrieve OTP from Redis
 */
export async function getOtp(phone: string): Promise<string | null> {
    try {
        const redis = getRedis();
        return await redis.get(`otp:${phone}`);
    } catch (err) {
        console.error("❌ Failed to get OTP from Redis:", err);
        return null;
    }
}

/**
 * Delete OTP from Redis
 */
export async function deleteOtp(phone: string): Promise<void> {
    try {
        const redis = getRedis();
        await redis.del(`otp:${phone}`);
    } catch (err) {
        console.error("❌ Failed to delete OTP from Redis:", err);
    }
}
